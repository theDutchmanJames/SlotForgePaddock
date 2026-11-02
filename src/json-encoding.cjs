// Database values are JSON, with potentially very large immutable image strings.
// Keep native JSON escaping for every scalar, but reuse the encoding of long
// strings across validation, conflict hashes and saves. The cache is bounded;
// it never caches mutable objects or assumes that a record is unchanged.
const crypto=require('node:crypto');
const {types}=require('node:util');
const LIMIT=128*1024*1024,MIN=4096;
const strings=new Map();let bytes=0;
// Valid base64 photos contain only JSON-safe ASCII. Retain validation results,
// not a second escaped copy of each photograph. Large collections otherwise
// evict the ordinary string cache on every pass and repeatedly encode all photos.
const photos=new Map(),PHOTO_LIMIT=256*1024*1024;let photoBytes=0;
function knownPhoto(value){
 if(photos.has(value))return true;
 if(typeof value!=='string'||!value.startsWith('data:image/')||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return false;
 if(value.length<=PHOTO_LIMIT){while(photoBytes+value.length>PHOTO_LIMIT){const first=photos.keys().next().value;photos.delete(first);photoBytes-=first.length;}photos.set(value,true);photoBytes+=value.length;}
 return true;
}
function encodedString(value){
 let entry=strings.get(value);if(entry)return entry;
 const json=JSON.stringify(value);entry={json,bytes:Buffer.byteLength(json)};
 if(value.length>=MIN){
  const cost=value.length*2+json.length*2;
  if(cost<=LIMIT){while(bytes+cost>LIMIT){const [key,old]=strings.entries().next().value;strings.delete(key);bytes-=old.cost;}entry.cost=cost;strings.set(value,entry);bytes+=cost;}
 }
 return entry;
}
function prepare(value,key){
 if(value!==null&&['object','function','bigint'].includes(typeof value)&&typeof value.toJSON==='function')value=value.toJSON(key);
 if(types.isNumberObject(value))return Number(value);
 if(types.isStringObject(value))return String(value);
 if(types.isBooleanObject(value))return Boolean.prototype.valueOf.call(value);
 if(types.isBigIntObject(value))return BigInt.prototype.valueOf.call(value);
 return value;
}
function* chunks(value,ancestors=new Set(),prepared=false){
 if(!prepared)value=prepare(value,'');
 if(typeof value==='string'){
  if(knownPhoto(value)){yield {json:'"',bytes:1};yield {json:value,bytes:value.length};yield {json:'"',bytes:1};}
  else yield encodedString(value);return;
 }
 if(value===null||typeof value!=='object'){
  const json=JSON.stringify(value);if(json!==undefined)yield {json,bytes:Buffer.byteLength(json)};return;
 }
 if(ancestors.has(value))throw new TypeError('Converting circular structure to JSON');
 ancestors.add(value);
 try{
  const array=Array.isArray(value);yield {json:array?'[':'{',bytes:1};let first=true;
  for(const key of array?Array.from({length:value.length},(_,i)=>i):Object.keys(value)){
   let item=prepare(value[key],String(key));const missing=item===undefined||typeof item==='function'||typeof item==='symbol';
   if(missing&&!array)continue;if(missing)item=null;
   if(!first)yield {json:',',bytes:1};first=false;
   if(!array){yield encodedString(key);yield {json:':',bytes:1};}
   yield* chunks(item,ancestors,true);
  }
  yield {json:array?']':'}',bytes:1};
 }finally{ancestors.delete(value);}
}
function stringify(value){
 // Join small tokens in bounded batches instead of retaining millions of
 // chunk objects and array entries for a large parts/results catalogue.
 const batches=[];let parts=[],size=0;
 for(const chunk of chunks(value)){parts.push(chunk.json);size+=chunk.bytes;if(size>=65536){batches.push(parts.join(''));parts=[];size=0;}}
 if(parts.length)batches.push(parts.join(''));return batches.length?batches.join(''):undefined;
}
function byteLength(value){let size=0;for(const chunk of chunks(value))size+=chunk.bytes;if(!size)throw new TypeError('Value has no JSON representation');return size;}
function* buffers(value){
 let parts=[],size=0;
 for(const chunk of chunks(value)){parts.push(chunk.json);size+=chunk.bytes;if(size>=65536){yield Buffer.from(parts.join(''));parts=[];size=0;}}
 if(parts.length)yield Buffer.from(parts.join(''));
}
function hash(value){const digest=crypto.createHash('sha256');let any=false;for(const chunk of chunks(value)){any=true;digest.update(chunk.json);}if(!any)throw new TypeError('Value has no JSON representation');return digest.digest('hex');}
function isPhoto(value){return !value||knownPhoto(value);}
module.exports={stringify,byteLength,hash,isPhoto,buffers};
