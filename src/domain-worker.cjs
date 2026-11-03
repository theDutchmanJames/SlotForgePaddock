'use strict';
// Domain validation, derived statistics and SQLite commits all run off the UI
// thread. The caller owns the collection write lock until publication.
const {parentPort}=require('node:worker_threads');
const {Store}=require('./store.cjs');
function describe(store){
 const state=require('./deferred-store.cjs').open(store.file);
 if(!state)throw Error('The committed database needs reopening.');
 return {manifest:state.manifest,token:state.token,catalogueRevision:state.data.catalogueRevision,stats:store.lastWrite};
}
parentPort.on('message',job=>{
 let task,completed=false;
 try{
  task=require('./domain-transfer.cjs').unpack(job.packed);let store=new Store(job.file,{deferred:true});
  if(task.kind==='refresh'?store.data.id!==task.databaseId:store.expectedIdentity!==job.expected)throw Object.assign(Error('The database changed. Reopen Paddock before retrying.'),{code:'QUERY_CHANGED'});
  if(!store.deferredState){store=new Store(job.file,{deferred:true});if(!store.deferredState)throw Error('Reopen this database before background processing.');}
  store.additionalPins=task.pins||[];
  let result;
  if(task.kind==='timing'){
   let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(task.bytes));}
   catch{throw require('./timing-integration.cjs').fault('INVALID_JSON','Request must contain valid UTF-8 JSON.');}
   result=require('./timing-integration.cjs').receive(store,payload);
   }else if(task.kind==='timing-receipt'){
   const key=JSON.stringify(['timing','sessions','session:'+JSON.stringify([task.sourceId,task.sessionId])]);
   const record=store.deferredState.read(r=>r.record(key));
   if(!record)throw require('./timing-integration.cjs').fault('SESSION_NOT_FOUND','No session with that source and session ID is stored.',404);
   result=require('./timing-integration.cjs').receipt(store.data,record);
  }else if(task.kind==='receipt')result=require('./command-receipts.cjs').lookupFile(store.file,task.command);
  else if(task.kind==='command')result=require('./command-receipts.cjs').execute(store,task.command);
  else if(task.kind!=='refresh')throw Error('Unknown background database operation.');
  completed=true;parentPort.postMessage({id:job.id,value:{result,...describe(store)}});
 }catch(e){
  if(completed&&task?.kind==='command')e.code='WRITE_UNCERTAIN';
  parentPort.postMessage({id:job.id,error:e.message,code:e.code,apiCode:e.apiCode,httpStatus:e.httpStatus});
 }
});
