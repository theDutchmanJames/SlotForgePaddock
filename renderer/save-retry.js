(function(root){
 'use strict';
 const prefix='paddock-save-',canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
 function create({storage,crypto}){
  const flights=new Map(),digest=async text=>prefix+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
  function run(input,send){
   // Capture intent and register before hashing, storage or transport can yield.
   const value=JSON.parse(JSON.stringify(input)),fingerprint=canonical(value);
   if(flights.has(fingerprint))return flights.get(fingerprint);
   const job=Promise.resolve().then(async()=>{
    const key=await digest(fingerprint),legacy=await digest(JSON.stringify(value));let id;
    try{
     const current=storage.getItem(key),old=legacy===key?current:storage.getItem(legacy);id=current||old;
     if(current&&old&&current!==old)throw Error('Conflicting pending save identities.');
     if(id&&!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid pending save identity.');
     if(!id){let count=0;for(let i=0;i<storage.length;i++)if(storage.key(i)?.startsWith(prefix))count++;if(count>=128)throw Error('Too many unconfirmed saves. Retry pending saves first.');id=crypto.randomUUID();}
     storage.setItem(key,id);
    }catch(e){throw Error('Cannot safely remember this save. '+e.message+' No save was sent.');}
    const clear=()=>{if(legacy!==key)storage.removeItem(legacy);storage.removeItem(key);};
    let result;
    try{result=await send(value,id);}catch(e){
     if(e.definiteRejection===true){try{clear();}catch{throw Error('The save was rejected, but its retry tracking could not be cleared. Retry the same save. '+e.message);}}
     throw e;
    }
    try{clear();}catch{throw Error('The save succeeded, but its retry tracking could not be cleared. Retry the same save to clear it safely.');}
    return result;
   }).finally(()=>flights.delete(fingerprint));flights.set(fingerprint,job);return job;
  }
  return {run};
 }
 const api={create,canonical};if(typeof module==='object'&&module.exports)module.exports=api;else root.SaveRetry=api;
})(typeof globalThis!=='undefined'?globalThis:this);
