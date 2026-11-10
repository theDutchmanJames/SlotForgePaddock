'use strict';
// Private desktop reads, executed by historyView in the background worker.
const Q=require('./sqlite-query.cjs'),H=require('./shared-history-read.cjs'),T=require('./timing-integration.cjs');
const fail=(code,message)=>{throw T.fault(code,message,409);};
const ID=/^[\w-]{1,100}$/;
const active="json_extract(s.json,'$.payload.state')='active' AND coalesce(json_extract(s.json,'$._query.requiresCorrection'),0)=0";
const owner=require('./car-merge-query.cjs').owner;
const physical="json_extract(p.value,'$.kind')='physical' AND "+owner()+'=?';
function car(r,id){const row=r.db.prepare(`SELECT json_extract(f.json,'$') name,q.archived FROM query_records q JOIN records rr ON rr.key=q.key JOIN record_fields f ON f.record=q.key AND f.path='["name"]' WHERE q.bucket='["cars"]' AND rr.identity=?`).get('id:'+id);if(!row)fail('CAR_NOT_FOUND','This car no longer exists. Refresh the comparison.');return {id,...row};}
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('INVALID_QUERY','Invalid comparison options.');}
function selection(s){keys(s,['carId','sourceId','sessionId','participantId','lane','driverId']);for(const k of ['carId','sourceId','sessionId','participantId'])if(typeof s[k]!=='string'||!ID.test(s[k]))fail('INVALID_QUERY','Choose a car and recorded session.');if(s.driverId!==undefined&&(typeof s.driverId!=='string'||!ID.test(s.driverId)))fail('INVALID_QUERY','Invalid driver.');if(s.lane!==undefined&&(!Number.isInteger(s.lane)||s.lane<1||s.lane>64))fail('INVALID_QUERY','Invalid lane.');}
function cars(r,input){
 const where=`q.bucket='["cars"]' AND instr(sf_sort_text(json_extract(f.json,'$')),?)>0 AND EXISTS(SELECT 1 FROM query_sessions s JOIN json_each(s.json,'$.payload.participants') p WHERE ${owner()}=substr(rr.identity,4) AND ${active} AND json_extract(p.value,'$.kind')='physical')`;
 const from=` FROM query_records q JOIN records rr ON rr.key=q.key JOIN record_fields f ON f.record=q.key AND f.path='["name"]' WHERE ${where}`,query=(input.query||'').toLowerCase(),offset=input.offset||0;
 const total=r.db.prepare('SELECT count(*) n'+from).get(query).n,rows=r.db.prepare('SELECT substr(rr.identity,4) id,json_extract(f.json,\'$\') name,q.archived'+from+' ORDER BY sf_sort_text(name),rr.identity LIMIT 20 OFFSET ?').all(query,offset);
 return {rows,total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};
}
function sessions(r,input){
 const owner=car(r,input.carId),offset=input.offset||0,trackQuery=(input.query||'').toLowerCase();
 const from=` FROM query_sessions s JOIN json_each(s.json,'$.payload.participants') p WHERE ${active} AND ${physical} AND instr(sf_sort_text(json_extract(s.json,'$.payload.track.name')),?)>0`;
 const total=r.db.prepare('SELECT count(*) n'+from).get(input.carId,trackQuery).n;
 const rows=r.db.prepare(`SELECT s.source sourceId,s.session sessionId,json_extract(p.value,'$.id') participantId,json_extract(s.json,'$.payload.name') name,json_extract(s.json,'$.payload.startedAt') startedAt,json_extract(s.json,'$.bundle.context.savedAt') savedAt,json_extract(s.json,'$.payload.track') track,json_extract(p.value,'$.drivers') drivers,json_extract(s.json,'$.format') format,json_extract(s.json,'$.bundle.provenance.kind') provenance FROM query_sessions s JOIN json_each(s.json,'$.payload.participants') p WHERE ${active} AND ${physical} AND instr(sf_sort_text(json_extract(s.json,'$.payload.track.name')),?)>0 ORDER BY coalesce(julianday(json_extract(s.json,'$.payload.startedAt')),julianday(json_extract(s.json,'$.bundle.context.savedAt')),-1) DESC,s.source,s.session,json_extract(p.value,'$.id') LIMIT 20 OFFSET ?`).all(input.carId,trackQuery,offset).map(x=>({...x,carId:input.carId,track:JSON.parse(x.track),drivers:JSON.parse(x.drivers),format:x.format||'timing-v1',provenance:x.provenance||'measured'}));
 return {car:owner,rows,total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};
}
function measurements(rows,p,rich,filter){
 let n=0,mean=0,m2=0,total=0,personal=null,track=null,personalLaps=0,trackLaps=0,previous=null,window=[],sustained5=null,sustained10=null;
 const durations=[],lanes=new Set(),drivers=new Set(),stints=new Map(p.stints.map(s=>[s.id,s]));let unknownLane=0,unknownDriver=0;
 for(const row of rows){const l=JSON.parse(row.json),st=stints.get(l.stintId),lane=rich?l.lane:st?.lane,driver=rich?l.driverId:st?.driverId,heat=rich?l.heatId:st?.heatId;
  if(filter.lane!==undefined&&lane!==filter.lane||filter.driverId!==undefined&&driver!==filter.driverId){previous=null;window=[];continue;}
  total++;if(lane==null)unknownLane++;else lanes.add(lane);if(driver==null)unknownDriver++;else drivers.add(driver);
  if(l.valid!==true||l.pit!==false||!Number.isFinite(l.durationMs)){previous=null;window=[];continue;}
  durations.push(l.durationMs);n++;const delta=l.durationMs-mean;mean+=delta/n;m2+=delta*(l.durationMs-mean);
  if((rich?l.personalRecordEligible:l.recordEligible)===true){personalLaps++;personal=personal===null?l.durationMs:Math.min(personal,l.durationMs);}
  if((rich?l.trackRecordEligible:l.recordEligible)===true){trackLaps++;track=track===null?l.durationMs:Math.min(track,l.durationMs);}
  // A sustained run needs explicit continuity; missing timing never creates it.
  if(!Number.isFinite(l.endedAtMs)||!Number.isInteger(l.number)||!l.stintId||!heat||lane==null||driver==null){previous=null;window=[];continue;}
  const group=JSON.stringify([l.stintId,heat,lane,driver]);
  if(!previous||previous.group!==group||l.number!==previous.number+1||Math.abs(l.endedAtMs-l.durationMs-previous.ended)>1){window=[];}
  window.push(l.durationMs);if(window.length>10)window.shift();
  if(window.length>=5){const v=window.slice(-5).reduce((a,b)=>a+b,0)/5;sustained5=sustained5===null?v:Math.min(sustained5,v);}
  if(window.length===10){const v=window.reduce((a,b)=>a+b,0)/10;sustained10=sustained10===null?v:Math.min(sustained10,v);}
  previous={group,number:l.number,ended:l.endedAtMs};
 }
 durations.sort((a,b)=>a-b);const middle=Math.floor(n/2),deviation=n>=2?Math.sqrt(Math.max(0,m2/n)):null;
 return {totalLaps:total,validLaps:n,averageMs:n?mean:null,medianMs:n?(n%2?durations[middle]:(durations[middle-1]+durations[middle])/2):null,standardDeviationMs:deviation,coefficientPercent:deviation===null||!mean?null:deviation/mean*100,bestPersonalMs:personal,bestTrackMs:track,personalLaps,trackLaps,sustained5Ms:sustained5,sustained10Ms:sustained10,lanes:[...lanes].sort((a,b)=>a-b),driverIds:[...drivers].sort(),unknownLaneLaps:unknownLane,unknownDriverLaps:unknownDriver};
}
function side(r,s){
 const owner=car(r,s.carId),head=H.readWith(r,'http://localhost/v1/shared-history/sessions/'+s.sourceId+'/'+s.sessionId),rich=head.body?.format==='history-v1',race=rich?head.body.race:head.body?.payload;
 const row=r.db.prepare("SELECT key,json_extract(json,'$._query.requiresCorrection') quarantined FROM query_sessions WHERE source=? AND session=?").get(s.sourceId,s.sessionId);
 if(!race||row.quarantined)fail('RESULT_UNAVAILABLE','This session was withdrawn or needs correction. Refresh the comparison.');
 const p=race.participants.find(p=>p.id===s.participantId&&p.kind==='physical'&&r.merges.contribution(s.sourceId,s.sessionId,p.id,p.carId,head.body.format).status==='included'&&r.merges.contribution(s.sourceId,s.sessionId,p.id,p.carId,head.body.format).canonicalCarId===s.carId);if(!p)fail('PARTICIPANT_NOT_FOUND','This car is no longer a physical participant in the selected session.');
 if(s.lane!==undefined&&!race.track.lanes.some(l=>l.lane===s.lane))fail('INVALID_QUERY','This lane is not recorded for the session.');if(s.driverId!==undefined&&!p.drivers.some(d=>d.id===s.driverId))fail('INVALID_QUERY','This driver is not recorded for the participant.');
 const metrics=measurements(r.db.prepare('SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY position').iterate(row.key,p.id),p,rich,s);
 return {car:owner,sourceId:s.sourceId,sessionId:s.sessionId,participantId:p.id,accepted:head.accepted,resultToken:head.resultToken,format:head.body.format,name:race.name,startedAt:race.startedAt,savedAt:head.body.context?.savedAt||null,track:race.track,driverNames:metrics.driverIds.map(id=>p.drivers.find(d=>d.id===id)?.name||'Unknown'),configuration:p.configuration,provenance:rich?head.body.provenance:{kind:'measured'},metrics};
}
function read(store,input){
 keys(input,['operation','databaseId','recoveryId','snapshot','carId','query','offset','left','right']);
 if(!['pace-cars','pace-sessions','pace-compare'].includes(input.operation))fail('INVALID_QUERY','Unknown comparison operation.');
 for(const k of ['databaseId','recoveryId'])if(typeof input[k]!=='string'||!ID.test(input[k]))fail('INVALID_QUERY','Invalid library identity.');
 if(input.carId!==undefined&&(typeof input.carId!=='string'||!ID.test(input.carId)))fail('INVALID_QUERY','Invalid car.');
 if(input.query!==undefined&&(typeof input.query!=='string'||input.query.length>200))fail('INVALID_QUERY','Search is limited to 200 characters.');
 if(input.offset!==undefined&&(!Number.isSafeInteger(input.offset)||input.offset<0))fail('INVALID_QUERY','Invalid page.');
 if(input.snapshot!==undefined&&(typeof input.snapshot!=='string'||input.snapshot.length>1000))fail('INVALID_QUERY','Invalid snapshot.');
 if(input.operation==='pace-compare'){selection(input.left);selection(input.right);if(!input.snapshot)fail('INVALID_QUERY','Refresh the comparison before comparing.');}
 if(input.operation==='pace-sessions'&&!input.carId)fail('INVALID_QUERY','Choose a car.');
 return Q.read(store,null,r=>{
  if(input.databaseId!==r.id)fail('DATABASE_MISMATCH','The collection changed. Reopen Compare pace.');if(input.recoveryId!==r.epoch)fail('RECOVERY_CHANGED','The collection was restored. Reopen Compare pace.');
  const snapshot=JSON.stringify(r.token);if(input.snapshot!==undefined&&input.snapshot!==snapshot)fail('SNAPSHOT_CHANGED','The collection changed. Refresh selections before comparing current results.');
  const value=input.operation==='pace-cars'?cars(r,input):input.operation==='pace-sessions'?sessions(r,input):{left:side(r,input.left),right:side(r,input.right)};
  const result={databaseId:r.id,recoveryId:r.epoch,snapshot,...value};if(Buffer.byteLength(JSON.stringify(result))>8388608)fail('RESPONSE_TOO_LARGE','This comparison exceeds the display limit.');return result;
 }).value;
}
module.exports={read,measurements};
