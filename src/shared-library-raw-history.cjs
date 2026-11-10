'use strict';
// Original-only sessions live in the shared file, but never enter measured
// statistics. Keep their exact source body, including unsupported race types.
const Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs'),S=require('./scoped-write.cjs'),codec=require('./shared-library-evidence.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const validId=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value);
function keys(input){
 if(!validId(input.sourceId)||typeof input.originalId!=='string'||!input.originalId||input.originalId.length>200)fail('INVALID_ORIGIN','Use the original source and session identity.');
 return {origin:'origin-'+T.digest([input.sourceId,'session',input.originalId]),extra:'extra-'+T.digest(['timing.historyOriginals',input.sourceId,input.originalId])};
}
const record=(r,bucket,id)=>r.record(JSON.stringify([bucket,'id:'+id]));
function existing(r,input){const k=keys(input);return {...k,row:record(r,'libraryOrigins',k.origin),body:record(r,'libraryExtras',k.extra)};}
function requireOriginal(value){if(value.row?.projectionStatus!=='raw-only'||!value.body)fail(value.row?'UNSUPPORTED_COVERAGE':'ORIGINAL_NOT_FOUND','This operation requires original-only history, not accepted measured history.');}
function accepted(row,body){return {revision:body.revision,state:row.state||'active',contentHash:body.hash};}
function summary(row,body){return {sourceId:row.sourceId,originalId:row.originalId,sessionId:row.sessionId,name:row.name,projectionReason:row.reason,carIds:row.carIds||[],lapCount:row.lapCount||0,originalOnly:true,...accepted(row,body)};}
function prepare(store,input){
 if(!['create','replace','withdraw','restore'].includes(input.action)||!validId(input.sessionId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)fail('INVALID_PAYLOAD','Original history requires an action, expected revision and reason.');
 const prior=Q.read(store,null,r=>existing(r,input)).value;
 Q.read(store,null,r=>{
  if(r.record(JSON.stringify(['timing','sessions','session:'+JSON.stringify([input.sourceId,input.sessionId])]))!==null)fail('UNSUPPORTED_COVERAGE','Accepted racing history must use its guarded history operation, not original-only history.');
  const occupied=r.db.prepare(`SELECT r.key FROM records r JOIN record_fields s ON s.record=r.key AND s.path='["sourceId"]' JOIN record_fields n ON n.record=r.key AND n.path='["sessionId"]' WHERE r.bucket='["libraryOrigins"]' AND s.json=? AND n.json=? LIMIT 1`).get(JSON.stringify(input.sourceId),JSON.stringify(input.sessionId));
  if(occupied&&occupied.key!==JSON.stringify(['libraryOrigins','id:'+prior.origin]))fail('ORIGIN_CONFLICT','This source session already has a different original identity.');
 });
 if(prior.row)requireOriginal(prior);
 if(prior.row&&prior.row.sessionId!==input.sessionId)fail('ORIGIN_CONFLICT','An original history key cannot be assigned to another session.');
 if(input.expectedRevision!==(prior.body?.revision||0))fail('REVISION_CONFLICT','Original history changed. Reload before editing.');
 if(input.action==='create'&&prior.row)fail('REVISION_CONFLICT','This original session already exists.');
 if(input.action!=='create'&&!prior.row)fail('ORIGINAL_NOT_FOUND','Original session no longer exists.');
 const content=['create','replace'].includes(input.action),oldState=prior.row?.state||'active';let body,row;
 if(content){
  if(input.action==='replace'&&oldState==='withdrawn')fail('REVISION_CONFLICT','Restore the withdrawn original explicitly before editing.');
  const raw=input.rawOriginal;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.session!==null&&(!raw.session||typeof raw.session!=='object'||Array.isArray(raw.session))||!Array.isArray(raw.laps)||raw.laps.some(l=>!l||typeof l!=='object'||Array.isArray(l)))fail('INVALID_ORIGINAL','Preserve a session object (or null for orphans) and the original lap objects.');
  if(typeof raw.session?.id==='string'&&raw.session.id!==input.originalId)fail('ORIGIN_CONFLICT','The original session ID cannot change.');
  if(typeof input.projectionReason!=='string'||!input.projectionReason.trim()||input.projectionReason.length>2000||!Array.isArray(input.carIds)||input.carIds.length>10000||new Set(input.carIds).size!==input.carIds.length||input.carIds.some(id=>!validId(id)))fail('INVALID_PAYLOAD','Supply linked car identities and an explicit preservation reason.');
  Q.read(store,null,r=>{for(const id of input.carIds)if(!r.one('cars',id))fail('CAR_NOT_FOUND','Original history references a missing car.');});
  body={id:prior.extra,namespace:'timing.historyOriginals',sourceId:input.sourceId,originalId:input.originalId,revision:(prior.body?.revision||0)+1,...codec.encode(raw)};
  row={...prior.row,id:prior.origin,sourceId:input.sourceId,originalId:input.originalId,entity:'session',sessionId:input.sessionId,sourceHash:prior.row?.sourceHash||body.hash,projectionStatus:'raw-only',reason:input.projectionReason,carIds:input.carIds,name:String(raw.session?.setupName||raw.session?.name||'Preserved original racing history').slice(0,200),lapCount:raw.laps.length,state:'active'};
 }else{
  if(input.rawOriginal!==undefined)fail('INVALID_PAYLOAD','Withdraw and restore preserve the existing original body.');
  if(input.action==='restore'&&oldState!=='withdrawn'||input.action==='withdraw'&&oldState==='withdrawn')fail('REVISION_CONFLICT','Original history is already in that state.');
  body={...prior.body,revision:prior.body.revision+1};row={...prior.row,state:input.action==='withdraw'?'withdrawn':'active'};
 }
 if(content)Object.assign(row,require('./shared-library-lap-counts.cjs').rawMeta(store,input.sourceId,input.rawOriginal,input.carIds));
 row.updatedAt=new Date().toISOString();row.changeReason=input.reason;
 const result={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,sourceId:input.sourceId,originalId:input.originalId,sessionId:input.sessionId,operationId:input.operationId,action:input.action,requestHash:T.digest(input),status:'committed',accepted:accepted(row,body),originalOnly:true,duplicate:false};
 const before=S.context(store,'@history-import').data,after={...before,revision:before.revision+1};before.libraryOrigins=prior.row?[prior.row]:[];after.libraryOrigins=[row];before.libraryExtras=prior.body?[prior.body]:[];after.libraryExtras=[body];return S.prepare(store,before,after,result);
}
function read(store,input){
 const kind=input.kind||'sessions',offset=input.offset??0,limit=input.limit??(kind==='laps'?200:50);
 if(!['sessions','detail','laps'].includes(kind)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||offset&&!input.token)fail('INVALID_QUERY','Use bounded original history pages and their snapshot token.');
 return Q.read(store,input.token,r=>{
  const identity={databaseId:r.id,recoveryId:r.epoch,token:r.token};
  if(kind==='sessions'){
   const state=input.state||'active';if(!['active','withdrawn','all'].includes(state)||input.sourceId!==undefined&&!validId(input.sourceId)||input.carId!==undefined&&!validId(input.carId))fail('INVALID_QUERY','Invalid original history filters.');
   let from=`FROM records r JOIN record_fields p ON p.record=r.key AND p.path='["projectionStatus"]' WHERE r.bucket='["libraryOrigins"]' AND p.json='"raw-only"'`,args=[];
   if(input.sourceId){from+=` AND EXISTS(SELECT 1 FROM record_fields s WHERE s.record=r.key AND s.path='["sourceId"]' AND s.json=?)`;args.push(JSON.stringify(input.sourceId));}
   if(input.carId){from+=` AND EXISTS(SELECT 1 FROM record_fields c WHERE c.record=r.key AND c.path='["carIds"]' AND ${require('./car-merge-query.cjs').rawMember()})`;args.push(input.carId);}
   if(state!=='all'){from+=` AND COALESCE((SELECT json_extract(s.json,'$') FROM record_fields s WHERE s.record=r.key AND s.path='["state"]'),'active')=?`;args.push(state);}
   const total=r.db.prepare('SELECT count(*) n '+from).get(...args).n,rows=r.db.prepare('SELECT r.key '+from+' ORDER BY r.key LIMIT ? OFFSET ?').all(...args,limit,offset).map(x=>{const row=r.record(x.key),value=existing(r,row);requireOriginal(value);return summary(row,value.body);});
   return {...identity,rows,total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};
  }
  const value=existing(r,input);requireOriginal(value);const original=codec.decode(value.body),meta=summary(value.row,value.body);
  if(kind==='detail')return {...identity,...meta,session:original.session??null,lapCount:original.laps?.length||0};
  const laps=original.laps||[];return {...identity,...meta,rows:laps.slice(offset,offset+limit),total:laps.length,offset,nextOffset:offset+limit<laps.length?offset+limit:null};
 }).value;
}
module.exports={read,prepare};
