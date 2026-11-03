const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {Store,makePackage}=require('../src/store.cjs'),storage=require('../src/sqlite-storage.cjs'),M=require('../src/club-model.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-sqlite-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'database.json')};}
const photo='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
function rich(){
 const s=new Store(),id=s.mutate('car.save',{data:{name:'Collection car 😀',privateNotes:'Private',picture:photo,photos:[{id:'extra',name:'Extra',data:photo}],technical:{motor:'Original',pinion:'9',gear:'27'},realHistory:{team:'Team',classification:'Unverified'}}}).result;
 s.mutate('part.save',{data:{name:'Motor',category:'Motor',tracking:'quantity',quantity:3,picture:photo}});
 s.mutate('part.install',{carId:id,partId:s.data.parts[0].id,quantity:1,field:'motor',position:'Motor pod'});
 s.mutate('setup.save',{carId:id,name:'Baseline'});
 s.mutate('test.add',{carId:id,track:'Home',lane:'1',driver:'Owner',laps:'10',best:'5.2',average:'5.8'});
 s.mutate('work.add',{carId:id,type:'maintenance',title:'Cleaned',nextDue:'2027-01-01'});
 s.mutate('job.start',{revision:s.data.revision,kind:'general',carId:id,name:'Tune'});
 s.mutate('custom.add',{label:'Paint code',type:'text'});
 s.mutate('planning.shelf.save',{revision:s.data.revision,name:'Favourites',carIds:[id]});
 s.mutate('submission.add',{package:makePackage(s.data,[id],{photos:true,setups:true})});
 return s;
}
test('legacy collection migration preserves every field, JSON ordering and integration identity without touching source or old recovery copy',t=>{
 const {file}=fixture(t),original=rich().snapshot(),text=JSON.stringify(original);fs.writeFileSync(file,text);fs.writeFileSync(file+'.previous','original recovery bytes');
 const s=new Store(file);assert.equal(s.file,storage.sqlitePath(file));assert.equal(fs.readFileSync(s.file).subarray(0,16).toString(),'SQLite format 3\0');
 assert.equal(JSON.stringify(s.data),text);assert.equal(M.digest(s.data),M.digest(original));assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(fs.readFileSync(file+'.previous','utf8'),'original recovery bytes');
 s.mutate('settings.save',{name:'Updated'});assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(new Store(file).data.settings.name,'Updated');assert.deepEqual(s.previousSnapshot(),original);
});
test('invalid legacy data is never replaced or partially migrated',t=>{
 const {file,dir}=fixture(t);fs.writeFileSync(file,'{"schema":11,"cars":[]}');assert.throws(()=>new Store(file));assert.equal(fs.existsSync(storage.sqlitePath(file)),false);assert.deepEqual(fs.readdirSync(dir),['database.json']);
});
test('migration failure leaves JSON intact and removes its staging database',t=>{
 const {file,dir}=fixture(t),data=rich().snapshot();fs.writeFileSync(file,JSON.stringify(data));const write=storage.write;t.mock.method(storage,'write',(destination,...args)=>{write(destination,...args);throw Error('Interrupted migration');});
 assert.throws(()=>new Store(file),/Interrupted migration/);assert.deepEqual(JSON.parse(fs.readFileSync(file)),data);assert.equal(fs.existsSync(storage.sqlitePath(file)),false);assert.deepEqual(fs.readdirSync(dir),['database.json']);
});

test('migration never overwrites a SQLite database created while migration is running',t=>{
 const {file}=fixture(t),target=storage.sqlitePath(file),source=rich().snapshot(),winner=new Store().snapshot();fs.writeFileSync(file,JSON.stringify(source));const link=fs.linkSync;
 t.mock.method(fs,'linkSync',(from,to)=>{storage.write(target,storage.pack(winner),null);return link(from,to);});
 assert.throws(()=>new Store(file),/appeared during migration/);assert.deepEqual(storage.read(target),winner);assert.deepEqual(JSON.parse(fs.readFileSync(file)),source);
});

test('collection identity metadata must agree with its committed manifest',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const sql=new DatabaseSync(s.file);sql.prepare('UPDATE state SET value=? WHERE key=?').run('["other",0]','identity');sql.close();assert.throws(()=>new Store(file),/identity integrity/);
});
test('incremental writes do not rewrite unchanged cars, photos or historical setups',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const c=s.data.cars[0],before=s.snapshot();
 const sql=new DatabaseSync(s.file);const photos=sql.prepare('SELECT count(*) AS n FROM assets').get().n;sql.close();assert.equal(photos,1);
 s.mutate('car.save',{id:c.id,revision:c.revision,data:{livery:'New livery'}});assert.equal(s.lastWrite.assetWrites,0);assert.ok(s.lastWrite.recordWrites<=5,JSON.stringify(s.lastWrite));
 assert.deepEqual(new Store(s.file).data.setups,before.setups);assert.deepEqual(s.previousSnapshot(),before);
});
test('previous revision and retained change history protect photos until their references expire',t=>{
 const {file}=fixture(t),s=new Store(file),id=s.mutate('car.save',{data:{name:'Car',picture:photo}}).result;
 s.mutate('car.save',{id,revision:1,data:{picture:''}});assert.equal(s.previousSnapshot().cars[0].picture,photo);assert.equal(new Store(s.file).data.cars[0].picture,'');
 s.mutate('settings.save',{name:'Next'});let sql=new DatabaseSync(s.file);assert.equal(sql.prepare('SELECT count(*) AS n FROM assets').get().n,1);sql.exec('PRAGMA foreign_keys=ON; DELETE FROM change_log;');sql.close();
 s.mutate('settings.save',{name:'After log retention'});
 // Live lazy handles can pin the original until their owner is collected. A
 // restarted process has no such leases and reclaims this now-unreferenced blob.
 require('node:child_process').execFileSync(process.execPath,['-e',"const {Store}=require('./src/store.cjs');new Store(process.argv[1]).mutate('settings.save',{name:'After restart'});",s.file],{cwd:path.join(__dirname,'..')});
 sql=new DatabaseSync(s.file);assert.equal(sql.prepare('SELECT count(*) AS n FROM assets').get().n,0);sql.close();
});

test('failed new-image writes roll back assets and recovery data, and retry writes the missing asset',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const before=s.snapshot(),previous=s.previousSnapshot(),next='data:image/png;base64,'+'B'.repeat(20000),car=s.data.cars[0];
 let sql=new DatabaseSync(s.file);sql.exec("CREATE TRIGGER fail_asset BEFORE INSERT ON assets BEGIN SELECT RAISE(ABORT,'injected asset failure'); END");sql.close();
 assert.throws(()=>s.mutate('car.save',{id:car.id,revision:car.revision,data:{picture:next}}),/asset failure/);assert.deepEqual(new Store(file).data,before);assert.deepEqual(s.previousSnapshot(),previous);
 sql=new DatabaseSync(s.file);sql.exec('DROP TRIGGER fail_asset');sql.close();s.mutate('car.save',{id:car.id,revision:car.revision,data:{picture:next}});assert.equal(new Store(file).data.cars[0].picture,next);assert.deepEqual(s.previousSnapshot(),before);assert.equal(s.lastWrite.assetWrites,1);
});

test('mixed record additions, removals, reordering and shared media preserve exact current and previous revisions',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const primary=s.data.cars[0].id;
 for(let i=0;i<60;i++){
  const before=s.snapshot();s.transact(db=>{const car=db.cars.find(c=>c.id===primary);switch(i%6){
   case 0:car.picture='data:image/png;base64,'+Buffer.from('shared-'+i%3).toString('base64');car.photos=[{id:'extra',name:'Extra',data:car.picture}];break;
   case 1:db.cars.push({...require('../src/json-data.cjs').cloneJSON(car),id:'extra-'+i,name:'Extra '+i});break;
   case 2:db.cars.reverse();db.parts.reverse();break;
   case 3:db.cars=db.cars.filter(c=>c.id===primary);break;
   case 4:car.picture='';car.photos=[];break;
   case 5:car.privateNotes='Literal data:image/\ud800 '+i;break;
  }});
  assert.equal(JSON.stringify(new Store(file).data),JSON.stringify(s.data),'current step '+i);assert.equal(JSON.stringify(s.previousSnapshot()),JSON.stringify(before),'previous step '+i);
 }
});
test('a second writer cannot overwrite newer records even after changing the local revision',t=>{
 const {file}=fixture(t),a=new Store(file);a.mutate('settings.save',{name:'Initial'});const b=new Store(file);a.mutate('settings.save',{name:'Newer'});const before=b.snapshot();
 assert.throws(()=>b.mutate('settings.save',{name:'Stale'}),/another process/);assert.deepEqual(b.data,before);assert.equal(new Store(file).data.settings.name,'Newer');
});
test('an interrupted SQL transaction rolls back on reopening',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const before=s.snapshot();
 const script="const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE; DELETE FROM records;');process.exit(23)";
 const child=spawnSync(process.execPath,['-e',script,s.file]);assert.equal(child.status,23);assert.deepEqual(new Store(file).data,before);
});

test('opening recovers a hot journal after a writer exits with dirty pages spilled to disk',t=>{
 const {file}=fixture(t),s=new Store(file);s.mutate('car.save',{data:{name:'Journal recovery',picture:'data:image/png;base64,'+'A'.repeat(1024*1024)}});const before=s.snapshot();
 const script="const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA cache_size=10; BEGIN IMMEDIATE');d.prepare('UPDATE assets SET value=?').run(Buffer.alloc(1024*1024,66));process.exit(23)";
 const child=spawnSync(process.execPath,['-e',script,s.file]);assert.equal(child.status,23);assert.ok(fs.existsSync(s.file+'-journal'));assert.deepEqual(new Store(file).data,before);
});

test('a schema-only database is reported as incomplete rather than silently resetting its identity',t=>{
 const {file}=fixture(t),target=storage.sqlitePath(file);const packed=storage.pack(new Store().data);packed.records[0].refs=['0'.repeat(64)];assert.throws(()=>storage.write(target,packed,null));
 assert.throws(()=>new Store(file),/no committed collection/);
});
test('storage versions, corrupt attachments and unrelated SQLite files fail clearly without replacement',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());let sql=new DatabaseSync(s.file);sql.exec('PRAGMA user_version=99');sql.close();assert.throws(()=>new Store(file),/Unsupported/);
 sql=new DatabaseSync(s.file);sql.exec('PRAGMA user_version=1');sql.prepare('UPDATE assets SET value=?').run(Buffer.from('damaged'));sql.close();assert.throws(()=>new Store(file),/integrity/);
});
test('backup restoration and database replacement keep previous identity and complete data recoverable',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const before=s.snapshot(),replacement=new Store().snapshot();s.restore(replacement,s.data.revision);
 assert.equal(new Store(file).data.id,replacement.id);assert.deepEqual(s.previousSnapshot(),before);const restored=new Store();restored.restore(s.previousSnapshot(),0);assert.deepEqual(restored.data.cars,before.cars);
});
test('logical SQLite representation round trips nested arrays, key order and collision-like user data',t=>{
 const {file}=fixture(t),target=storage.sqlitePath(file),value=JSON.parse('{"id":"x","revision":0,"cars":[{"id":"a","custom":{"$paddockAsset":"ordinary","__proto__":"own value"},"picture":"data:image/png;base64,AAAA"}],"timing":{"key":null,"sessions":[]},"empty":[]}');
 storage.write(target,storage.pack(value),null);assert.equal(JSON.stringify(storage.read(target)),JSON.stringify(value));assert.equal({}.polluted,undefined);
});
test('all live database and retained JSON files are protected from export overwrite',t=>{const {file}=fixture(t),s=new Store(file);for(const f of [s.file,file,file+'.previous',s.file+'-journal',s.file+'-wal',s.file+'-shm'])assert.ok(s.protectedFiles().includes(f));});

test('unrelated SQLite files are rejected without altering their contents',t=>{
 const {file}=fixture(t),target=storage.sqlitePath(file),sql=new DatabaseSync(target);sql.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'Keep me\')');sql.close();const before=fs.readFileSync(target);
 assert.throws(()=>new Store(file),/not a Paddock/);assert.deepEqual(fs.readFileSync(target),before);
});

test('empty SQLite files never hide an existing JSON collection or become a new collection on read',t=>{
 const {file}=fixture(t),legacy=JSON.stringify(rich().snapshot()),target=storage.sqlitePath(file);fs.writeFileSync(file,legacy);fs.writeFileSync(target,'');
 assert.throws(()=>new Store(file),/SQLite|committed|Paddock/);assert.equal(fs.statSync(target).size,0);assert.equal(fs.readFileSync(file,'utf8'),legacy);
});

test('reading a missing previous revision does not create an empty live database',t=>{
 const {file}=fixture(t),s=new Store(file);assert.equal(s.previousSnapshot(),null);assert.equal(fs.existsSync(s.file),false);
});

test('attachment extraction preserves arbitrary text including unpaired UTF-16 characters',t=>{
 const {file}=fixture(t),s=new Store(file),notes='data:image/\ud800',custom='Text with \udfff '+ 'x'.repeat(1200);
 s.mutate('car.save',{data:{name:'Text round trip',privateNotes:notes}});s.transact(db=>db.cars[0].custom.data=custom);
 const reloaded=new Store(file);assert.equal(reloaded.data.cars[0].privateNotes,notes);assert.equal(reloaded.data.cars[0].custom.data,custom);
});

test('missing asset references are detected before subsequent garbage collection can delete a live image',t=>{
 const {file}=fixture(t),s=new Store(file);s.replace(rich().snapshot());const sql=new DatabaseSync(s.file);sql.exec('DELETE FROM asset_refs');sql.close();
 assert.throws(()=>new Store(file),/attachment reference|integrity/);
});

test('migration preserves signed Timing results, Telemetry snapshots and pending Dealership reviews across restart',async t=>{
 const {file,dir}=fixture(t),f=require('./support/timing-fixtures.cjs').fixtures(),timing=require('../src/timing-integration.cjs'),telemetry=require('../src/telemetry-export.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
 for(const payload of [f.normal,f.multi,f.endurance])timing.receive(f.store,payload);
 let net=new Network(f.store),club=new Club(f.store,net,dir);club.enable('Test dealership','Test password');
 await club.mutate('car.save',{id:'car-a',revision:f.store.data.cars[0].revision,data:{livery:'Pending livery'}});
 const original=f.store.snapshot(),manifest=telemetry.manifest(original),digest=M.digest(original);club.close();net.close();
 fs.writeFileSync(file,JSON.stringify(original));const s=new Store(file);assert.deepEqual(s.data,original);assert.deepEqual(telemetry.manifest(s.data),manifest);assert.equal(M.digest(s.data),digest);assert.equal(timing.receive(s,f.normal).duplicate,true);
 net=new Network(s);club=new Club(s,net,dir);t.after(()=>{club.close();net.close();});assert.equal(club.status().password,'Test password');
 const proposal=club.preview(s.data.club.proposals[0].id);club.review({id:proposal.id,token:proposal.token,decision:'accept'});
 assert.equal(new Store(file).data.cars[0].livery,'Pending livery');
 timing.receive(s,f.correction);assert.equal(new Store(file).data.timing.sessions.find(x=>x.payload.sessionId===f.normal.sessionId).payload.revision,2);
 timing.receive(s,f.withdrawal);const reopened=new Store(file);assert.equal(timing.receive(reopened,f.withdrawal).duplicate,true);assert.throws(()=>timing.receive(reopened,f.normal),e=>e.apiCode==='STALE_REVISION');
 assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(original));
});
