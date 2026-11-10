'use strict';
// Converts saved evidence only. It has no transport, database or approval API.
// Public deliveries stay timing-v1 until joint history-v1 qualification.
const crypto=require('node:crypto');
const {shape}=require('./paddock-rich-read'),schema=require('./paddock-rich-schema');
const fail=message=>{throw Object.assign(Error(message),{code:'RICH_MAPPING_REQUIRED'});};
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const text=(v,n=200)=>typeof v==='string'?[...v].slice(0,n).join(''):'';
const identity=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const stable=(kind,v)=>kind+'-'+crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,48);
const nullableId=v=>identity(v)?v:null;
const date=v=>{
 const ms=typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)?Date.parse(v):NaN;
 const d=new Date(ms);return Number.isFinite(d.getTime())&&d.getUTCFullYear()>=0&&d.getUTCFullYear()<=9999?d.toISOString():null;
};
const flag=v=>typeof v==='boolean'?v:Number.isInteger(v)&&v>=0?v>0:null;
const status=r=>r.dq?'disqualified':r.retired?'dnf':num(r.laps)===null?'unknown':r.laps>0?'finished':'dns';
function effects(r){
 const out=[],add=(kind,value,reason)=>{if(value==null||value===0)return;if(num(value)===null)fail('A saved adjustment is not a finite number.');out.push({kind,amount:value,reason:reason+'. Already included in classification; not measured laps or distance.'});};
 add('time',r.adjMs,'Race Director time adjustment');
 add('time',r.penalty==null?null:r.penalty-(r.pluginTimeMs??0),'Race-system time penalty');
 add('time',r.pluginTimeMs,'Plugin time adjustment');add('laps',r.adjLaps,'Race Director lap adjustment');
 add('laps',r.swapLost?-r.swapLost:null,'Driver-change deduction');
 if(num(r.points)!==null){add('points',r.adjPoints,'Race Director points adjustment');add('points',r.pluginPoints,'Plugin points adjustment');}return out;
}
// Counted is a NUMBER in Timing, not an array of heat IDs. Recover its members
// only from explicit participant indices, complete heat rows and saved drops.
function context(s,participants,heatIds,warnings){
 const teams=new Map(),classes=new Map(),classification=[];
 const byIndex=new Map();
 for(const r of s.standings||[]){const p=participants.get(r.carId);if(!p)continue;
  if(Number.isInteger(r.participant)){if(byIndex.has(r.participant)&&byIndex.get(r.participant)!==p)fail('Ambiguous saved heat participant.');byIndex.set(r.participant,p);}
  if(identity(r.teamId)){p.teamId=r.teamId;teams.set(r.teamId,{id:r.teamId,name:text(r.teamName)||r.teamId});}
 }
 const unit=(r,scope)=>{
  if(['practice','qualifying'].includes(s.sessionType))return 'ms';
  let basis=s.resultBy;
  if(scope==='class'){
   if(s.classResultBy)basis=s.classResultBy;
   else if(s.multiclass?.pointsMode==='class'){
    // Class-only heats can rank overall by laps but classes by points.
    // A saved non-leader gap names its unit; a leader gap does not.
    const known={time:'ms',points:'points',laps:'laps',distance:'m'}[r.classGap?.kind];
    if(known)return known;
    if(num(r.score)!==null)warnings.add('An older class score has no unambiguous saved scoring unit.');
    return null;
   }
  }
  return basis==='time'?'ms':basis==='points'?'points':r.measure==='distance'?'m':basis==='laps'?'laps':null;
 };
 const award=(r,p,scope='overall',scopeId=null,classId=null)=>{
  const state=status(r),u=unit(r,scope),score=['practice','qualifying'].includes(s.sessionType)?num(r.best):num(r.score);
  const dropped=Array.isArray(r.dropped)?r.dropped.map(n=>heatIds.get(String(n))).filter(Boolean):[];
  const driven=(s.heatResults||[]).filter(h=>!h.final&&h.rows?.some(x=>Number.isInteger(x.participant)&&byIndex.get(x.participant)===p));
  const eligible=driven.filter(h=>!r.dropped?.includes(h.heat)).map(h=>heatIds.get(String(h.heat))).filter(Boolean);
  const counted=Number.isInteger(r.counted)&&eligible.length===r.counted?eligible:[];
  const gap=r.classGap,gu={time:'ms',laps:'laps',points:'points',distance:'m'}[gap?.kind];
  const elapsed=scope==='overall'||scope==='class'?num(s.paddockJournal?.classifiedTimes?.[r.carId]):num(r.spentPen??r.total);
  let effectRow=r;
  if(scope==='overall'||scope==='class'){
   const entries=(s.paddockJournal?.heats||[]).flatMap(h=>(h.entries||[]).filter(e=>e.carId===r.carId));
   if(entries.length&&entries.every(e=>num(e.resultEffects?.penaltyMs)!==null&&num(e.resultEffects?.pluginMs)!==null)){
    const penalty=entries.reduce((n,e)=>n+e.resultEffects.penaltyMs,0),plugin=entries.reduce((n,e)=>n+e.resultEffects.pluginMs,0);
    effectRow={...r,penalty:r.penalty??penalty+plugin,pluginTimeMs:r.pluginTimeMs??plugin};
   }
  }
  const out={participantId:p.id,scope,scopeId,classId,position:state==='finished'&&Number.isInteger(r.pos)&&r.pos>0?r.pos:null,status:state,laps:num(r.laps),elapsedMs:elapsed,points:num(r.points),score:score!==null&&u?score:null,scoreUnit:score!==null&&u?u:null,gap:gu&&num(gap.value)!==null?{value:gap.value,unit:gu}:null,countedHeatIds:counted,droppedHeatIds:dropped,incomplete:flag(r.incomplete),estimated:flag(r.estimated),effects:effects(effectRow)};
  classification.push(out);return out;
 };
 for(const r of s.standings||[]){const p=participants.get(r.carId);if(p)award(r,p);}
 for(const r of s.classStandings||[]){const p=participants.get(r.carId);if(!p)continue;if(!identity(r.raceClass))fail('A class result is missing its saved class identity.');classes.set(r.raceClass,{id:r.raceClass,name:text(r.className)||r.raceClass});
  // Overall points copied into a class row are NOT class awards.
  award({...r,pos:r.classPos,points:r.classPoints??null},p,'class',r.raceClass,r.raceClass);
 }
 for(const h of s.heatResults||[]){const hid=heatIds.get(String(h.heat));if(!hid){warnings.add('Some heat classifications have no captured heat identity.');continue;}
  for(const r of h.rows||[]){const p=identity(r.carId)?participants.get(r.carId):byIndex.get(r.participant);if(!p){warnings.add('Some older heat rows lack a saved participant-to-car mapping.');continue;}
   award(r,p,h.final?'final':'heat',h.final?stable('final',[h.heat,h.final]):hid);
  }
 }
 if(s.champ)warnings.add('Championship membership is retained locally; it is not a saved championship award.');
 if(s.virtualRivals?.length)warnings.add('Virtual replay summaries remain local; they are not physical lap measurements.');
 const changes=[...(s.systemChanges||[]),...(s.heatResults||[]).flatMap(h=>h.systemChanges||[])].map(c=>({system:text(c.system,100),enabled:c.enabled,atMs:null}));
 // Engine event time is not a wall-clock offset (pauses and heats differ).
 if(changes.length)warnings.add('System changes are retained; their engine-clock timestamps are not converted to wall time.');
 return {savedAt:date(s.date),endedBy:typeof s.endedBy==='string'?text(s.endedBy):null,resumed:Number.isInteger(s.resumed)?s.resumed:null,weather:typeof s.weatherNote==='string'?text(s.weatherNote,2000):null,teams:[...teams.values()],classes:[...classes.values()],classification,systemChanges:changes,scoringSnapshot:null,notes:text('Saved reviewed classification. Adjustments are explanatory and must not be applied again. Unknown values stay unknown. '+[...warnings].join(' '),4000)};
}
function validate(bundle,{checkBytes=true}={}){
 const {race:r,context:c}=bundle;
 const body={...bundle,race:{...r,participants:r.participants.map(({laps,...p})=>p)}};
 shape(body,schema.body);
 const unique=xs=>{if(new Set(xs).size!==xs.length)fail('Duplicate rich-history identity.');};
 unique(r.participants.map(p=>p.id));unique(r.participants.filter(p=>p.carId).map(p=>p.carId));unique(r.heats.map(h=>h.id));
 unique(c.classification.map(a=>JSON.stringify([a.participantId,a.scope,a.scopeId,a.classId])));
 unique(r.track.lanes.map(l=>l.lane));
 const duration=r.startedAt===null?null:Date.parse(r.endedAt)-Date.parse(r.startedAt),all=[];
 if(duration!==null&&(duration<0||duration>604800000))fail('Captured session duration is invalid.');
 for(const h of r.heats)if(h.startedAtMs!==null&&h.endedAtMs!==null&&(h.startedAtMs>h.endedAtMs||duration!==null&&h.endedAtMs>duration))fail('Invalid heat interval.');
 for(const a of c.classification){
  if(!r.participants.some(p=>p.id===a.participantId)||a.classId!==null&&!c.classes.some(k=>k.id===a.classId)||a.scope==='class'&&a.classId!==a.scopeId||a.scope==='overall'&&(a.scopeId!==null||a.classId!==null)||a.scope==='heat'&&!r.heats.some(h=>h.id===a.scopeId)||['final','championship-award'].includes(a.scope)&&a.scopeId===null||(a.score===null)!==(a.scoreUnit===null)||a.position===1&&a.status!=='finished')fail('Invalid saved classification reference.');
  unique(a.countedHeatIds.concat(a.droppedHeatIds));if(a.countedHeatIds.concat(a.droppedHeatIds).some(id=>!r.heats.some(h=>h.id===id)))fail('Invalid counted/dropped heat reference.');
 }
 for(const p of r.participants){unique(p.stints.map(s=>s.id));unique(p.drivers.map(d=>d.id));let prior=null,stintEnd=null;
  if(p.teamId!==null&&!c.teams.some(t=>t.id===p.teamId))fail('Unknown saved team.');
  for(const st of p.stints){const h=r.heats.find(h=>h.id===st.heatId);if(!h||!p.drivers.some(d=>d.id===st.driverId)||!r.track.lanes.some(l=>l.lane===st.lane))fail('Invalid driver stint reference.');
   if(st.startedAtMs!==null&&st.endedAtMs!==null&&(st.startedAtMs>st.endedAtMs||h.startedAtMs!==null&&st.startedAtMs<h.startedAtMs||h.endedAtMs!==null&&st.endedAtMs>h.endedAtMs||stintEnd!==null&&st.startedAtMs<stintEnd))fail('Overlapping or invalid driver stint.');stintEnd=st.endedAtMs;
  }
  unique(p.laps.filter(l=>l.heatId!==null).map(l=>JSON.stringify([l.heatId,l.number])));
  for(const l of p.laps){shape(l,schema.lap);all.push(l.id);const st=p.stints.find(s=>s.id===l.stintId),h=r.heats.find(h=>h.id===l.heatId);
   if((l.personalRecordEligible===true||l.trackRecordEligible===true)&&(p.kind!=='physical'||l.valid!==true||l.pit!==false||l.durationMs===null||l.flags.length))fail('Ineligible lap marked as a record.');
   if(bundle.provenance.kind==='measured'&&(!st||!h||st.driverId!==l.driverId||st.lane!==l.lane||st.heatId!==l.heatId||l.endedAtMs<st.startedAtMs||l.endedAtMs>st.endedAtMs||l.endedAtMs-l.durationMs<h.startedAtMs||l.endedAtMs>h.endedAtMs||l.endedAtMs>duration||(prior!==null&&l.endedAtMs-l.durationMs<prior)))fail('Captured laps or driver boundaries overlap or are incomplete.');
   if(l.endedAtMs!==null)prior=l.endedAtMs;
  }
 }
 unique(all);if(all.length>50000||checkBytes&&Buffer.byteLength(JSON.stringify(bundle))>8*1024*1024)fail('Rich history exceeds the current 50,000-lap / 8 MiB limits.');return bundle;
}
function measured(session,rows,databaseId){
 const s=structuredClone(session),j=s.paddockJournal;
 if(!identity(s.id)||!identity(databaseId)||s.sessionType==='tokens')fail('Unsupported saved session identity or type.');
 if(!j?.heats?.length||!Array.isArray(j.lanes))fail('Original captured timing is required.');
 const heats=j.heats.slice().sort((a,b)=>a.startedAt-b.startedAt);
 if(heats.some(h=>num(h.startedAt)===null||num(h.endedAt)===null||h.endedAt<h.startedAt))fail('Original heat boundaries are missing.');
 const began=Math.min(...heats.map(h=>h.startedAt)),ended=Math.max(...heats.map(h=>h.endedAt)),offset=v=>v-began;
 const heatIds=new Map(heats.map(h=>[String(h.id),stable('heat',String(h.id))])),participants=new Map(),warnings=new Set();
 const saved=new Map(),matched=new Set();for(const r of rows){if(r.sessionId&&r.sessionId!==s.id)fail('Saved lap belongs to another session.');const key=JSON.stringify([r.carId,r.lane,r.lapNumber,String(r.heat??'')]);if(saved.has(key))fail('Ambiguous saved lap evidence.');saved.set(key,r);}
 const track={id:nullableId(s.trackId),name:text(s.trackName)||'Unknown track',lanes:j.lanes.map((v,i)=>({lane:i+1,lengthM:num(v)!==null&&v>0?v:null}))};
 for(const h of heats)for(const e of h.entries||[]){
  if(!identity(e.carId))fail('A measured participant needs its original Timing car identity.');
  let p=participants.get(e.carId);if(!p){const cap=j.captures?.[e.carId];if(cap?.configuration&&(cap.configuration.databaseId!==databaseId||cap.configuration.kind!=='current'))fail('Captured configuration does not belong to this collection.');
   p={id:stable('car',e.carId),kind:'physical',carId:cap?.configuration?.carId||null,configuration:cap?.configuration||null,displayName:text(cap?.name||e.driverName)||'Guest',teamId:null,drivers:[],stints:[],laps:[]};participants.set(e.carId,p);
  }
  const hid=heatIds.get(String(h.id)),changes=[{at:h.startedAt,driverId:e.driverId,driverName:e.driverName},...(e.changes||[])];
  for(let n=0;n<changes.length;n++){const c=changes[n],end=changes[n+1]?.at??h.endedAt;
   if(!identity(c.driverId)||num(c.at)===null||c.at<h.startedAt||end<c.at||end>h.endedAt)fail('Original driver boundaries are invalid.');
   if(!p.drivers.some(d=>d.id===c.driverId))p.drivers.push({id:c.driverId,name:text(c.driverName)||'Guest'});
   p.stints.push({id:stable('stint',[e.carId,h.id,n]),heatId:hid,driverId:c.driverId,lane:e.lane,startedAtMs:offset(c.at),endedAtMs:offset(end)});
  }
  for(const l of e.laps||[]){if(l.removed)continue;
   if(num(l.at)===null||num(l.time)===null||l.time<=0||typeof l.valid!=='boolean'||typeof l.pit!=='boolean')fail('A lap lacks original measured timing or validity.');
   const end=offset(l.at),st=p.stints.find(st=>st.heatId===hid&&st.driverId===l.driverId&&end>=st.startedAtMs&&end<=st.endedAtMs);
   if(!st)fail('A lap lacks its captured driver boundary.');
   const key=JSON.stringify([e.carId,e.lane,l.number,String(h.id)]),r=saved.get(key)||(heats.length===1?saved.get(JSON.stringify([e.carId,e.lane,l.number,''])):null);
   if(r){if(r.virtual===true||r.virtualRival===true||num(r.time)!==l.time||r.driverId&&r.driverId!==l.driverId)fail('Saved lap contradicts the original measured journal.');matched.add(r);}
   const flags=['invalid','tooSlow','late','redFlag'].filter(k=>r?.[k]===true),valid=l.valid&&r?.valid!==false&&!flags.length,eligible=valid&&!l.pit;
   p.laps.push({id:stable('lap',identity(r?.id)?['saved',r.id]:[e.carId,String(h.id),l.number]),originLapId:nullableId(r?.id),stintId:st.id,heatId:hid,driverId:st.driverId,lane:e.lane,number:l.number,durationMs:l.time,endedAtMs:end,valid,pit:l.pit,personalRecordEligible:r?eligible&&!r.noPersonalBest:null,trackRecordEligible:r?eligible&&!r.noTrackRecord:null,countsForDistance:true,distanceM:track.lanes[e.lane-1]?.lengthM??null,flags,reason:l.pit?'Pit lap':!valid?'Excluded by race rules':''});
  }
 }
 if(rows.some(r=>!matched.has(r)))fail('Some saved laps have no captured measured crossing. Keep them as historical evidence.');
 const c=context(s,participants,heatIds,warnings),ps=[...participants.values()];
 if(!ps.length)fail('No measured participants.');
 const missing=[];if(ps.some(p=>!p.configuration))missing.push('configuration');if(ps.some(p=>p.laps.some(l=>l.personalRecordEligible===null||l.trackRecordEligible===null)))missing.push('record-eligibility');if(track.lanes.some(l=>l.lengthM===null))missing.push('lane-lengths');if(!c.classification.length)missing.push('classification');
 return {bundle:validate({format:'history-v1',provenance:{kind:'measured',evidence:'Original Timing crossing journal, captured configurations and saved reviewed classification.',missing},race:{name:text(s.setupName)||'Race session',type:['practice','qualifying','endurance'].includes(s.sessionType)?s.sessionType:'race',startedAt:new Date(began).toISOString(),endedAt:new Date(ended).toISOString(),track,heats:heats.map(h=>({id:heatIds.get(String(h.id)),name:text(h.name)||'Heat',startedAtMs:offset(h.startedAt),endedAtMs:offset(h.endedAt)})),participants:ps},context:c}),warnings:[...warnings],sourceSessionId:s.id};
}
// New explicit historical submissions only. Existing frozen requests are never
// rebuilt. Historical record eligibility stays false regardless of saved flags.
function historical(bundle,e,groups){
 const map=new Map(),warnings=new Set();for(const [key,p] of groups){const [virtual,carId]=JSON.parse(key);if(!virtual&&carId)map.set(carId,p);}
 const heatIds=new Map();for(const l of e.laps)if(l.heat!=null&&l.heat!==''){const key=String(l.heat);if(!heatIds.has(key))heatIds.set(key,'heat-'+heatIds.size);}
 bundle.context=context(e.session,map,heatIds,warnings);
 // Acceptance belongs to the receipt, not to immutable evidence. This same
 // context is displayed after acceptance and after direct local adoption.
 bundle.context.notes=text('Historical Timing evidence. '+bundle.context.notes,4000);
 if(bundle.context.classification.length)bundle.provenance.missing=bundle.provenance.missing.filter(k=>k!=='classification');
 bundle.provenance.evidence='Saved Timing session and lap records. Original evidence is retained; missing timing boundaries are not reconstructed.';
 return validate(bundle,{checkBytes:false});
}
module.exports={measured,historical,validate};
