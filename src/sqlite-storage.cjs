'use strict';
// Persistence only: domain validation, review rules and public JSON contracts
// remain in Store. Each record is independently stored; media is deduplicated.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {StringCache}=require('./string-cache.cjs');
const lazy=require('./lazy-assets.cjs');
const fieldRecords=require('./sqlite-records.cjs');
const FORMAT=3,APPLICATION_ID=0x53465044;
const FIELD_SCHEMA='CREATE TABLE record_fields (record TEXT NOT NULL REFERENCES records(key) ON DELETE CASCADE, path TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(record,path)) STRICT; CREATE INDEX record_fields_lookup ON record_fields(path,json) WHERE length(json)<=512; CREATE TABLE field_versions (record TEXT NOT NULL, path TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(record,path)) STRICT; CREATE TABLE change_log (sequence INTEGER PRIMARY KEY AUTOINCREMENT, epoch TEXT NOT NULL, from_identity TEXT, to_identity TEXT NOT NULL, json TEXT NOT NULL, bytes INTEGER NOT NULL) STRICT; CREATE TABLE change_assets (sequence INTEGER NOT NULL REFERENCES change_log(sequence) ON DELETE CASCADE, hash TEXT NOT NULL REFERENCES assets(hash), PRIMARY KEY(sequence,hash)) STRICT;';
const own=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});
const sqlitePath=file=>file&&(/\.json$/i.test(file)?file.replace(/\.json$/i,'.sqlite'):file);
const legacyPath=file=>/\.sqlite$/i.test(file)?file.replace(/\.sqlite$/i,'.json'):null;
function open(file,existingOnly=false){
 // Opening a collection must not create/initialise one. Retain read-write
 // access so SQLite can recover a hot rollback journal left by a power loss.
 if(existingOnly&&!fs.statSync(file).isFile())throw Error('Choose a Paddock SQLite database file.');
 const db=new DatabaseSync(file,{timeout:5000});
 try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  const application=db.prepare('PRAGMA application_id').get().application_id;
  if(version!==0&&(![1,2,FORMAT].includes(version)||application!==APPLICATION_ID))throw Error('Unsupported Paddock SQLite storage version. Use a newer Paddock.');
  if(!version){
   if(existingOnly)throw Error('This is not a Paddock SQLite database with a committed collection. Keep the file and restore a verified backup.');
   if(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get().n)throw Error('This is not a Paddock SQLite database.');
   db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE records (key TEXT PRIMARY KEY, bucket TEXT NOT NULL, identity TEXT NOT NULL, json TEXT NOT NULL) STRICT;
    CREATE INDEX records_bucket ON records(bucket,identity);
    ${FIELD_SCHEMA}
    CREATE TABLE assets (hash TEXT PRIMARY KEY, value BLOB NOT NULL, meta TEXT NOT NULL, meta_digest TEXT NOT NULL) STRICT;
    CREATE TABLE asset_refs (record TEXT NOT NULL REFERENCES records(key) ON DELETE CASCADE, hash TEXT NOT NULL REFERENCES assets(hash), PRIMARY KEY(record,hash)) STRICT;
    CREATE TABLE undo_records (key TEXT PRIMARY KEY, bucket TEXT, identity TEXT, json TEXT) STRICT;
    CREATE TABLE undo_assets (hash TEXT PRIMARY KEY REFERENCES assets(hash)) STRICT;
    PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${FORMAT};`);
   require('./storage-structure.cjs').initializeReceipts(db);db.exec('COMMIT');
  }
  require('./storage-structure.cjs').check(db,version||FORMAT);
  return db;
 }catch(e){db.close();throw e;}
}
// A typed tree descriptor preserves object property order exactly (replication
// digests depend on it), including future fields not known to this storage layer.
function pack(data,cache=new StringCache(),prune=true,baseline=null,reused=null){
 const used=new Set();
 const records=[],assets=new Map(),externalAssets=new Map();
 function record(value,parts,asset=null){
  const key=JSON.stringify(parts);used.add(key);if(baseline?.has(key)&&baseline.get(key)===(asset||value))return {record:key};
  const refs=[];
  function visit(v,p=[]){
   // Documents and photos are immutable base64 strings. Preserve their exact
   // bytes rather than decoding/re-encoding imported noncanonical data URIs.
   if(typeof v==='string'&&(v.startsWith('data:image/')&&require('./json-encoding.cjs').isPhoto(v)||(p.at(-1)==='data'&&v.length>=1024&&/^[A-Za-z0-9+/=]+$/.test(v)))){
    let hash=cache.get(v);if(!hash){hash=crypto.createHash('sha256').update(v).digest('hex');cache.set(v,hash);}
    assets.set(hash,v);refs.push({path:p,hash});return null;
   }
   function member(k){const a=require('./lazy-assets.cjs').property(v,k);if(a){refs.push({path:[...p,Array.isArray(v)?Number(k):k],hash:a.meta.hash});externalAssets.set(a.meta.hash,a.file);return null;}return visit(v[k],[...p,Array.isArray(v)?Number(k):k]);}
   if(Array.isArray(v))return Array.from({length:v.length},(_,i)=>member(i));
   if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).map(k=>[k,member(k)]));
   return v;
  }
  if(asset){refs.push({path:[],hash:asset.meta.hash});externalAssets.set(asset.meta.hash,asset.file);}
  const json=JSON.stringify({value:asset?null:visit(value),refs});
  records.push({key,bucket:JSON.stringify(parts.slice(0,-1)),identity:String(parts.at(-1)),json,refs:[...new Set(refs.map(r=>r.hash))]});
  return {record:key};
 }
 function tree(v,p,asset=null){
  const saved=reused?.get(JSON.stringify(p));if(saved)return saved;
  if(asset)return record(null,p,asset);
  if(Array.isArray(v)){
   const ids=Array.from({length:v.length},(_,i)=>{if(lazy.property(v,i))return 'index:'+i;const x=v[i];return x&&typeof x.id==='string'?'id:'+x.id:p.join('.')==='timing.sessions'&&x?.payload?'session:'+JSON.stringify([x.payload.source.id,x.payload.sessionId]):'index:'+i;});
   if(new Set(ids).size!==ids.length)throw Error('Duplicate SQLite record identity.');
   return {array:Array.from({length:v.length},(_,i)=>{const a=lazy.property(v,i);return record(a?null:v[i],[...p,ids[i]],a);})};
  }
  if(v&&typeof v==='object'&&(p.length===0||['timing','planning','club'].includes(p[0])&&p.length===1))return {object:Object.keys(v).map(k=>{const a=lazy.property(v,k);return [k,tree(a?null:v[k],[...p,k],a)];})};
  return record(v,p);
 }
 const manifest=JSON.stringify(tree(data,[]));
 // The cache must not keep removed photographs alive forever.
 if(prune)for(const [value,hash] of cache)if(!assets.has(hash))cache.delete(value);
 return {manifest,records,assets:[...assets],externalAssets:[...externalAssets],identity:JSON.stringify([data.id,data.revision]),...(baseline?{partial:true,removed:[...baseline.keys()].filter(key=>!used.has(key))}:{})};
}
function recordValues(before){
 const baseline=new Map();
 function tree(v,p){
  if(Array.isArray(v)){for(let i=0;i<v.length;i++){const a=lazy.property(v,i),x=a?null:v[i],id=x&&typeof x.id==='string'?'id:'+x.id:p.join('.')==='timing.sessions'&&x?.payload?'session:'+JSON.stringify([x.payload.source.id,x.payload.sessionId]):'index:'+i;baseline.set(JSON.stringify([...p,id]),a||x);}return;}
  if(v&&typeof v==='object'&&(p.length===0||['timing','planning','club'].includes(p[0])&&p.length===1)){for(const k of Object.keys(v)){const a=lazy.property(v,k);if(a)baseline.set(JSON.stringify([...p,k]),a);else tree(v[k],[...p,k]);}return;}
  baseline.set(JSON.stringify(p),v);
 }
 tree(before,[]);return baseline;
}
function packChanges(before,after,cache,manifest=null){
 if(!manifest)return pack(after,cache,false,recordValues(before));
 // The committed descriptor already names every unchanged record. Reuse whole
 // unchanged lists instead of rebuilding their keys on each small mutation.
 const baseline=new Map(),reused=new Map();
 const member=(object,key)=>lazy.property(object,key)||object?.[key];
 function compare(a,b,node,p){
  if(a===b){reused.set(JSON.stringify(p),node);return;}
  if(Object.hasOwn(node,'record')){baseline.set(node.record,a);return;}
  if(node.array){for(let i=0;i<node.array.length;i++)baseline.set(node.array[i].record,member(a,i));return;}
  if(node.object){for(const [key,child]of node.object)compare(member(a,key),member(b,key),child,[...p,key]);return;}
  throw Error('Invalid committed collection descriptor.');
 }
 compare(before,after,JSON.parse(manifest),[]);
 return pack(after,cache,false,baseline,reused);
}
function envelopes(file,keys){const db=open(file,true);try{db.exec('BEGIN');const get=db.prepare('SELECT json FROM records WHERE key=?');return new Map(keys.map(key=>{const row=get.get(key);return [key,row?recordEnvelope(db,key,row.json):undefined];}));}finally{db.close();}}
function availableAssetMetadata(file,hashes){const db=open(file,true);try{const get=db.prepare('SELECT meta FROM assets WHERE hash=?');return hashes.flatMap(hash=>{const row=get.get(hash);return row?[JSON.parse(row.meta)]:[];});}finally{db.close();}}
function state(db,key){return db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value??null;}
function recordEnvelope(db,key,json){const entry=JSON.parse(json);return Object.hasOwn(entry,'shape')?fieldRecords.merge(json,db.prepare('SELECT path,json FROM record_fields WHERE record=?').all(key).map(r=>[r.path,r.json])):json;}
function unpack(db,previous=false,lazyFile=null,baseline=null){
 const current=state(db,'manifest');if(!current)throw Error('SQLite contains no committed collection. Keep the file and restore a verified backup.');
 const manifest=previous?state(db,'previous_manifest'):current;if(!manifest)return null;
 if(db.prepare('PRAGMA foreign_key_check').get())throw Error('SQLite attachment reference integrity check failed.');
 const links=new Map();for(const row of db.prepare('SELECT record,hash FROM asset_refs').iterate()){if(!links.has(row.record))links.set(row.record,new Set());links.get(row.record).add(row.hash);}
 let metadataSize=0;const rows=new Map(),fields=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='record_fields'").get()?db.prepare('SELECT path,json FROM record_fields WHERE record=?'):null;
 // Keep one decoded model, not headers + complete JSON strings + parsed copies.
 // Prepared field queries and streamed rows also avoid per-record SQL parsing.
 for(const row of db.prepare('SELECT key,json FROM records ORDER BY key').iterate()){
  const entry=fieldRecords.decode(row.json,(fields?.all(row.key)||[]).map(r=>[r.path,r.json]));
  if(!entry||!Array.isArray(entry.refs)||!Object.hasOwn(entry,'value'))throw Error('Invalid SQLite record.');
  const expected=new Set(entry.refs.map(r=>r.hash)),actual=links.get(row.key)||new Set();
  if(expected.size!==actual.size||[...expected].some(hash=>!actual.has(hash)))throw Error('SQLite attachment reference integrity check failed.');
  metadataSize+=require('./json-encoding.cjs').metadataByteLength(entry.value)+entry.refs.length*252;require('./storage-resources.cjs').checkCollectionSize(metadataSize);
  rows.set(row.key,entry);
 }
 if(baseline){baseline.manifest=manifest;baseline.references=new Map([...rows].filter(([,e])=>e.refs.length).map(([key,e])=>[key,[...new Set(e.refs.map(r=>r.hash))]]));}
 if(previous)for(const row of db.prepare('SELECT key,json FROM undo_records').iterate()){if(row.json===null)rows.delete(row.key);else rows.set(row.key,JSON.parse(row.json));}
 const media=new Map(),used=new Set(),getAsset=db.prepare(lazyFile?'SELECT meta,meta_digest,length(value) size FROM assets WHERE hash=?':'SELECT value FROM assets WHERE hash=?');
 function readRecord(key){
  if(!rows.has(key))throw Error('SQLite collection has a missing record.');
  if(used.has(key))throw Error('SQLite collection has a duplicate record reference.');used.add(key);
  const entry=rows.get(key);
  for(const ref of entry.refs){
   if(!media.has(ref.hash)){
    const row=getAsset.get(ref.hash);if(!row)throw Error('SQLite collection has a missing attachment.');
    if(lazyFile){const lazy=require('./lazy-assets.cjs'),meta=JSON.parse(row.meta);if(lazy.digest(row.meta)!==row.meta_digest||!lazy.valid(meta,ref.hash,row.size))throw Error('SQLite attachment metadata integrity check failed.');media.set(ref.hash,lazy.asset(lazyFile,meta));}
    else{const bytes=Buffer.from(row.value);if(crypto.createHash('sha256').update(bytes).digest('hex')!==ref.hash)throw Error('SQLite attachment integrity check failed.');media.set(ref.hash,bytes.toString('utf8'));}
   }
   if(!ref.path.length)entry.value=media.get(ref.hash);
   else{let parent=entry.value;for(const k of ref.path.slice(0,-1)){if(!Object.hasOwn(parent,k))throw Error('Invalid SQLite attachment reference.');parent=parent[k];}const key=ref.path.at(-1);if(!Object.hasOwn(parent,key))throw Error('Invalid SQLite attachment reference.');if(lazyFile)require('./lazy-assets.cjs').attach(parent,key,media.get(ref.hash));else own(parent,key,media.get(ref.hash));}
  }
  return entry.value;
 }
 function visit(node){if(Object.hasOwn(node,'record'))return readRecord(node.record);if(node.array||node.object){const target=node.array?[]:{};for(const [key,n]of node.array?node.array.map((n,i)=>[i,n]):node.object){const value=visit(n);if(lazy.isAsset(value))lazy.attach(target,key,value);else own(target,key,value);}return target;}throw Error('Invalid SQLite collection structure.');}
 const data=visit(JSON.parse(manifest));if(used.size!==rows.size)throw Error('SQLite collection has unreferenced records.');return data;
}
function write(file,packed,expected){
 fs.mkdirSync(path.dirname(file),{recursive:true});const db=open(file);
 try{
  db.exec('BEGIN IMMEDIATE');
  const releaseMergePermit=require('./car-merge-fence.cjs').begin(db,{install:packed.records.some(r=>r.bucket==='["mergeMappings"]')});
  require('./storage-structure.cjs').initializeReceipts(db);
  require('./storage-resources.cjs').prepareWrite(file,db,packed);
  require('./query-index.cjs').ensure(db);
  if(db.prepare('PRAGMA user_version').get().user_version!==FORMAT)throw Error('SQLite storage migration is required before saving. Reopen Paddock.');
  if(state(db,'identity')!==expected)throw Object.assign(Error('The database changed in another process. Refresh and retry the unchanged operation.'),{code:'QUERY_CHANGED'});
  const invalidations=require('./public-invalidations.cjs').begin(db,packed);
  const previous=state(db,'manifest');if(packed.partial&&!previous)throw Error('A partial write needs an existing collection.');
  const sizes=previous&&!packed.resetEpoch&&!packed.refreshAssets?require('./sqlite-sizes.cjs').tracker(db,expected,previous,packed.manifest):null;
  const getRecord=db.prepare('SELECT * FROM records WHERE key=?'),old=new Map((packed.partial?[...new Set([...packed.records.map(r=>r.key),...(packed.removed||[])])].map(key=>getRecord.get(key)).filter(Boolean):db.prepare('SELECT * FROM records').all()).map(r=>[r.key,r]));
  const putState=db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  let epoch=state(db,'change_epoch');const from=expected?JSON.parse(expected):null,to=JSON.parse(packed.identity);
  const mergeGuard=!packed.resetEpoch&&from?.[0]===to[0];
  if(!epoch||!from||from[0]!==to[0]||to[1]<=from[1]||packed.resetEpoch){epoch=crypto.randomUUID();db.exec('DELETE FROM change_log; DELETE FROM field_versions;');if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='command_receipts'").get())db.exec('DELETE FROM command_receipts');putState.run('change_epoch',epoch);putState.run('field_floor',String(to[1]));}
  const stamp=db.prepare('INSERT INTO field_versions(record,path,revision) VALUES(?,?,?) ON CONFLICT(record,path) DO UPDATE SET revision=excluded.revision');
  db.exec('DELETE FROM undo_records; DELETE FROM undo_assets;');
  if(previous)putState.run('previous_manifest',previous);
  const assetExists=db.prepare('SELECT 1 FROM assets WHERE hash=?'),putAsset=db.prepare('INSERT INTO assets(hash,value,meta,meta_digest) VALUES(?,?,?,?) ON CONFLICT(hash) DO UPDATE SET value=excluded.value,meta=excluded.meta,meta_digest=excluded.meta_digest');
  let assetWrites=0,recordWrites=0,fieldWrites=0;const changes=[],changeAssets=new Set();
  const addAsset=(hash,value)=>{const lazy=require('./lazy-assets.cjs'),meta=lazy.metadata(value);if(meta.hash!==hash)throw Error('SQLite attachment hash does not match its content.');const json=JSON.stringify(meta);putAsset.run(hash,Buffer.from(value),json,lazy.digest(json));assetWrites++;};
  // A restore repairs matching blobs too: a surviving hash/metadata row does
  // not prove that the old on-disk bytes are still intact. Normal saves retain
  // the deduplicated fast path and do not rewrite unchanged originals.
  for(const [hash,value] of packed.assets)if(packed.refreshAssets||!assetExists.get(hash))addAsset(hash,value);
  for(const [hash,source]of packed.externalAssets||[])if(packed.refreshAssets||!assetExists.get(hash))addAsset(hash,readAsset(source,hash));
  const putUndo=db.prepare('INSERT INTO undo_records(key,bucket,identity,json) VALUES(?,?,?,?)');
  const keepUndoAssets=db.prepare('INSERT OR IGNORE INTO undo_assets SELECT hash FROM asset_refs WHERE record=?');
  const deleteRefs=db.prepare('DELETE FROM asset_refs WHERE record=?'),putRef=db.prepare('INSERT INTO asset_refs(record,hash) VALUES(?,?)');
  const putRecord=db.prepare('INSERT INTO records(key,bucket,identity,json) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,identity=excluded.identity,json=excluded.json');
  const getFields=db.prepare('SELECT path,json FROM record_fields WHERE record=?'),putField=db.prepare('INSERT INTO record_fields(record,path,json) VALUES(?,?,?) ON CONFLICT(record,path) DO UPDATE SET json=excluded.json'),removeField=db.prepare('DELETE FROM record_fields WHERE record=? AND path=?');
  for(const row of packed.records){
   const before=old.get(row.key);old.delete(row.key);if(before&&JSON.parse(before.json).digest===fieldRecords.hash(row.json))continue;
   const split=fieldRecords.split(row.json),fields=new Map(getFields.all(row.key).map(r=>[r.path,r.json])),changedFields=[];
   const beforeJson=before?recordEnvelope(db,before.key,before.json):null;
   if(mergeGuard&&beforeJson)require('./car-merge-write-guard.cjs').check(before.bucket,JSON.parse(beforeJson).value,JSON.parse(row.json).value,db);
   sizes?.change(beforeJson,-1);sizes?.change(row.json,1);
   putUndo.run(row.key,before?.bucket??null,before?.identity??null,beforeJson);keepUndoAssets.run(row.key);deleteRefs.run(row.key);
   putRecord.run(row.key,row.bucket,row.identity,split.header);
   if(!before)stamp.run(row.key,'*',to[1]);
   for(const [key,json]of split.fields){if(fields.get(key)!==json){putField.run(row.key,key,json);changedFields.push({path:key,json});fieldWrites++;}fields.delete(key);}
   for(const key of fields.keys()){removeField.run(row.key,key);changedFields.push({path:key,remove:true});fieldWrites++;}
   changes.push({key:row.key,before:before?JSON.parse(before.json).digest:null,header:split.header,fields:changedFields});
   for(const field of changedFields)stamp.run(row.key,field.path,to[1]);
   // Extracted values are null in field rows. Their content lives in refs;
   // replacing an asset must still advance the corresponding field version.
   const oldRefs=new Map((before?JSON.parse(before.json).refs:[]).map(ref=>[JSON.stringify(ref.path),ref.hash])),newRefs=new Map(JSON.parse(split.header).refs.map(ref=>[JSON.stringify(ref.path),ref.hash]));
   for(const key of new Set([...oldRefs.keys(),...newRefs.keys()]))if(oldRefs.get(key)!==newRefs.get(key))stamp.run(row.key,key,to[1]);
   for(const hash of row.refs){putRef.run(row.key,hash);changeAssets.add(hash);}
   require('./query-index.cjs').update(db,row.key,row.bucket,JSON.parse(row.json).value);recordWrites++;
  }
  const remove=db.prepare('DELETE FROM records WHERE key=?');
  for(const row of old.values()){const beforeJson=recordEnvelope(db,row.key,row.json);if(mergeGuard)require('./car-merge-write-guard.cjs').check(row.bucket,JSON.parse(beforeJson).value,null,db);sizes?.change(beforeJson,-1);putUndo.run(row.key,row.bucket,row.identity,beforeJson);keepUndoAssets.run(row.key);remove.run(row.key);stamp.run(row.key,'*',to[1]);changes.push({key:row.key,before:JSON.parse(row.json).digest,remove:true});recordWrites++;}
  require('./query-performance.cjs').flush(db);
  putState.run('manifest',packed.manifest);putState.run('identity',packed.identity);
  if(packed.replicaState)putState.run('replica_sync',JSON.stringify(packed.replicaState));else db.prepare("DELETE FROM state WHERE key='replica_sync'").run();
  // Retain deletion versions for a bounded revision window. Older proposals
  // require an explicit conflict review instead of trusting incomplete history.
  const floor=Math.max(Number(state(db,'field_floor')||0),to[1]-10000);putState.run('field_floor',String(floor));
  db.prepare("DELETE FROM field_versions WHERE revision<? AND NOT EXISTS (SELECT 1 FROM record_fields f WHERE f.record=field_versions.record AND f.path=field_versions.path) AND (path<>'*' OR NOT EXISTS (SELECT 1 FROM records r WHERE r.key=field_versions.record))").run(floor);
  // Internal storage journal only. Public feeds must project and authorize it;
  // signing keys/private fields must never leak through an unfiltered endpoint.
  const entry=JSON.stringify({publicCars:invalidations(),manifestBefore:previous?fieldRecords.hash(previous):null,manifestAfter:fieldRecords.hash(packed.manifest),manifestChanges:require('./sqlite-delta.cjs').delta(previous?JSON.parse(previous):null,JSON.parse(packed.manifest)),changes});
  const sequence=db.prepare('INSERT INTO change_log(epoch,from_identity,to_identity,json,bytes) VALUES(?,?,?,?,?)').run(epoch,expected,packed.identity,entry,Buffer.byteLength(entry)).lastInsertRowid;
  putState.run('change_sequence',String(sequence));require('./query-index.cjs').stamp(db);
  const pin=db.prepare('INSERT INTO change_assets(sequence,hash) VALUES(?,?)');for(const hash of changeAssets)pin.run(sequence,hash);
  let retained=0,count=0;for(const item of db.prepare('SELECT sequence,bytes FROM change_log ORDER BY sequence DESC').all()){retained+=item.bytes;count++;if(count>256||retained>32*1024*1024){db.prepare('DELETE FROM change_log WHERE sequence<=?').run(item.sequence);break;}}
  // Bound media retained only for replay independently of live/undo media.
  const orphanBytes=db.prepare('SELECT coalesce(sum(length(value)),0) bytes FROM assets WHERE hash IN (SELECT hash FROM change_assets) AND hash NOT IN (SELECT hash FROM asset_refs) AND hash NOT IN (SELECT hash FROM undo_assets)');
  while(orphanBytes.get().bytes>32*1024*1024){const first=db.prepare('SELECT min(sequence) sequence FROM change_log').get().sequence;if(first===null)break;db.prepare('DELETE FROM change_log WHERE sequence=?').run(first);}
  db.exec('CREATE TEMP TABLE live_assets(hash TEXT PRIMARY KEY)');const live=db.prepare('INSERT OR IGNORE INTO live_assets VALUES(?)');for(const hash of packed.pinnedAssets||[])live.run(hash);
  db.exec('DELETE FROM assets WHERE hash NOT IN (SELECT hash FROM asset_refs) AND hash NOT IN (SELECT hash FROM undo_assets) AND hash NOT IN (SELECT hash FROM change_assets) AND hash NOT IN (SELECT hash FROM live_assets)');
  const metadata=db.prepare('SELECT meta FROM assets WHERE hash=?'),assetMetadata=[...new Set(packed.records.flatMap(r=>r.refs))].map(hash=>JSON.parse(metadata.get(hash).meta));
  require('./sqlite-sizes.cjs').save(db,packed.identity,packed.manifest,sizes);
  if(packed.commandReceipt){if(packed.commandReceipt.epoch!==epoch)throw Error('Save receipt generation changed.');require('./command-receipts.cjs').insert(db,packed.commandReceipt);}
  releaseMergePermit();db.exec('COMMIT');return {recordWrites,assetWrites,fieldWrites,assetMetadata};
 }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
}
function read(file,previous=false,lazy=false,baseline=null){const db=open(file,true);try{db.exec('BEGIN');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('SQLite integrity check failed.');const data=unpack(db,previous,lazy&&db.prepare('PRAGMA user_version').get().user_version===FORMAT?file:null,baseline);if(!previous&&state(db,'identity')!==JSON.stringify([data.id,data.revision]))throw Error('SQLite collection identity integrity check failed.');db.exec('COMMIT');return data;}finally{db.close();}}
function readAsset(file,hash){if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid attachment identity.');const db=open(file,true);try{const row=db.prepare('SELECT value FROM assets WHERE hash=?').get(hash);if(!row)throw Error('This attachment is no longer available. Reopen its collection.');const bytes=Buffer.from(row.value);if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('SQLite attachment integrity check failed.');return bytes.toString('utf8');}finally{db.close();}}
function writeAsync(file,packed,expected){return require('./sqlite-writer.cjs').write(file,packed,expected);}
function upgrade(file,expected){
 const db=open(file,true);let backup;
 try{
  const version=db.prepare('PRAGMA user_version').get().user_version;if(version===FORMAT){db.exec('BEGIN IMMEDIATE');const release=require('./car-merge-fence.cjs').begin(db);if(state(db,'identity')!==expected)throw Error('The database changed before index preparation. Reopen Paddock.');require('./storage-structure.cjs').initializeReceipts(db);require('./query-index.cjs').ensure(db);release();db.exec('COMMIT');return null;}
  if(state(db,'identity')!==expected)throw Error('The database changed before storage migration. Reopen Paddock.');
  const before=unpack(db),previous=unpack(db,true);
  backup=file+'.format'+version+'-'+crypto.randomUUID()+'.backup';
  db.prepare('VACUUM INTO ?').run(backup);
  db.exec('BEGIN IMMEDIATE');
  if(state(db,'identity')!==expected||db.prepare('PRAGMA user_version').get().user_version!==version)throw Error('The database changed during storage migration. Reopen Paddock.');
  if(version===1){db.exec(FIELD_SCHEMA);
  const putField=db.prepare('INSERT INTO record_fields(record,path,json) VALUES(?,?,?)'),putHeader=db.prepare('UPDATE records SET json=? WHERE key=?');
  for(const row of db.prepare('SELECT key,json FROM records').all()){
   const split=fieldRecords.split(row.json);for(const [key,json]of split.fields)putField.run(row.key,key,json);putHeader.run(split.header,row.key);
  }
  db.prepare('INSERT INTO state(key,value) VALUES(?,?)').run('change_epoch',crypto.randomUUID());
  db.prepare('INSERT INTO state(key,value) VALUES(?,?)').run('change_sequence','0');
  db.prepare('INSERT INTO state(key,value) VALUES(?,?)').run('field_floor',String(before.revision));
  }
  if(!db.prepare('PRAGMA table_info(assets)').all().some(c=>c.name==='meta'))db.exec('ALTER TABLE assets ADD COLUMN meta TEXT; ALTER TABLE assets ADD COLUMN meta_digest TEXT;');
  const putMeta=db.prepare('UPDATE assets SET meta=?,meta_digest=? WHERE hash=?'),lazy=require('./lazy-assets.cjs');for(const row of db.prepare('SELECT hash,value FROM assets').all()){const value=Buffer.from(row.value).toString('utf8'),meta=lazy.metadata(value);if(meta.hash!==row.hash)throw Error('SQLite attachment integrity check failed.');const json=JSON.stringify(meta);putMeta.run(json,lazy.digest(json),row.hash);}
  if(JSON.stringify(unpack(db))!==JSON.stringify(before)||JSON.stringify(unpack(db,true))!==JSON.stringify(previous))throw Error('SQLite field migration did not preserve the collection and recovery revision.');
  require('./storage-structure.cjs').initializeReceipts(db);require('./query-index.cjs').ensure(db);db.exec('PRAGMA user_version=3; COMMIT');return backup;
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
}
function changesSince(file,{epoch,after=0,limit=64,maxBytes=4*1024*1024}={}){
 if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>256||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024)throw Error('Invalid change cursor or limits.');
 const db=open(file,true);try{
  db.exec('BEGIN');const currentEpoch=state(db,'change_epoch'),latest=Number(state(db,'change_sequence')||0),base={epoch:currentEpoch,latest,identity:JSON.parse(state(db,'identity'))};
  if(epoch!==currentEpoch||after>latest)return {...base,snapshotRequired:true,reason:'epoch'};
  if(after===latest)return {...base,entries:[],next:after,more:false};
  const rows=db.prepare('SELECT * FROM change_log WHERE sequence>? ORDER BY sequence LIMIT ?').all(after,limit),entries=[];let bytes=0,next=after;
  if(!rows.length||rows[0].sequence!==after+1)return {...base,snapshotRequired:true,reason:'expired'};
  for(const row of rows){if(row.bytes>maxBytes&&!entries.length)return {...base,snapshotRequired:true,reason:'transaction-size'};if(bytes+row.bytes>maxBytes)break;entries.push({sequence:row.sequence,from:JSON.parse(row.from_identity),to:JSON.parse(row.to_identity),...JSON.parse(row.json)});bytes+=row.bytes;next=row.sequence;}
  return {...base,entries,next,more:next<latest};
 }finally{db.close();}
}
// Targeted version reads never hydrate photographs or unrelated records.
function fieldState(file,expected,record,paths=[]){
 const db=open(file,true);try{db.exec('BEGIN');if(state(db,'identity')!==expected)throw Error('The database changed in another process. Reopen Paddock before reviewing.');
  const get=db.prepare('SELECT revision FROM field_versions WHERE record=? AND path=?');
  return {epoch:state(db,'change_epoch'),floor:Number(state(db,'field_floor')||0),identity:JSON.parse(expected),versions:Object.fromEntries(['*',...paths].map(key=>[key,get.get(record,key)?.revision||0]))};
 }finally{db.close();}
}
function syncState(file){const db=open(file,true);try{return {epoch:state(db,'change_epoch'),after:Number(state(db,'change_sequence')||0),identity:JSON.parse(state(db,'identity')),replica:JSON.parse(state(db,'replica_sync')||'null')};}finally{db.close();}}
function assetMetadata(file,hashes){const db=open(file,true);try{const query=db.prepare('SELECT meta FROM assets WHERE hash=?');return hashes.map(hash=>{const row=query.get(hash);if(!row)throw Error('Attachment unavailable.');return JSON.parse(row.meta);});}finally{db.close();}}
function assetChunk(file,hash,offset=0){if(!/^[a-f0-9]{64}$/.test(hash)||!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid asset cursor.');const db=open(file,true);try{const r=db.prepare('SELECT length(value) size,substr(value,?,1048576) bytes,meta FROM assets WHERE hash=?').get(offset+1,hash);if(!r||offset>=r.size)throw Error('Attachment unavailable.');return {hash,offset,size:r.size,data:Buffer.from(r.bytes).toString('base64'),meta:JSON.parse(r.meta)};}finally{db.close();}}
function stageAsset(file,hash,value){const db=open(file,true);try{const meta=require('./lazy-assets.cjs').metadata(value);if(meta.hash!==hash)throw Error('Attachment verification failed.');db.exec('BEGIN IMMEDIATE');const release=require('./car-merge-fence.cjs').begin(db);const json=JSON.stringify(meta);db.prepare('INSERT OR IGNORE INTO assets(hash,value,meta,meta_digest) VALUES(?,?,?,?)').run(hash,Buffer.from(value),json,fieldRecords.hash(json));release();db.exec('COMMIT');return meta;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}}
// Lightweight connection-status hint, never a substitute for opening/validating a Store.
function collectionHint(file){
 const db=open(file,true);try{
  db.exec('BEGIN');const identity=JSON.parse(state(db,'identity')||'null');
  const key=JSON.stringify(['club','id']),row=db.prepare('SELECT json FROM records WHERE key=?').get(key);
  return {id:identity?.[0],clubId:row?JSON.parse(recordEnvelope(db,key,row.json)).value:null};
 }finally{db.close();}
}
function protectedFiles(file){if(!file)return [];const legacy=legacyPath(file),folder=require('node:path').dirname(file),prefix=require('node:path').basename(file)+'.format',recovery=fs.existsSync(folder)?fs.readdirSync(folder).filter(name=>name.startsWith(prefix)&&name.endsWith('.backup')).map(name=>require('node:path').join(folder,name)):[];return [file,file+'-journal',file+'-wal',file+'-shm',legacy,legacy&&legacy+'.previous',...recovery].filter(Boolean);}
function sharedSnapshot(store,file,limit){
 const db=open(store.file,true),hash=crypto.createHash('sha256'),hashes=new Set();let fd,size=0,complete=false;
 const write=text=>{const bytes=Buffer.from(text);size+=bytes.length;if(size>limit)throw Error('Snapshot metadata exceeds the transfer limit.');fs.writeSync(fd,bytes);hash.update(bytes);};
 try{fd=fs.openSync(file,'wx');db.exec('BEGIN');if(state(db,'identity')!==store.expectedIdentity)throw Error('The database changed during snapshot creation. Retry.');const cursor={epoch:state(db,'change_epoch'),after:Number(state(db,'change_sequence')||0),revision:JSON.parse(state(db,'identity'))[1]};
 write('{"manifest":'+JSON.stringify(state(db,'manifest'))+',"rows":[');let first=true;for(const row of db.prepare('SELECT key,json FROM records ORDER BY key').iterate()){
  if(row.key===JSON.stringify(['timing','key']))continue;const json=recordEnvelope(db,row.key,row.json);for(const ref of JSON.parse(json).refs)hashes.add(ref.hash);if(!first)write(',');first=false;write(JSON.stringify([row.key,json]));
 }write(']}');fs.fsyncSync(fd);complete=true;return {size,digest:hash.digest('hex'),hashes,cursor};
 }finally{db.close();if(fd!==undefined){fs.closeSync(fd);if(!complete)try{fs.unlinkSync(file);}catch{}}}
}
function recoverForRead(file){const db=open(file,true);try{db.prepare('SELECT count(*) FROM sqlite_master').get();}finally{db.close();}}
module.exports={recoverForRead,sharedSnapshot,recordValues,envelopes,availableAssetMetadata,packChanges,protectedFiles,collectionHint,syncState,assetMetadata,assetChunk,stageAsset,FORMAT,sqlitePath,legacyPath,pack,read,readAsset,write,writeAsync,upgrade,changesSince,fieldState};
