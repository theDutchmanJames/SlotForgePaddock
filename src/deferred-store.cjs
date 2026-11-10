'use strict';
// A revision-bound read model for current-format collections. Only the small
// record directory is opened eagerly; section bodies are decoded on demand.
// No connection is kept open between requests and no work runs on a timer.
const {DatabaseSync}=require('node:sqlite'),{Reader}=require('./sqlite-query.cjs'),lazy=require('./lazy-assets.cjs');
const models=new WeakMap();
let integrityWorker;
const yieldTurn=()=>new Promise(resolve=>setImmediate(resolve));
const own=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});
// Exact JSON-size accounting from shapes and SQL byte lengths. Settings does
// not need to reconstruct lap arrays or the complete inventory just for totals.
function measure(connection,tree){
 const assets=new Map(connection.prepare('SELECT hash,length(value) bytes FROM assets').all().map(r=>[r.hash,r.bytes])),sizes=new Map();
 const structure=node=>{
  if(Object.hasOwn(node,'field'))return 0;
  if(!Array.isArray(node.object))throw Error('Invalid stored field shape.');
  return 2+Math.max(0,node.object.length-1)+node.object.reduce((n,[key,child])=>n+Buffer.byteLength(JSON.stringify(key))+1+structure(child),0);
 };
 for(const row of connection.prepare('SELECT r.key,r.json,coalesce(sum(length(CAST(f.json AS BLOB))),0) bytes FROM records r LEFT JOIN record_fields f ON f.record=r.key GROUP BY r.key').iterate()){
  const entry=JSON.parse(row.json),base=entry.shape?structure(entry.shape)+row.bytes:Buffer.byteLength(JSON.stringify(entry.value));let logical=base,metadata=base;
  for(const ref of entry.refs){const bytes=assets.get(ref.hash);if(bytes===undefined)throw Error('Missing attachment.');logical+=bytes+2-4;metadata+=256-4;}
  sizes.set(row.key,{logical,metadata});
 }
 const total=(node,kind)=>{
  if(Object.hasOwn(node,'record')){const size=sizes.get(node.record);if(!size)throw Error('Missing collection record.');return size[kind];}
  if(node.array)return 2+Math.max(0,node.array.length-1)+node.array.reduce((n,child)=>n+total(child,kind),0);
  return 2+Math.max(0,node.object.length-1)+node.object.reduce((n,[key,child])=>n+Buffer.byteLength(JSON.stringify(key))+1+total(child,kind),0);
 };
 return {logicalBytes:total(tree,'logical'),metadataBytes:total(tree,'metadata')};
}
function open(file,allowUpgrade=true){
 // A hot rollback journal needs a writable SQLite open to recover. Keep that
 // exceptional case on the established recovery/validation path.
 const journal=file+'-journal';if(require('node:fs').existsSync(journal)&&require('node:fs').statSync(journal).size>0)require('./sqlite-storage.cjs').recoverForRead(file);
 const connection=new DatabaseSync(file,{readOnly:true,timeout:5000});let manifest,tree,token,upgrade;
 try{
  connection.exec('BEGIN; PRAGMA trusted_schema=OFF;');
  if(connection.prepare('PRAGMA application_id').get().application_id!==0x53465044||connection.prepare('PRAGMA user_version').get().user_version!==3)return null;
  const structure=require('./storage-structure.cjs').check(connection,3);
  const values=Object.fromEntries(connection.prepare('SELECT key,value FROM state').all().map(r=>[r.key,r.value]));
  if(values.query_index_identity!==JSON.stringify(['identity','change_epoch','change_sequence'].map(k=>values[k]??null)))return null;
  if(values.query_index_version==='7'&&allowUpgrade)upgrade=values.identity;
  else if(values.query_index_version!=='8')return null;
  else if(!require('./query-index.cjs').objectsReady(connection)){
   if(!allowUpgrade||!require('./query-index.cjs').structure(connection).records)return null;
   upgrade=values.identity;
  }
  else if(!require('./query-indexes.cjs').ready(connection)){if(!allowUpgrade)return null;upgrade=values.identity;}
  if(!structure.initialized){if(!allowUpgrade)return null;upgrade=values.identity;}
  const [id,revision]=JSON.parse(values.identity);token={id,revision,epoch:values.change_epoch};manifest=values.manifest;tree=JSON.parse(manifest);
  const keys=new Set(connection.prepare('SELECT key FROM records').all().map(r=>r.key)),seen=new Set();
  function directory(node,depth=0){
   if(!node||typeof node!=='object'||depth>20)throw Error('Invalid collection directory.');
   if(Object.hasOwn(node,'record')){if(typeof node.record!=='string'||!keys.has(node.record)||seen.has(node.record))throw Error('Missing or duplicate collection record.');seen.add(node.record);return;}
   if(Array.isArray(node.array)){for(const child of node.array)directory(child,depth+1);return;}
   if(Array.isArray(node.object)){const names=new Set();for(const pair of node.object){if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||names.has(pair[0]))throw Error('Invalid collection member.');names.add(pair[0]);directory(pair[1],depth+1);}return;}
   throw Error('Invalid collection directory.');
  }
  directory(tree);if(seen.size!==keys.size)throw Error('Unreferenced collection records.');
 }finally{connection.close();}
 // Summary upgrades and repairs use the current record/session projections.
 // Release the read transaction first; never hydrate all car/lap data here.
 if(upgrade){require('./sqlite-storage.cjs').upgrade(file,upgrade);return open(file,false);}
 return create(file,manifest,token);
}
// Build the next revision before committing it. Seed only its identity; all
// other reads are revision-bound and happen after the atomic SQL commit.
function create(file,manifest,token,seed={}){
 const tree=JSON.parse(manifest);
 const stats={recordReads:0,loadedSections:[]},resolvers=new WeakMap();let reader=null,complete=false;
 const read=fn=>{if(reader)return fn(reader);reader=new Reader(file,token);try{return fn(reader);}finally{stats.recordReads+=reader.reads;reader.close();reader=null;}};
 function build(node,path=[]){
  if(Object.hasOwn(node,'record'))return Object.hasOwn(seed,node.record)?seed[node.record]:read(r=>r.record(node.record,{assetHandle:true}));
  if(node.array)return read(()=>{const result=[];for(const child of node.array){const value=build(child,path),index=result.length;if(lazy.isAsset(value))lazy.attach(result,index,value);else result.push(value);}return result;});
  const result={};
  for(const [key,child]of node.object){const load=()=>{
   const value=build(child,[...path,key]);stats.loadedSections.push([...path,key].join('.'));
   if(lazy.isAsset(value)){lazy.attach(result,key,value);return value;}
   own(result,key,value);return value;
  };const get=()=>{const value=load();return lazy.isAsset(value)?value.read():value;};resolvers.set(get,load);Object.defineProperty(result,key,{enumerable:true,configurable:true,get});}
  return result;
 }
 const data=build(tree);
 const identity=fn=>Object.keys(seed).length?fn():read(fn);
 const supported=identity(()=>data.schema===11&&Object.hasOwn(data,'catalogueRevision'));
 if(!supported)return null;
 identity(()=>{if(data.id!==token.id||data.revision!==token.revision||typeof data.id!=='string'||!Number.isSafeInteger(data.revision)||data.revision<0||!Number.isSafeInteger(data.catalogueRevision))throw Error('Invalid collection identity.');});
 const state={file,data,token,manifest,stats,read,get complete(){return complete;},measure:connection=>measure(connection,tree),
  materialize(){
   if(complete)return data;
   return read(r=>{
    if(r.db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||r.db.prepare('PRAGMA foreign_key_check').get())throw Error('SQLite integrity check failed.');
    const visit=(object,node)=>{if(!node.object)return;for(const [key,child]of node.object){if(lazy.property(object,key))continue;const load=resolvers.get(Object.getOwnPropertyDescriptor(object,key)?.get),value=load?load():object[key];if(child.object)visit(value,child);}};
    visit(data,tree);return data;
   });
  },
  async materializeAsync(){
   if(complete)return data;
   integrityWorker??=new (require('./sqlite-writer.cjs').Writer)(()=>new (require('node:worker_threads').Worker)(require('node:path').join(__dirname,'startup-check-worker.cjs')));
   await integrityWorker.write(file,token,null);
   // Decode bounded batches between event-loop turns. The first write still
   // needs global domain validation, but its disk scan does not block the UI.
   const visit=async(object,node,path=[])=>{
    if(!node.object)return;
    for(const [key,child]of node.object){
     if(lazy.property(object,key))continue;
     const load=resolvers.get(Object.getOwnPropertyDescriptor(object,key)?.get);
     if(load&&child.array){
      const result=[];
      for(let i=0;i<child.array.length;i+=64){read(()=>{for(const item of child.array.slice(i,i+64)){const value=build(item,[...path,key]);if(lazy.isAsset(value))lazy.attach(result,result.length,value);else result.push(value);}});await yieldTurn();}
      own(object,key,result);stats.loadedSections.push([...path,key].join('.'));
     }else{const value=load?load():object[key];if(child.object)await visit(value,child,[...path,key]);}
    }
   };
   await visit(data,tree);read(()=>{}); // Reject external revision changes even for empty sections.
  },
  validated(){complete=true;models.delete(data);},
  references(){return read(r=>{const refs=new Map();for(const row of r.db.prepare('SELECT record,hash FROM asset_refs').iterate()){if(!refs.has(row.record))refs.set(row.record,[]);refs.get(row.record).push(row.hash);}return refs;});},
  liveHashes(hashes){return read(r=>{const has=r.db.prepare('SELECT 1 FROM asset_refs WHERE hash=? LIMIT 1');return hashes.filter(hash=>has.get(hash));});}
 };
 models.set(data,state);return state;
}
module.exports={open,create,measure,state:data=>models.get(data)};
