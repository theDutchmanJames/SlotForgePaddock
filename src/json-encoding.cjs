// Database values are JSON, with potentially very large immutable image strings.
// Keep native JSON escaping for every scalar, but reuse the encoding of long
// strings across validation, conflict hashes and saves. The cache is bounded;
// Default calls never cache mutable objects. Store may supply a private weak
// size cache only for validated copy-on-write predecessors.
const crypto=require('node:crypto');
const {types}=require('node:util');
const LIMIT=8*1024*1024,MIN=4096;
const {StringCache}=require('./string-cache.cjs');
const strings=new StringCache();let bytes=0;
// Valid base64 photos contain only JSON-safe ASCII. Retain validation results,
// not a second escaped copy of each photograph. Large collections otherwise
// evict the ordinary string cache on every pass and repeatedly encode all photos.
const photos=new StringCache(),PHOTO_LIMIT=8*1024*1024;let photoBytes=0;
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
function* chunks(value,ancestors=new Set(),prepared=false,measure=false){
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
   const asset=measure&&require('./lazy-assets.cjs').property(value,key);if(asset){if(!first)yield {json:',',bytes:1};first=false;if(!array){yield encodedString(key);yield {json:':',bytes:1};}yield {json:'',bytes:measure==='resident'?256:asset.meta.chars+2};continue;}
   let item=prepare(value[key],String(key));const missing=item===undefined||typeof item==='function'||typeof item==='symbol';
   if(missing&&!array)continue;if(missing)item=null;
   if(!first)yield {json:',',bytes:1};first=false;
   if(!array){yield encodedString(key);yield {json:':',bytes:1};}
   yield* chunks(item,ancestors,true,measure);
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
function byteLength(value,metadata=false,memo=null,reuse=false){
 // Count directly: generator tokens and temporary index arrays otherwise
 // allocate millions of short-lived objects during collection validation.
 const ancestors=new Set(),lazy=require('./lazy-assets.cjs');
 function measure(v){
  if(typeof v==='string')return knownPhoto(v)?metadata?256:v.length+2:encodedString(v).bytes;
  if(v===null||typeof v!=='object'){const json=JSON.stringify(v);return json===undefined?undefined:Buffer.byteLength(json);}
  if(ancestors.has(v))throw new TypeError('Converting circular structure to JSON');if(reuse&&memo?.has(v))return memo.get(v);ancestors.add(v);
  try{
   let size=2,count=0;
   function member(key,array){
    const asset=lazy.property(v,key);let bytes;
    if(asset)bytes=metadata?256:asset.meta.chars+2;
    else{const item=prepare(v[key],String(key));bytes=metadata&&key==='data'&&typeof item==='string'&&item.length>=1024&&/^[A-Za-z0-9+/=]+$/.test(item)?256:measure(item);}
    if(bytes===undefined){if(!array)return;bytes=4;}
    if(count++)size++;if(!array)size+=encodedString(key).bytes+1;size+=bytes;
   }
   if(Array.isArray(v)){const length=v.length;for(let i=0;i<length;i++)member(i,true);}else for(const key of Object.keys(v))member(key,false);
   memo?.set(v,size);return size;
  }finally{ancestors.delete(v);}
 }
 const size=measure(prepare(value,''));if(size===undefined)throw new TypeError('Value has no JSON representation');return size;
}
// Reject oversized lazy media before JSON.stringify can materialize it. Keep
// the final check too, for ordinary objects with dynamic toJSON/accessors.
function boundedStringify(value,limit,message){
 if(!Number.isSafeInteger(limit)||limit<=0)throw Error('Invalid JSON size limit.');
 if(byteLength(value)>limit)throw Error(message);
 const json=JSON.stringify(value);if(Buffer.byteLength(json)>limit)throw Error(message);return json;
}
// Conservative retention accounting for lazy snapshots: count handles rather
// than original bodies, with room for UTF-16 strings and container overhead.
function retainedSize(value){let size=0;for(const chunk of chunks(value,new Set(),false,'resident'))size+=chunk.bytes*2+32;return size;}
function* buffers(value){
 let parts=[],size=0;
 for(const chunk of chunks(value)){parts.push(chunk.json);size+=chunk.bytes;if(size>=65536){yield Buffer.from(parts.join(''));parts=[];size=0;}}
 if(parts.length)yield Buffer.from(parts.join(''));
}
function hash(value){const digest=crypto.createHash('sha256');let any=false;for(const chunk of chunks(value)){any=true;digest.update(chunk.json);}if(!any)throw new TypeError('Value has no JSON representation');return digest.digest('hex');}
function isPhoto(value){return !value||knownPhoto(value);}
module.exports={metadataByteLength:value=>byteLength(value,true),stringify,byteLength,boundedStringify,retainedSize,hash,isPhoto,buffers};
