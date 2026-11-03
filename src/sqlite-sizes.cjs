'use strict';
// Revision/epoch/sequence-bound derived size counters. Updated in the same SQL
// transaction as records; older writers invalidate them by advancing the cursor.
function overhead(node){
 if(Object.hasOwn(node,'record'))return 0;
 if(node.array)return 2+Math.max(0,node.array.length-1)+node.array.reduce((n,c)=>n+overhead(c),0);
 return 2+Math.max(0,node.object.length-1)+node.object.reduce((n,[k,c])=>n+Buffer.byteLength(JSON.stringify(k))+1+overhead(c),0);
}
function cached(db,identity){
 try{const entry=JSON.parse(db.prepare("SELECT value FROM state WHERE key='collection_sizes_v1'").get()?.value||'null');
  const state=db.prepare('SELECT value FROM state WHERE key=?');
  if(entry?.identity===identity&&entry.epoch===state.get('change_epoch')?.value&&entry.sequence===state.get('change_sequence')?.value&&['logicalBytes','metadataBytes'].every(k=>Number.isSafeInteger(entry[k])&&entry[k]>=2))return {logicalBytes:entry.logicalBytes,metadataBytes:entry.metadataBytes};
 }catch{/* Missing/obsolete derived metadata is rebuilt from SQL. */}
 return null;
}
function tracker(db,identity,previous,next){
 const size=cached(db,identity);if(!size)return null;
 const delta=overhead(JSON.parse(next))-overhead(JSON.parse(previous));size.logicalBytes+=delta;size.metadataBytes+=delta;
 const length=db.prepare('SELECT length(value) bytes FROM assets WHERE hash=?'),assets=new Map();
 return {size,change(json,sign){
  if(!json)return;const entry=JSON.parse(json),base=Buffer.byteLength(JSON.stringify(entry.value));let logical=base,metadata=base;
  for(const ref of entry.refs){if(!assets.has(ref.hash)){const row=length.get(ref.hash);if(!row)throw Error('Missing attachment.');assets.set(ref.hash,row.bytes);}logical+=assets.get(ref.hash)-2;metadata+=252;}
  size.logicalBytes+=sign*logical;size.metadataBytes+=sign*metadata;
 }};
}
function save(db,identity,manifest,tracking){
 const size=tracking?.size||require('./deferred-store.cjs').measure(db,JSON.parse(manifest));
 require('./storage-resources.cjs').checkCollectionSize(size.metadataBytes);
 if(!Number.isSafeInteger(size.logicalBytes)||size.logicalBytes<2)throw Error('Invalid collection size.');
 const state=db.prepare('SELECT value FROM state WHERE key=?');
 db.prepare("INSERT INTO state(key,value) VALUES('collection_sizes_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({identity,epoch:state.get('change_epoch')?.value,sequence:state.get('change_sequence')?.value,...size}));
 return size;
}
module.exports={cached,tracker,save};
