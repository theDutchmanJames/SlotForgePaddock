'use strict';
const path=require('node:path'),{Worker}=require('node:worker_threads');
const writer=new (require('./sqlite-writer.cjs').Writer)(()=>new Worker(path.join(__dirname,'domain-worker.cjs')));
function adopt(store,value){
 if(value.token.id!==store.data.id)throw Error('The background operation returned a different database.');
 const seed=Object.fromEntries([['schema',11],['id',value.token.id],['revision',value.token.revision],['catalogueRevision',value.catalogueRevision]].map(([k,v])=>[JSON.stringify([k]),v]));
 const state=require('./deferred-store.cjs').create(store.file,value.manifest,value.token,seed);
 store.deferredState=state;store.data=state.data;store.persistedData=state.data;store.persistedFile=store.file;
 store.expectedIdentity=JSON.stringify([value.token.id,value.token.revision]);store.persistedManifest=value.manifest;
 store.persistedReferences=new Map();store.persistedAssets=new Set();store.assetHashes.clear();store.lastWrite=value.stats;store.photoPreviewWrites=value.photoPreviewWrites||null;store.writeUncertain=false;
}
async function execute(store,task,guard){
 while(store.pendingWrite)await store.whenIdle();
 let release;store.pendingWrite=new Promise(resolve=>{release=resolve;});
 try{
  guard();if(store.writeUncertain)throw Object.assign(Error('Reopen this database before retrying the uncertain save.'),{code:'WRITE_UNCERTAIN'});
  const packed=require('./domain-transfer.cjs').pack({...task,pins:require('./lazy-assets.cjs').pins(store.file)});
  let value;
  for(let attempt=0;;attempt++)try{value=await writer.write(store.file,packed,store.expectedIdentity);break;}
  catch(e){if(e.code!=='QUERY_CHANGED'||attempt>=5)throw e;const fresh=await writer.write(store.file,require('./domain-transfer.cjs').pack({kind:'refresh',databaseId:store.data.id}),null);adopt(store,fresh);store.emit();guard();}
  if(JSON.stringify([value.token.id,value.token.revision])!==store.expectedIdentity||value.token.epoch!==store.deferredState?.token.epoch){adopt(store,value);store.emit();}return value.result;
  }catch(error){
  if(error.code==='WRITE_UNCERTAIN'){
   // A commit can be durable even when its acknowledgement is lost. Reload the
   // committed generation, then let the caller retry the SAME command identity.
   try{const value=await writer.write(store.file,require('./domain-transfer.cjs').pack({kind:'refresh',databaseId:store.data.id}),null);const before=store.expectedIdentity;adopt(store,value);if(before!==store.expectedIdentity)store.emit();}catch{store.writeUncertain=true;}
  }
  throw error;
 }finally{store.pendingWrite=null;release();}
}
async function run(store,task,guard=()=>{}){
 const bytes=task.bytes?.byteLength||0;
 if((store.domainPending||0)>=16||(store.domainPendingBytes||0)+bytes>32*1024*1024)throw Object.assign(Error('Background database queue is full. Retry shortly.'),{code:'WORKER_BUSY',httpStatus:503});
 store.domainPending=(store.domainPending||0)+1;store.domainPendingBytes=(store.domainPendingBytes||0)+bytes;
 try{return await execute(store,task,guard);}finally{store.domainPending--;store.domainPendingBytes-=bytes;}
}
module.exports={run,adopt};
