'use strict';
// Domain validation, derived statistics and SQLite commits all run off the UI
// thread. The caller owns the collection write lock until publication.
const {parentPort}=require('node:worker_threads');
const {Store}=require('./store.cjs');
function describe(store){
 const state=require('./deferred-store.cjs').open(store.file);
 if(!state)throw Error('The committed database needs reopening.');
 return {manifest:state.manifest,token:state.token,catalogueRevision:state.data.catalogueRevision,stats:store.lastWrite,photoPreviewWrites:store.photoPreviewWrites};
}
parentPort.on('message',job=>{
 let task,completed=false;
 try{
  task=require('./domain-transfer.cjs').unpack(job.packed);let store=new Store(job.file,{deferred:true});
  if(task.kind==='refresh'?store.data.id!==task.databaseId:store.expectedIdentity!==job.expected)throw Object.assign(Error('The database changed. Reopen Paddock before retrying.'),{code:'QUERY_CHANGED'});
  if(!store.deferredState){store=new Store(job.file,{deferred:true});if(!store.deferredState)throw Error('Reopen this database before background processing.');}
  store.additionalPins=task.pins||[];
  let result;
  if(task.kind==='car-merge'){
   const M=require('./car-merge-storage.cjs');if(!M.enabled())M.execute();
   if(store.data.club?.replica)throw Object.assign(Error('Review merges on the dealership computer.'),{code:'MERGE_AUTHORITY_REQUIRED'});
   const repo=M.openHost(store.file),q=task.input;
   if(q?.command)result=repo.command(q.command);
   else{const state=repo.state();require('./car-merge-model.cjs').init(state.data);result=require('./car-merge-review.cjs').read(state.data,state.recoveryId,q);}
  }
  else if(task.kind==='dealership-disable'){
   const p=task.input;
   if(p.databaseId!==store.data.id||p.clubId!==store.data.club?.id||p.revision!==store.data.revision||p.recoveryId!==store.deferredState.token.epoch||store.data.club?.replica)throw Error('The collection changed. Reopen Turn off Dealership Mode.');
   store.scopedTransact('@club',db=>{db.club=null;});result={disabled:true};
  }
  else if(task.kind==='history-view')result=require('./history-view.cjs').read(store,task.input);
  else if(task.kind==='timing-collection-review')result=require('./timing-collection-review.cjs').decide(store,task.input);
  else if(task.kind==='history-import'){
   const H=require('./history-imports.cjs');let input=task.input;
   if(task.bytes)try{input=require('./strict-json.cjs').parse(task.bytes);}catch{throw require('./timing-integration.cjs').fault('INVALID_PAYLOAD','Send unambiguous UTF-8 JSON with unique keys, finite numbers and valid Unicode.');}
   if(task.action==='receive')result=H.receive(store,input);
   else if(task.action==='lookup')result=H.lookup(store,task.installationId,task.operationId,input);
   else if(task.action==='cancel')result=H.cancel(store,task.installationId,task.operationId,input);
   else if(task.action==='review')result=H.review(store,input);
   else throw Error('Unknown historical import action.');
  }else if(task.kind==='history-upload'){result=require('./history-uploads.cjs').run(store,task);
  }else if(task.kind==='shared-history-read'){result=require('./shared-history-read.cjs').read(store,task.url);
  }else if(task.kind==='shared-history-write'){
   let input;try{input=require('./strict-json.cjs').parse(task.bytes);}catch{throw require('./timing-integration.cjs').fault('INVALID_PAYLOAD','Send unambiguous UTF-8 JSON with unique keys, finite numbers and valid Unicode.');}
   result=require('./shared-history.cjs').receive(store,input);
  }else if(task.kind==='shared-history-receipt'){result=require('./shared-history.cjs').lookup(store,task.installationId,task.operationId,task.recoveryId);
  }else if(task.kind==='shared-car-write'){result=require('./shared-car-library.cjs').receive(store,require('./local-library-api.cjs').parse(task.bytes));
  }else if(task.kind==='shared-car-receipt'){result=require('./shared-car-library.cjs').lookup(store,task.sourceId,task.operationId,task.recoveryId);
  }else if(task.kind==='local-library-cancel'){
   const local=require('./local-library-api.cjs');result=local.cancel(store,task.sourceId,task.transferId,local.parse(task.bytes));
  }else if(task.kind==='local-library-import'){
   const local=require('./local-library-api.cjs');result=local.receive(store,local.parse(task.bytes));
  }else if(task.kind==='local-library-origin'){
   result=require('./local-library-api.cjs').originReceipt(store,task.sourceId,task.timingCarId);
  }else if(task.kind==='local-library-receipt'){
   result=require('./local-library-api.cjs').lookup(store,task.sourceId,task.transferId);
  }else if(task.kind==='timing'){
   let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(task.bytes));}
   catch{throw require('./timing-integration.cjs').fault('INVALID_JSON','Request must contain valid UTF-8 JSON.');}
   result=require('./timing-integration.cjs').receive(store,payload);
   }else if(task.kind==='timing-receipt'){
   result=store.deferredState.read(r=>require('./query-timing.cjs').receipt(r,task.sourceId,task.sessionId));
  }else if(task.kind==='receipt')result=require('./command-receipts.cjs').lookupFile(store.file,task.command);
  else if(task.kind==='portal-read')result=require('./portal-store.cjs').read(store,task.input,task.expected);
  else if(task.kind==='portal-photos')result=require('./portal-store.cjs').append(store,task.input,task.expected);
  else if(task.kind==='portal-create')result=require('./portal-store.cjs').create(store,task.input,task.expected);
  else if(task.kind==='portal-receipt')result=require('./portal-store.cjs').receipt(store,task.id,task.expected);
  else if(task.kind==='command')result=require('./command-receipts.cjs').execute(store,task.command);
  else if(task.kind!=='refresh')throw Error('Unknown background database operation.');
  completed=true;parentPort.postMessage({id:job.id,value:{result,...describe(store)}});
 }catch(e){
  if(completed&&['portal-photos','portal-create','command','shared-car-write','shared-history-write','history-upload','history-import','timing-collection-review','dealership-disable','car-merge'].includes(task?.kind))e.code='WRITE_UNCERTAIN';
  parentPort.postMessage({id:job.id,error:e.message,code:e.code,apiCode:e.apiCode,httpStatus:e.httpStatus,details:e.details});
 }
});
