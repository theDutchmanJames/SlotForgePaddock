'use strict';
const {DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto'),zlib=require('node:zlib');
const MAX_RESULT=200*1024*1024;
const fault=(code,message)=>Object.assign(Error(message),{code});
function ensure(db){require('./storage-structure.cjs').initializeReceipts(db);}
function check(command){
 if(!command||typeof command.id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(command.id)||typeof command.action!=='string'||!command.action||command.action.length>100)throw fault('INVALID_COMMAND','Invalid save identity or action.');
 if(typeof command.databaseId!=='string'||typeof command.epoch!=='string')throw fault('INVALID_COMMAND','A save must identify its database and generation.');
}
function receipt(command,result){check(command);let json=JSON.stringify(result??null);const size=Buffer.byteLength(json);if(size>MAX_RESULT)throw fault('COMMAND_RECEIPT_LIMIT','Save receipt exceeds the collection metadata working limit.');if(size>16384)json='z1:'+zlib.deflateRawSync(json).toString('base64');return {id:command.id,epoch:command.epoch,fingerprint:crypto.createHash('sha256').update(require('./timing-integration.cjs').canonical(command.action==='catalogue.picture'?{...command,payload:{intent:command.payload.intent}}:command)).digest('hex'),result:json};}
function find(db,wanted){
 if(!require('./storage-structure.cjs').receipts(db).exists)return null;
 const row=db.prepare('SELECT * FROM command_receipts WHERE id=?').get(wanted.id);if(!row)return null;
 if(row.epoch!==wanted.epoch||row.fingerprint!==wanted.fingerprint)throw fault('COMMAND_CONFLICT','This save identity was already used with different content.');
 const json=row.result.startsWith('z1:')?zlib.inflateRawSync(Buffer.from(row.result.slice(3),'base64'),{maxOutputLength:MAX_RESULT}).toString('utf8'):row.result;
 return {result:JSON.parse(json),duplicate:true};
}
function insert(db,value){
 ensure(db);
 if(find(db,value))return;
 const size=db.prepare('SELECT count(*) n,coalesce(sum(length(CAST(result AS BLOB))),0) bytes FROM command_receipts').get();
 if(size.n>=100000||size.bytes+Buffer.byteLength(value.result)>32*1024*1024)throw fault('COMMAND_RECEIPT_LIMIT','This database has reached its durable save-receipt limit.');
 db.prepare('INSERT INTO command_receipts VALUES(?,?,?,?)').run(value.id,value.epoch,value.fingerprint,value.result);
}
function lookupFile(file,command){if(command.action==='catalogue.picture'&&Object.hasOwn(command.payload||{},'picture'))require('./catalogue-picture-apply.cjs').validate(command.payload);const wanted=receipt(command,null),db=new DatabaseSync(file,{readOnly:true,timeout:5000});try{
 db.exec('BEGIN');const state=Object.fromEntries(db.prepare("SELECT key,value FROM state WHERE key IN ('identity','change_epoch')").all().map(r=>[r.key,r.value]));
 if(JSON.parse(state.identity)[0]!==command.databaseId||state.change_epoch!==command.epoch)throw fault('COMMAND_EPOCH_CHANGED','The collection was replaced. Review the current data before saving again.');
 return find(db,wanted);
 }finally{db.close();}}
function execute(store,command,prepare=(s,c)=>require('./scoped-write.cjs').command(s,c.action,c.payload)){
 const existing=lookupFile(store.file,command);if(existing)return existing;
 const prepared=prepare(store,command),saved=receipt(command,prepared.result);
 if(prepared.noop){const db=new DatabaseSync(store.file,{timeout:5000});try{db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');const release=require('./car-merge-fence.cjs').begin(db);if(db.prepare("SELECT value FROM state WHERE key='identity'").get().value!==store.expectedIdentity||db.prepare("SELECT value FROM state WHERE key='change_epoch'").get().value!==command.epoch)throw fault('QUERY_CHANGED','The database changed before saving.');insert(db,saved);release();db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}}
 else{prepared.scope.receipt=saved;require('./transaction.cjs').run(store,()=>prepared,{scoped:true});}
 return {result:prepared.result??null,duplicate:false};
}
function decodeResult(value){return JSON.parse(value.startsWith('z1:')?zlib.inflateRawSync(Buffer.from(value.slice(3),'base64'),{maxOutputLength:MAX_RESULT}).toString('utf8'):value);}
module.exports={decodeResult,ensure,insert,find,receipt,lookupFile,execute};
