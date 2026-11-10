'use strict';
const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs');
try{
 const file=workerData.file;
 if(!fs.existsSync(file))parentPort.postMessage({value:{ready:false}});
 else{
  // Preserve established validation/recovery for stale indexes and old formats.
  // Current summaries upgrade or repair without materializing source lap bodies.
  const store=new (require('./store.cjs').Store)(file,{deferred:true});
  const state=store.deferredState||require('./deferred-store.cjs').open(file,false);
  parentPort.postMessage({value:{ready:!!state,token:state?.token,recoveryFile:store.storageRecoveryFile}});
 }
}catch(e){parentPort.postMessage({error:e.message,code:e.code});}
