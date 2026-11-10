'use strict';
// Trusted-local history projections. Run in the domain worker, never hydrate
// the collection or reconstruct complete lap arrays to browse accepted history.
const crypto=require('node:crypto'),Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs');
const BASE='/v1/shared-history',ID=/^[a-zA-Z0-9_-]{1,100}$/;
const fail=(code,message,status=400)=>{throw T.fault(code,message,status);};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const snapshot=r=>encode({databaseId:r.id,epoch:r.epoch,after:Number(r.db.prepare("SELECT value FROM state WHERE key='change_sequence'").get().value)});
const base=r=>({version:1,databaseId:r.id,recoveryId:r.epoch});
const accepted=x=>({revision:x.payload.revision,contentHash:x.contentHash,state:x.payload.state});
const token=(r,x)=>T.digest({databaseId:r.id,epoch:r.epoch,sourceId:x.payload.source.id,sessionId:x.payload.sessionId,contentHash:x.contentHash});
function params(url,allowed){const result={};for(const [k,v] of url.searchParams){if(!allowed.includes(k)||Object.hasOwn(result,k))fail('INVALID_QUERY','Unknown or repeated query parameter.');result[k]=v;}return result;}
function integer(v,min,max,fallback){if(v===undefined)return fallback;if(!/^\d+$/.test(v)||!Number.isSafeInteger(+v)||+v<min||+v>max)fail('INVALID_QUERY','Integer outside the supported range.');return +v;}
function filters(p){
 if(p.dateBasis!==undefined&&!['started','available'].includes(p.dateBasis))fail('INVALID_QUERY','Unknown date basis.');
 for(const k of ['carId','sourceId','trackId','sessionId','participantId','driverId'])if(p[k]!==undefined&&!ID.test(p[k]))fail('INVALID_QUERY','Invalid '+k+'.');
 if(p.trackId&&!p.sourceId)fail('INVALID_QUERY','Track IDs require sourceId.');
 for(const k of ['from','to'])if(p[k]!==undefined){if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(p[k])||!Number.isFinite(Date.parse(p[k]))||new Date(p[k]).toISOString().replace('.000Z','Z')!==p[k].replace('.000Z','Z'))fail('INVALID_QUERY','Use a valid UTC ISO timestamp.');p[k]=new Date(p[k]).toISOString();}
 if(p.from&&p.to&&p.from>=p.to)fail('INVALID_QUERY','from must precede to.');
 if(p.q!==undefined&&p.q.length>200)fail('INVALID_QUERY','Search text is limited to 200 characters.');
 if(p.state!==undefined&&!['all','active','withdrawn'].includes(p.state))fail('INVALID_QUERY','Unknown session state.');return p;
}
// lastActive is retained on new withdrawals. Already-discarded legacy metadata
// remains unknown rather than being replaced by the receipt date/current track.
const meta=`WITH metadata AS (SELECT s.key,s.source,s.session,s.json,
 json_extract(s.json,'$.payload.state') state,
 coalesce(json_extract(s.json,'$.bundle.context.savedAt'),json_extract(s.json,'$.lastActive.savedAt')) saved,
 coalesce(json_extract(s.json,'$.payload.startedAt'),json_extract(s.json,'$.lastActive.startedAt'),json_extract(s.json,'$.bundle.context.savedAt'),json_extract(s.json,'$.lastActive.savedAt')) effectiveDate,
 CASE WHEN json_extract(s.json,'$.payload.state')='active' THEN json_extract(s.json,'$.payload.startedAt') ELSE json_extract(s.json,'$.lastActive.startedAt') END started,
 CASE WHEN json_extract(s.json,'$.payload.state')='active' THEN json_extract(s.json,'$.payload.track.id') ELSE json_extract(s.json,'$.lastActive.trackId') END track,
 CASE WHEN json_extract(s.json,'$.payload.state')='active' THEN json_extract(s.json,'$.payload.track.name') ELSE coalesce(json_extract(s.json,'$.lastActive.trackName'),'') END trackName,
 coalesce(json_extract(s.json,'$.payload.name'),json_extract(s.json,'$.lastName'),'') name FROM query_sessions s)`;
function where(p,r){const sql=[],args=[];const add=(s,v)=>{sql.push(s);args.push(v);};
 if(p.carId){
  if(!r.merges.active)add('EXISTS(SELECT 1 FROM query_car_results c WHERE c.key=m.key AND c.car_id=?)',p.carId);
  else{sql.push(`(EXISTS(SELECT 1 FROM json_each(m.json,'$.payload.participants') p WHERE ${require('./car-merge-query.cjs').owner('m')}=?) OR (m.state='withdrawn' AND sf_history_withdrawal(m.source,m.session,json_extract(m.json,'$.carIds'),?)=1))`);args.push(p.carId,p.carId);}
 }
 if(p.sourceId)add('m.source=?',p.sourceId);if(p.trackId)add('m.track=?',p.trackId);
 const dateColumn=p.dateBasis==='available'?'m.effectiveDate':'m.started';
 if(p.from)add('julianday('+dateColumn+')>=julianday(?)',p.from);if(p.to)add('julianday('+dateColumn+')<julianday(?)',p.to);
 if(p.state&&p.state!=='all')add('m.state=?',p.state);
 if(p.q){sql.push('(instr(sf_sort_text(m.name),?)>0 OR instr(sf_sort_text(m.trackName),?)>0)');args.push(p.q.toLowerCase(),p.q.toLowerCase());}
 return {sql:sql.length?sql.join(' AND '):'1',args};
}
function seal(r,value){const body=encode(value),key=r.scalar('timing','key');if(!key)fail('STORAGE_FAILED','History signing key is unavailable.',503);return body+'.'+crypto.createHmac('sha256',key).update(body).digest('hex');}
function open(r,raw){let value;try{if(raw.length>4096||!/^[\w-]+\.[a-f0-9]{64}$/.test(raw))throw Error();value=JSON.parse(Buffer.from(raw.split('.')[0],'base64url'));if(!value||typeof value.snapshot!=='string')throw Error();}catch{fail('INVALID_PAGE','Invalid history continuation.');}
 // A restore can also replace the capture key. Reject its obsolete snapshot
 // before verifying the MAC; no unverified pagination values are used in SQL.
 if(value.snapshot!==snapshot(r))fail('SNAPSHOT_CHANGED','History changed; restart this listing.',409);
 try{if(seal(r,value)!==raw)throw Error();return value;}catch{fail('INVALID_PAGE','Invalid history continuation.');}}
function list(r,url){
 const p=filters(params(url,['carId','sourceId','trackId','from','to','q','state','limit','page','dateBasis'])),limit=integer(p.limit,1,50,50),page=p.page;delete p.page;delete p.limit;p.state=p.state||'all';p.q=p.q||'';
 const now=snapshot(r),f=where(p,r);let after='';
 if(page){const v=open(r,page);if(v.snapshot!==now)fail('SNAPSHOT_CHANGED','History changed; restart this listing.',409);if(v.filters!==T.canonical(p)||v.limit!==limit)fail('INVALID_PAGE','Repeat the same filters and limit.');
  after=' AND (coalesce(julianday(m.effectiveDate),-1)<? OR (coalesce(julianday(m.effectiveDate),-1)=? AND (m.source>? OR (m.source=? AND m.session>?))))';f.args.push(v.last[0],v.last[0],v.last[1],v.last[1],v.last[2]);
 }
 const rows=r.db.prepare(meta+` SELECT m.source,m.session,m.started,m.saved,m.effectiveDate,m.track,m.trackName,m.name,json_extract(m.json,'$.format') format,json_extract(m.json,'$.provenanceKind') provenance,coalesce(julianday(m.effectiveDate),-1) sortDate,
 json_object('payload',json_object('source',json_object('id',m.source),'sessionId',m.session,'revision',json_extract(m.json,'$.payload.revision'),'state',m.state),'contentHash',json_extract(m.json,'$.contentHash'),'carIds',json_extract(m.json,'$.carIds')) value
 FROM metadata m WHERE ${f.sql}${after} ORDER BY sortDate DESC,m.source,m.session LIMIT ?`).all(...f.args,limit+1);
 const more=rows.length>limit;if(more)rows.pop();const last=rows.at(-1);
 return {...base(r),snapshot:now,cursor:now,entries:rows.map(row=>{const x=JSON.parse(row.value);return {sourceId:row.source,sessionId:row.session,accepted:accepted(x),name:row.name,startedAt:row.started,savedAt:row.saved,effectiveDate:row.effectiveDate,dateBasis:row.started?'started':row.saved?'saved':'unknown',trackId:row.track,trackName:row.trackName,carIds:x.carIds,resultToken:token(r,x),format:row.format||'timing-v1',provenance:row.provenance||'measured'};}),nextPage:more?seal(r,{snapshot:now,filters:T.canonical(p),limit,last:[last.sortDate,last.source,last.session]}):null};
}
function session(r,url,match){
 const [,sourceId,sessionId,participantId]=match,p=params(url,participantId?['offset','token']:[]);
 const projection=participantId?`json_object('format',json_extract(json,'$.format'),'contentHash',json_extract(json,'$.contentHash'),'payload',json_object('source',json_object('id',source),'sessionId',session,'state',json_extract(json,'$.payload.state'),'participants',(SELECT json_group_array(json_object('id',json_extract(p.value,'$.id'))) FROM json_each(query_sessions.json,'$.payload.participants') p)))`:"json_remove(json,'$._query','$.history')";
 const row=r.db.prepare('SELECT key,'+projection+' json FROM query_sessions WHERE source=? AND session=?').get(sourceId,sessionId);if(!row)fail('SESSION_NOT_FOUND','No accepted session with this identity.',404);
 const x=JSON.parse(row.json),resultToken=token(r,x),common={...base(r),sourceId,sessionId,resultToken};
 if(!participantId){const payload=x.payload;if(payload.state==='active')payload.participants=payload.participants.map(({laps,...v})=>v);return {...common,accepted:accepted(x),body:payload.state==='active'?(x.format==='history-v1'?x.bundle:{format:'timing-v1',payload}):null,lapCounts:r.db.prepare('SELECT participant participantId,count(*) count FROM query_laps WHERE key=? GROUP BY participant ORDER BY participant').all(row.key)};}
 if(!p.token)fail('TOKEN_REQUIRED','Read the session head before downloading laps.');if(p.token!==resultToken)fail('RESULT_CHANGED','Discard partial pages and reload the accepted session.',409);
 if(x.payload.state!=='active')fail('SESSION_WITHDRAWN','Session has been withdrawn.',409);if(!x.payload.participants.some(v=>v.id===participantId))fail('PARTICIPANT_NOT_FOUND','Unknown participant.',404);
 const offset=integer(p.offset,0,1000000,0),total=r.db.prepare('SELECT count(*) n FROM query_laps WHERE key=? AND participant=?').get(row.key,participantId).n;if(offset>total)fail('INVALID_PAGE','Offset exceeds lap count.');
 const laps=r.db.prepare('SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY position LIMIT 250 OFFSET ?').all(row.key,participantId,offset).map(v=>JSON.parse(v.json));
 return {...common,participantId,format:x.format||'timing-v1',offset,total,nextOffset:offset+laps.length<total?offset+laps.length:null,laps};
}
function statistics(r,url,carId,{sessionScope=false}={}){
 const p=filters(params(url,['sourceId','trackId','from','to','lane','driverId','sessionId','participantId','snapshot','dateBasis']));
 if(p.driverId?(!p.sourceId||!p.sessionId||!p.participantId):(!sessionScope&&p.sessionId!==undefined||p.participantId!==undefined))fail('INVALID_QUERY','Driver filtering requires source, session, participant and driver together.');
 const lane=integer(p.lane,1,64,undefined),now=snapshot(r);if(p.snapshot!==undefined&&p.snapshot!==now)fail('SNAPSHOT_CHANGED','History changed; refresh the listing.',409);
 if(!r.db.prepare("SELECT 1 FROM query_records WHERE bucket='[\"cars\"]' AND key=?").get(JSON.stringify(['cars','id:'+carId])))fail('CAR_NOT_FOUND','Car no longer exists.',404);
 const f=where({...p,carId,state:'active'},r);if(p.sessionId){f.sql+=' AND m.session=?';f.args.push(p.sessionId);}
 const out={...base(r),carId,snapshot:now,cursor:now,acceptedSessions:0,historicalSessions:0,measuredLaps:0,validLaps:0,personalRecordLaps:0,trackRecordLaps:0,measuredTimeMs:0,averageLapMs:null,bestPersonalLapMs:null,bestTrackLapMs:null,distanceM:0,distanceComplete:true,unknownDistanceLaps:0,overallWins:0,classWins:0,manualIncluded:false,quarantinedSessions:0};
 // SQLite reads only selected sessions' indexed lap rows. The worker streams
 // small participant metadata; no JS array of the collection's laps is built.
 const rows=r.db.prepare(meta+` SELECT m.key,json_extract(m.json,'$.payload.type') type,json_extract(m.json,'$._query.requiresCorrection') quarantined,
 p.value participant,json_extract(m.json,'$.payload.standings') standings,json_extract(m.json,'$.format') format,json_extract(m.json,'$.bundle.provenance.kind') provenance,json_extract(m.json,'$.bundle.context.classification') classification FROM metadata m,json_each(m.json,'$.payload.participants') p
 WHERE ${f.sql} AND json_extract(p.value,'$.kind')='physical' AND ${require('./car-merge-query.cjs').owner('m')}=?`).iterate(...f.args,carId);
 const counted=new Set(),historical=new Set(),classes=new Set(),quarantined=new Set(),wins=new Set();
 for(const row of rows){const participant=JSON.parse(row.participant);if(p.participantId&&participant.id!==p.participantId)continue;
  if(row.format==='history-v1'){
   const v=require('./rich-history-statistics.cjs').participant(r.db,row.key,participant.id,{lane,driverId:p.driverId});
   if(v.n){counted.add(row.key);if(row.provenance==='historical')historical.add(row.key);}
   for(const field of ['measuredLaps','validLaps','measuredTimeMs','personalRecordLaps','trackRecordLaps','distanceM','unknownDistanceLaps'])out[field]+=v[field];
   for(const field of ['bestPersonalLapMs','bestTrackLapMs'])if(v[field]!==null)out[field]=out[field]===null?v[field]:Math.min(out[field],v[field]);
   if(lane===undefined&&!p.driverId&&!['practice','qualifying'].includes(row.type))for(const award of JSON.parse(row.classification))if(award.participantId===participant.id&&award.position===1&&award.status==='finished'){if(award.scope==='overall')wins.add(row.key);if(award.scope==='class')classes.add(JSON.stringify([row.key,award.classId]));}
   continue;
  }
  const stints=participant.stints.filter(s=>(lane===undefined||s.lane===lane)&&(!p.driverId||s.driverId===p.driverId)).map(s=>s.id);if(!stints.length)continue;
  if(row.quarantined){quarantined.add(row.key);continue;}
  const v=r.db.prepare(`SELECT count(*) n,sum(json_extract(json,'$.durationMs') IS NOT NULL) measured,
 sum(json_extract(json,'$.valid')=1 AND json_extract(json,'$.pit')=0) valid,
 sum(CASE WHEN json_extract(json,'$.valid')=1 AND json_extract(json,'$.pit')=0 THEN json_extract(json,'$.durationMs') ELSE 0 END) time,
 sum(json_extract(json,'$.valid')=1 AND json_extract(json,'$.pit')=0 AND json_extract(json,'$.recordEligible')=1) eligible,
 min(CASE WHEN json_extract(json,'$.valid')=1 AND json_extract(json,'$.pit')=0 AND json_extract(json,'$.recordEligible')=1 THEN json_extract(json,'$.durationMs') END) best,
 sum(CASE WHEN json_extract(json,'$.countsForDistance')=1 THEN coalesce(json_extract(json,'$.distanceM'),0) ELSE 0 END) distance,
 sum(json_extract(json,'$.countsForDistance')=1 AND json_extract(json,'$.distanceM') IS NULL) unknown
 FROM query_laps WHERE key=? AND participant=? AND json_extract(json,'$.stintId') IN (SELECT value FROM json_each(?))`).get(row.key,participant.id,JSON.stringify(stints));
  if(v.n)counted.add(row.key);out.measuredLaps+=v.measured||0;out.validLaps+=v.valid||0;out.measuredTimeMs+=v.time||0;out.personalRecordLaps+=v.eligible||0;out.trackRecordLaps+=v.eligible||0;out.distanceM+=v.distance||0;out.unknownDistanceLaps+=v.unknown||0;
  if(v.best!==null)for(const field of ['bestPersonalLapMs','bestTrackLapMs'])out[field]=out[field]===null?v.best:Math.min(out[field],v.best);
  if(lane===undefined&&!p.driverId&&!['practice','qualifying'].includes(row.type)&&JSON.parse(row.standings).some(s=>s.participantId===participant.id&&s.position===1&&s.status==='finished'))wins.add(row.key);
 }
 out.acceptedSessions=counted.size;out.historicalSessions=historical.size;out.classWins=classes.size;out.quarantinedSessions=quarantined.size;out.overallWins=wins.size;out.distanceComplete=out.unknownDistanceLaps===0;out.averageLapMs=out.validLaps?out.measuredTimeMs/out.validLaps:null;return out;
}
function readWith(r,raw){const url=new URL(raw);let value,match;if(url.pathname===BASE+'/sessions')value=list(r,url);else if((match=url.pathname.match(/^\/v1\/shared-history\/sessions\/([\w-]{1,100})\/([\w-]{1,100})(?:\/laps\/([\w-]{1,100}))?$/)))value=session(r,url,match);else if((match=url.pathname.match(/^\/v1\/shared-history\/cars\/([\w-]{1,100})\/statistics$/)))value=statistics(r,url,match[1]);else fail('NOT_FOUND','Unknown history read route.',404);if(Buffer.byteLength(JSON.stringify(value))>8388608)fail('RESPONSE_TOO_LARGE','History response exceeds 8 MiB.',413);return value;}
function read(store,raw){return Q.read(store,null,r=>readWith(r,raw)).value;}
module.exports={read,readWith,statistics};
