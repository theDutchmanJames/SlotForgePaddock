'use strict';
const path=require('node:path');
const {Worker}=require('node:worker_threads');
// A single persistent writer avoids starting a Node runtime for every keystroke.
// SQLite connections still open/close per commit so shutdown and backups never
// depend on an idle connection. Pending work keeps the worker alive; idle does not.
class Writer {
 constructor(createWorker=()=>new Worker(path.join(__dirname,'sqlite-worker.cjs')),{timeoutMs=120000,maxQueue=32}={}){if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(maxQueue)||maxQueue<1)throw Error('Invalid writer limits.');this.timeoutMs=timeoutMs;this.maxQueue=maxQueue;this.createWorker=createWorker;this.worker=null;this.queue=[];this.active=null;this.sequence=0;}
 write(file,packed,expected){if(this.queue.length+(this.active?1:0)>=this.maxQueue)return Promise.reject(Object.assign(Error('Database worker queue is full. Retry shortly.'),{code:'WORKER_BUSY'}));return new Promise((resolve,reject)=>{this.queue.push({id:++this.sequence,file,packed,expected,resolve,reject});this.pump();});}
 pump(){
  if(this.active||this.stopping||!this.queue.length)return;
  if(!this.worker){
   let worker;try{worker=this.createWorker();}catch(error){for(const job of this.queue.splice(0))job.reject(error);return;}this.worker=worker;
   worker.on('message',message=>{if(this.worker!==worker)return;const job=this.active;if(!job||message.id!==job.id){this.failed(worker,Error('SQLite writer returned an unexpected acknowledgement.'));return;}clearTimeout(this.timer);this.active=null;message.error?job.reject(Object.assign(Error(message.error),{code:message.code,apiCode:message.apiCode,httpStatus:message.httpStatus,details:message.details})):job.resolve(message.value);if(this.queue.length)this.pump();else worker.unref();});
   worker.on('error',error=>this.failed(worker,error));
   worker.on('exit',code=>{if(this.worker===worker)this.failed(worker,Error('SQLite writer stopped before acknowledging the save ('+code+').'));});
  }
  const job=this.queue.shift();this.active=job;this.worker.ref();this.timer=setTimeout(()=>this.failed(this.worker,Error('Database worker timed out. Check the save receipt before retrying.')),this.timeoutMs);
  try{this.worker.postMessage({id:job.id,file:job.file,packed:job.packed,expected:job.expected});}catch(error){this.failed(this.worker,error);}
 }
 failed(worker,error){if(this.worker!==worker)return;clearTimeout(this.timer);error.code='WRITE_UNCERTAIN';this.worker=null;const jobs=[...(this.active?[this.active]:[]),...this.queue];this.active=null;this.queue=[];this.stopping=Promise.resolve(worker.terminate()).catch(()=>{}).finally(()=>{this.stopping=null;this.pump();});for(const job of jobs)job.reject(error);}
}
const writer=new Writer();
module.exports={Writer,write:(...args)=>writer.write(...args)};
