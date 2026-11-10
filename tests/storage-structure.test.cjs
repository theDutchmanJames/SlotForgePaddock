'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{Store}=require('../src/store.cjs'),S=require('../src/sqlite-storage.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-structure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'db.sqlite'));const carId=store.mutate('car.save',{data:{name:'Retained car'}}).result;return {store,carId};}
const tables=['state','records','assets','asset_refs','undo_records','undo_assets','record_fields','field_versions','change_log','change_assets','command_receipts'];
for(const table of tables)test('missing authoritative '+table+' fails before opening or recreating storage',async t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);db.exec('PRAGMA foreign_keys=OFF; DROP TABLE '+table);db.close();const before=fs.readFileSync(store.file);
 await assert.rejects(Store.open(store.file),e=>e.code==='STORAGE_STRUCTURE_INVALID'&&e.message.includes(table)&&e.message.includes('backup'));
 assert.deepEqual(fs.readFileSync(store.file),before);
 const check=new DatabaseSync(store.file);assert.equal(check.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table),undefined);check.close();
});
for(const [table,column]of [['assets','meta_digest'],['records','identity'],['command_receipts','fingerprint']])test('missing '+table+'.'+column+' is rejected without reading collection bodies',async t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);db.exec('ALTER TABLE '+table+' RENAME COLUMN '+column+' TO missing_column');db.close();const before=fs.readFileSync(store.file);
 await assert.rejects(Store.open(store.file),e=>e.code==='STORAGE_STRUCTURE_INVALID'&&e.message.includes(table+'.'+column));assert.deepEqual(fs.readFileSync(store.file),before);
});
test('old unmarked receipt storage upgrades without changing records, receipt fingerprints or generation',async t=>{
 const {store,carId}=fixture(t),payload={carId,title:'Only once',type:'maintenance'},options={commandId:'old-command',snapshot:false};await store.mutateAsync('work.add',payload,options);
 const db=new DatabaseSync(store.file);db.exec("DELETE FROM state WHERE key='command_receipts_version'");const before=db.prepare('SELECT * FROM command_receipts').all(),epoch=S.syncState(store.file).epoch;db.close();const opened=await Store.open(store.file);
 assert.equal((await opened.mutateAsync('work.add',payload,options)).duplicate,true);assert.equal(S.syncState(store.file).epoch,epoch);
 const check=new DatabaseSync(store.file);assert.deepEqual(check.prepare('SELECT * FROM command_receipts').all(),before);assert.equal(check.prepare("SELECT value FROM state WHERE key='command_receipts_version'").get().value,'1');check.close();
});
test('legacy database with no receipt feature initializes atomically, including failed upgrade and retry',async t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);db.exec("DELETE FROM state WHERE key='command_receipts_version'; DROP TABLE command_receipts; CREATE TRIGGER refuse_receipts BEFORE INSERT ON state WHEN NEW.key='command_receipts_version' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");const before=db.prepare('SELECT * FROM records').all();db.close();
 await assert.rejects(Store.open(store.file),/injected failure/);const check=new DatabaseSync(store.file);assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='command_receipts'").get(),undefined);assert.equal(check.prepare("SELECT 1 FROM state WHERE key='command_receipts_version'").get(),undefined);assert.deepEqual(check.prepare('SELECT * FROM records').all(),before);check.exec('DROP TRIGGER refuse_receipts');check.close();assert.ok((await Store.open(store.file)).deferredState);
});
test('lost receipts after opening cannot turn a retry into a second saved event',async t=>{
 const {store,carId}=fixture(t),payload={carId,title:'Never twice',type:'maintenance'},options={commandId:'guarded-retry',snapshot:false};await store.mutateAsync('work.add',payload,options);const db=new DatabaseSync(store.file);db.exec('DROP TABLE command_receipts');const before=db.prepare('SELECT * FROM records').all();db.close();
 await assert.rejects(store.mutateAsync('work.add',payload,options),e=>e.code==='STORAGE_STRUCTURE_INVALID'&&!e.definiteRejection);const check=new DatabaseSync(store.file);assert.deepEqual(check.prepare('SELECT * FROM records').all(),before);assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='command_receipts'").get(),undefined);check.close();
});

test('an unsupported receipt version is refused without modifying the collection',async t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);db.exec("UPDATE state SET value='2' WHERE key='command_receipts_version'");db.close();const before=fs.readFileSync(store.file);await assert.rejects(Store.open(store.file),e=>e.code==='STORAGE_STRUCTURE_INVALID');assert.deepEqual(fs.readFileSync(store.file),before);
});
test('a view cannot substitute for the authoritative receipt table',async t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);db.exec('ALTER TABLE command_receipts RENAME TO hidden_receipts; CREATE VIEW command_receipts AS SELECT * FROM hidden_receipts');db.close();const before=fs.readFileSync(store.file);await assert.rejects(Store.open(store.file),e=>e.code==='STORAGE_STRUCTURE_INVALID');assert.deepEqual(fs.readFileSync(store.file),before);
});
