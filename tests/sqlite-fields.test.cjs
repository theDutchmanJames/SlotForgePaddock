const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),storage=require('../src/sqlite-storage.cjs'),records=require('../src/sqlite-records.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-fields-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.json'));s.mutate('car.save',{data:{name:'Original',maker:'NSR',picture:'data:image/png;base64,AAAA'}});s.mutate('car.save',{id:s.data.cars[0].id,revision:1,data:{livery:'Before'}});return s;}
function legacy(s){const packed=storage.pack(s.data),db=new DatabaseSync(s.file);db.exec('BEGIN; DROP TABLE record_fields; DROP TABLE field_versions; DROP TABLE change_assets; DROP TABLE change_log; DELETE FROM state WHERE key IN (\'change_epoch\',\'change_sequence\',\'field_floor\'); PRAGMA user_version=1;');for(const row of packed.records)db.prepare('UPDATE records SET json=? WHERE key=?').run(row.json,row.key);db.exec('COMMIT');db.close();}
function cursor(s){const result=storage.changesSince(s.file);return {epoch:result.epoch,after:result.latest};}
test('field shapes preserve scalar types, arrays, ordering and unusual property names',()=>{
 const input=JSON.stringify({value:JSON.parse('{"x":null,"a":[1,"text"],"technical":{"__proto__":"own","motor":"\\ud800"},"empty":{},"flag":true}'),refs:[]});
 const split=records.split(input);assert.equal(records.merge(split.header,split.fields),input);assert.equal({}.polluted,undefined);
 assert.throws(()=>records.merge(split.header,split.fields.slice(1)),/integrity/);assert.throws(()=>records.merge(split.header,[...split.fields,['["extra"]','2']]),/integrity/);
});
test('format 1 migration preserves current and previous data and retains a readable original SQLite backup',t=>{
 const s=fixture(t),before=s.snapshot(),previous=s.previousSnapshot();legacy(s);const original=fs.readFileSync(s.file),reopened=new Store(s.file);
 assert.deepEqual(reopened.data,before);assert.deepEqual(reopened.previousSnapshot(),previous);assert.ok(reopened.storageRecoveryFile);assert.deepEqual(storage.read(reopened.storageRecoveryFile),before);assert.deepEqual(storage.read(reopened.storageRecoveryFile,true),previous);
 const backup=new DatabaseSync(reopened.storageRecoveryFile);assert.equal(backup.prepare('PRAGMA user_version').get().user_version,1);backup.close();assert.ok(original.length>0);
 assert.equal(new Store(s.file).storageRecoveryFile,null);
 assert.ok(new Store(s.file).protectedFiles().includes(reopened.storageRecoveryFile));
});
test('failed field migration rolls back the entire layout and leaves the format 1 database usable',t=>{
 const s=fixture(t),before=s.snapshot();legacy(s);let db=new DatabaseSync(s.file);db.exec("CREATE TRIGGER fail_upgrade BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'migration failed'); END");db.close();
 assert.throws(()=>new Store(s.file),/migration failed/);assert.deepEqual(storage.read(s.file),before);db=new DatabaseSync(s.file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='record_fields'").get().n,0);db.exec('DROP TRIGGER fail_upgrade');db.close();assert.deepEqual(new Store(s.file).data,before);
});
test('one-field edits do not update neighbouring fields and the durable journal excludes them',t=>{
 const s=fixture(t),mark=cursor(s);let db=new DatabaseSync(s.file);
 db.exec(`CREATE TRIGGER protect_maker BEFORE UPDATE ON record_fields WHEN OLD.path='["maker"]' BEGIN SELECT RAISE(ABORT,'Unchanged maker written'); END`);db.close();
 s.mutate('car.save',{id:s.data.cars[0].id,revision:2,data:{livery:'After'}});
 const feed=storage.changesSince(s.file,mark),change=feed.entries[0].changes.find(x=>JSON.parse(x.key)[0]==='cars');assert.ok(change.fields.some(f=>f.path==='["livery"]'));assert.equal(change.fields.some(f=>f.path==='["maker"]'),false);assert.equal(JSON.stringify(feed).includes('data:image/'),false);assert.equal(feed.entries.length,1);
 assert.equal(new Store(s.file).data.cars[0].livery,'After');assert.equal(s.previousSnapshot().cars[0].livery,'Before');
});
test('field and log failures roll back values, previous revision and journal position together',t=>{
 const s=fixture(t);for(const table of ['record_fields','field_versions','change_log']){const before=s.snapshot(),previous=s.previousSnapshot(),mark=cursor(s);let db=new DatabaseSync(s.file);db.exec(`CREATE TRIGGER fail_commit BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END`);db.close();
  assert.throws(()=>s.mutate('car.save',{id:s.data.cars[0].id,revision:2,data:{livery:'Not saved'}}),/injected/);assert.deepEqual(new Store(s.file).data,before);assert.deepEqual(s.previousSnapshot(),previous);assert.deepEqual(cursor(s),mark);db=new DatabaseSync(s.file);db.exec('DROP TRIGGER fail_commit');db.close();}
});
test('field corruption fails rather than returning incorrect car data',t=>{
 const s=fixture(t),db=new DatabaseSync(s.file);db.prepare('UPDATE record_fields SET json=? WHERE path=?').run('"Corrupted"','["name"]');db.close();assert.throws(()=>new Store(s.file),/field integrity/);
});
test('durable changes survive restart, paginate complete transactions, expire and detect database replacement',t=>{
 const s=fixture(t),mark=cursor(s);for(let i=0;i<3;i++)s.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{livery:'Change '+i}});
 const reopened=new Store(s.file),first=storage.changesSince(reopened.file,{...mark,limit:1});assert.equal(first.entries.length,1);assert.equal(first.more,true);assert.equal(storage.changesSince(s.file,{epoch:first.epoch,after:first.next}).entries.length,2);
 assert.equal(storage.changesSince(s.file,{...mark,maxBytes:1}).reason,'transaction-size');
 const db=new DatabaseSync(s.file);db.prepare('DELETE FROM change_log WHERE sequence<=?').run(first.next);db.close();assert.equal(storage.changesSince(s.file,mark).reason,'expired');
 s.replace(new Store().snapshot());assert.equal(storage.changesSince(s.file,mark).reason,'epoch');
});
test('manifest journal records a small insertion instead of all prior history IDs',()=>{
 const delta=require('../src/sqlite-delta.cjs').delta,before={object:[['events',{array:Array.from({length:1000},(_,i)=>({record:'event-'+i}))}]]},after=require('../src/json-data.cjs').cloneJSON(before);after.object[0][1].array.unshift({record:'new-event'});
 const changes=delta(before,after);assert.equal(changes.length,1);assert.deepEqual(changes[0].splice,{start:0,remove:0,items:[{record:'new-event'}]});assert.ok(JSON.stringify(changes).length<200);
});
test('targeted worker submissions remain bounded when unrelated cars and histories grow',async t=>{
 const s=fixture(t),first=s.snapshot().cars[0];s.transact(db=>{for(let i=0;i<100;i++)db.cars.push({...require('../src/json-data.cjs').cloneJSON(first),id:'extra-'+i});});
 await s.mutateAsync('car.save',{id:first.id,revision:first.revision,data:{livery:'Small packet'}});assert.equal(s.lastWrite.submittedRecords,6);assert.equal(s.lastWrite.assetWrites,0);assert.deepEqual(new Store(s.file).data,s.data);
});
test('retention bounds journal-only media and expires cursors instead of leaving missing attachments',t=>{
 const s=fixture(t);s.transact(db=>{for(let i=0;i<6;i++)db.cars.push({...require('../src/json-data.cjs').cloneJSON(db.cars[0]),id:'large-'+i,picture:'data:image/png;base64,'+'A'.repeat(6*1024*1024-4)+String.fromCharCode(66+i).repeat(4)});});
 const mark=cursor(s);s.transact(db=>{for(const c of db.cars)c.picture='';});s.mutate('settings.save',{name:'Age the recovery revision'});
 const db=new DatabaseSync(s.file),extra=db.prepare('SELECT coalesce(sum(length(value)),0) bytes FROM assets WHERE hash IN (SELECT hash FROM change_assets) AND hash NOT IN (SELECT hash FROM asset_refs) AND hash NOT IN (SELECT hash FROM undo_assets)').get().bytes;assert.ok(extra<=32*1024*1024);db.close();assert.equal(storage.changesSince(s.file,{epoch:mark.epoch,after:0}).snapshotRequired,true);assert.deepEqual(new Store(s.file).data,s.data);
});
