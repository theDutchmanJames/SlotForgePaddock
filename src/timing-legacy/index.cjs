'use strict';
// Read-only legacy interface. No app startup, migration, recovery, timers or writes.
// Run in a worker: legacy JSON must be parsed once; SQLite stays record-paged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION=1,MAX_JSON=Math.min(1024*1024*1024,require('node:buffer').constants.MAX_STRING_LENGTH);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>digest(canonical(v));
const entities=new Set(['slotcars','sessions','laps','tracks','drivers','teams','raceclasses']);
function fail(message){throw Object.assign(Error(message),{code:'TIMING_LEGACY_INVALID'});}
function fileHash(file){const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),b=Buffer.allocUnsafe(65536);try{let n;while((n=fs.readSync(fd,b,0,b.length,null)))h.update(b.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
function json(file,optional=false){try{const st=fs.lstatSync(file);if(!st.isFile()||st.size>MAX_JSON)fail('Legacy JSON is not a regular file or exceeds the supported size.');const bytes=fs.readFileSync(file);if(bytes.length>MAX_JSON)fail('Legacy JSON grew beyond the supported size.');return {value:JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),sha256:digest(bytes)};}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}}
function describe(profile){
 const root=fs.realpathSync(profile),selection=path.join(root,'storage-backend.json'),marker=json(selection,true);
 if(marker){const m=marker.value;if(m.format!=='slotforge-storage-selection'||m.version!==1||m.backend!=='sqlite'||!/^\w{8}(?:-\w{4}){3}-\w{12}$/.test(m.generation||''))fail('Invalid active SQLite selection. Stale JSON must not be adopted.');
  const folder=path.join(root,'sqlite',m.generation,'working'),file=path.join(folder,'working.sqlite');
  if(fs.realpathSync(path.dirname(folder))!==path.dirname(folder)||fs.realpathSync(folder)!==folder||!fs.lstatSync(file).isFile())fail('Active SQLite generation is missing or redirected.');
  return {version:VERSION,profile:root,backend:'sqlite',file,selection,selectionHash:marker.sha256,generation:m.generation,originKey:digest(root)};
 }
 if(fs.existsSync(path.join(root,'sqlite-activation-request.json')))fail('Timing has an unfinished storage activation. Let Timing finish it before adoption.');
 const filename=path.basename(root)==='slot-lap-timer'?'slot-lap-timer.json':'slotforge-timing.json',file=path.join(root,filename);
 if(!fs.existsSync(file))return null;if(!fs.lstatSync(file).isFile())fail('Legacy database is not a regular file.');
 return {version:VERSION,profile:root,backend:'json',file,selection,selectionHash:null,originKey:digest(root)};
}
function discover({appData}){
 if(typeof appData!=='string'||!path.isAbsolute(appData))fail('Supply the current operating-system appData directory.');
 const current=path.join(appData,'slotforge-timing');
 if(fs.existsSync(current)){const d=describe(current);return d?[d]:[];}
 const old=path.join(appData,'slot-lap-timer');if(fs.existsSync(old)){const d=describe(old);return d?[d]:[];}return [];
}
function open({profile,sourceId}={}){
 const descriptor=describe(profile);if(!descriptor)fail('No Timing database found.');
 let data,db,closed=false,finished=false,sourceHash,dataVersion;
 const indexes=new Map();
 const assertOpen=()=>{if(closed||finished)fail('Legacy snapshot is closed.');};
 try{
  if(descriptor.backend==='json'){
   const input=json(descriptor.file);data=input.value;sourceHash=input.sha256;
   if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==undefined&&data.version!==1||data.format||data.app)fail('Expected a raw Timing database, not an export or backup wrapper.');
   for(const e of entities){
    if(data[e]!==undefined&&!Array.isArray(data[e]))fail('Invalid legacy '+e+' collection.');
    const index=new Map();for(const row of data[e]||[]){if(!row||typeof row.id!=='string'||!row.id||index.has(row.id))fail('Missing or duplicate legacy '+e+' identity.');index.set(row.id,row);}indexes.set(e,index);
   }
  }else{
   const {DatabaseSync}=require('node:sqlite');db=new DatabaseSync(descriptor.file,{readOnly:true,timeout:5000});db.exec('PRAGMA query_only=ON');
   if(db.prepare('PRAGMA application_id').get().application_id!==0x5346544d||db.prepare('PRAGMA user_version').get().user_version!==1)fail('Not a supported Timing SQLite database.');
   const format=db.prepare("SELECT value FROM info WHERE key='workingFormat'").get()?.value;
   if(!['1','2','3','4','5','6'].includes(format))fail('Unsupported Timing working format. No schema upgrade was attempted.');
   dataVersion=db.prepare('PRAGMA data_version').get().data_version;db.exec('BEGIN');
   db.prepare('SELECT COUNT(*) FROM records').get(); // Pin the snapshot before enumeration.
  }
 }catch(e){db?.close();throw e;}
 function get(entity,id,{media=true}={}){
  assertOpen();if(!entities.has(entity)&&entity!=='@meta')fail('Unsupported legacy entity.');
  if(!db){const row=entity==='@meta'?data[id]:indexes.get(entity).get(id);return row===undefined?null:structuredClone(row);}
  const record=db.prepare('SELECT shape FROM records WHERE entity=? AND id=?').get(entity,id);if(!record)return null;
  const fields=new Map(db.prepare('SELECT path,json FROM fields WHERE entity=? AND id=?').all(entity,id).map(f=>[f.path,f.json])),used=new Set();
  function build(s){if(!Array.isArray(s))fail('Invalid record shape.');if(s[0]==='field'){if(!fields.has(s[1])||used.has(s[1]))fail('Missing or repeated legacy field.');used.add(s[1]);return JSON.parse(fields.get(s[1]));}if(s[0]!=='object'||!Array.isArray(s[1]))fail('Invalid legacy object shape.');return Object.fromEntries(s[1].map(([k,v])=>[k,build(v)]));}
  let value=build(JSON.parse(record.shape));if(used.size!==fields.size)fail('Unexpected legacy fields.');
  if(media)for(const a of db.prepare('SELECT path,mime,bytes,digest,original FROM assets WHERE entity=? AND id=?').iterate(entity,id)){
   if(digest(a.bytes)!==a.digest)fail('Legacy media checksum mismatch.');
   const uri=a.original??`data:${a.mime};base64,${Buffer.from(a.bytes).toString('base64')}`,parts=JSON.parse(a.path);
   if(!parts.length)value=uri;else{let target=value;for(const key of parts.slice(0,-1)){if(!Object.hasOwn(target,key))fail('Missing media parent.');target=target[key];}Object.defineProperty(target,parts.at(-1),{value:uri,enumerable:true,writable:true,configurable:true});}
  }
  return value;
 }
 const savedSource=get('@meta','paddock',{media:false})?.sourceId;
 if(sourceId&&savedSource&&sourceId!==savedSource){db?.close();fail('Source identity conflicts with the saved Timing installation.');}
 const identity=savedSource||sourceId||null;
 function page(entity,{after=-1,limit=100,sessionId}={}){
  assertOpen();if(!entities.has(entity)||!Number.isSafeInteger(after)||after< -1||!Number.isInteger(limit)||limit<1||limit>200)fail('Invalid legacy page.');
  let refs;
  if(db)refs=sessionId!==undefined?db.prepare("SELECT r.id,r.ordinal FROM lap_index l JOIN records r ON r.entity='laps' AND r.id=l.id WHERE l.sessionId=? AND r.ordinal>? ORDER BY r.ordinal LIMIT ?").all(sessionId,after,limit+1):db.prepare('SELECT id,ordinal FROM records WHERE entity=? AND ordinal>? ORDER BY ordinal LIMIT ?').all(entity,after,limit+1);
  else {refs=[];const list=data[entity]||[];for(let ordinal=after+1;ordinal<list.length&&refs.length<=limit;ordinal++){const v=list[ordinal];if(sessionId===undefined||v?.sessionId===sessionId)refs.push({id:v?.id,ordinal});}}
  const rows=[];let bytes=0;
  for(const ref of refs.slice(0,limit)){if(typeof ref.id!=='string'||!ref.id)fail('Record has no stable source identity.');const value=get(entity,ref.id),size=Buffer.byteLength(JSON.stringify(value));if(rows.length&&bytes+size>8*1024*1024)break;rows.push({...ref,value,sha256:hash(value)});bytes+=size;}
  return {rows,next:refs.length>rows.length?rows.at(-1)?.ordinal??after:null};
 }
 function counts(){assertOpen();return Object.fromEntries([...entities].map(e=>[e,db?db.prepare('SELECT COUNT(*) n FROM records WHERE entity=?').get(e).n:(data[e]||[]).length]));}
 function finish(){assertOpen();finished=true;let unchanged;
  if(db){db.exec('COMMIT');unchanged=db.prepare('PRAGMA data_version').get().data_version===dataVersion;}
  else unchanged=fileHash(descriptor.file)===sourceHash;
  const current=describe(descriptor.profile);unchanged=unchanged&&!!current&&current.backend===descriptor.backend&&current.file===descriptor.file&&current.selectionHash===descriptor.selectionHash;
  return {unchanged,sourceId:identity,originKey:descriptor.originKey};
 }
 function close(){if(closed)return;if(db){if(!finished)try{db.exec('ROLLBACK');}catch{}db.close();}closed=true;data=null;indexes.clear();}
 return {descriptor,sourceId:identity,counts,page,get,sessionLaps:(id,o={})=>page('laps',{...o,sessionId:id}),finish,close};
}
module.exports={VERSION,discover,describe,open,hash};
