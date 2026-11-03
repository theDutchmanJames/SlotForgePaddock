// Database values are plain JSON data. Copy containers while sharing immutable
// primitive strings, rather than copying every base64 photo on each transaction.
// Object.fromEntries also preserves an own '__proto__' key without invoking the
// legacy prototype setter. Validation at the existing boundaries stays intact.
function cloneJSON(value){
  if(value===null||typeof value!=='object')return value;
  const prototype=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return structuredClone(value);
  const out=Array.isArray(value)?new Array(value.length):{};for(const key of Object.keys(value)){const asset=require('./lazy-assets.cjs').property(value,key);if(asset)require('./lazy-assets.cjs').attach(out,key,asset);else Object.defineProperty(out,key,{enumerable:true,configurable:true,writable:true,value:cloneJSON(value[key])});}return out;
}
function shallowJSON(value,changes={}){const out=Object.defineProperties({},Object.getOwnPropertyDescriptors(value));for(const key of Object.keys(changes))Object.defineProperty(out,key,{value:changes[key],writable:true,enumerable:true,configurable:true});return out;}
module.exports={cloneJSON,shallowJSON};
