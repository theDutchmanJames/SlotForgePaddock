'use strict';
const {parentPort,workerData}=require('node:worker_threads');
function execute(job){try{parentPort.postMessage({id:job.id,value:require('./sqlite-storage.cjs').write(job.file,job.packed,job.expected)});}catch(error){parentPort.postMessage({id:job.id,error:error.message,code:error.code});}}
if(workerData)execute(workerData);else parentPort.on('message',execute);
