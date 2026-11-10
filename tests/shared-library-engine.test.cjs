'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {open}=require('../packages/shared-library/index.cjs');
async function setup(t){const root=fs.mkdtempSync(path.join(__dirname,'../.qa','common-library-')),handles=[];t.after(async()=>{await Promise.all(handles.map(h=>h.close()));fs.rmSync(root,{recursive:true,force:true});});const start=async id=>{const h=await open({application:'SlotForge '+id,installationId:id,sharedRoot:root});handles.push(h);return h;};return {root,start};}
const identity=s=>({databaseId:s.databaseId,recoveryId:s.recoveryId});
test('two independent workers share one file, see writes immediately and preserve conflicting edits',async t=>{
 const {start}=await setup(t),[a,b]=await Promise.all([start('Timing'),start('Paddock')]);const sa=await a.status(),sb=await b.status();assert.equal(sa.file,sb.file);assert.equal(sa.databaseId,sb.databaseId);
 const created=await a.carWrite({...identity(sa),operationId:'create',action:'create',set:{name:'Timing car',reference:'ORIGINAL'}});const c=await b.car(created.car.id);assert.equal(c.fields.name,'Timing car');
 const edits=await Promise.allSettled([a.carWrite({...identity(sa),operationId:'edit-a',action:'patch',carId:c.id,expectedRevision:c.revision,set:{name:'From Timing'}}),b.carWrite({...identity(sb),operationId:'edit-b',action:'patch',carId:c.id,expectedRevision:c.revision,set:{name:'From Paddock'}})]);
 assert.equal(edits.filter(e=>e.status==='fulfilled').length,1);assert.equal(edits.find(e=>e.status==='rejected').reason.code,'REVISION_CONFLICT');
 assert.equal((await b.catalogue()).cars.length,1);const changes=await b.changes({after:sb.changeCursor});assert.equal(changes.entries[0].carId,c.id);
 await a.close();const current=await b.car(c.id);await b.carWrite({...identity(sb),operationId:'six-weeks',action:'patch',carId:c.id,expectedRevision:current.revision,set:{reference:'After weeks alone'}});
 const reopened=await start('Timing');assert.equal((await reopened.car(c.id)).fields.reference,'After weeks alone');assert.equal((await reopened.receipt({...identity(sa),operationId:'create'})).car.id,c.id);
});
test('automatic adoption preserves original fields and stable aliases atomically without Review',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status(),raw={id:'old-id',name:'Older car',simulation:{fuel:12},customUnknown:'preserve'};
 const input={...identity(s),operationId:'adopt-old',sourceId:'ancient-timing',originalId:raw.id,data:{name:raw.name},rawOriginal:raw};const first=await a.adoptCar(input);await a.close();const b=await start('Paddock');assert.equal((await b.adoptCar(input)).carId,first.carId);assert.equal((await b.catalogue()).cars.length,1);
 const original=await b.extensionRead({namespace:'timing.carExtras',sourceId:input.sourceId,originalId:raw.id});assert.deepEqual(original.value,raw);assert.equal((await b.adoptionStatus({sourceId:input.sourceId})).rows[0].originalId,'old-id');
 await assert.rejects(b.adoptCar({...input,rawOriginal:{...raw,name:'changed original'}}),e=>e.code==='ORIGIN_CHANGED');
 const file=(await b.status()).file,db=new(require('node:sqlite').DatabaseSync)(file,{readOnly:true});try{assert.equal(db.prepare("SELECT count(*) n FROM records WHERE bucket='[\"submissions\"]'").get().n,0);}finally{db.close();}
});
test('historical adoption uses same accepted history and keeps unknown configuration',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status();const car=await a.adoptCar({...identity(s),operationId:'car',sourceId:'old',originalId:'car',data:{name:'Historic car'},rawOriginal:{id:'car'}});
 const batch=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))),bundle=batch.items[0].bundle;bundle.race.participants[0].carId=car.carId;bundle.race.participants[0].configuration=null;
 const raw={id:'session',laps:bundle.race.participants[0].laps,unknown:'kept'};const input={...identity(s),operationId:'history',sourceId:'old',originalId:'session',sessionId:'session',bundle,rawOriginal:raw};await a.adoptSession(input);await a.adoptSession(input);
 const b=await start('Paddock'),stats=await b.historyRead({kind:'statistics',carId:car.carId});assert.equal(stats.historicalSessions,1);assert.equal(stats.personalRecordLaps,0);assert.equal((await b.historyRead({kind:'sessions',carId:car.carId})).entries.length,1);
 const original=await b.extensionRead({namespace:'timing.historyOriginals',sourceId:'old',originalId:'session'});assert.deepEqual(original.value,raw);
});
test('canonical car and Timing companion fields commit together, with conflict rollback and durable retries',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status();assert.equal((await a.carSchema()).fields.pinion.unit,'teeth');
 const input={...identity(s),operationId:'create-extras',action:'create',set:{name:'Combined',pinion:9,gear:27},timingExtras:{sourceId:'Timing',originalId:'local-original',expectedRevision:0,rawOriginal:{fuel:33}}};
 const created=await a.carWrite(input);assert.equal((await a.carWrite(input)).car.id,created.car.id);assert.equal((await a.adoptionStatus({sourceId:'Timing'})).rows[0].carId,created.car.id);
 assert.deepEqual((await a.extensionRead({namespace:'timing.carExtras',sourceId:'Timing',originalId:'local-original'})).value,{fuel:33});
 await assert.rejects(a.carWrite({...identity(s),operationId:'bad-extras',action:'patch',carId:created.car.id,expectedRevision:1,set:{name:'Must roll back'},timingExtras:{...input.timingExtras,rawOriginal:{fuel:44}}}),e=>e.code==='REVISION_CONFLICT');assert.equal((await a.car(created.car.id)).fields.name,'Combined');
 const cars=(await a.catalogue()).cars;assert.equal(cars[0].hasPicture,false);assert.equal(cars[0].galleryCount,0);assert.deepEqual((await a.car(created.car.id,{includeMedia:true})).photos,[]);
});
test('companion-only edits validate car state, commit atomically and replay receipts without fake canonical edits',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status(),created=await a.carWrite({...identity(s),operationId:'extras-car',action:'create',set:{name:'Unchanged'}}),id=created.car.id;
 const input={...identity(s),operationId:'extras-only',action:'patch',carId:id,expectedRevision:1,set:{},clear:[],timingExtras:{sourceId:'Timing',originalId:'extras-car',expectedRevision:0,patch:{damageFactor:1.5}}};
 const result=await a.carWrite(input);assert.deepEqual(result.car,created.car);assert.equal(result.timingExtras.revision,1);
 assert.equal((await a.status()).revision,s.revision+2);assert.equal((await a.origin({sourceId:'Timing',originalId:'extras-car'})).carId,id);
 const companion={namespace:'timing.carExtras',sourceId:'Timing',originalId:'extras-car'},before=await a.extensionRead(companion),state=await a.status();
 await assert.rejects(a.carWrite({...input,operationId:'stale-extra'}),e=>e.code==='REVISION_CONFLICT');
 await assert.rejects(a.carWrite({...input,operationId:'stale-car',expectedRevision:9}),e=>e.code==='REVISION_CONFLICT');
 await assert.rejects(a.carWrite({...input,operationId:'null-extra',timingExtras:null}),e=>e.code==='INVALID_ORIGIN');
 await assert.rejects(a.carWrite({...input,operationId:'missing-car',carId:'missing'}),e=>e.code==='CAR_NOT_FOUND');
 assert.deepEqual(await a.extensionRead(companion),before);assert.equal((await a.status()).revision,state.revision);
 const noExtras={...input,operationId:'empty'};delete noExtras.timingExtras;await assert.rejects(a.carWrite(noExtras),e=>e.code==='INVALID_OPERATION');
 // The older service contract remains strict, including attempts to opt in via JSON.
 const Store=require('../src/store.cjs').Store,C=require('../src/shared-car-library.cjs'),store=new Store(s.file,{deferred:true}),payload={version:1,...noExtras,sourceId:'Timing'};
 assert.throws(()=>C.prepare(store,{payload}),e=>e.apiCode==='INVALID_OPERATION');assert.throws(()=>C.prepare(store,{payload:{...payload,allowCompanionOnly:true}}),e=>e.apiCode==='INVALID_OPERATION');
 await a.close();const b=await start('Timing'),retry=await b.carWrite(input);assert.deepEqual(retry,{...result,duplicate:true});
 assert.deepEqual(await b.receipt({...identity(s),operationId:input.operationId}),retry);
 await assert.rejects(b.carWrite({...input,timingExtras:{...input.timingExtras,patch:{damageFactor:2}}}),e=>e.code==='COMMAND_CONFLICT'||e.code==='OPERATION_CONFLICT');
 await b.carWrite({...identity(s),operationId:'archive-extras-car',action:'archive',carId:id,expectedRevision:1});
 await assert.rejects(b.carWrite({...input,operationId:'archived-extra',expectedRevision:2,timingExtras:{...input.timingExtras,expectedRevision:1}}),e=>e.code==='CAR_ARCHIVED');assert.deepEqual(await b.extensionRead(companion),before);
});

test('restoration rejects old operations and adopted originals do not silently resurrect deleted cars',async t=>{
 const {root,start}=await setup(t),a=await start('Timing'),s=await a.status();const input={...identity(s),operationId:'before-reset',action:'create',set:{name:'Before reset'}};await a.carWrite(input);
 const {Store,initial}=require('../src/store.cjs'),store=await Store.open(s.file);const oldId=store.data.id;await store.restoreAsync(initial(),store.data.revision);await require('../src/shared-library-location.cjs').rebind(root,s.file,oldId);
 await assert.rejects(a.carWrite(input),e=>e.code==='DATABASE_MISMATCH');await a.close();const b=await start('Paddock');assert.notEqual((await b.status()).databaseId,oldId);assert.equal((await b.catalogue()).total,0);
});
test('small companion patches preserve media chunks and portable backups retain exact originals plus edits',async t=>{
 const {root,start}=await setup(t),a=await start('Timing'),s=await a.status(),raw={id:'large-original',picture:crypto.randomBytes(1500000).toString('base64'),damageFactor:1,unknown:'keep'};
 const adopted=await a.adoptCar({...identity(s),sourceId:'Timing',originalId:raw.id,operationId:'large',data:{name:'Large original'},rawOriginal:raw});
 const hashes=()=>{const db=new(require('node:sqlite').DatabaseSync)(s.file,{readOnly:true});try{return db.prepare('SELECT hash FROM assets ORDER BY hash').all().map(r=>r.hash);}finally{db.close();}};
 const before=hashes();assert.ok(before.length>=2);const result=await a.carWrite({...identity(s),operationId:'small-patch',action:'patch',carId:adopted.carId,expectedRevision:1,set:{name:'Large original'},timingExtras:{sourceId:'Timing',originalId:raw.id,expectedRevision:1,patch:{damageFactor:1.2}}});assert.equal(result.timingExtras.revision,2);assert.deepEqual(hashes(),before);
 const key={namespace:'timing.carExtras',sourceId:'Timing',originalId:raw.id};assert.deepEqual((await a.extensionRead(key)).value,{...raw,damageFactor:1.2});const small=await a.extensionRead({...key,selectedFields:['damageFactor','unknown']});assert.equal(small.complete,false);assert.deepEqual(small.value,{damageFactor:1.2,unknown:'keep'});
 const backup=require('../src/portable-backup.cjs'),archive=path.join(root,'backup.sfpbackup'),stage=path.join(root,'restored.sqlite');backup.exportBackup(s.file,archive);backup.stageBackup(archive,stage);const restored=new(require('../src/store.cjs').Store)(stage,{deferred:true});const evidence=await require('../src/shared-library-engine.cjs').call(restored,{installationId:'Timing'},'extensionRead',key);assert.deepEqual(evidence.value,{...raw,damageFactor:1.2});
});
test('catalogue and original alias continuation rejects a changed snapshot',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status();for(let i=0;i<3;i++)await a.adoptCar({...identity(s),sourceId:'Timing',originalId:'source-'+i,operationId:'adopt-'+i,data:{name:'Car '+i},rawOriginal:{id:'source-'+i}});
 const first=await a.adoptionStatus({sourceId:'Timing',entity:'car',limit:1}),next=await a.adoptionStatus({sourceId:'Timing',entity:'car',limit:1,offset:first.nextOffset,token:first.token});assert.notEqual(first.rows[0].carId,next.rows[0].carId);assert.equal((await a.origin({sourceId:'Timing',originalId:'source-0'})).originalId,'source-0');
 const page=await a.catalogue({limit:1});await a.carWrite({...identity(s),operationId:'changed-page',action:'create',set:{name:'New car'}});await assert.rejects(a.adoptionStatus({sourceId:'Timing',offset:first.nextOffset,token:first.token}),e=>e.code==='QUERY_CHANGED');await assert.rejects(a.catalogue({offset:page.nextOffset,token:page.token}),e=>e.code==='QUERY_CHANGED');
});
test('a crash after deliberate database replacement recovers the registration and never admits old handles',async t=>{
 const {root,start}=await setup(t),a=await start('Timing'),s=await a.status(),locations=require('../src/shared-library-location.cjs'),ticket=await locations.beginReplacement(root,s.file,s.databaseId);
 const {Store,initial}=require('../src/store.cjs'),store=await Store.open(s.file);await store.restoreAsync(initial(),store.data.revision);
 ticket.pid=Number(require('node:child_process').execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'}));fs.writeFileSync(path.join(root,'replacement.json'),JSON.stringify(ticket));
 const b=await start('Paddock');assert.equal((await b.status()).databaseId,store.data.id);assert.equal(fs.existsSync(path.join(root,'replacement.json')),false);await assert.rejects(a.catalogue(),e=>e.code==='DATABASE_MISMATCH');
});

test('worker backup captures the whole shared library, identity and originals without replacing destinations',async t=>{
 const {root,start}=await setup(t),a=await start('Timing'),initial=await a.status();
 await a.adoptCar({...identity(initial),sourceId:'Timing',originalId:'backup-car',operationId:'backup-car',data:{name:'Preserved',owner:'Private owner'},rawOriginal:{id:'backup-car',unknown:'Preserved original'}});
 const store=new(require('../src/store.cjs').Store)(initial.file);store.mutate('part.save',{data:{name:'Paddock inventory',category:'Motor',tracking:'quantity',quantity:3}});
 const s=await a.status(),destination=path.join(root,'full-library.sfpbackup'),input={...identity(s),revision:s.revision,destination};
 await assert.rejects(a.backup({...input,revision:initial.revision}),e=>e.code==='REVISION_CONFLICT');
 await assert.rejects(a.backup({...input,recoveryId:'old-generation'}),e=>e.code==='RECOVERY_CHANGED');
 assert.equal(fs.existsSync(destination),false);
 const result=await a.backup(input);assert.equal(result.databaseId,s.databaseId);assert.equal(result.recoveryId,s.recoveryId);assert.equal(result.revision,s.revision);
 const bytes=fs.readFileSync(destination);await assert.rejects(a.backup(input),e=>e.code==='DESTINATION_EXISTS');assert.deepEqual(fs.readFileSync(destination),bytes);
 const portable=require('../src/portable-backup.cjs'),stage=path.join(root,'backup-stage.sqlite');assert.deepEqual(portable.verify(destination).identity,[s.databaseId,s.revision]);portable.stageBackup(destination,stage);
 const restored=new(require('../src/store.cjs').Store)(stage);assert.equal(restored.data.cars[0].owner,'Private owner');assert.equal(restored.data.parts[0].quantity,3);
 assert.equal((await require('../src/shared-library-engine.cjs').call(restored,{installationId:'Timing'},'extensionRead',{namespace:'timing.carExtras',sourceId:'Timing',originalId:'backup-car'})).value.unknown,'Preserved original');
 assert.equal(fs.readdirSync(root).some(name=>name.startsWith('.slotforge-backup-')),false);
});

test('direct shared history corrections and withdrawals are visible to another app and old retries never restore them',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status(),car=await a.carWrite({...identity(s),operationId:'race-car',action:'create',set:{name:'Race car'}});
 const batch=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))),bundle=batch.items[0].bundle;bundle.race.participants[0].carId=car.car.id;bundle.race.participants[0].configuration=null;
 const operation={version:1,...identity(s),operationId:'race-create',sourceId:'Timing',sessionId:'shared-race',editor:{installationId:'Timing',application:'SlotForge Timing',name:'Owner'},reason:'Original evidence',action:'create',expected:null,bundle,rawOriginal:{session:{id:'shared-race'},laps:bundle.race.participants[0].laps}};
 const first=await a.historyWrite(operation),b=await start('Paddock');assert.equal((await b.historyRead({kind:'sessions',carId:car.car.id})).entries.length,1);
 const corrected=structuredClone(bundle);corrected.race.name='Corrected name';const second=await a.historyWrite({...operation,operationId:'race-correction',action:'replace',expected:first.accepted,bundle:corrected,rawOriginal:{corrected:true}});
 assert.equal(second.accepted.revision,2);await assert.rejects(b.historyWrite({...operation,operationId:'conflicting-race',action:'replace',expected:first.accepted}),e=>e.code==='REVISION_CONFLICT');
 const withdrawal={...operation,operationId:'race-withdraw',action:'withdraw',expected:second.accepted,withdrawalReason:'Duplicate session',reason:'Withdraw reviewed result'};delete withdrawal.bundle;delete withdrawal.rawOriginal;
 const removed=await a.historyWrite(withdrawal);assert.equal(removed.accepted.state,'withdrawn');await a.close();
 const reopened=await start('Timing'),retry=await reopened.historyWrite(operation);assert.equal(retry.duplicate,true);assert.equal((await b.historyRead({kind:'sessions',carId:car.car.id,state:'active'})).entries.length,0);assert.equal((await b.historyRead({kind:'statistics',carId:car.car.id})).historicalSessions,0);
 assert.equal((await b.extensionRead({namespace:'timing.historyOriginals',sourceId:'Timing',originalId:'shared-race'})).value.corrected,true);
});

test('an earlier keyless historical-only adoption can capture future races and sign history pages',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status(),car=await a.carWrite({...identity(s),operationId:'key-car',action:'create',set:{name:'Old history'}}),bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))).items[0].bundle;bundle.race.participants[0].carId=car.car.id;bundle.race.participants[0].configuration=null;
 for(let i=0;i<2;i++)await a.adoptSession({...identity(s),operationId:'old-history-'+i,sourceId:'old',originalId:'old-'+i,sessionId:'old-'+i,bundle,rawOriginal:{session:{id:'old-'+i},laps:[]}});
 await a.close();const store=new(require('../src/store.cjs').Store)(s.file);store.transact(d=>{d.timing.key=null;});
 const repaired=await start('Timing'),capture=await repaired.profile({carId:car.car.id});require('../src/timing-integration.cjs').verifyConfiguration(new(require('../src/store.cjs').Store)(s.file).data,car.car.id,capture.configuration);
 const page=await repaired.historyRead({kind:'sessions',limit:1});assert.ok(page.nextPage);assert.equal((await repaired.historyRead({kind:'sessions',limit:1,page:page.nextPage})).entries.length,1);
});

test('missing keys in signed measured history are never replaced during automatic shared startup',async t=>{
 const {start}=await setup(t),a=await start('Timing'),s=await a.status();await a.close();const {Store}=require('../src/store.cjs'),store=new Store(s.file),fixtures=require('./support/timing-fixtures.cjs').fixtures(),T=require('../src/timing-integration.cjs');store.replace(fixtures.store.snapshot());T.receive(store,fixtures.normal);
 // Deliberately corrupt only this disposable database, bypassing normal validation.
 const data=store.snapshot();data.timing.key=null;require('../src/sqlite-storage.cjs').write(s.file,require('../src/sqlite-storage.cjs').pack(data),store.expectedIdentity);
 assert.throws(()=>require('../src/shared-library-key.cjs').ensure(s.file),e=>['CAPTURE_KEY_MISSING','CONFIGURATION_INVALID'].includes(e.code||e.apiCode));
 const reader=new(require('../src/sqlite-query.cjs').Reader)(s.file);try{assert.equal(reader.scalar('timing','key'),null);}finally{reader.close();}
});
