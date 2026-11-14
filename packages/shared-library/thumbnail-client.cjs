'use strict';
// Shared by host apps. Encoding runs in their browser worker, never SQLite's worker.
module.exports=function(invoke,encode,{timeout=20000}={}){
 const flights=new Map(),cancellations=new Set();let tail=Promise.resolve(),closed=false;
 const fault=(code,message)=>Object.assign(Error(message),{code});
 function encoding(source){
  return new Promise((resolve,reject)=>{
   let timer,done=false;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);cancellations.delete(cancel);if(error)reject(error);else resolve(value);};
   const cancel=()=>finish(fault('LIBRARY_CLOSED','Library handle is closed.'));
   cancellations.add(cancel);timer=setTimeout(()=>finish(fault('THUMBNAIL_TIMEOUT','Thumbnail generation timed out.')),timeout);
   Promise.resolve().then(()=>encode(source)).then(value=>finish(null,value),finish);
  });
 }
 function wait(){return new Promise(resolve=>{const finish=()=>{clearTimeout(timer);cancellations.delete(finish);resolve();},timer=setTimeout(finish,1000);cancellations.add(finish);});}
 async function get(input){
  if(closed)throw fault('LIBRARY_CLOSED','Library handle is closed.');
  input=structuredClone(input);
  const key=JSON.stringify(input);if(flights.has(key))return flights.get(key);
  if(flights.size>=128)throw fault('WORKER_BUSY','Thumbnail queue is full. Retry shortly.');
  const job=tail.then(async()=>{
   if(closed)throw fault('LIBRARY_CLOSED','Library handle is closed.');
   for(let n=0;n<70&&!closed;n++){
    const r=await invoke('thumbnailRead',input);if(!r.lease&&!r.pending)return r.data;
    if(r.pending){if(!closed)await wait();continue;}
    let data=null;
    try{if(closed)throw fault('LIBRARY_CLOSED','Library handle is closed.');if(typeof encode!=='function')throw Error('Thumbnail encoder is unavailable.');data=await encoding(r.source);const saved=await invoke('thumbnailStore',{key:r.key,lease:r.lease,data});if(!saved.stored)continue;return data;}
    catch(e){await invoke('thumbnailStore',{key:r.key,lease:r.lease,data:null}).catch(()=>{});throw e;}
   }
   if(closed)throw fault('LIBRARY_CLOSED','Library handle is closed.');
   return null;
  });tail=job.catch(()=>{});flights.set(key,job);try{return await job;}finally{flights.delete(key);}
 }
 return {get,warm(carId){if(typeof encode==='function'&&flights.size<32)get({carId}).catch(()=>{});},close(){closed=true;for(const cancel of cancellations)cancel();return tail;}};
};
