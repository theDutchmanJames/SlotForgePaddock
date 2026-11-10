'use strict';
// Private Phase 2 storage primitive. No renderer, IPC or HTTP entry point.
const {cloneJSON:clone}=require('./json-data.cjs'),lazy=require('./lazy-assets.cjs');
const crypto=require('node:crypto');
// Hash asset identities without loading their bodies. This also makes a digest
// identical before and after SQLite replaces inline media with lazy references.
function normalized(value,key){
 if(value===undefined)return ['undefined'];
 if(typeof value==='string'&&(require('./json-encoding.cjs').isPhoto(value)||key==='data'&&value.length>=1024&&/^[A-Za-z0-9+/=]+$/.test(value)))return ['asset',lazy.digest(value)];
 if(Array.isArray(value))return ['array',Array.from({length:value.length},(_,i)=>{const a=lazy.property(value,i);return a?['asset',a.meta.hash]:normalized(value[i],i);})];
 if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(k=>{const a=lazy.property(value,k);return [k,a?['asset',a.meta.hash]:normalized(value[k],k)];})];
 return [typeof value,value];
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
function freeze(graph,archiveId){
 const chunks=[];
 function leaf(value,path){const id='chunk-'+digest([archiveId,path]);chunks.push({id,archiveId,value:clone(value),digest:digest(value)});return {chunk:id};}
 function member(value,key,path){
  const asset=lazy.property(value,key);
  if(asset){const holder={};lazy.attach(holder,'data',asset);return {asset:leaf(holder,path)};}
  const raw=value[key];if(key==='data'&&typeof raw==='string'&&raw.length>=1024&&/^[A-Za-z0-9+/=]+$/.test(raw))return {asset:leaf({data:raw},path)};
  return node(raw,path);
 }
 function node(value,path=[]){
  // Split large evidence at actual JSON boundaries; no base64 re-encoding or
  // unbounded single archive envelope. Lazy media remains owned by its chunk.
  const bytes=Buffer.byteLength(JSON.stringify(normalized(value)));
  if(bytes>1024*1024&&value&&typeof value==='object'){
   if(Array.isArray(value))return {array:Array.from({length:value.length},(_,i)=>member(value,i,[...path,i]))};
   return {object:Object.keys(value).map(k=>[k,member(value,k,[...path,k])])};
  }
  if(bytes>24*1024*1024)throw Object.assign(Error('An archive value exceeds the existing record limit.'),{code:'MERGE_ARCHIVE_LIMIT'});
  return leaf(value,path);
 }
 // Each graph collection starts separately, avoiding a single giant snapshot.
 const tree={object:Object.keys(graph).map(k=>[k,Array.isArray(graph[k])?{array:graph[k].map((v,i)=>node(v,[k,i]))}:node(graph[k],[k])])};
 return {chunks,tree,digest:digest(graph)};
}
function thaw(archive,chunks){
 const rows=new Map(chunks.filter(c=>c.archiveId===archive.id).map(c=>[c.id,c])),used=new Set();
 function member(out,key,n){if(n.asset){const holder=node(n.asset);lazy.copyProperty(out,key,holder,'data');}else Object.defineProperty(out,key,{value:node(n),enumerable:true,writable:true,configurable:true});}
 function node(n){
  if(n.chunk){const row=rows.get(n.chunk);if(!row||used.has(row.id)||digest(row.value)!==row.digest)throw Error('Merge archive integrity check failed.');used.add(row.id);return clone(row.value);}
  if(n.array){const out=[];n.array.forEach((v,i)=>member(out,i,v));return out;}
  if(n.object){const out={};for(const [k,v]of n.object)member(out,k,v);return out;}
  throw Error('Invalid merge archive directory.');
 }
 const value=node(archive.tree);if(used.size!==rows.size||digest(value)!==archive.digest)throw Error('Merge archive integrity check failed.');return value;
}
module.exports={digest,normalized,freeze,thaw};
