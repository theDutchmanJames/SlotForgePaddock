'use strict';
// Inspect schema metadata only. Authoritative tables are never reconstructed
// from empty defaults; disposable query indexes have their own repair path.
const marker='command_receipts_version';
const common={state:['key','value'],records:['key','bucket','identity','json'],assets:['hash','value'],asset_refs:['record','hash'],undo_records:['key','bucket','identity','json'],undo_assets:['hash']};
const fields={record_fields:['record','path','json'],field_versions:['record','path','revision'],change_log:['sequence','epoch','from_identity','to_identity','json','bytes'],change_assets:['sequence','hash']};
const receiptColumns=['id','epoch','fingerprint','result'];
const fault=detail=>Object.assign(Error('Required database storage is missing or incompatible: '+detail+'. Keep this file and restore a verified backup. No replacement data has been created.'),{code:'STORAGE_STRUCTURE_INVALID'});
function table(db,name,columns){
 if(db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)?.type!=='table')throw fault(name);
 const found=new Set(db.prepare('PRAGMA table_info('+name+')').all().map(row=>row.name));
 for(const column of columns)if(!found.has(column))throw fault(name+'.'+column);
}
function receipts(db){
 table(db,'state',common.state);
 const version=db.prepare('SELECT value FROM state WHERE key=?').get(marker)?.value;
 if(version!==undefined&&version!=='1')throw fault('unsupported save-receipt version');
 const exists=!!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get('command_receipts');
 if(version!==undefined||exists)table(db,'command_receipts',receiptColumns);
 return {exists,initialized:version==='1'};
}
function check(db,version){
 for(const [name,columns]of Object.entries(common))table(db,name,columns);
 if(version>=2)for(const [name,columns]of Object.entries(fields))table(db,name,columns);
 if(version>=3)table(db,'assets',['meta','meta_digest']);
 return receipts(db);
}
// Call inside the caller's transaction. Unmarked older collections may have
// no receipts yet; once initialized, losing this table must never erase history.
function initializeReceipts(db){
 const state=receipts(db);
 if(!state.exists)db.exec('CREATE TABLE command_receipts(id TEXT PRIMARY KEY,epoch TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL) STRICT;');
 if(!state.initialized)db.prepare('INSERT INTO state(key,value) VALUES(?,?)').run(marker,'1');
}
module.exports={check,receipts,initializeReceipts};
