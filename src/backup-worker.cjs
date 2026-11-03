const {parentPort,workerData}=require('node:worker_threads');
const api=require('./portable-backup.cjs'),cancel=new Int32Array(workerData.cancel);let last=0;
const options={...workerData.options,cancel:()=>Atomics.load(cancel,0)!==0,progress:value=>{const now=Date.now();if(now-last>100||value.done===value.total){last=now;parentPort.postMessage({progress:value});}}};
try{const value=workerData.action==='export'?api.exportBackup(workerData.source,workerData.destination,options):workerData.action==='stage'?api.stageBackup(workerData.source,workerData.destination,options):(()=>{throw Error('Unknown backup operation.');})();parentPort.postMessage({value});}catch(e){parentPort.postMessage({error:e.message,code:e.code});}
