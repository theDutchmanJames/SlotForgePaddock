'use strict';
const {parentPort}=require('node:worker_threads'),{Reader}=require('./sqlite-query.cjs');
parentPort.on('message',job=>{let reader;try{
 reader=new Reader(job.file,job.packed);
 if(reader.db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||reader.db.prepare('PRAGMA foreign_key_check').get())throw Error('SQLite integrity check failed.');
 parentPort.postMessage({id:job.id,value:true});
}catch(error){parentPort.postMessage({id:job.id,error:error.message});}finally{reader?.close();}});
