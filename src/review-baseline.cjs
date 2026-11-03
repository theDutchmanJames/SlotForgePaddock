'use strict';
// Versioned review baseline over committed record digests and manifest order.
// Includes media content hashes through record digests, never original bodies.
const crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const cache=new WeakMap();
const excluded=key=>{const p=JSON.parse(key);return p[0]==='club'||p.length===1&&['revision','catalogueRevision'].includes(p[0])||p[0]==='timing'&&p[1]==='key';};
function manifest(value){const tree=JSON.parse(value);tree.object=tree.object.filter(([key])=>!['club','revision','catalogueRevision'].includes(key));const timing=tree.object.find(([key])=>key==='timing')?.[1];if(timing?.object)timing.object=timing.object.filter(([key])=>key!=='key');return JSON.stringify(tree);}
function digest(store){
 if(cache.has(store.data))return cache.get(store.data);const hash=crypto.createHash('sha256');
 if(!store.file||!store.expectedIdentity){const packed=require('./sqlite-storage.cjs').pack(store.data);hash.update(manifest(packed.manifest));for(const row of packed.records.filter(r=>!excluded(r.key)).sort((a,b)=>Buffer.compare(Buffer.from(a.key),Buffer.from(b.key))))hash.update(JSON.stringify([row.key,require('./sqlite-records.cjs').hash(row.json)]));}
 else{const db=new DatabaseSync(store.file,{readOnly:true,timeout:5000});try{db.exec('BEGIN');const get=db.prepare('SELECT value FROM state WHERE key=?');if(get.get('identity')?.value!==store.expectedIdentity)throw Error('The database changed. Reopen this review.');hash.update(manifest(get.get('manifest').value));for(const row of db.prepare('SELECT key,json FROM records ORDER BY key').iterate())if(!excluded(row.key))hash.update(JSON.stringify([row.key,JSON.parse(row.json).digest]));}finally{db.close();}}
 const result=hash.digest('hex');cache.set(store.data,result);return result;
}
module.exports={digest};
