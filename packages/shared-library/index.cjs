'use strict';
const path=require('node:path'),fs=require('node:fs'),{Worker}=require('node:worker_threads');
const engine=fs.existsSync(path.join(__dirname,'engine','src'))?path.join(__dirname,'engine','src'):path.resolve(__dirname,'../../src');
async function open(options){
 if(!options||typeof options.application!=='string'||!/^[\w-]{1,100}$/.test(options.installationId||''))throw Error('Shared library needs an application and persistent installation ID.');
 const worker=new Worker(path.join(engine,'shared-library-worker.cjs'),{workerData:options}),pending=new Map();let serial=0,closed=false,closing=null;
 const invoke=(method,input)=>new Promise((resolve,reject)=>{if(closed||closing&&method!=='close')return reject(Error('Library handle is closed.'));if(pending.size>=32&&method!=='close')return reject(Object.assign(Error('Shared library queue is full. Retry shortly.'),{code:'WORKER_BUSY'}));const id=++serial;pending.set(id,{resolve,reject});try{worker.postMessage({id,method,input});}catch(e){pending.delete(id);reject(e);}});
 worker.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(Object.assign(Error(m.error.message),m.error));else p.resolve(m.value);});
 const fail=e=>{for(const p of pending.values())p.reject(e);pending.clear();closed=true;};worker.on('error',fail);worker.on('exit',code=>fail(Object.assign(Error('Library worker stopped; retained write identities can be retried.'),{code:'WRITE_UNCERTAIN',exitCode:code})));
 const handle=Object.fromEntries(['status','backup','restore','carSchema','carIdentity','mergeMappings','mergeContributions','timingSettings','timingSettingsWrite','catalogue','carWrite','customSchema','customRead','customDefinitionWrite','serviceRead','serviceWrite','historyWrite','historyRead','timingRead','originalHistory','originalHistoryWrite','changes','receipt','adoptCar','adoptSession','adoptionStatus','origin','extensionRead','extensionWrite','profile'].map(name=>[name,input=>invoke(name,input)]));
 handle.car=(id,options={})=>invoke('car',{id,...options});handle.close=()=>{if(closing)return closing;if(closed)return Promise.resolve();closing=(async()=>{await invoke('close');closed=true;await worker.terminate();})();return closing;};
 try{const bootstrap=await invoke('open');handle.bootstrapInfo=async()=>structuredClone(bootstrap);return handle;}catch(e){await worker.terminate();throw e;}
}
module.exports={open,version:'1.0.0'};
