'use strict';
// One-shot workers release migration memory before the UI adopts a collection.
// Coalesce opens of the same file, and wait for worker exit (not just its reply)
// so failure/timeout never leaves a writer racing a subsequent retry.
const path=require('node:path'),{Worker}=require('node:worker_threads');
class CollectionOpener {
 constructor({timeoutMs=600000,createWorker=file=>new Worker(path.join(__dirname,'collection-open-worker.cjs'),{workerData:{file}})}={}){this.timeoutMs=timeoutMs;this.createWorker=createWorker;this.jobs=new Map();}
 prepare(file){
  file=path.resolve(file);if(this.jobs.has(file))return this.jobs.get(file);
  const job=new Promise((resolve,reject)=>{
   let worker,timer,result,error;
   try{worker=this.createWorker(file);}catch(e){reject(e);return;}
   const stop=e=>{error=e;void worker.terminate().catch(()=>{});};
   timer=setTimeout(()=>stop(Error('Preparing this collection took too long. Reopen Paddock to retry.')),this.timeoutMs);
   worker.on('message',message=>{if(message.error)error=Object.assign(Error(message.error),{code:message.code});else result=message.value;});
   worker.on('error',e=>{error=e;});
   worker.on('exit',code=>{clearTimeout(timer);if(error||code!==0||!result)reject(error||Error('Collection preparation stopped before completion. Reopen Paddock to retry.'));else resolve(result);});
  }).finally(()=>this.jobs.delete(file));this.jobs.set(file,job);return job;
 }
 get pending(){return this.jobs.size>0;}
 async whenIdle(){while(this.jobs.size)await Promise.allSettled([...this.jobs.values()]);}
}
const opener=new CollectionOpener();
module.exports={CollectionOpener,prepare:file=>opener.prepare(file),pending:()=>opener.pending,whenIdle:()=>opener.whenIdle()};
