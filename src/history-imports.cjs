'use strict';
// Quarantined evidence and durable decisions. Owner Review may atomically
// approve history behind a separate closed gate; intake never accepts results.
const T=require('./timing-integration.cjs'),S=require('./history-import-schema.cjs'),Q=require('./sqlite-query.cjs');
const MAX_ITEMS=10000,MAX_PENDING=1000,MAX_LAPS=50000;
const fail=(code,message,status=400)=>{throw T.fault(code,message,status);};
const check=(condition,message)=>{if(!condition)fail('INVALID_PAYLOAD',message);};
const batchId=b=>'import-'+T.digest([b.recoveryId,b.editor.installationId,b.operationId]);
const itemId=(batch,id)=>'import-'+T.digest([batch,id]);
const recordKey=id=>JSON.stringify(['timing','imports','id:'+id]);
const bucket='["timing","imports"]';
function guard(r,input){if(input.databaseId!==r.id)fail('DATABASE_MISMATCH','This import belongs to another library.',409);if(input.recoveryId!==r.epoch)fail('RECOVERY_CHANGED','This library was restored or replaced. Reconcile retained imports before submitting again.',409);}
function unique(rows,key,label){const ids=rows.map(x=>x[key]);check(new Set(ids).size===ids.length,'Duplicate '+label+'.');return new Set(ids);}
function semantics(item,{historical=true}={}){
 const {race,context,provenance}=item.bundle;
 check(race.name.trim()&&race.participants.length,'Include a session name and at least one participant.');
 check(provenance.evidence.trim(),'Describe the historical evidence.');unique(provenance.missing.map(id=>({id})),'id','missing-evidence flag');
 const lanes=unique(race.track.lanes,'lane','lane'),heats=unique(race.heats,'id','heat'),participants=unique(race.participants,'id','participant'),teams=unique(context.teams,'id','team'),classes=unique(context.classes,'id','class');
 const interval=x=>check(x.startedAtMs===null||x.endedAtMs===null||x.endedAtMs>=x.startedAtMs,'An interval ends before it starts.');
 check(!race.startedAt||!race.endedAt||race.endedAt>=race.startedAt,'Session ends before it starts.');race.heats.forEach(interval);
 let laps=0;const carIds=new Set(),lapIds=new Set();
 for(const p of race.participants){
  check(p.teamId===null||teams.has(p.teamId),'Unknown participant team.');
  check(p.kind!=='virtual'||p.carId===null&&p.configuration===null,'Virtual participants cannot claim a physical car or configuration.');
  if(p.carId){check(!carIds.has(p.carId),'A physical car appears in multiple participants.');carIds.add(p.carId);}
  check(!p.configuration||p.carId!==null,'Configuration requires an identified car.');if(p.configuration?.carId)check(p.configuration.carId===p.carId,'Captured configuration belongs to another car.');
  const drivers=unique(p.drivers,'id','driver'),stints=unique(p.stints,'id','stint'),stintMap=new Map(p.stints.map(s=>[s.id,s]));unique(p.laps,'id','lap');
  for(const s of p.stints){check(heats.has(s.heatId)&&drivers.has(s.driverId)&&lanes.has(s.lane),'Unknown stint heat, driver or lane.');interval(s);}
  for(const l of p.laps){
   check(!lapIds.has(l.id),'Duplicate lap identity across participants.');lapIds.add(l.id);
   check(l.stintId===null||stints.has(l.stintId),'Unknown lap stint.');check(l.heatId===null||heats.has(l.heatId),'Unknown lap heat.');check(l.driverId===null||drivers.has(l.driverId),'Unknown lap driver.');check(l.lane===null||lanes.has(l.lane),'Unknown lap lane.');
   const stint=stintMap.get(l.stintId);if(stint)check((l.heatId===null||l.heatId===stint.heatId)&&(l.driverId===null||l.driverId===stint.driverId)&&(l.lane===null||l.lane===stint.lane),'Lap contradicts its stint.');
   if(historical)check(l.personalRecordEligible!==true&&l.trackRecordEligible!==true,'Historical intake cannot declare record eligibility; retain false or null.');
   check(p.kind!=='virtual'||!l.countsForDistance,'Virtual laps cannot add physical distance.');
  }
  laps+=p.laps.length;
 }
 check(laps<=MAX_LAPS,'Maximum 50,000 laps per historical item in this phase.');
 for(const row of context.classification){check(participants.has(row.participantId),'Unknown classified participant.');check(row.classId===null||classes.has(row.classId),'Unknown classification class.');check(row.scope!=='class'||classes.has(row.scopeId),'Unknown classification scope class.');check(row.scope!=='heat'||heats.has(row.scopeId),'Unknown classification scope heat.');check((row.score===null)===(row.scoreUnit===null),'A score needs its unit.');const counted=unique(row.countedHeatIds.map(id=>({id})),'id','counted heat');unique(row.droppedHeatIds.map(id=>({id})),'id','dropped heat');check([...row.countedHeatIds,...row.droppedHeatIds].every(id=>heats.has(id))&&!row.droppedHeatIds.some(id=>counted.has(id)),'Unknown or contradictory classified heat.');}
 return {name:race.name,track:race.track.name,startedAt:race.startedAt,participants:race.participants.length,laps,carIds:[...new Set(race.participants.map(p=>p.carId).filter(Boolean))],cars:race.participants.filter(p=>p.kind==='physical').map(p=>p.displayName),missing:provenance.missing};
}
function validateRequest(input){
 if(Buffer.byteLength(JSON.stringify(input))>T.MAX_BYTES)fail('PAYLOAD_TOO_LARGE','Historical batches are limited to 8 MiB.',413);
 if(input?.items?.some(i=>i?.bundle?.context?.scoringSnapshot!=null))fail('UNSUPPORTED_COVERAGE','Scoring snapshots need the agreed Timing mapper; send null in this review-only phase.',409);
 S.validate(input,S.request);unique(input.items,'itemId','item ID');check(new Set(input.items.map(i=>JSON.stringify([i.sourceId,i.sessionId]))).size===input.items.length,'A batch contains the same session more than once.');
 input.items.forEach(semantics);
}
// Scalar/short-array projection: listing and polling never hydrate lap bundles.
const fields=['id','batchId','requestHash','status','message','accepted','receivedAt','decidedAt','decisionNote','summary','batch','itemId','sourceId','sessionId','ordinal','batchSize'];
function projected(r,where='',params=[]){
 const rows=r.db.prepare(`SELECT r.key,f.path,f.json FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? ${where} AND (f.path IN (${fields.map(()=>'?').join(',')}) OR f.path LIKE '["summary",%' OR f.path LIKE '["batch",%' OR f.path LIKE '["accepted",%') ORDER BY r.key,f.path`).all(bucket,...params,...fields.map(k=>JSON.stringify([k])));
 const result=new Map();for(const row of rows){let obj=result.get(row.key);if(!obj){obj={};result.set(row.key,obj);}const path=JSON.parse(row.path);for(const k of path.slice(0,-1))obj=obj[k]??=( {} );obj[path.at(-1)]=JSON.parse(row.json);}return [...result.values()];
}
const batchRows=(r,id)=>projected(r,`AND EXISTS(SELECT 1 FROM record_fields b WHERE b.record=r.key AND b.path='["batchId"]' AND b.json=?)`,[JSON.stringify(id)]);
function receipt(rows){const row=rows[0];return {version:1,databaseId:row.batch.databaseId,recoveryId:row.batch.recoveryId,operationId:row.batch.operationId,requestHash:row.requestHash,items:rows.toSorted((a,b)=>a.ordinal-b.ordinal).map(r=>({itemId:r.itemId,sourceId:r.sourceId,sessionId:r.sessionId,status:r.status,accepted:r.accepted,message:r.message}))};}
function commit(store,beforeRows,afterRows,result){
 const scoped=require('./scoped-write.cjs'),before=scoped.context(store,'@history-import').data;
 before.timing.imports=beforeRows;const after={...before,revision:before.revision+1,timing:{...before.timing,imports:afterRows}};
 validateStored(after,null,{partial:true});try{return require('./transaction.cjs').run(store,()=>scoped.prepare(store,before,after,result),{scoped:true});}catch(e){
  if(e.code==='COLLECTION_LIMIT')fail('CAPACITY_EXCEEDED','Collection metadata capacity reached. No historical item was accepted.',507);
  // A publication error may follow a durable commit. Refresh before allowing
  // another write, and let the original operation/decision be retried.
  if(!e.apiCode)e.code='WRITE_UNCERTAIN';throw e;
 }
}
function receive(store,input){
 validateRequest(input);
 const rows=Q.read(store,null,r=>{
  guard(r,input);const id=batchId(input),hash=T.digest(input),existing=batchRows(r,id);
  if(existing.length){if(existing.some(x=>x.requestHash!==hash))fail('OPERATION_CONFLICT','This historical batch ID already has different content.',409);return {existing};}
  const counts=r.db.prepare(`SELECT count(*) total,sum(CASE WHEN f.json='"pending"' THEN 1 ELSE 0 END) pending FROM records r JOIN record_fields f ON f.record=r.key AND f.path='["status"]' WHERE r.bucket=?`).get(bucket);
  if(counts.total+input.items.length>MAX_ITEMS||Number(counts.pending)+input.items.length>MAX_PENDING)fail('CAPACITY_EXCEEDED','Historical review capacity reached. Retained decisions are not discarded.',507);
  const {items,...batch}=input,receivedAt=new Date().toISOString();
  return {created:items.map((item,ordinal)=>{
   const accepted=r.db.prepare("SELECT json_extract(json,'$.payload.revision') revision,json_extract(json,'$.payload.state') state,json_extract(json,'$.contentHash') contentHash FROM query_sessions WHERE source=? AND session=?").get(item.sourceId,item.sessionId)||null;
   const prior=r.db.prepare(`SELECT 1 FROM records r JOIN record_fields s ON s.record=r.key AND s.path='["sourceId"]' JOIN record_fields t ON t.record=r.key AND t.path='["sessionId"]' JOIN record_fields st ON st.record=r.key AND st.path='["status"]' WHERE r.bucket=? AND s.json=? AND t.json=? AND st.json='"pending"' LIMIT 1`).get(bucket,JSON.stringify(item.sourceId),JSON.stringify(item.sessionId));
   const status=accepted||prior?'conflict':'pending',message=accepted?'This session identity already has accepted history. No data was overwritten.':prior?'This session already has a pending historical import. Review that item first.':'Awaiting review in Paddock. No racing statistics have changed.';
   return {id:itemId(id,item.itemId),batchId:id,requestHash:hash,ordinal,batchSize:items.length,itemHash:T.digest(item),batch,itemId:item.itemId,sourceId:item.sourceId,sessionId:item.sessionId,item,summary:semantics(item),status,message,accepted,receivedAt,decidedAt:status==='pending'?null:receivedAt,decisionNote:''};
  })};
 }).value;
 if(rows.existing)return receipt(rows.existing);return commit(store,[],rows.created,receipt(rows.created));
}
function lookup(store,installationId,operationId,input){return Q.read(store,null,r=>{guard(r,input);const rows=batchRows(r,batchId({...input,operationId,editor:{installationId}}));if(!rows.length)fail('OPERATION_NOT_FOUND','Historical batch not found in this recovery generation.',404);return receipt(rows);}).value;}
function cancel(store,installationId,operationId,input){
 S.validate(input,S.cancel);check(operationId===input.operationId,'Route and body operation IDs differ.');unique(input.itemIds.map(id=>({id})),'id','cancellation item');
 const work=Q.read(store,null,r=>{guard(r,input);const rows=batchRows(r,batchId({...input,editor:{installationId}}));if(!rows.length)fail('OPERATION_NOT_FOUND','Historical batch not found.',404);check(input.itemIds.every(id=>rows.some(row=>row.itemId===id)),'Unknown cancellation item.');const before=rows.filter(row=>input.itemIds.includes(row.itemId)&&row.status==='pending').map(row=>r.record(recordKey(row.id)));return {rows,before};}).value;
 const after=work.before.map(row=>({...row,status:'cancelled',message:'Cancelled by the submitting application. No accepted history was removed.',decidedAt:new Date().toISOString()}));
 if(!after.length)return receipt(work.rows);const decisions=new Map(after.map(row=>[row.id,row]));return commit(store,work.before,after,receipt(work.rows.map(row=>decisions.get(row.id)||row)));
}
function inbox(r,offset=null){
 const total=r.db.prepare(`SELECT count(*) n FROM records r WHERE r.bucket=? AND EXISTS(SELECT 1 FROM record_fields s WHERE s.record=r.key AND s.path='["status"]' AND s.json='"pending"')`).get(bucket).n;
 if(offset===null)return {total};
 const keys=r.db.prepare(`SELECT r.key FROM records r JOIN record_fields d ON d.record=r.key AND d.path='["receivedAt"]' WHERE r.bucket=? ORDER BY d.json DESC,r.key LIMIT 20 OFFSET ?`).all(bucket,offset).map(x=>x.key);
 const rows=keys.length?projected(r,`AND r.key IN (${keys.map(()=>'?').join(',')})`,keys):[];const byId=new Map(rows.map(row=>[recordKey(row.id),row]));
 return {total,approvalEnabled:require('./historical-approval-gate.cjs').enabled(),count:r.db.prepare('SELECT count(*) n FROM records WHERE bucket=?').get(bucket).n,rows:keys.map(key=>({...byId.get(key),recoveryChanged:byId.get(key).batch.recoveryId!==r.epoch})),databaseId:r.id,recoveryId:r.epoch};
}
function review(store,input){
 check(input&&typeof input==='object'&&['inspect','reject','approve'].includes(input.action),'Unknown historical review action.');
 check(typeof input.id==='string'&&/^import-[a-f0-9]{64}$/.test(input.id),'Invalid historical item ID.');
 const row=Q.read(store,null,r=>{guard(r,input);const row=r.record(recordKey(input.id));if(!row)fail('OPERATION_NOT_FOUND','Historical import no longer exists.',404);if(input.requestHash!==row.requestHash)fail('REVISION_CONFLICT','Historical review evidence changed. Reopen the review.',409);return row;}).value;
 if(input.action==='inspect')return Q.read(store,null,r=>{
  guard(r,input);
  check(input.offset===undefined||Number.isSafeInteger(input.offset)&&input.offset>=0,'Invalid evidence page.');
  check(input.offset===undefined||input.participantId!==undefined,'Choose a participant before paging evidence.');
  check(input.participantId===undefined||row.item.bundle.race.participants.some(p=>p.id===input.participantId),'Unknown evidence participant.');
  const linked=id=>id?r.db.prepare("SELECT json_extract(f.json,'$') name,q.archived FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='[\"name\"]' WHERE q.bucket='[\"cars\"]' AND q.key=?").get(JSON.stringify(['cars','id:'+id]))||null:null;
  const participants=row.item.bundle.race.participants.map(p=>{
   const chosen=input.participantId===p.id,offset=chosen?(input.offset||0):0,limit=input.participantId?chosen?100:0:10;check(!chosen||offset<=p.laps.length,'Evidence page is outside this participant.');
   const missing={duration:0,crossing:0,driver:0,lane:0,validity:0,pit:0,distance:0};let distanceM=0,validLaps=0;
   for(const l of p.laps){if(l.durationMs===null)missing.duration++;if(l.endedAtMs===null)missing.crossing++;if(l.driverId===null)missing.driver++;if(l.lane===null)missing.lane++;if(l.valid===null)missing.validity++;if(l.pit===null)missing.pit++;if(l.countsForDistance){if(l.distanceM===null)missing.distance++;else distanceM+=l.distanceM;}if(l.durationMs!==null&&l.valid===true&&l.pit===false)validLaps++;}
   return {...p,linkedCar:linked(p.carId),lapCount:p.laps.length,evidenceSummary:{missing,distanceM,validLaps},lapPage:{offset,limit,nextOffset:offset+limit<p.laps.length?offset+limit:null},laps:p.laps.slice(offset,offset+limit)};
  });
  return {...row,approvalEnabled:require('./historical-approval-gate.cjs').enabled(),recoveryChanged:row.batch.recoveryId!==r.epoch,item:{...row.item,bundle:{...row.item.bundle,race:{...row.item.bundle.race,participants}}}};
 }).value;
 if(input.action==='approve'){
  if(!require('./historical-approval-gate.cjs').enabled())fail('UNSUPPORTED_COVERAGE','Historical acceptance is not enabled. Evidence remains in Review and does not contribute to performance history.',409);
  const result=require('./rich-history.cjs').approveQualified(store,input);
  return {status:'approved',duplicate:result.duplicate,accepted:result.accepted,current:result.current};
 }
 check(typeof input.note==='string'&&input.note.length<=2000,'Enter a review note of at most 2,000 characters.');
 if(row.status==='rejected'&&row.decisionNote===input.note)return {status:'rejected',duplicate:true};
 if(row.status!=='pending')fail('REVISION_CONFLICT','This historical item has already been decided. Refresh Review.',409);
 const after={...row,status:'rejected',decidedAt:new Date().toISOString(),decisionNote:input.note,message:'Rejected in Paddock Review. No accepted history was changed.'};return commit(store,[row],[after],{status:'rejected',duplicate:false});
}
function validateStored(db,previous,{partial=false}={}){
 const rows=db.timing.imports;if(rows===undefined)return;check(Array.isArray(rows)&&rows.length<=MAX_ITEMS,'Invalid historical review storage.');unique(rows,'id','historical item');
 const reused=new Set(previous?.id===db.id?previous.timing.imports||[]:[]),batches=new Map();
 for(const row of rows){
  let group=batches.get(row.batchId);if(!group){group=[];batches.set(row.batchId,group);}group.push(row);
  if(reused.has(row))continue;
  check(row.batch?.databaseId===db.id&&row.batchId===batchId(row.batch)&&row.id===itemId(row.batchId,row.itemId),'Invalid historical review identity.');
  check(Object.keys(row).length===18&&Object.keys(row).every(k=>['id','batchId','requestHash','itemHash','batch','itemId','sourceId','sessionId','item','summary','status','message','accepted','receivedAt','decidedAt','decisionNote','ordinal','batchSize'].includes(k)),'Invalid historical storage fields.');
  check(row.itemId===row.item?.itemId&&row.sourceId===row.item.sourceId&&row.sessionId===row.item.sessionId,'Invalid historical item identity.');
  check(['pending','approved','rejected','cancelled','conflict'].includes(row.status),'Unsupported historical review decision.');check(['conflict','approved'].includes(row.status)||row.accepted===null,'Unaccepted historical item cannot have an accepted tuple.');
  if(row.status==='approved'){check(row.accepted?.state==='active','Approved evidence needs its accepted tuple.');if(!partial)check(db.timing.audit?.some(a=>a.sourceId===row.sourceId&&a.sessionId===row.sessionId&&a.revision===row.accepted.revision&&a.contentHash===row.accepted.contentHash),'Approved evidence lacks its immutable accepted revision.');}
  S.validate(row.receivedAt,{type:'string',format:'date-time'});S.validate(row.decidedAt,{anyOf:[{type:'null'},{type:'string',format:'date-time'}]});check((row.status==='pending')===(row.decidedAt===null),'Invalid historical decision date.');
  check(typeof row.message==='string'&&row.message.length<=2000&&typeof row.decisionNote==='string'&&row.decisionNote.length<=2000,'Invalid historical decision message.');
  check(Number.isSafeInteger(row.batchSize)&&row.batchSize>=1&&row.batchSize<=25&&Number.isSafeInteger(row.ordinal)&&row.ordinal>=0&&row.ordinal<row.batchSize,'Invalid historical batch membership.');
  check(row.itemHash===T.digest(row.item),'Historical evidence hash mismatch.');
  S.validate({...row.batch,items:[row.item]},S.request);
  check(T.canonical(row.summary)===T.canonical(semantics(row.item)),'Invalid historical summary.');
  // Partial scoped workspaces do not contain the whole original batch. Store a
  // per-item hash too, while the full request hash remains the retry identity.
  check(/^[a-f0-9]{64}$/.test(row.requestHash),'Invalid historical request hash.');
  S.validate(receipt([row]),S.receipt);
 }
 for(const group of batches.values()){if(group.every(r=>reused.has(r)))continue;const first=group[0];check(partial||group.length===first.batchSize,'Incomplete stored historical batch.');check(group.every(r=>r.requestHash===first.requestHash&&r.batchSize===first.batchSize&&T.canonical(r.batch)===T.canonical(first.batch)),'Historical batch identity disagreement.');unique(group,'ordinal','historical batch position');if(group.length===first.batchSize)check(T.digest({...first.batch,items:group.toSorted((a,b)=>a.ordinal-b.ordinal).map(r=>r.item)})===first.requestHash,'Historical batch request hash mismatch.');}
}
module.exports={receive,lookup,cancel,inbox,review,validateStored,validateRequest,semantics,recordKey,MAX_ITEMS,MAX_PENDING,MAX_LAPS};
