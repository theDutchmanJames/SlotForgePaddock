'use strict';
const path=require('node:path'),fs=require('node:fs'),{Worker}=require('node:worker_threads');
const engine=fs.existsSync(path.join(__dirname,'engine','src'))?path.join(__dirname,'engine','src'):path.resolve(__dirname,'../../src');
async function open(options){
 if(!options||typeof options.application!=='string'||!/^[\w-]{1,100}$/.test(options.installationId||''))throw Error('Shared library needs an application and persistent installation ID.');
 const {thumbnailEncoder,...workerOptions}=options;
 const worker=new Worker(path.join(engine,'shared-library-worker.cjs'),{workerData:workerOptions}),pending=new Map();let serial=0,closed=false,closing=null;
 const waiting=[];let active=0,thumbnails;
 const pump=()=>{while(active<8&&waiting.length&&!closed){const item=waiting.shift(),id=++serial;active++;pending.set(id,item);try{worker.postMessage({id,method:item.method,input:item.input});}catch(e){pending.delete(id);active--;item.reject(e);}}};
 const invoke=(method,input)=>new Promise((resolve,reject)=>{
  if(closed||closing&&!['close','thumbnailStore'].includes(method))return reject(Object.assign(Error('Library handle is closed.'),{code:'LIBRARY_CLOSED'}));
  if(waiting.length>=128&&method!=='close')return reject(Object.assign(Error('Shared library queue is full. Retry shortly.'),{code:'WORKER_BUSY'}));
  // Preserve postMessage's call-time snapshot even while admission is queued.
  waiting.push({method,input:structuredClone(input),resolve,reject});pump();
 });
 worker.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);active--;pump();if(m.error)p.reject(Object.assign(Error(m.error.message),m.error));else p.resolve(m.value);});
 const fail=e=>{for(const p of pending.values())p.reject(e);pending.clear();for(const p of waiting.splice(0))p.reject(e);active=0;closed=true;thumbnails?.close().catch(()=>{});};worker.on('error',fail);worker.on('exit',code=>fail(Object.assign(Error('Library worker stopped; retained write identities can be retried.'),{code:'WRITE_UNCERTAIN',exitCode:code})));
 thumbnails=require('./thumbnail-client.cjs')(invoke,thumbnailEncoder);
 const handle=Object.fromEntries(['catalogueOverview','status','backup','restore','carSchema','carIdentity','mergeMappings','mergeContributions','timingSettings','timingSettingsWrite','catalogue','carWrite','customSchema','customRead','customDefinitionWrite','serviceRead','serviceWrite','historyWrite','historyRead','timingRead','originalHistory','originalHistoryWrite','changes','receipt','adoptCar','adoptSession','adoptionStatus','origin','extensionRead','extensionWrite','profile'].map(name=>[name,input=>invoke(name,input)]));
 handle.thumbnail=input=>thumbnails.get(input);
 for(const method of ['carWrite','adoptCar']){const original=handle[method];handle[method]=async input=>{const result=await original(input);const carId=result.car?.id||result.carId;if(carId)thumbnails.warm(carId);return result;};}
 handle.car=(id,options={})=>invoke('car',{id,...options});handle.close=()=>{if(closing)return closing;if(closed)return Promise.resolve();closing=(async()=>{await thumbnails.close();await invoke('close');closed=true;await worker.terminate();})();return closing;};
 try{const bootstrap=await invoke('open');handle.bootstrapInfo=async()=>structuredClone(bootstrap);return handle;}catch(e){await worker.terminate();throw e;}
}
module.exports={open,version:'1.0.0'};
