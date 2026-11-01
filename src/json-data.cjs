// Database values are plain JSON data. Copy containers while sharing immutable
// primitive strings, rather than copying every base64 photo on each transaction.
// Object.fromEntries also preserves an own '__proto__' key without invoking the
// legacy prototype setter. Validation at the existing boundaries stays intact.
function cloneJSON(value){
  if(value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(cloneJSON);
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return structuredClone(value);
  return Object.fromEntries(Object.keys(value).map(key=>[key,cloneJSON(value[key])]));
}
module.exports={cloneJSON};
