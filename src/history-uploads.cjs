'use strict';
// Disposable transport staging, separate from the authoritative library. All
// calls run under its domain-worker lock. Accepted content/receipts ONLY live
// in the ordinary guarded history or historical Review transaction, never here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const T=require('./timing-integration.cjs'),S=require('./shared-history-schema.cjs'),H=require('./shared-history.cjs');
const CHUNK=262144,MAX=T.MAX_BYTES,TTL=86400000,APP_ID=1397118032;
const fail=(code,message,status=400)=>{throw T.fault(code,message,status);};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function space(store,bytes){try{require('./storage-resources.cjs').requireSpace(path.dirname(store.file),bytes);}catch{fail('CAPACITY_EXCEEDED','Not enough disk space to stage this upload safely.',507);}}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}}
function open(store){
 const file=store.file+'.history-staging.sqlite';
 try{const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);}catch(e){if(e.code!=='EEXIST')throw e;}
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Invalid history staging file.');
 const db=new DatabaseSync(file,{timeout:5000});
 try{db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;');
  const app=db.prepare('PRAGMA application_id').get().application_id,version=db.prepare('PRAGMA user_version').get().user_version;
  if(app!==APP_ID){if(app!==0||version!==0||db.prepare("SELECT count(*) n FROM sqlite_master").get().n)throw Error('Unexpected history staging database.');
   transaction(db,()=>db.exec(`CREATE TABLE uploads(id TEXT PRIMARY KEY, database_id TEXT NOT NULL, epoch TEXT NOT NULL, manifest TEXT NOT NULL, created INTEGER NOT NULL, state TEXT NOT NULL, command TEXT) STRICT;
CREATE TABLE chunks(upload TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE, position INTEGER NOT NULL, hash TEXT NOT NULL, bytes BLOB, PRIMARY KEY(upload,position)) STRICT;
PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`));
  }else if(version!==1)throw Error('Unsupported history staging version.');
  const pageSize=db.prepare('PRAGMA page_size').get().page_size;db.exec('PRAGMA max_page_count='+Math.floor(256*1024*1024/pageSize));return db;
 }catch(e){db.close();throw e;}
}
function current(store,input){const state=H.status(store);if(input.databaseId!==state.databaseId)fail('DATABASE_MISMATCH','This upload belongs to another library.',409);if(input.recoveryId!==state.recoveryId)fail('RECOVERY_CHANGED','This library was restored or replaced. Reconcile the original operation before uploading again.',409);return state;}
function find(db,id){const row=db.prepare('SELECT * FROM uploads WHERE id=?').get(id);if(!row)fail('UPLOAD_NOT_FOUND','No staging upload with this identity.',404);row.input=JSON.parse(row.manifest);return row;}
function reconcile(store,db,row){
 if(!row.command)return null;const command=JSON.parse(row.command);let receipt;
 try{receipt=row.input.kind==='import'?require('./history-imports.cjs').lookup(store,command.installationId,command.operationId,{databaseId:row.database_id,recoveryId:row.epoch}):H.lookup(store,command.installationId,command.operationId,row.epoch);}catch(e){if(e.apiCode==='OPERATION_NOT_FOUND')return null;throw e;}
 if(receipt.requestHash!==command.requestHash)return null;
 if(row.state!=='committed')transaction(db,()=>{db.prepare("UPDATE uploads SET state='committed' WHERE id=?").run(row.id);db.prepare('UPDATE chunks SET bytes=NULL WHERE upload=?').run(row.id);});row.state='committed';return receipt;
}
function live(row){if(row.state==='cancelled')fail('UPLOAD_CANCELLED','This upload was cancelled. Use a new upload ID for deliberate new work.',410);if(row.state==='expired'||Date.now()>=row.created+TTL)fail('UPLOAD_EXPIRED','This upload expired. Retain the original operation for reconciliation.',410);}
function result(db,row,receipt=null){return {version:1,databaseId:row.database_id,recoveryId:row.epoch,uploadId:row.id,state:row.state==='committing'?'staging':row.state,byteLength:row.input.byteLength,sha256:row.input.sha256,chunkBytes:CHUNK,received:row.state==='committed'?Array.from({length:Math.ceil(row.input.byteLength/CHUNK)},(_,i)=>i):db.prepare('SELECT position FROM chunks WHERE upload=? ORDER BY position').all(row.id).map(r=>r.position),expiresAt:new Date(row.created+TTL).toISOString(),receipt};}
function clean(store,db,state){
 transaction(db,()=>db.prepare('DELETE FROM uploads WHERE database_id<>? OR epoch<>?').run(state.databaseId,state.recoveryId));
 for(const value of db.prepare("SELECT id FROM uploads WHERE state IN ('staging','committing') AND created<=?").all(Date.now()-TTL)){
  const row=find(db,value.id);if(reconcile(store,db,row))continue;
  transaction(db,()=>{db.prepare("UPDATE uploads SET state='expired' WHERE id=?").run(row.id);db.prepare('DELETE FROM chunks WHERE upload=?').run(row.id);});
 }
}
function run(store,task){
 let input;if(task.bytes){try{input=require('./strict-json.cjs').parse(task.bytes);}catch{fail('INVALID_PAYLOAD','Send unambiguous UTF-8 JSON with unique keys.');}}else input=task.input;
 const definition={start:S.uploads.uploadStart,chunk:S.uploads.chunk,commit:S.uploads.uploadCommit,status:S.uploads.uploadLookup,cancel:S.uploads.uploadLookup}[task.action];if(!definition)fail('NOT_FOUND','Unknown upload action.',404);S.validate(input,definition);
 if(task.uploadId&&input.uploadId!==task.uploadId||task.index!==undefined&&input.index!==task.index)fail('INVALID_PAYLOAD','Upload route and body identities must agree.');
 const state=current(store,input),db=open(store);try{
  clean(store,db,state);
  if(task.action==='start'){
   const json=T.canonical(input),old=db.prepare('SELECT id FROM uploads WHERE id=?').get(input.uploadId);
   if(old){const row=find(db,input.uploadId);if(row.manifest!==json)fail('UPLOAD_CONFLICT','This upload ID already identifies different bytes or attribution.',409);const receipt=reconcile(store,db,row);if(!receipt)live(row);return result(db,row,receipt);}
   const count=db.prepare("SELECT count(*) total,sum(state IN ('staging','committing')) unfinished FROM uploads").get();if(count.total>=10000||count.unfinished>=4)fail('CAPACITY_EXCEEDED','Upload staging is full (four unfinished uploads or 10,000 identities).',507);
   space(store,input.byteLength*2);
   transaction(db,()=>db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,'staging',NULL)").run(input.uploadId,state.databaseId,state.recoveryId,json,Date.now()));return result(db,find(db,input.uploadId));
  }
  const row=find(db,input.uploadId),receipt=reconcile(store,db,row);
  if(task.action==='cancel'){
   if(receipt||row.state==='committed')fail('UPLOAD_COMMITTED',row.input.kind==='import'?'This batch has entered Review. Cancel pending items through the historical import endpoint.':'Accepted history cannot be deleted through upload cancellation.',409);
   transaction(db,()=>{db.prepare("UPDATE uploads SET state='cancelled',command=NULL WHERE id=?").run(row.id);db.prepare('DELETE FROM chunks WHERE upload=?').run(row.id);});return {version:1,databaseId:state.databaseId,recoveryId:state.recoveryId,uploadId:row.id,cancelled:true};
  }
  if(task.action==='commit'&&input.sha256!==row.input.sha256)fail('HASH_MISMATCH','Commit hash does not match the manifest.',409);
  if(task.action==='status'||task.action==='commit'){if(receipt)return result(db,row,receipt);if(row.state==='committed')fail('STORAGE_FAILED','Accepted upload receipt is unavailable; reconcile the original operation.',503);}
  if(!receipt)live(row);
  if(task.action==='status')return result(db,row);
  if(task.action==='chunk'){
   const bytes=Buffer.from(input.data,'base64');if(bytes.toString('base64')!==input.data)fail('INVALID_PAYLOAD','Chunk data must be canonical base64.');
   const total=Math.ceil(row.input.byteLength/CHUNK),size=input.index===total-1?row.input.byteLength-input.index*CHUNK:CHUNK;
   if(input.index>=total||bytes.length!==size)fail('INVALID_PAYLOAD','Chunk index or decoded length does not match the manifest.');if(hash(bytes)!==input.sha256)fail('HASH_MISMATCH','Chunk checksum does not match its bytes.',409);
   // Small checksums remain for idempotent chunk retries after acceptance.
   const old=db.prepare('SELECT hash,bytes FROM chunks WHERE upload=? AND position=?').get(row.id,input.index);if(old){if(old.hash!==input.sha256||old.bytes!==null&&!Buffer.from(old.bytes).equals(bytes))fail('CHUNK_CONFLICT','This chunk index already contains different bytes.',409);return result(db,row,receipt);}
   if(row.state==='committed')fail('UPLOAD_COMMITTED','Upload is accepted; reconcile its durable receipt instead of adding chunks.',409);
   space(store,bytes.length*2);
   transaction(db,()=>db.prepare('INSERT INTO chunks VALUES(?,?,?,?)').run(row.id,input.index,input.sha256,bytes));return result(db,row);
  }
  const rows=db.prepare('SELECT position,hash,bytes FROM chunks WHERE upload=? ORDER BY position').all(row.id),total=Math.ceil(row.input.byteLength/CHUNK);
  if(rows.length!==total||rows.some((r,i)=>r.position!==i))fail('UPLOAD_INCOMPLETE','Upload every chunk before committing.',409);
  const chunks=rows.map(r=>{const bytes=Buffer.from(r.bytes);if(hash(bytes)!==r.hash)fail('HASH_MISMATCH','Staged chunk checksum failed.',409);return bytes;}),bytes=Buffer.concat(chunks);
  if(bytes.length!==row.input.byteLength||hash(bytes)!==row.input.sha256)fail('HASH_MISMATCH','Complete upload checksum failed.',409);
  let operation;try{operation=require('./strict-json.cjs').parse(bytes);}catch{fail('INVALID_PAYLOAD','Staged operation is not valid unambiguous UTF-8 JSON.');}
  const historical=row.input.kind==='import';
  if(historical)require('./history-imports.cjs').validateRequest(operation);else H.validateOperation(operation);
  if(operation.databaseId!==row.database_id||operation.recoveryId!==row.epoch||T.canonical(operation.editor)!==T.canonical(row.input.editor))fail('INVALID_PAYLOAD','Staged request identity or editor differs from the upload manifest.');
  const command=JSON.stringify({installationId:operation.editor.installationId,operationId:operation.operationId,requestHash:T.digest(operation)});
  transaction(db,()=>db.prepare("UPDATE uploads SET state='committing',command=? WHERE id=?").run(command,row.id));
  const accepted=historical?require('./history-imports.cjs').receive(store,operation):H.receive(store,operation);
  // A crash here is reconciled from the authoritative receipt on GET/retry.
  try{transaction(db,()=>{db.prepare("UPDATE uploads SET state='committed' WHERE id=?").run(row.id);db.prepare('UPDATE chunks SET bytes=NULL WHERE upload=?').run(row.id);});}catch(e){e.code='WRITE_UNCERTAIN';throw e;}
  row.state='committed';return result(db,row,accepted);
 }finally{db.close();}
}
module.exports={run,CHUNK,MAX,TTL,hash};
