'use strict';
// Internal worker transport only. Keep lazy originals out of structuredClone:
// its getter evaluation would otherwise read photographs on the UI thread.
const lazy=require('./lazy-assets.cjs');
function pack(value){
 const assets=[];
 function walk(v,path=[]){
  if(!v||typeof v!=='object'||ArrayBuffer.isView(v))return v;
  const out=Array.isArray(v)?[]:{};
  for(const k of Object.keys(v)){
   const a=lazy.property(v,k);
   const next=a?null:walk(v[k],[...path,k]);
   Object.defineProperty(out,k,{value:next,enumerable:true,configurable:true,writable:true});
   if(a)assets.push({path:[...path,k],file:a.file,meta:a.meta});
  }
  return out;
 }
 return {value:walk(value),assets};
}
function unpack(envelope){
 for(const a of envelope.assets){let owner=envelope.value;for(const k of a.path.slice(0,-1))owner=owner[k];lazy.attach(owner,a.path.at(-1),lazy.asset(a.file,a.meta));}
 return envelope.value;
}
module.exports={pack,unpack};
