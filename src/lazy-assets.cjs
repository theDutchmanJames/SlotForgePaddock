'use strict';
// Internal accessors are never accepted from JSON or exposed on the wire.
// Normal JSON serialization still materializes the exact original string.
const crypto=require('node:crypto'),path=require('node:path');
const getters=new WeakMap(),sources=new Map(),cache=new Map(),handles=new WeakSet();let cacheBytes=0,reads=0;
const LIMIT=32*1024*1024;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function metadata(value){
 const image=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value),body=image?image[2]:value,bytes=Buffer.from(body,'base64');
 let width=null,height=null;
 if(image?.[1]==='image/png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);}
 if(image?.[1]==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){let i=2;while(i+4<bytes.length){if(bytes[i++]!==255)break;while(i<bytes.length&&bytes[i]===255)i++;if(i+3>bytes.length)break;const marker=bytes[i++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const n=bytes.readUInt16BE(i);if(n<2||i+n>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&n>=7){height=bytes.readUInt16BE(i+3);width=bytes.readUInt16BE(i+5);break;}i+=n;}}
 if(image?.[1]==='image/webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  const kind=bytes.toString('ascii',12,16);if(kind==='VP8X'){width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);}else if(kind==='VP8L'&&bytes[20]===47){const bits=bytes.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}else if(kind==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}
 }
 return {hash:digest(value),chars:value.length,encodedBytes:Buffer.byteLength(value),mime:image?.[1]||null,bytes:bytes.length,width:width||null,height:height||null,photo:!!image,canonical:bytes.toString('base64')===body,head:bytes.subarray(0,16).toString('hex')};
}
function valid(meta,hash,size){return meta&&meta.hash===hash&&Number.isSafeInteger(meta.chars)&&meta.chars>0&&meta.encodedBytes===size&&meta.chars===size&&Number.isSafeInteger(meta.bytes)&&meta.bytes>=0&&typeof meta.photo==='boolean'&&typeof meta.canonical==='boolean'&&typeof meta.head==='string'&&/^[a-f0-9]{0,32}$/.test(meta.head)&&(!meta.photo||['image/png','image/jpeg','image/webp'].includes(meta.mime))&&['width','height'].every(k=>meta[k]===null||Number.isSafeInteger(meta[k])&&meta[k]>0);}
function sourceKey(file){const full=path.resolve(file);return process.platform==='win32'?full.toLowerCase():full;}
function asset(file,meta){
 const source=sourceKey(file);let table=sources.get(source);if(!table)sources.set(source,table=new Map());let a=table.get(meta.hash)?.deref();if(a)return a;
 const key=source+'|'+meta.hash;
 a={file,meta,key,read(){let value=cache.get(key);if(value){cache.delete(key);cache.set(key,value);return value;}
   value=require('./sqlite-storage.cjs').readAsset(file,meta.hash);reads++;const cost=value.length*2;
   if(cost<=LIMIT){while(cacheBytes+cost>LIMIT&&cache.size){const first=cache.keys().next().value;cacheBytes-=cache.get(first).length*2;cache.delete(first);}cache.set(key,value);cacheBytes+=cost;}return value;
 }};handles.add(a);table.set(meta.hash,new WeakRef(a));return a;
}
function attach(object,key,a){const get=()=>a.read();getters.set(get,a);Object.defineProperty(object,key,{enumerable:true,configurable:true,get,set(value){Object.defineProperty(object,key,{enumerable:true,configurable:true,writable:true,value});}});return object;}
function property(object,key){return object&&getters.get(Object.getOwnPropertyDescriptor(object,key)?.get);}
function copyProperty(target,key,source,from=key){const a=property(source,from);if(a)attach(target,key,a);else Object.defineProperty(target,key,{enumerable:true,configurable:true,writable:true,value:source[from]});return target;}
function copyPhoto(target,key,source,validator,from=key){const a=property(source,from);if(a){if(!a.meta.photo||a.meta.chars>12*1024*1024)throw Error('Invalid stored photograph metadata.');attach(target,key,a);}else target[key]=validator(source[from]);return target;}
function pins(file){const table=sources.get(sourceKey(file)),result=[];if(table)for(const [hash,ref]of table){if(ref.deref())result.push(hash);else table.delete(hash);}return result;}
function stats(){return {reads,cacheBytes,cacheLimit:LIMIT};}
function clearCache(){cache.clear();cacheBytes=0;reads=0;}
function adopt(data,file,packed,metadata){
 const byHash=new Map(metadata.map(m=>[m.hash,m]));
 for(const row of packed.records){const route=JSON.parse(row.key);let parent=data;
  for(let i=0;i<route.length-1;i++)parent=parent[route[i]];
  const last=route.at(-1),index=Array.isArray(parent)?last.startsWith('id:')?parent.findIndex(r=>r?.id===last.slice(3)):last.startsWith('session:')?parent.findIndex(r=>r?.payload&&JSON.stringify([r.payload.source.id,r.payload.sessionId])===last.slice(8)):Number(last.slice(6)):last;let record=property(parent,index)?null:parent[index];
  for(const ref of JSON.parse(row.json).refs){if(!ref.path.length){const m=byHash.get(ref.hash);if(m&&property(parent,index)?.file!==file)attach(parent,index,asset(file,m));continue;}let owner=record;for(const k of ref.path.slice(0,-1))owner=owner[k];const key=ref.path.at(-1),m=byHash.get(ref.hash);if(m&&property(owner,key)?.file!==file)attach(owner,key,asset(file,m));}
 }
}
module.exports={metadata,valid,asset,isAsset:value=>!!value&&typeof value==='object'&&handles.has(value),attach,property,copyProperty,copyPhoto,pins,stats,clearCache,digest,adopt};
