'use strict';
// Transaction-local copy-on-write drafts. Untouched records retain identity;
// changed containers are detached before mutation. Lazy media accessors survive.
const states=new WeakMap();
function draft(base,originals){
 originals.add(base);
 const state={base,copy:null,children:new Map(),proxy:null};
 const current=()=>state.copy||base;
 const copy=()=>{
  if(state.copy)return state.copy;
  // Register original children only when copying or reading them. Merely
  // finding one car must not enumerate every record in its containing list.
  const descriptors=Object.getOwnPropertyDescriptors(base);
  for(const d of Object.values(descriptors))if(d.value&&typeof d.value==='object'&&!states.has(d.value))originals.add(d.value);
  return state.copy=Object.defineProperties(Array.isArray(base)?[]:Object.create(Object.getPrototypeOf(base)),descriptors);
 };
 state.proxy=new Proxy(Array.isArray(base)?[]:{},{
  get(_target,key){const source=current(),value=Reflect.get(source,key,state.proxy);
   // Native unshift through a Proxy drafts every displaced history record.
   // These two methods only return a length, so move untouched references on
   // the detached array directly, retaining any already-accessed child drafts.
   if(Array.isArray(base)&&(key==='push'||key==='unshift')&&value===Array.prototype[key])return function(...items){
    if(this!==state.proxy)return Reflect.apply(value,this,items);
    const target=copy();
    for(const [index,child]of state.children)if(Object.getOwnPropertyDescriptor(target,index)?.value===child.base)target[index]=child.proxy;
    state.children.clear();
    return Reflect.apply(value,target,items);
   };
   if(!value||typeof value!=='object')return value;if(states.has(value))return value;if(Object.getOwnPropertyDescriptor(base,key)?.value===value)originals.add(value);if(!originals.has(value))return value;const existing=state.children.get(key);if(existing?.base===value)return existing.proxy;const child=draft(value,originals);state.children.set(key,child);return child.proxy;},
  set(_target,key,value){const descriptor=Object.getOwnPropertyDescriptor(current(),key);if(descriptor&&Object.hasOwn(descriptor,'value')&&descriptor.value===value)return true;Object.defineProperty(copy(),key,{value,enumerable:key!=='length',writable:true,configurable:key!=='length'});state.children.delete(key);return true;},
  deleteProperty(_target,key){delete copy()[key];state.children.delete(key);return true;},
  defineProperty(_target,key,descriptor){Object.defineProperty(copy(),key,descriptor);state.children.delete(key);return true;},
  ownKeys(){return Reflect.ownKeys(current());},has(_target,key){return key in current();},
  getOwnPropertyDescriptor(_target,key){const d=Object.getOwnPropertyDescriptor(current(),key);return d?{...d,configurable:key==='length'&&Array.isArray(base)?false:true}:undefined;},
  getPrototypeOf(){return Object.getPrototypeOf(base);}
 });states.set(state.proxy,state);return state;
}
function finish(value,seen=new WeakMap(),originals=new WeakSet()){
 if(!value||typeof value!=='object')return value;if(seen.has(value))return seen.get(value);
 const state=states.get(value);if(!state&&originals.has(value))return value;
 if(state){let result=state.copy||state.base;seen.set(value,result);
  const assign=(key,next)=>{if(result===state.base)result=Object.defineProperties(Array.isArray(result)?[]:Object.create(Object.getPrototypeOf(result)),Object.getOwnPropertyDescriptors(result));Object.defineProperty(result,key,{value:next,enumerable:true,writable:true,configurable:true});seen.set(value,result);};
  for(const [key,child]of state.children)if(Object.getOwnPropertyDescriptor(result,key)?.value===child.base){const next=finish(child.proxy,seen,originals);if(next!==child.base)assign(key,next);}
  if(state.copy)for(const key of Object.keys(result)){const d=Object.getOwnPropertyDescriptor(result,key);if(!Object.hasOwn(d,'value'))continue;const next=finish(d.value,seen,originals);if(next!==d.value)assign(key,next);}
  return result;
 }
 // Newly assigned arrays/objects may contain draft references (filter, spread).
 // Resolve those without writing into a caller-owned payload.
 let result=value;seen.set(value,result);for(const key of Object.keys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(d,'value'))continue;const next=finish(d.value,seen,originals);if(next!==d.value){if(result===value)result=Object.defineProperties(Array.isArray(value)?[]:Object.create(Object.getPrototypeOf(value)),Object.getOwnPropertyDescriptors(value));Object.defineProperty(result,key,{...d,value:next});seen.set(value,result);}}return result;
}
function produce(base,fn){const originals=new WeakSet(),state=draft(base,originals),result=fn(state.proxy),seen=new WeakMap(),data=finish(state.proxy,seen,originals);return {data,result:finish(result,seen,originals)};}
module.exports={produce,finish};
