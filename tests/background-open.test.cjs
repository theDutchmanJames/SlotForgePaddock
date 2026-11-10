'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite'),{Worker}=require('node:worker_threads');
const {Store}=require('../src/store.cjs'),storage=require('../src/sqlite-storage.cjs'),{CollectionOpener}=require('../src/collection-open.cjs'),Q=require('../src/sqlite-query.cjs');
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-open-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const f=require('./support/timing-fixtures.cjs').fixtures(),store=new Store(path.join(folder,'database.sqlite'));store.replace(f.store.snapshot());require('../src/timing-integration.cjs').receive(store,f.multi);return {folder,store};}
function sql(file,fn){const db=new DatabaseSync(file);try{return fn(db);}finally{db.close();}}
function version(file){return sql(file,db=>db.prepare("SELECT value FROM state WHERE key='query_index_version'").get().value);}
function authoritative(file){return sql(file,db=>({records:db.prepare('SELECT * FROM records ORDER BY key').all(),fields:db.prepare('SELECT * FROM record_fields ORDER BY record,path').all(),versions:db.prepare('SELECT * FROM field_versions ORDER BY record,path').all(),journal:db.prepare('SELECT * FROM change_log ORDER BY sequence').all(),receipts:db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%receipt%'").all(),state:db.prepare("SELECT * FROM state WHERE key NOT LIKE 'query_%' ORDER BY key").all()}));}
test('v7 index upgrade runs off-thread, preserves source/cursors and stays deferred',async t=>{
 const {store}=fixture(t),before=authoritative(store.file),overview=require('../src/view-query.cjs').view(store,{page:'Overview'});
 sql(store.file,db=>db.exec("UPDATE state SET value='7' WHERE key='query_index_version'; DROP TABLE query_performance; CREATE TRIGGER forbid_lap BEFORE INSERT ON query_laps BEGIN SELECT RAISE(ABORT,'Rebuilt laps'); END; CREATE TRIGGER forbid_record BEFORE INSERT ON query_records BEGIN SELECT RAISE(ABORT,'Rebuilt records'); END;"));
 const upgrade=t.mock.method(storage,'upgrade',()=>{throw Error('Upgrade ran on caller thread');}),read=t.mock.method(storage,'read',()=>{throw Error('Loaded whole model on caller thread');});
 let ticks=0;const heartbeat=setInterval(()=>ticks++,1);let opened;try{opened=await Store.open(store.file);}finally{clearInterval(heartbeat);upgrade.mock.restore();read.mock.restore();}
 assert.ok(ticks>0);assert.equal(version(store.file),'8');assert.deepEqual(authoritative(store.file),before);assert.ok(opened.deferredState);assert.equal(opened.deferredState.stats.loadedSections.includes('timing'),false);assert.deepEqual(require('../src/view-query.cjs').view(opened,{page:'Overview'}),overview);
 sql(store.file,db=>db.exec('DROP TRIGGER forbid_lap; DROP TRIGGER forbid_record'));await opened.mutateAsync('car.save',{id:'car-a',revision:opened.data.cars[0].revision,data:{name:'After upgrade'}},{snapshot:false});assert.equal(new Store(store.file).data.cars[0].name,'After upgrade');
});
test('stale indexes rebuild in the worker and retain exact results and manual data',async t=>{
 const {store}=fixture(t),before=store.snapshot();sql(store.file,db=>db.exec("UPDATE state SET value='stale' WHERE key='query_index_identity'"));
 const read=t.mock.method(storage,'read',()=>{throw Error('Caller hydrated records');});const opened=await Store.open(store.file);read.mock.restore();assert.ok(opened.deferredState);assert.deepEqual(opened.snapshot(),before);
 const actual=Q.read(opened,null,r=>require('../src/query-timing.cjs').page(r,'car-a')).value;assert.deepEqual(actual.aggregate,require('../renderer/timing-results-model.js').aggregate(before.timing.sessions,'car-a'));
});
test('missing derived tables or maintenance triggers are repaired before publication',async t=>{
 const {store}=fixture(t);for(const damage of ['DROP TABLE query_performance','DROP TRIGGER query_totals_update','DROP TABLE query_laps']){
  sql(store.file,db=>db.exec(damage));const opened=await Store.open(store.file);assert.ok(opened.deferredState);assert.equal(sql(store.file,db=>require('../src/query-index.cjs').objectsReady(db)),true);assert.deepEqual(opened.snapshot(),store.snapshot());
 }
});
test('failed background upgrades roll back and can be retried after restart',async t=>{
 const {store}=fixture(t),before=authoritative(store.file);sql(store.file,db=>db.exec("UPDATE state SET value='7' WHERE key='query_index_version'; CREATE TRIGGER fail_upgrade BEFORE INSERT ON query_performance BEGIN SELECT RAISE(ABORT,'Injected upgrade failure'); END;"));
 await assert.rejects(Store.open(store.file),/Injected upgrade failure/);assert.equal(version(store.file),'7');assert.deepEqual(authoritative(store.file),before);
 sql(store.file,db=>db.exec('DROP TRIGGER fail_upgrade'));assert.ok((await Store.open(store.file)).deferredState);assert.equal(version(store.file),'8');
});
test('a changed collection between preparation and adoption is rejected',async t=>{
 const {store}=fixture(t),prepared=await require('../src/collection-open.cjs').prepare(store.file);store.mutate('settings.save',{name:'Changed elsewhere'});assert.throws(()=>new Store(store.file,{deferred:true,prepared}),e=>e.code==='QUERY_CHANGED');
 const current=await require('../src/collection-open.cjs').prepare(store.file);sql(store.file,db=>db.prepare("UPDATE state SET value='new-epoch' WHERE key='change_epoch'").run());assert.throws(()=>new Store(store.file,{deferred:true,prepared:current}),e=>e.code==='QUERY_CHANGED');
});
test('upgrade rejects a stale expected identity before writing indexes',t=>{
 const {store}=fixture(t),before=authoritative(store.file);sql(store.file,db=>db.exec("UPDATE state SET value='7' WHERE key='query_index_version'"));assert.throws(()=>storage.upgrade(store.file,'wrong'),/changed before index/);assert.equal(version(store.file),'7');assert.deepEqual(authoritative(store.file),before);
});
test('worker failure waits for exit, rolls back SQL and permits a fresh open',async t=>{
 const {store}=fixture(t);let worker,started;const ready=new Promise(resolve=>started=resolve),opener=new CollectionOpener({createWorker:file=>{
  worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const db=new(require('node:sqlite').DatabaseSync)(workerData);db.exec("BEGIN IMMEDIATE; UPDATE state SET value='interrupted' WHERE key='query_index_version'");parentPort.postMessage({value:{ready:true}});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);`,{eval:true,workerData:file});worker.once('message',started);return worker;
 }});const job=opener.prepare(store.file);await ready;await worker.terminate();await assert.rejects(job,/stopped/);await opener.whenIdle();assert.equal(opener.pending,false);assert.equal(version(store.file),'8');assert.ok((await Store.open(store.file)).deferredState);
});
test('preparation coalesces a file and timeout releases the worker before retry',async t=>{
 const {store}=fixture(t);let starts=0;const opener=new CollectionOpener({timeoutMs:50,createWorker:()=>{starts++;return new Worker("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)",{eval:true});}});
 const a=opener.prepare(store.file),b=opener.prepare(store.file);assert.equal(a,b);assert.equal(starts,1);await assert.rejects(a,/too long/);assert.equal(opener.pending,false);await opener.whenIdle();assert.ok((await Store.open(store.file)).deferredState);
});
test('Dealership saved copies prepare asynchronously before switching',async t=>{
 const {store,folder}=fixture(t),{Club}=require('../src/club.cjs'),{Network}=require('../src/network.cjs');const copy=new Store(path.join(folder,'club-copy.json'));copy.replace({...store.snapshot(),club:{id:'replica-club',replica:true,proposals:[]}});
 fs.writeFileSync(path.join(folder,'club-device.json'),JSON.stringify({version:1,id:'device-test',name:'Test laptop',pair:{databaseId:copy.data.id,clubId:'replica-club',password:'1234'},outbox:[]}));sql(copy.file,db=>db.exec("UPDATE state SET value='7' WHERE key='query_index_version'"));
 const network=new Network(store),club=new Club(store,network,folder);t.after(()=>{club.close();network.close();});assert.equal(club.loadedCache,null);assert.equal(club.status().hasCopy,true);assert.equal(club.loadedCache,null);
 const upgrade=t.mock.method(storage,'upgrade',()=>{throw Error('Replica upgraded on caller thread');});await club.switchAsync(true);upgrade.mock.restore();assert.equal(club.active,true);assert.ok(club.cache.deferredState);assert.equal(version(copy.file),'8');assert.equal(club.cache.data.id,copy.data.id);
});
