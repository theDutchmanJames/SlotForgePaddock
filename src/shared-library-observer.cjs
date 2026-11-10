'use strict';
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
function token(file){const db=new DatabaseSync(file,{readOnly:true,timeout:100});try{db.exec('BEGIN');const values=Object.fromEntries(db.prepare("SELECT key,value FROM state WHERE key IN ('identity','change_epoch')").all().map(r=>[r.key,r.value]));return {identity:values.identity,epoch:values.change_epoch};}finally{db.close();}}
function observe(store,onChange,onError=()=>{}){
 let closed=false,pending=null,timer,last=token(store.file),reportedError=null;
 async function refresh(){
  if(closed)return false;if(pending)return pending;
  pending=(async()=>{await store.whenIdle();const actual=token(store.file);
   if(JSON.parse(actual.identity)[0]!==store.data.id)throw Object.assign(Error('The shared library was replaced by another collection. Close and reopen Paddock to use it. Unsaved edits have not been applied.'),{code:'DATABASE_MISMATCH'});
   if(actual.identity===store.expectedIdentity&&actual.epoch===(store.deferredState?.token.epoch??last.epoch)){last=actual;return false;}
   await require('./domain-tasks.cjs').run(store,{kind:'refresh',databaseId:store.data.id});last={identity:store.expectedIdentity,epoch:store.deferredState.token.epoch};onChange();return true;
  })().finally(()=>{pending=null;});return pending;
 }
 const poll=()=>refresh().then(()=>{reportedError=null;},error=>{const key=JSON.stringify([error.code,error.message]);if(key!==reportedError){reportedError=key;onError(error);}});
 const check=()=>{clearTimeout(timer);timer=setTimeout(poll,100);timer.unref();};
 let watcher;try{watcher=fs.watch(path.dirname(store.file),{persistent:false},(_kind,name)=>{if(!name||String(name).startsWith(path.basename(store.file)))check();});}catch{/* Bounded fallback also covers dropped filesystem notifications. */}
 const fallback=setInterval(poll,3000);fallback.unref();
 return {refresh,async close(){closed=true;clearTimeout(timer);clearInterval(fallback);watcher?.close();await pending;}};
}
module.exports={observe,token};
