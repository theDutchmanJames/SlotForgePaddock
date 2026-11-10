'use strict';
// Qualification only. No normal database path is accepted by this worker.
const {parentPort}=require('node:worker_threads');
parentPort.on('message',job=>{
 try{
  const repo=require('./car-merge-storage.cjs').openQualification(job.file),q=job.packed;
  let value;if(q.command)value=repo.command(q.command);else{const state=repo.state();value=require('./car-merge-review.cjs').read(state.data,state.recoveryId,q);}
  parentPort.postMessage({id:job.id,value});
 }catch(e){parentPort.postMessage({id:job.id,error:e.message,code:e.code});}
});
