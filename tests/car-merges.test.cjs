'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Storage=require('../src/car-merge-storage.cjs'),M=require('../src/car-merge-model.cjs'),A=require('../src/car-merge-archive.cjs'),S=require('../src/sqlite-storage.cjs');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),{fixtures}=require('./support/timing-fixtures.cjs'),w=require('../src/workshop.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(t,edit=()=>{}){
 const f=fixtures();edit(f);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slotforge-merge-qualification-')),repo=Storage.openQualification(dir);repo.initialize(f.store.data);
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let sequence=0;
 const command=(action,payload={},operationId='op-'+(++sequence))=>({databaseId:repo.read().id,recoveryId:repo.state().recoveryId,sourceId:'review-pc',operationId,action,payload});
 const send=(action,payload,options)=>repo.command(command(action,payload),options).result;
 const create=(mainCarId='car-b',retiredCarId='car-a')=>send('create',{mainCarId,retiredCarId});
 const save=(p,edit)=>{const choices=structuredClone(p.choices);edit(choices);return send('save',{id:p.id,expectedRevision:p.revision,choices});};
 const approve=(p,options)=>send('approve',{id:p.id,expectedRevision:p.revision},options);
 return {...f,dir,repo,command,send,create,save,approve};
}
const archive=(db,side)=>{const a=db.mergeArchives.find(a=>a.side===side);return A.thaw(a,db.mergeChunks);};

function settingsOriginal(db,carId,sourceId,originalId,values){
 db.libraryOrigins??=[];db.libraryExtras??=[];
 db.libraryOrigins.push({id:'origin-'+T.digest([sourceId,'car',originalId]),entity:'car',carId,sourceId,originalId,sourceHash:T.digest(values)});
 db.libraryExtras.push({id:'extra-'+T.digest(['timing.carExtras',sourceId,originalId]),namespace:'timing.carExtras',sourceId,originalId,revision:1,...require('../src/shared-library-evidence.cjs').encode(values)});
}

test('Timing settings merge per field and installation, preserving originals, explicit clears and zero',t=>{
 const f=fixture(t,f=>{
  settingsOriginal(f.store.data,'car-b','laptop','main',{damageFactor:2,failureFactor:3,tyreCompound:'M',serviceInterval:1000,unknownFuture:{keep:true}});
  settingsOriginal(f.store.data,'car-a','laptop','old',{damageFactor:0,failureFactor:null,tyreCompound:'C_0123456789ABCDEF',serviceInterval:200});
  settingsOriginal(f.store.data,'car-b','club','main-club',{damageFactor:4,tyreCompound:'S'});
  settingsOriginal(f.store.data,'car-a','club','old-club',{damageFactor:5,tyreCompound:'W'});
 }),before=f.repo.read(),p=f.save(f.create(),c=>{
  c.settings['["laptop","damageFactor"]']='["incoming","origin:old"]';c.settings['["laptop","failureFactor"]']='["incoming","origin:old"]';
 });f.approve(p);const db=f.repo.read(),values=db.mergeCompanions.find(r=>r.sourceId==='laptop');
 assert.deepEqual(values.fields,{tyreCompound:'M',damageFactor:0,failureFactor:null,serviceInterval:1000});assert.equal(values.localCarId,'main');
 assert.equal(require('../src/car-merge-settings.cjs').effective(values.fields).failureFactor,1);
 assert.equal(db.mergeCompanions.find(r=>r.sourceId==='club').fields.damageFactor,4);
 assert.deepEqual(db.libraryExtras,before.libraryExtras);assert.deepEqual(db.libraryOrigins,before.libraryOrigins);
 assert.deepEqual(archive(db,'retired').extras,before.libraryExtras.filter(e=>['old','old-club'].includes(e.originalId)));
});

test('missing incoming settings never clear main values; a missing main binding is deterministic',t=>{
 const f=fixture(t,f=>{settingsOriginal(f.store.data,'car-b','laptop','main',{damageFactor:2});settingsOriginal(f.store.data,'car-a','laptop','old',{tyreCompound:'SS'});settingsOriginal(f.store.data,'car-a','new-source','old-only',{failureFactor:0});});
 const rows=require('../src/car-merge-settings.cjs').rows(f.repo.read(),'car-b','car-a');
 assert.equal(rows.find(r=>r.key==='["laptop","damageFactor"]').candidates.some(c=>c.side==='incoming'),false);
 const p=f.create();f.approve(p);const db=f.repo.read(),newSource=db.mergeCompanions.find(c=>c.sourceId==='new-source');
 assert.equal(newSource.localCarId,'car-b');assert.deepEqual(newSource.fields,{});assert.equal(db.mergeCompanions.find(c=>c.sourceId==='laptop').fields.damageFactor,2);
});

test('ambiguous main origins require an explicit field choice rather than first-wins order',t=>{
 const f=fixture(t,f=>{settingsOriginal(f.store.data,'car-b','laptop','main-1',{damageFactor:2});settingsOriginal(f.store.data,'car-b','laptop','main-2',{});settingsOriginal(f.store.data,'car-a','laptop','old',{damageFactor:5});});
 let p=f.create();assert.throws(()=>f.approve(p),/Choose the main or duplicate value/);
 p=f.save(p,c=>{c.settings['["laptop","damageFactor"]']='["main","origin:main-2"]';});f.approve(p);
 const row=f.repo.read().mergeCompanions[0];assert.equal(Object.hasOwn(row.fields,'damageFactor'),false);assert.equal(row.localCarId,'car-b');
});

test('chained settings merges use selected effective values and archive the prior binding',t=>{
 const f=fixture(t,f=>{const c=structuredClone(f.store.data.cars[1]);c.id='car-c';f.store.data.cars.push(c);settingsOriginal(f.store.data,'car-b','laptop','main',{damageFactor:2});settingsOriginal(f.store.data,'car-a','laptop','old',{damageFactor:0});});
 let p=f.save(f.create(),c=>{c.settings['["laptop","damageFactor"]']='["incoming","origin:old"]';});f.approve(p);
 const oldBinding=f.repo.read().mergeCompanions[0];p=f.save(f.create('car-c','car-b'),c=>{c.settings['["laptop","damageFactor"]']=JSON.stringify(['incoming','overlay:'+oldBinding.id]);});const result=f.approve(p),db=f.repo.read();
 assert.equal(db.mergeCompanions.find(c=>c.carId==='car-c').fields.damageFactor,0);assert.deepEqual(db.mergeCompanions.find(c=>c.carId==='car-b'),oldBinding);
 const snap=A.thaw(db.mergeArchives.find(a=>a.id===result.archives.retired),db.mergeChunks);assert.deepEqual(snap.companions,[oldBinding]);
});

test('both full and deferred production open reject private qualification files regardless of activation',t=>{
 const f=fixture(t);assert.throws(()=>Storage.execute(),{code:'MERGE_COMPATIBILITY_REQUIRED'});
 assert.throws(()=>new Store(f.repo.file),/Unsupported database version/);assert.throws(()=>new Store(f.repo.file,{deferred:true}),/Unsupported database version/);
 assert.throws(()=>Storage.openQualification(process.cwd()),{code:'MERGE_COMPATIBILITY_REQUIRED'});
});
test('proposal and edited choices survive reopen; nothing changes before explicit approval',t=>{
 const f=fixture(t),before=f.repo.read();let p=f.create();assert.equal(p.status,'pending');assert.deepEqual(f.repo.read().cars,before.cars);
 p=f.save(p,c=>{c.fields['["name"]']='take';c.photos={};});
 const reopened=Storage.openQualification(f.dir),saved=reopened.read().mergeProposals[0];assert.deepEqual(saved,p);assert.deepEqual(reopened.read().cars,before.cars);
 f.approve(p);const db=f.repo.read();assert.equal(db.cars.find(c=>c.id==='car-b').name,'Example GT3');assert.equal(db.cars.find(c=>c.id==='car-a').archived,true);
 assert.equal(M.resolve(db,'car-a',f.repo.state().recoveryId).canonicalCarId,'car-b');assert.deepEqual(archive(db,'retired').car,before.cars[0]);assert.deepEqual(archive(db,'main').car,before.cars[1]);
 assert.ok(fs.existsSync(db.mergeProposals[0].backup.path));
});
test('conflicts keep main values and blank fields fill without clearing existing values',t=>{
 const f=fixture(t,f=>{act(f.store,'car.save',{id:'car-a',revision:f.store.data.cars[0].revision,data:{reference:'NSR-123',livery:''}});act(f.store,'car.save',{id:'car-b',revision:f.store.data.cars[1].revision,data:{livery:'Keep livery'}});});
 const p=f.create();assert.equal(p.choices.fields['["name"]'],'keep');assert.equal(p.choices.fields['["reference"]'],'take');assert.equal(p.choices.fields['["livery"]'],'keep');f.approve(p);
 const main=f.repo.read().cars[1];assert.equal(main.name,'Example prototype');assert.equal(main.reference,'NSR-123');assert.equal(main.livery,'Keep livery');
});
test('each incoming photo can be excluded; archived originals remain owned and backup roundtrips',t=>{
 const picture='data:image/png;base64,AAAA',second='data:image/png;base64,AQAB';
 const f=fixture(t,f=>{act(f.store,'car.save',{id:'car-a',revision:f.store.data.cars[0].revision,data:{picture,photos:[{id:'image',name:'Other',data:second}]}});act(f.store,'car.save',{id:'car-b',revision:f.store.data.cars[1].revision,data:{picture:second}});});
 const p=f.save(f.create(),c=>{c.photos.picture=false;c.photos['photo:image']=true;});f.approve(p);let db=f.repo.read();assert.equal(db.cars[1].picture,second);assert.equal(db.cars[1].photos.length,1);assert.equal(archive(db,'retired').car.picture,picture);
 f.repo.change(d=>{d.cars[1].picture='';d.cars[1].photos=[];});f.repo.change(d=>{d.settings.name='Force later save';});
 db=f.repo.read();assert.equal(archive(db,'retired').car.picture,picture);
 const backup=path.join(f.dir,'after.sfpbackup'),restored=path.join(f.dir,'restored.sqlite'),B=require('../src/portable-backup.cjs');B.exportBackup(f.repo.file,backup);B.stageBackup(backup,restored,{validate:false});const roundtrip=S.read(restored);assert.deepEqual(archive(roundtrip,'retired'),archive(db,'retired'));
 const {DatabaseSync}=require('node:sqlite'),connection=new DatabaseSync(f.repo.file);try{assert.ok(connection.prepare("SELECT count(*) n FROM asset_refs WHERE record LIKE '%mergeChunks%'").get().n>=2);}finally{connection.close();}
});
test('changing cover preserves existing main cover and photo identity collisions are remapped',t=>{
 const f=fixture(t,f=>{for(const id of ['car-a','car-b'])act(f.store,'car.save',{id,revision:f.store.data.cars.find(c=>c.id===id).revision,data:{picture:id==='car-a'?'data:image/png;base64,AAAA':'data:image/png;base64,AQAB',photos:[{id:'same',name:'Extra',data:'data:image/png;base64,AQAB'}]}});});
 f.approve(f.save(f.create(),c=>{c.cover='picture';}));const c=f.repo.read().cars[1];assert.equal(c.picture,'data:image/png;base64,AAAA');assert.equal(new Set(c.photos.map(p=>p.id)).size,c.photos.length);assert.ok(c.photos.some(p=>p.name==='Previous main photo'));
});
test('related edits stale review, unrelated theme changes do not; refresh retains choices',t=>{
 const f=fixture(t);let p=f.save(f.create(),c=>{c.fields['["name"]']='take';});f.repo.change(d=>{d.settings.theme='light';});assert.equal(M.preview(f.repo.read(),p).needsRefresh,false);
 f.repo.change(d=>{d.cars[0].reference='Changed';d.cars[0].revision++;});assert.throws(()=>f.approve(p),{code:'MERGE_REVIEW_STALE'});
 p=f.send('refresh',{id:p.id,expectedRevision:p.revision});assert.equal(p.choices.fields['["name"]'],'take');assert.equal(p.choices.fields['["reference"]'],'take');f.approve(p);
});
test('concurrent reviewers and contradictory retirement never overwrite approved choices',t=>{
 const f=fixture(t),p=f.create(),other=f.create();const updated=f.save(p,c=>{c.fields['["name"]']='take';});assert.throws(()=>f.save(p,()=>{}),{code:'MERGE_REVIEW_STALE'});f.approve(updated);assert.throws(()=>f.approve(other),{code:'CAR_MERGED'});
});
test('reject and cancel are durable and leave all car information unchanged',t=>{
 for(const action of ['reject','cancel']){const f=fixture(t),before=f.repo.read().cars,p=f.create();f.send(action,{id:p.id,expectedRevision:p.revision});assert.deepEqual(f.repo.read().cars,before);assert.equal(f.repo.read().mergeMappings.length,0);assert.throws(()=>f.approve(p),/already been decided/);}
});
test('lost acknowledgement retries return original receipt; changed requests and recovery are rejected',t=>{
 const f=fixture(t),p=f.create(),cmd=f.command('approve',{id:p.id,expectedRevision:p.revision},'approve-once');const first=f.repo.command(cmd),before=f.repo.read();assert.equal(Storage.openQualification(f.dir).command(cmd).duplicate,true);assert.deepEqual(f.repo.command(cmd).result,first.result);assert.deepEqual(f.repo.read(),before);
 assert.throws(()=>f.repo.command({...cmd,payload:{...cmd.payload,expectedRevision:999}}),{code:'COMMAND_CONFLICT'});
 f.repo.change(()=>{},{restore:true});assert.throws(()=>f.repo.command(cmd),{code:'RECOVERY_CHANGED'});
});
test('backup or SQLite failure never exposes partial retirement or a success receipt',t=>{
 const f=fixture(t),p=f.create(),cmd=f.command('approve',{id:p.id,expectedRevision:p.revision},'fault'),before=f.repo.read();
 assert.throws(()=>f.repo.command(cmd,{beforeCommit:packed=>{packed.commandReceipt.epoch='wrong';}}),/generation changed/);assert.deepEqual(f.repo.read(),before);assert.equal(f.repo.command(cmd).duplicate,false);
});
test('change during backup invalidates comparison; unrelated change is preserved on commit',t=>{
 const f=fixture(t),p=f.create();assert.throws(()=>f.approve(p,{afterBackup:()=>f.repo.change(d=>{d.cars[0].location='new location';})}),{code:'MERGE_REVIEW_STALE'});assert.equal(f.repo.read().mergeMappings.length,0);
 const fresh=f.send('refresh',{id:p.id,expectedRevision:p.revision});f.approve(fresh,{afterBackup:()=>f.repo.change(d=>{d.settings.theme='light';})});assert.equal(f.repo.read().settings.theme,'light');
});
test('same physical motor reduces owned and fitted without inventing spare stock',t=>{
 let part;const f=fixture(t,f=>{part=act(f.store,'part.save',{data:{name:'21.5k',tracking:'quantity',quantity:2}});for(const carId of ['car-a','car-b'])act(f.store,'part.install',{carId,partId:part,quantity:1,field:'motor'});});
 const db=f.repo.read(),a=db.installations.find(i=>i.carId==='car-a'),b=db.installations.find(i=>i.carId==='car-b');
 assert.throws(()=>f.approve(f.create()),/Two parts occupy/);
 const p=f.save(f.create(),c=>{c.installations[a.id]={action:'same',with:b.id};});f.approve(p);const after=f.repo.read(),stock=after.parts.find(p=>p.id===part);assert.equal(stock.quantity,1);assert.equal(w.available(after,stock),0);assert.equal(w.active(after).length,1);assert.equal(archive(after,'retired').parts[0].quantity,2);
});
test('returning a real spare preserves total owned quantity and transfer uses an empty slot',t=>{
 let part;const f=fixture(t,f=>{part=act(f.store,'part.save',{data:{name:'21.5k',tracking:'quantity',quantity:2}});for(const carId of ['car-a','car-b'])act(f.store,'part.install',{carId,partId:part,quantity:1,field:'motor'});});
 const a=f.repo.read().installations.find(i=>i.carId==='car-a');f.approve(f.save(f.create(),c=>{c.installations[a.id]={action:'return'};}));const db=f.repo.read();assert.equal(db.parts.reduce((n,p)=>n+p.quantity,0),2);assert.equal(db.parts.reduce((n,p)=>n+w.available(db,p),0),1);
 const g=fixture(t,f=>{part=act(f.store,'part.save',{data:{name:'Braid',tracking:'quantity',quantity:1}});act(f.store,'part.install',{carId:'car-a',partId:part,quantity:1,field:'braids'});});g.approve(g.create());assert.equal(w.active(g.repo.read())[0].carId,'car-b');
});
test('selected historical contribution follows correction without rewriting payload or configuration',t=>{
 const f=fixture(t,f=>T.receive(f.store,f.normal));f.approve(f.create());let db=f.repo.read();assert.deepEqual(db.timing.sessions,f.store.data.timing.sessions);assert.equal(M.disposition(db,M.contributions(db)[0],'car-b'),'included');
 const temp=new Store();temp.data={...db,schema:11};T.receive(temp,f.correction);f.repo.change(d=>{d.timing=temp.data.timing;});db=f.repo.read();assert.equal(M.disposition(db,M.contributions(db)[0],'car-b'),'included');assert.equal(archive(db,'retired').sessions[0].payload.revision,1);
});
test('excluded history remains excluded through correction and through a chained merge',t=>{
 const f=fixture(t,f=>{T.receive(f.store,f.normal);act(f.store,'car.save',{data:{name:'Third'}});});let p=f.save(f.create(),c=>{for(const key of Object.keys(c.history))c.history[key]=false;});f.approve(p);
 const third=f.repo.read().cars[2].id;p=f.create(third,'car-b');assert.equal(Object.keys(p.choices.history).length,0);f.approve(p);const db=f.repo.read();assert.equal(M.disposition(db,M.contributions(db)[0],third),'excluded');assert.equal(M.resolve(db,'car-a',f.repo.state().recoveryId).mergeIds.length,2);
});
test('late old-car evidence is a single pending review, and acceptance differs from inclusion',t=>{
 const f=fixture(t);f.approve(f.create());const temp=new Store();temp.data={...f.repo.read(),schema:11};T.receive(temp,f.normal);f.repo.change(d=>{d.timing=temp.data.timing;});
 f.send('reconcileHistory');let db=f.repo.read(),item=db.mergeInclusions[0];assert.equal(item.status,'pending');assert.equal(M.disposition(db,M.contributions(db)[0],'car-b'),'pending');f.send('reconcileHistory');assert.equal(f.repo.read().mergeInclusions.length,1);
 f.send('includeHistory',{id:item.id,expectedRevision:item.revision,include:true});db=f.repo.read();assert.equal(M.disposition(db,M.contributions(db)[0],'car-b'),'included');assert.equal(archive(db,'retired').sessions.length,0);
});
test('late evidence rejection retains original, corrections invalidate pending review revisions',t=>{
 const f=fixture(t);f.approve(f.create());const temp=new Store();temp.data={...f.repo.read(),schema:11};T.receive(temp,f.normal);f.repo.change(d=>{d.timing=temp.data.timing;});f.send('reconcileHistory');const first=f.repo.read().mergeInclusions[0];
 T.receive(temp,f.correction);f.repo.change(d=>{d.timing=temp.data.timing;});assert.throws(()=>f.send('includeHistory',{id:first.id,expectedRevision:first.revision,include:true}),{code:'MERGE_REVIEW_STALE'});
 f.send('reconcileHistory');const revised=f.repo.read().mergeInclusions[0];f.send('includeHistory',{id:revised.id,expectedRevision:revised.revision,include:false});const db=f.repo.read();assert.equal(M.disposition(db,M.contributions(db)[0],'car-b'),'excluded');assert.equal(db.timing.sessions.length,1);
});
test('same-session double participation requires explicit exclusion, never deduplicates laps',t=>{
 const f=fixture(t,f=>T.receive(f.store,f.multi)),p=f.create();assert.throws(()=>f.approve(p),/Both cars participate/);const selected=f.save(p,c=>{for(const key of Object.keys(c.history))c.history[key]=false;});f.approve(selected);assert.deepEqual(f.repo.read().timing.sessions,f.store.data.timing.sessions);
});
test('archives and retired identities cannot be mutated; missing and cyclic resolution fail',t=>{
 const f=fixture(t);f.approve(f.create());assert.throws(()=>f.repo.change(d=>{d.cars[0].archived=false;}),/Retired car/);assert.throws(()=>f.repo.change(d=>{d.mergeChunks[0].value={};}),/integrity/);assert.throws(()=>M.assertWritable(f.repo.read(),'car-a'),{code:'CAR_MERGED'});assert.throws(()=>M.resolve(f.repo.read(),'missing','epoch'),{code:'CAR_NOT_FOUND'});
 const db=f.repo.read();db.mergeMappings.push({id:'cycle',retiredCarId:'car-b',mainCarId:'car-a'});assert.throws(()=>M.resolve(db,'car-a','epoch'),{code:'MERGE_LINEAGE_CONFLICT'});
});
test('large archives split at JSON boundaries and preserve scalar and array types',()=>{
 const value={rows:Array.from({length:3500},(_,id)=>({id,text:'x'.repeat(400)})),config:{empty:null,zero:0,no:false}},frozen=A.freeze(value,'archive-fixture'),meta={id:'archive-fixture',tree:frozen.tree,digest:frozen.digest};assert.ok(frozen.chunks.length>1);assert.deepEqual(A.thaw(meta,frozen.chunks),value);assert.notEqual(A.digest('data:image/png;base64,AAAA'),A.digest({asset:require('../src/lazy-assets.cjs').digest('data:image/png;base64,AAAA')}));
});

test('pending proposal can be refreshed after recovery, but cannot approve under its old generation',t=>{
 const f=fixture(t),p=f.create();f.repo.change(()=>{},{restore:true});assert.throws(()=>f.approve(p),{code:'RECOVERY_CHANGED'});
 const refreshed=f.send('refresh',{id:p.id,expectedRevision:p.revision});assert.equal(refreshed.recoveryId,f.repo.state().recoveryId);f.approve(refreshed);
});
test('recovery occurring during backup leaves every merge change unapplied',t=>{
 const f=fixture(t),p=f.create();assert.throws(()=>f.approve(p,{afterBackup:()=>f.repo.change(()=>{},{restore:true})}),{code:'RECOVERY_CHANGED'});assert.equal(f.repo.read().mergeArchives.length,0);assert.equal(f.repo.read().mergeProposals[0].status,'pending');
});
test('verified-backup failure blocks approval, preserves pending choices and both cars',t=>{
 const f=fixture(t),p=f.create(),before=f.repo.read(),B=require('../src/portable-backup.cjs'),original=B.exportBackup;
 try{B.exportBackup=()=>{throw Error('Test disk full');};assert.throws(()=>f.approve(p),{code:'MERGE_BACKUP_FAILED'});}finally{B.exportBackup=original;}
 assert.deepEqual(f.repo.read(),before);f.approve(p);
});
test('proposal creation itself is idempotent after restart and wrong database writes are refused',t=>{
 const f=fixture(t),cmd=f.command('create',{mainCarId:'car-b',retiredCarId:'car-a'},'one-create');const first=f.repo.command(cmd);assert.deepEqual(Storage.openQualification(f.dir).command(cmd).result,first.result);assert.equal(f.repo.read().mergeProposals.length,1);
 assert.throws(()=>f.repo.command({...cmd,databaseId:'another-database'}),{code:'DATABASE_MISMATCH'});
});
test('mapping pages are bounded and reject stale recovery or mapping snapshots',t=>{
 const f=fixture(t,f=>{act(f.store,'car.save',{data:{name:'Third'}});});f.approve(f.create());const third=f.repo.read().cars[2].id;f.approve(f.create(third,'car-b'));
 const data=f.repo.read(),epoch=f.repo.state().recoveryId,first=M.mappingPage(data,epoch,{limit:1});assert.equal(first.rows.length,1);const second=M.mappingPage(data,epoch,{limit:1,cursor:first.nextCursor});assert.equal(second.rows.length,1);assert.equal(second.nextCursor,null);assert.notEqual(first.rows[0].id,second.rows[0].id);
 assert.throws(()=>M.mappingPage(data,'restored',{cursor:first.nextCursor}),{code:'SNAPSHOT_CHANGED'});assert.throws(()=>M.mappingPage(data,epoch,{limit:101}),{code:'INVALID_QUERY'});assert.throws(()=>M.mappingPage(data,epoch,{cursor:'garbage'}),{code:'INVALID_QUERY'});
});
test('changing the participant car identity cannot bypass an excluded contribution',t=>{
 const f=fixture(t,f=>T.receive(f.store,f.normal));f.approve(f.save(f.create(),c=>{for(const key of Object.keys(c.history))c.history[key]=false;}));
 const db=f.repo.read(),row=M.contributions(db)[0];row.carId='car-b';assert.equal(M.disposition(db,row,'car-b'),'conflict');row.carId='car-a';row.format='history-v1';assert.equal(M.disposition(db,row,'car-b'),'conflict');
});
test('late history arriving across chained merges needs a decision at each boundary',t=>{
 const f=fixture(t,f=>act(f.store,'car.save',{data:{name:'Third'}}));f.approve(f.create());const third=f.repo.read().cars[2].id;f.approve(f.create(third,'car-b'));
 const temp=new Store();temp.data={...f.repo.read(),schema:11};T.receive(temp,f.normal);f.repo.change(d=>{d.timing=temp.data.timing;});f.send('reconcileHistory');let db=f.repo.read();assert.equal(db.mergeInclusions.length,1);let item=db.mergeInclusions[0];f.send('includeHistory',{id:item.id,expectedRevision:item.revision,include:true});db=f.repo.read();assert.equal(db.mergeInclusions.length,2);assert.equal(M.disposition(db,M.contributions(db)[0],third),'pending');item=db.mergeInclusions.find(i=>i.status==='pending');f.send('includeHistory',{id:item.id,expectedRevision:item.revision,include:false});db=f.repo.read();assert.equal(M.disposition(db,M.contributions(db)[0],third),'excluded');
});
test('service counters retain main baseline while observations rebase to included laps',t=>{
 const f=fixture(t,f=>{T.receive(f.store,f.normal);f.store.data.cars[1].service={revision:1,lifetimeBaseline:100,observedLifetime:0,sinceBaseline:20,observedSince:0,lastServicedAt:null,servicesDone:3};});f.approve(f.create());const db=f.repo.read(),s=db.cars[1].service;assert.equal(s.lifetimeBaseline,100);assert.equal(s.observedLifetime,3);assert.equal(s.sinceBaseline,20);assert.equal(s.observedSince,3);assert.equal(s.servicesDone,3);assert.equal(M.serviceCounts(db,'car-b'),3);
});
test('original-only history is archived and selectable without becoming measured performance',t=>{
 const codec=require('../src/shared-library-evidence.cjs');
 const f=fixture(t,f=>{f.store.data.libraryOrigins=[{id:'raw-origin',entity:'session',projectionStatus:'raw-only',sourceId:'timing-demo',originalId:'old-race',sessionId:'raw-session',carIds:['car-a'],state:'active'}];f.store.data.libraryExtras=[{id:'raw-extra',namespace:'timing.historyOriginals',sourceId:'timing-demo',originalId:'old-race',revision:1,...codec.encode({session:{startedAt:'2026-01-01'},laps:[{carId:'car-a',duration:10},{carId:'car-a',duration:11},{carId:'car-a',virtual:true}]})}];});
 const p=f.create();assert.equal(Object.keys(p.choices.history).length,1);f.approve(p);const db=f.repo.read(),row=M.contributions(db)[0];assert.equal(row.rawOnly,true);assert.equal(row.lapCount,2);assert.equal(M.serviceCounts(db,'car-b'),2);assert.equal(archive(db,'retired').extras.length,1);assert.equal(db.timing.sessions.length,0);
});
test('active jobs must transfer with their plans; completed records may remain archive-only',t=>{
 let job;const f=fixture(t,f=>{job=act(f.store,'job.start',{kind:'general',category:'maintenance',carId:'car-a',name:'Clean motor',notes:'Keep plan'});act(f.store,'work.add',{carId:'car-a',title:'Old repair',type:'maintenance',notes:'Retain original'});});
 const p=f.save(f.create(),c=>{c.records.jobs[job]=false;});assert.throws(()=>f.approve(p),/Transfer this active job/);
 const changed=f.save(p,c=>{c.records.jobs[job]=true;for(const id of Object.keys(c.records.events))c.records.events[id]=false;});f.approve(changed);const db=f.repo.read();assert.equal(db.jobs[0].carId,'car-b');assert.equal(archive(db,'retired').jobs[0].carId,'car-a');assert.ok(db.events.some(e=>e.carId==='car-a'&&e.title==='Old repair'));
});
test('rebuild ancestry blocks merging, independent pending incoming changes also block',t=>{
 const f=fixture(t,f=>act(f.store,'rebuild.start',{carId:'car-a',revision:f.store.data.revision}));assert.throws(()=>f.create(),{code:'MERGE_LINEAGE_CONFLICT'});
 const g=fixture(t),p=g.create();g.repo.change(d=>{const pack=require('../src/store.cjs').makePackage(d,['car-a']);d.submissions.push({id:'pending-car',package:pack,status:'pending',received:new Date().toISOString(),outcomes:{}});});const refreshed=g.send('refresh',{id:p.id,expectedRevision:p.revision});assert.throws(()=>g.approve(refreshed),/Resolve pending incoming changes/);
});
test('malformed selection paths, missing checkboxes and invented command fields are refused',t=>{
 const f=fixture(t),p=f.create();assert.throws(()=>f.save(p,c=>{c.fields['["__proto__","polluted"]']='take';}),/Refresh the fields/);assert.throws(()=>f.save(p,c=>{delete c.fields['["name"]'];}),/Refresh the fields/);assert.equal({}.polluted,undefined);
 assert.throws(()=>f.send('save',{id:p.id,expectedRevision:p.revision,choices:p.choices,invented:true}),{code:'INVALID_COMMAND'});
});
test('PDF assets have a stable archive hash before and after lazy SQLite storage',t=>{
 const f=fixture(t),pdf=Buffer.from('%PDF-1.4\n'+'0'.repeat(1200)).toString('base64');const frozen=A.freeze({document:{data:pdf}},'pdf-archive'),meta={id:'pdf-archive',tree:frozen.tree,digest:frozen.digest};
 const file=path.join(f.dir,'assets.sqlite'),data={id:'asset-test',revision:0,schema:11,mergeChunks:frozen.chunks};S.write(file,S.pack(data),null);const loaded=S.read(file,false,true);assert.deepEqual(A.thaw(meta,loaded.mergeChunks),{document:{data:pdf}});
});

test('transferring an assembly preserves dedicated stock, original snapshots and reservations',t=>{
 let assembly;const f=fixture(t,f=>{const part=act(f.store,'part.save',{data:{name:'Tyres',tracking:'quantity',quantity:4}});assembly=act(f.store,'assembly.create',{name:'Rear axle',components:[{partId:part,quantity:2,field:'rearTyres',position:'Rear'}]});act(f.store,'assembly.install',{id:assembly,carId:'car-a'});act(f.store,'setup.save',{carId:'car-a',name:'Original setup'});});
 const before=f.repo.read(),owned=before.parts.reduce((n,p)=>n+p.quantity,0);f.approve(f.create());const db=f.repo.read();assert.equal(db.assemblies.find(a=>a.id===assembly).carId,'car-b');assert.equal(db.parts.reduce((n,p)=>n+p.quantity,0),owned);assert.deepEqual(archive(db,'retired').setups,before.setups);assert.equal(db.setups[0].carId,'car-b');assert.deepEqual(db.setups[0].installations,before.setups[0].installations);
});
test('returning an assembly does not convert its reserved components to loose spare stock',t=>{
 let assembly;const f=fixture(t,f=>{const part=act(f.store,'part.save',{data:{name:'Tyres',tracking:'quantity',quantity:2}});assembly=act(f.store,'assembly.create',{name:'Rear axle',components:[{partId:part,quantity:2,field:'rearTyres',position:'Rear'}]});act(f.store,'assembly.install',{id:assembly,carId:'car-a'});});f.approve(f.save(f.create(),c=>{c.assemblies[assembly]='return';}));const db=f.repo.read();assert.equal(db.assemblies[0].carId,null);assert.equal(db.parts.reduce((n,p)=>n+w.available(db,p),0),0);assert.equal(w.active(db).length,0);
});
test('same-physical choice cannot deduplicate mismatched quantities or another part record',t=>{
 const f=fixture(t,f=>{for(const [carId,quantity]of [['car-a',2],['car-b',1]]){const part=act(f.store,'part.save',{data:{name:'Same-name tyres',tracking:'quantity',quantity}});act(f.store,'part.install',{carId,partId:part,quantity,field:'rearTyres'});}});
 const before=f.repo.read(),a=before.installations.find(i=>i.carId==='car-a'),b=before.installations.find(i=>i.carId==='car-b'),p=f.save(f.create(),c=>{c.installations[a.id]={action:'same',with:b.id};});assert.throws(()=>f.approve(p),/matching retained installation/);assert.deepEqual(f.repo.read().parts,before.parts);
});
test('an unrelated writer racing the final commit causes atomic failure and can safely retry',t=>{
 const f=fixture(t),p=f.create(),cmd=f.command('approve',{id:p.id,expectedRevision:p.revision},'concurrent');assert.throws(()=>f.repo.command(cmd,{beforeCommit:()=>f.repo.change(d=>{d.settings.name='Other writer';})}),{code:'QUERY_CHANGED'});assert.equal(f.repo.read().mergeMappings.length,0);assert.equal(f.repo.read().mergeArchives.length,0);f.repo.command(cmd);assert.equal(f.repo.read().settings.name,'Other writer');
});
test('large mixed evidence chunks keep media lazy and independently owned',t=>{
 const f=fixture(t),lazy=require('../src/lazy-assets.cjs'),file=path.join(f.dir,'mixed.sqlite'),picture='data:image/png;base64,'+'AAAA'.repeat(10000),pdf=Buffer.from('%PDF-1.4\n'+'0'.repeat(1200)).toString('base64');
 const value={id:'item',notes:'x'.repeat(1100000),picture,document:{data:pdf}},data={...f.store.data,evidence:[value]};S.write(file,S.pack(data),null);const loaded=S.read(file,false,true),reads=lazy.stats().reads,frozen=A.freeze({evidence:loaded.evidence},'mixed-archive'),meta={id:'mixed-archive',tree:frozen.tree,digest:frozen.digest};const recovered=A.thaw(meta,frozen.chunks);assert.equal(lazy.stats().reads,reads);assert.equal(A.digest(recovered),A.digest({evidence:loaded.evidence}));assert.ok(S.pack({id:'mixed',revision:1,mergeChunks:frozen.chunks}).externalAssets.length>=2);
});
test('selected setups preserve their snapshots and archived Timing origins',t=>{
 const f=fixture(t,f=>{act(f.store,'setup.save',{carId:'car-a',name:'Historic setup'});f.store.data.libraryOrigins=[{id:'original-car',entity:'car',sourceId:'timing-demo',originalId:'timing-original-a',carId:'car-a'}];f.store.data.libraryExtras=[{id:'car-extra',namespace:'timing.carExtras',sourceId:'timing-demo',originalId:'timing-original-a',...require('../src/shared-library-evidence.cjs').encode({tyreCompound:'soft',damageFactor:2})}];});const before=f.repo.read();f.approve(f.create());const db=f.repo.read();assert.deepEqual(db.libraryOrigins,before.libraryOrigins);assert.deepEqual(db.libraryExtras,before.libraryExtras);assert.deepEqual(archive(db,'retired').origins,before.libraryOrigins);assert.equal(db.setups[0].carId,'car-b');assert.deepEqual(db.setups[0].technical,before.setups[0].technical);
});
test('a separate process commits then loses its acknowledgement; restart replays without duplicate effects',t=>{
 const f=fixture(t),p=f.create(),cmd=f.command('approve',{id:p.id,expectedRevision:p.revision},'crash-ack'),{spawnSync}=require('node:child_process'),helper=path.join(__dirname,'support/car-merge-child.cjs');
 const args=[helper,f.dir,JSON.stringify(cmd)],options={encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:'merge-qualification-child'}};
 const first=spawnSync(process.execPath,[...args,'lost-ack'],options);assert.equal(first.status,72,first.stderr);const second=spawnSync(process.execPath,args,options);assert.equal(second.status,0,second.stderr);const result=JSON.parse(second.stdout);assert.equal(result.duplicate,true);assert.equal(f.repo.read().mergeMappings.length,1);assert.equal(f.repo.read().mergeArchives.length,2);
});
test('setup jobs and tests cannot be split from their setup; target ownership relinks without changing specifications',t=>{
 let setup,job;const f=fixture(t,f=>{act(f.store,'setup.save',{carId:'car-a',name:'Race setup'});setup=f.store.data.setups[0].id;job=act(f.store,'job.start',{carId:'car-a',setupId:setup});});const before=f.repo.read(),p=f.create();const split=f.save(p,c=>{c.records.setups[setup]=false;});assert.throws(()=>f.approve(split),/must stay together/);
 const all=f.save(split,c=>{c.records.setups[setup]=true;});f.approve(all);const db=f.repo.read();assert.equal(db.jobs.find(j=>j.id===job).target.carId,'car-b');assert.deepEqual(db.jobs.find(j=>j.id===job).target.technical,before.setups[0].technical);assert.deepEqual(archive(db,'retired').jobs,before.jobs);
});
test('withdrawal removes the live contribution while the immutable pre-merge snapshot remains',t=>{
 const f=fixture(t,f=>T.receive(f.store,f.normal));f.approve(f.create());const temp=new Store();temp.data={...f.repo.read(),schema:11};T.receive(temp,f.withdrawal);f.repo.change(d=>{d.timing=temp.data.timing;});const db=f.repo.read();assert.equal(M.serviceCounts(db,'car-b'),0);assert.equal(M.contributions(db).length,0);assert.equal(archive(db,'retired').sessions[0].payload.state,'active');assert.equal(db.mergeInclusions[0].status,'included');
});
test('a 500-car collection preserves all unrelated records and archives only the affected graph',t=>{
 const f=fixture(t,f=>{const base=f.store.data.cars[1];for(let i=2;i<500;i++)f.store.data.cars.push({...structuredClone(base),id:'fixture-car-'+i,name:'Other '+i,privateNotes:'Unrelated private information '+i});});const before=f.repo.read().cars.slice(2);f.approve(f.create());const db=f.repo.read();assert.deepEqual(db.cars.slice(2),before);assert.equal(db.cars.filter(c=>!c.archived).length,499);assert.equal(archive(db,'retired').car.id,'car-a');assert.equal(JSON.stringify(archive(db,'retired')).includes('Unrelated private information'),false);
});
test('old successful car-write receipts remain byte-for-byte stable after merge',t=>{
 const f=fixture(t),R=require('../src/command-receipts.cjs'),cmd={id:'old-save',action:'car.save',databaseId:f.repo.read().id,epoch:f.repo.state().recoveryId,payload:{id:'car-a',name:'Original'}},result={car:{id:'car-a',revision:1,name:'Original'}};
 const {DatabaseSync}=require('node:sqlite'),connection=new DatabaseSync(f.repo.file);try{R.insert(connection,R.receipt(cmd,result));}finally{connection.close();}
 f.approve(f.create());assert.deepEqual(R.lookupFile(f.repo.file,cmd),{result,duplicate:true});
});
test('a backup corrupted after preparation prevents any archive, identity or stock commit',t=>{
 const f=fixture(t),p=f.create();assert.throws(()=>f.approve(p,{afterBackup:()=>{const backup=fs.readdirSync(f.dir).find(n=>n.endsWith('.sfpbackup'));fs.writeFileSync(path.join(f.dir,backup),'broken');}}),{code:'MERGE_BACKUP_FAILED'});assert.equal(f.repo.read().mergeMappings.length,0);assert.equal(f.repo.read().mergeArchives.length,0);
});
