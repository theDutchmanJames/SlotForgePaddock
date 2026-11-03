const path=require('node:path'),{Worker}=require('node:worker_threads'),{randomUUID}=require('node:crypto');
class BackupJobs {
 constructor(notify=()=>{}){this.notify=notify;this.active=null;}
 cancel(id){if(this.active?.id!==id)return false;Atomics.store(this.active.cancel,0,1);return true;}
 run(action,source,destination,options={}){
  if(this.active)return Promise.reject(Error('A backup operation is already running.'));const id=randomUUID(),buffer=new SharedArrayBuffer(4),cancel=new Int32Array(buffer);this.active={id,cancel};this.notify({id,phase:action==='export'?'Preparing backup':'Checking backup',done:0,total:1,cancelable:true});
  return new Promise((resolve,reject)=>{let worker,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;this.active=null;this.notify(null);if(error)reject(error);else resolve(value);};try{worker=new Worker(path.join(__dirname,'backup-worker.cjs'),{workerData:{action,source,destination,options,cancel:buffer}});worker.on('message',message=>{if(message.progress)this.notify({id,...message.progress,cancelable:true});else if(message.error)finish(Object.assign(Error(message.error),{code:message.code}));else finish(null,message.value);});worker.on('error',e=>finish(e));worker.on('exit',code=>{if(!settled)finish(Error('Backup worker stopped before completing ('+code+').'));});}catch(e){finish(e);}});
 }
}
module.exports={BackupJobs};
