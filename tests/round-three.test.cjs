'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),timing=require('../src/timing-integration.cjs'),{fixtures}=require('./support/timing-fixtures.cjs'),backup=require('../src/portable-backup.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
function fileStore(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-round3-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(path.join(dir,'db.sqlite'));}
const part=(s,name,quantity=4)=>act(s,'part.save',{data:{name,quantity,tracking:'quantity'}});
function deletion(s,id){return {id,revision:s.data.revision,confirmed:true,confirmName:s.data.cars.find(c=>c.id===id).name};}
test('permanent car deletion returns loose stock and intact assemblies and removes dependent records after reopen',t=>{
 let s=fileStore(t),id=act(s,'car.save',{data:{name:'Delete me'}}),other=act(s,'car.save',{data:{name:'Keep me'}}),motor=part(s,'Motor'),axle=part(s,'Axle',1);
 act(s,'part.install',{carId:id,partId:motor,quantity:1,field:'motor'});const assembly=act(s,'assembly.create',{name:'Rear axle',components:[{partId:axle,quantity:1,field:'rearAxle',position:'Rear axle'}]});act(s,'assembly.install',{id:assembly,carId:id});
 act(s,'settings.save',{showroomFeaturedId:id});act(s,'setup.save',{carId:id,name:'Before deletion'});const bytes=Buffer.from('%PDF-1.4\n%%EOF');act(s,'guide.add',{title:'Car manual',carId:id,document:{name:'manual.pdf',mime:'application/pdf',size:bytes.length,data:bytes.toString('base64')}});act(s,'guide.add',{title:'General manual',carId:null,document:{name:'general.pdf',mime:'application/pdf',size:bytes.length,data:bytes.toString('base64')}});
 const jobId=act(s,'job.start',{kind:'general',carId:id,name:'Work'});act(s,'planning.job.save',{jobId,priority:'Normal',targetDate:'',waiting:false,checklist:[{text:'Clean'}]});act(s,'planning.shopping.add',{partId:motor,jobId,quantity:1});act(s,'planning.shelf.save',{name:'Shelf',carIds:[id,other]});const before=s.snapshot();s=new Store(s.file,{deferred:true});const p=s.plan('car.delete',{id});assert.equal(p.loosePieces,1);assert.equal(p.assemblies,1);assert.equal(p.counts.documents,1);act(s,'car.delete',deletion(s,id));
 const current=new Store(s.file).snapshot();assert.deepEqual(current.cars.map(c=>c.id),[other]);for(const k of ['events','setups','jobs','tests','installations'])assert.ok(current[k].every(r=>r.carId!==id));assert.equal(current.planning.jobs.length,0);assert.equal(current.planning.shopping.length,1);assert.equal(current.planning.shopping[0].jobId,null);assert.equal(current.documents.length,1);assert.equal(current.documents[0].carId,null);assert.equal(current.settings.showroomFeaturedId,'');assert.deepEqual(current.planning.shelves[0].carIds,[other]);assert.equal(current.assemblies[0].carId,null);assert.equal(current.parts.reduce((n,p)=>n+p.quantity,0),before.parts.reduce((n,p)=>n+p.quantity,0));assert.equal(current.parts.find(p=>p.sourcePartId===motor).condition,'Used');
});
test('car deletion rejects stale/name/confirmation errors and rolls back disk failures',t=>{
 const s=fileStore(t),id=act(s,'car.save',{data:{name:'Exact name'}}),before=s.snapshot();for(const override of [{confirmed:false},{confirmName:'wrong'},{revision:-1},{id:'missing'}]){assert.throws(()=>act(s,'car.delete',{...deletion(s,id),...override}));assert.deepEqual(s.snapshot(),before);}
 const persist=s.persist;s.persist=()=>{throw Error('disk full');};assert.throws(()=>act(s,'car.delete',deletion(s,id)),/disk full/);assert.deepEqual(s.snapshot(),before);s.persist=persist;
});
test('deleting a car preserves multi-car Timing evidence and receipts; fresh results for missing car reject',()=>{
 const f=fixtures(),s=f.store;timing.receive(s,f.normal);const sessions=structuredClone(s.data.timing.sessions);act(s,'car.delete',deletion(s,'car-a'));assert.deepEqual(s.data.timing.sessions,sessions);assert.doesNotThrow(()=>new Store().restore(s.snapshot(),0));assert.throws(()=>timing.profile(s,'car-a'),/does not exist/);assert.equal(timing.receive(s,f.normal).duplicate,true);assert.throws(()=>timing.receive(s,f.correction),/does not exist/);assert.ok(s.data.cars.some(c=>c.id==='car-b'));
});
test('pair comparison uses current specs and recorded snapshots without loading original photos or lap records',t=>{
 const s=fileStore(t),f=fixtures();s.replace(f.store.snapshot());timing.receive(s,f.normal);const id='car-a',c=s.data.cars.find(c=>c.id===id);s.mutate('car.save',{id,revision:c.revision,data:{technical:{motor:'New motor'}}});const data=s.plan('car.compare',{ids:['car-a','car-b']});assert.equal(data.cars[0].technical.motor,'New motor');assert.ok(data.runs.some(r=>r.carId===id&&r.technical.motor==='21.5k'));assert.equal(data.cars[0].privateNotes,undefined);assert.equal(data.runs[0].laps,undefined);assert.throws(()=>s.plan('car.compare',{ids:[id,id]}),/different/);assert.throws(()=>s.plan('car.compare',{ids:[id,'missing']}),/no longer/);
});
function resetContext(store){const club={store,active:false,coordinator:false},network={sending:false,stopped:false,async stop(){this.stopped=true;},disconnect(){},discardSubmission(){}};return {store,club,network,backupJobs:{run:async(_action,source,dest,options)=>backup.exportBackup(source,dest,options)}};}
test('reset creates a recoverable backup and fresh identity and rejects old Timing input',async t=>{
 const s=fileStore(t),f=fixtures();s.replace(f.store.snapshot());timing.receive(s,f.normal);const old=s.snapshot(),ctx=resetContext(s),result=await require('../src/collection-reset.cjs').reset(ctx,{databaseId:old.id,revision:old.revision,confirmation:'RESET'});assert.notEqual(s.data.id,old.id);assert.equal(s.data.cars.length,0);assert.equal(s.data.timing.sessions.length,0);assert.equal(s.data.club,null);assert.ok(ctx.network.stopped);const stage=path.join(path.dirname(s.file),'recovery.sqlite');backup.stageBackup(result.recovery,stage);assert.deepEqual(new Store(stage).snapshot(),old);assert.throws(()=>timing.receive(s,f.normal),/database/i);assert.equal(new Store(s.file).data.id,s.data.id);
});
test('reset refuses replicas, wrong identity, stale confirmation and backup failures without changing data',async t=>{
 const s=fileStore(t);act(s,'car.save',{data:{name:'Keep'}});const old=s.snapshot(),p={databaseId:s.data.id,revision:s.data.revision,confirmation:'RESET'},reset=require('../src/collection-reset.cjs').reset;
 for(const override of [{confirmation:'reset'},{revision:-1},{databaseId:'old'}]){await assert.rejects(reset(resetContext(s),{...p,...override}));assert.deepEqual(s.snapshot(),old);}
 const copy=resetContext(s);copy.club.active=true;await assert.rejects(reset(copy,p),/authoritative/);
 const fail=resetContext(s);fail.backupJobs.run=async()=>{throw Error('disk full');};await assert.rejects(reset(fail,p),/disk full/);assert.deepEqual(s.snapshot(),old);assert.equal(fail.network.stopped,false);
 const stale=resetContext(s);stale.network.stop=async()=>{act(s,'settings.save',{name:'Changed'});};await assert.rejects(reset(stale,p),/changed/);assert.equal(s.data.cars.length,1);
});


test('a permanent deletion retry after restart does not return stock twice',async t=>{
 let s=fileStore(t);const id=act(s,'car.save',{data:{name:'Delete once'}}),pId=part(s,'Tyres',4);act(s,'part.install',{carId:id,partId:pId,quantity:2,field:'rearTyres'});
 const payload=deletion(s,id),epoch=require('../src/sqlite-storage.cjs').syncState(s.file).epoch,options={snapshot:false,commandId:'delete-once',epoch};
 await s.mutateAsync('car.delete',payload,options);const saved=new Store(s.file).snapshot();s=new Store(s.file,{deferred:true});const again=await s.mutateAsync('car.delete',payload,options);assert.equal(again.duplicate,true);assert.deepEqual(new Store(s.file).snapshot(),saved);assert.equal(saved.parts.reduce((n,p)=>n+p.quantity,0),4);
});
