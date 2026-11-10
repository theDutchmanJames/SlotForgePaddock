'use strict';
const T=require('./timing-integration.cjs'),S=require('./shared-history-schema.cjs'),Q=require('./sqlite-query.cjs');
const BASE='/v1/shared-history',MAX=T.MAX_BYTES,MAX_AUDIT=110000;
const fail=(code,message,status=400,current=null)=>{const e=T.fault(code,message,status);e.details={current};throw e;};
const tuple=r=>r?{revision:r.payload.revision,contentHash:r.contentHash,state:r.payload.state}:null;
const identity=(installationId,operationId)=>'history-'+T.digest([installationId,operationId]);
const auditId=(sourceId,sessionId,revision)=>'history-'+T.digest([sourceId,sessionId,revision]);
const recordKey=(sourceId,sessionId)=>JSON.stringify(['timing','sessions','session:'+JSON.stringify([sourceId,sessionId])]);
function recovery(r,wanted){if(wanted!==r.epoch)fail('RECOVERY_CHANGED','This library was restored or replaced. Reconcile pending history; do not rewrite its recovery identifier.',409);}
function status(store){return Q.read(store,null,r=>({version:1,databaseId:r.id,recoveryId:r.epoch,capability:S.capability,cursor:Buffer.from(JSON.stringify({databaseId:r.id,epoch:r.epoch,after:Number(r.db.prepare("SELECT value FROM state WHERE key='change_sequence'").get().value)})).toString('base64url')})).value;}
function current(r,sourceId,sessionId){const row=r.db.prepare("SELECT json_extract(json,'$.payload.revision') revision,json_extract(json,'$.payload.state') state,json_extract(json,'$.contentHash') contentHash FROM query_sessions WHERE source=? AND session=?").get(sourceId,sessionId);return row?{revision:row.revision,contentHash:row.contentHash,state:row.state}:null;}
function envelope(store,input){
 validateOperation(input);
 if(Buffer.byteLength(JSON.stringify(input))>MAX)fail('PAYLOAD_TOO_LARGE','Shared history commands are limited to 8 MiB.',413);
 Q.read(store,null,r=>{if(input.databaseId!==r.id)fail('DATABASE_MISMATCH','This history belongs to another library.',409);recovery(r,input.recoveryId);});
}
function operationSchema(){
 if(!require('./rich-history-gate.cjs').enabled())return S.operation;
 return {anyOf:[...S.operation.anyOf,...require('./rich-history.cjs').operationSchema().anyOf]};
}
function validateOperation(input){
 try{S.validate(input,operationSchema());}catch(e){fail('INVALID_PAYLOAD',e.message);}
 // Rich measured delivery and historical approval are separate rollouts.
 if(require('./rich-history-gate.cjs').enabled()&&input.bundle?.format==='history-v1'&&input.bundle.provenance.kind!=='measured')fail('UNSUPPORTED_COVERAGE','Historical results require the separately qualified Review workflow.',409);
}
function prepare(store,command){
 const input=command.payload;envelope(store,input);
 const old=Q.read(store,null,r=>r.record(recordKey(input.sourceId,input.sessionId))).value,accepted=tuple(old);
 if(old?.format==='history-v1')fail('RESULT_REQUIRES_SHARED_HISTORY','Use the qualified richer history path for this session.',409,accepted);
 if(T.canonical(accepted)!==T.canonical(input.expected))fail('REVISION_CONFLICT','Accepted history changed. Keep your draft and compare the current revision.',409,accepted);
 if(input.action==='replace'&&accepted.state==='withdrawn'&&!input.reason.trim())fail('INVALID_PAYLOAD','Reactivating a withdrawn session requires a reason.');
 const revision=(accepted?.revision||0)+1;
 const payload=input.action==='withdraw'?{integrationVersion:1,databaseId:input.databaseId,source:old.payload.source,sessionId:input.sessionId,revision,state:'withdrawn',reason:input.withdrawalReason}:input.bundle.payload;
 if(payload.databaseId!==input.databaseId||payload.source.id!==input.sourceId||payload.sessionId!==input.sessionId||payload.revision!==revision)fail('INVALID_PAYLOAD','Payload identity and revision must match the operation and next accepted revision.');
 const scoped=require('./scoped-write.cjs'),workspace=scoped.context(store,'@timing',payload),before=workspace.data;
 // Audit rows are independently stored. Empty workspace means append-only merge,
 // not removal of earlier rows from the complete collection directory.
 before.timing.audit=[];
 T.receive(workspace,payload,{guarded:true});
 const after={...workspace.data,timing:{...workspace.data.timing,sessions:workspace.data.timing.sessions.map(r=>({...r}))}},record=after.timing.sessions[0],now=record.receivedAt;
 record.guard=old?.guard||{version:1,adoptedAt:now,adoptedRevision:payload.revision};
 const archive=(r,operation)=>({id:auditId(r.payload.source.id,r.payload.sessionId,r.payload.revision),sourceId:r.payload.source.id,sessionId:r.payload.sessionId,revision:r.payload.revision,contentHash:r.contentHash,payload:r.payload,acceptedAt:r.receivedAt,operation});
 const attribution={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,editor:input.editor,requestHash:T.digest(input),reason:input.reason};
 after.timing.audit=[...(old&&!old.guard?[archive(old,null)]:[]),archive(record,attribution)];
 S.validate(record.guard,S.guard);validateAudit(after);
 const roots=new Map(JSON.parse(store.persistedManifest).object),timing=new Map(roots.get('timing').object);
 if((timing.get('audit')?.array.length||0)+after.timing.audit.length>MAX_AUDIT)fail('CAPACITY_EXCEEDED','The immutable history audit is full. No accepted records were removed.',507);
 const result={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,sourceId:input.sourceId,sessionId:input.sessionId,requestHash:T.digest(input),status:'committed',accepted:tuple(record),duplicate:false,committedAt:now,current:tuple(record)};
 return scoped.prepare(store,before,after,result);
}
function receive(store,input){
 envelope(store,input);
 if(require('./rich-history-gate.cjs').enabled()){
  // Withdrawals have no bundle. Route by the persisted identity, including its
  // tombstone, never by names or the sender's current installation identity.
  const rich=input.bundle?.format==='history-v1'||input.action==='withdraw'&&Q.read(store,null,r=>r.db.prepare("SELECT json_extract(json,'$.format') format FROM query_sessions WHERE source=? AND session=?").get(input.sourceId,input.sessionId)?.format==='history-v1').value;
  if(rich)return require('./rich-history.cjs').receiveQualified(store,input);
 }
 return execute(store,input,prepare);
}
// Shared receipt execution; HTTP and upload commit use receive() above.
function execute(store,input,prepareCommand){
 const command={id:identity(input.editor.installationId,input.operationId),action:'@shared-history',databaseId:input.databaseId,epoch:input.recoveryId,payload:input};
 let saved;try{saved=require('./command-receipts.cjs').execute(store,command,prepareCommand);}catch(e){
  if(e.code==='COMMAND_CONFLICT')fail('OPERATION_CONFLICT','This operation ID already has different content.',409);
  if(e.code==='COMMAND_EPOCH_CHANGED')fail('RECOVERY_CHANGED','The library changed recovery generation. Reconcile the retained operation.',409);
  if(e.code==='COMMAND_RECEIPT_LIMIT'||e.code==='COLLECTION_LIMIT')fail('CAPACITY_EXCEEDED','Durable receipt or collection metadata capacity reached. No result was accepted.',507);
  // Publication can fail after SQLite commits. Tell the caller to refresh the
  // committed model before accepting another command, never to invent a new ID.
  if(!e.apiCode)try{if(require('./command-receipts.cjs').lookupFile(store.file,command))e.code='WRITE_UNCERTAIN';}catch{e.code='WRITE_UNCERTAIN';}
  throw e;
 }
 try{return Q.read(store,null,r=>{recovery(r,input.recoveryId);return {...saved.result,duplicate:!!saved.duplicate,current:current(r,input.sourceId,input.sessionId)};}).value;}catch(e){e.code='WRITE_UNCERTAIN';throw e;}
}
function lookup(store,installationId,operationId,recoveryId){return Q.read(store,null,r=>{
 recovery(r,recoveryId);const row=r.db.prepare('SELECT epoch,result FROM command_receipts WHERE id=?').get(identity(installationId,operationId));
 if(!row)fail('OPERATION_NOT_FOUND','No committed receipt in this recovery generation. Retry only the identical original operation.',404);
 if(row.epoch!==recoveryId)fail('RECOVERY_CHANGED','Receipt belongs to another recovery generation.',409);
 const value=require('./command-receipts.cjs').decodeResult(row.result);return {...value,duplicate:true,current:current(r,value.sourceId,value.sessionId)};
}).value;}
function validateAudit(db,previous){
 const rows=db.timing.audit;if(rows===undefined)return;
 if(!Array.isArray(rows)||rows.length>MAX_AUDIT)fail('INVALID_PAYLOAD','Invalid immutable history audit.');
 const ids=new Set(),reused=new Set(previous?.id===db.id&&previous.timing.key===db.timing.key&&!!previous.club?.replica===!!db.club?.replica?previous.timing.audit||[]:[]);
 for(const row of rows){if(ids.has(row.id))fail('INVALID_PAYLOAD','Duplicate accepted revision audit.');ids.add(row.id);if(reused.has(row))continue;
  if(row.format==='history-v1'){require('./rich-history.cjs').validateAudit(db,row);continue;}
  S.validate(row,S.audit);T.validatePayload(row.payload,{stored:true});
  if(row.id!==auditId(row.sourceId,row.sessionId,row.revision)||row.contentHash!==T.digest(row.payload)||row.payload.databaseId!==db.id||row.payload.source.id!==row.sourceId||row.payload.sessionId!==row.sessionId||row.payload.revision!==row.revision||row.operation&&row.operation.databaseId!==db.id)fail('INVALID_PAYLOAD','Invalid accepted revision audit identity/hash.');
  if(!db.club?.replica&&row.payload.state==='active')for(const p of row.payload.participants)if(p.carId)T.verifyConfiguration(db,p.carId,p.configuration);
 }
}
async function handle(network,req,res,url,code,send){
 const store=network.store;
 const guard=()=>{if(!network.local||!network.access(code)?.timingResults)fail('PERMISSION_REQUIRED','Trusted local history editing is unavailable.',403);if(req.headers['x-slotforge-database']!==store.data.id)fail('DATABASE_MISMATCH','The library identity changed.',409);};
 try{
  guard();
  if(url.pathname===BASE+'/imports'||url.pathname.startsWith(BASE+'/imports/'))return send(200,await require('./history-import-http.cjs').handle(network,req,url,guard));
  if(url.pathname===BASE+'/uploads'||url.pathname.startsWith(BASE+'/uploads/'))return send(200,await require('./history-upload-http.cjs').handle(network,req,url,guard));
  if(req.method==='GET'&&url.pathname===BASE+'/status'){if(url.search)fail('INVALID_QUERY','Status accepts no query parameters.');return await store.withIdle(()=>{guard();return send(200,status(store));});}
  if(req.method==='GET'&&(url.pathname===BASE+'/sessions'||url.pathname.startsWith(BASE+'/sessions/')||url.pathname.startsWith(BASE+'/cars/')))return send(200,await require('./domain-tasks.cjs').run(store,{kind:'shared-history-read',url:url.href},guard));
  const match=url.pathname.match(/^\/v1\/shared-history\/operations\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
  if(req.method==='GET'&&match){if([...url.searchParams.keys()].join()!=='recoveryId'||! /^[a-zA-Z0-9_-]{1,100}$/.test(url.searchParams.get('recoveryId')||''))fail('INVALID_QUERY','Supply exactly one recoveryId.');return send(200,await require('./domain-tasks.cjs').run(store,{kind:'shared-history-receipt',installationId:match[1],operationId:match[2],recoveryId:url.searchParams.get('recoveryId')},guard));}
  if(req.method!=='POST'||url.pathname!==BASE+'/operations')return send(404,{code:'NOT_FOUND',error:'This shared-history feature is not enabled.',databaseId:store.data.id,recoveryId:null,current:null});
  if(url.search)fail('INVALID_QUERY','Operations accept no query parameters.');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))fail('INVALID_PAYLOAD','Send UTF-8 application/json.',415);
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail('INVALID_PAYLOAD','Compressed commands are unsupported.',415);
  if(Number(req.headers['content-length'])>MAX)fail('PAYLOAD_TOO_LARGE','Shared history commands are limited to 8 MiB.',413);
  const chunks=[];let size=0;for await(const bytes of req.iterator({destroyOnReturn:false})){size+=bytes.length;if(size>MAX)fail('PAYLOAD_TOO_LARGE','Shared history commands are limited to 8 MiB.',413);chunks.push(bytes);}
  const value=await require('./domain-tasks.cjs').run(store,{kind:'shared-history-write',bytes:Buffer.concat(chunks)},guard);
  if(!value.duplicate)try{network.onChange({kind:'timing'});}catch{}return send(200,value);
 }catch(e){
  if(e.code==='WORKER_BUSY')res.setHeader('Retry-After','1');
  let recoveryId=null;try{recoveryId=Q.read(store,null,r=>r.epoch).value;}catch{}
  return send(e.httpStatus||503,{code:e.apiCode||'STORAGE_FAILED',error:e.apiCode?e.message:'History could not be acknowledged. Keep the original operation and retry after storage recovers.',databaseId:store.data.id,recoveryId,current:e.details?.current||null});
 }
}
module.exports={capability:S.capability,status,receive,lookup,prepare,execute,validateAudit,handle,MAX_AUDIT,operationSchema,validateOperation};
