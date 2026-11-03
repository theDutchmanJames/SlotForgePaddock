'use strict';
const {parentPort}=require('node:worker_threads'),fs=require('node:fs'),crypto=require('node:crypto');
const cache=new Map();let size=0;const LIMIT=32*1024*1024;
parentPort.on('message',job=>{try{const {hash,staged}=job.packed,key=job.file+'|'+hash;let value=cache.get(key);if(value){cache.delete(key);cache.set(key,value);}else{
 const data=staged?fs.readFileSync(job.file,'utf8'):require('./sqlite-storage.cjs').readAsset(job.file,hash);if(crypto.createHash('sha256').update(data).digest('hex')!==hash)throw Error('Photograph integrity check failed.');const comma=data.indexOf(',');value={mime:data.slice(5,comma).split(';')[0],bytes:Buffer.from(data.slice(comma+1),'base64')};if(!['image/png','image/jpeg','image/webp'].includes(value.mime))throw Error('Invalid photograph type.');
 if(value.bytes.length<=LIMIT){while(size+value.bytes.length>LIMIT&&cache.size){const k=cache.keys().next().value;size-=cache.get(k).bytes.length;cache.delete(k);}cache.set(key,value);size+=value.bytes.length;}}
 parentPort.postMessage({id:job.id,value});
 }catch(error){parentPort.postMessage({id:job.id,error:error.message});}});
