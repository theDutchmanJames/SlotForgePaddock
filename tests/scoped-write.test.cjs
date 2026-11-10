'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),{fixtures}=require('./support/timing-fixtures.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-scoped-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const f=fixtures(),s=new Store(path.join(dir,'db.sqlite'));s.replace(f.store.snapshot());T.receive(s,f.normal);
 s.mutate('part.save',{data:{name:'Stock motor',quantity:3,tracking:'quantity'}});
 return {dir,s,f,open:()=>new Store(s.file,{deferred:true})};
}
const saved=s=>new Store(s.file).snapshot();
test('a first car edit reads only its car and common definitions, preserving all other records and undo',async t=>{
 const {s,open}=fixture(t),before=s.snapshot(),d=open(),state=d.deferredState;
 await d.mutateAsync('car.save',{id:'car-a',revision:before.cars[0].revision,data:{...before.cars[0],name:'New name'}},{snapshot:false});
 assert.ok(d.deferredState);assert.ok(state.stats.recordReads<16,JSON.stringify(state.stats));
 for(const key of ['cars','parts','events','tests','timing.sessions','documents'])assert.ok(!state.stats.loadedSections.includes(key),key);
 const after=saved(d);assert.equal(after.cars[0].name,'New name');assert.deepEqual(after.cars[1],before.cars[1]);
 assert.deepEqual(after.timing,before.timing);assert.deepEqual(after.parts,before.parts);assert.deepEqual(d.previousSnapshot(),before);
});
test('repeat scoped saves stay deferred, serialize concurrent actions and reject stale car revisions',async t=>{
 const {open}=fixture(t),d=open(),revision=d.data.revision;
 await Promise.all([d.mutateAsync('work.add',{carId:'car-a',type:'maintenance',title:'Oil motor'},{snapshot:false}),d.mutateAsync('settings.save',{name:'Renamed collection'},{snapshot:false})]);
 assert.ok(d.deferredState);assert.equal(d.data.revision,revision+2);assert.equal(saved(d).events[0].title,'Oil motor');assert.equal(saved(d).settings.name,'Renamed collection');
 const car=saved(d).cars[0];await d.mutateAsync('car.save',{id:car.id,revision:car.revision,data:{name:'First'}},{snapshot:false});
 await assert.rejects(d.mutateAsync('car.save',{id:car.id,revision:car.revision,data:{name:'Stale'}},{snapshot:false}),/changed/);assert.equal(saved(d).cars[0].name,'First');
});
test('scoped stock saves enforce usage across cars and preserve history and unrelated sessions',async t=>{
 const {s,open}=fixture(t),partId=s.data.parts[0].id;const d=open(),state=d.deferredState;
 await d.mutateAsync('part.install',{carId:'car-a',partId,quantity:2,field:'motor'},{snapshot:false});
 assert.ok(!state.stats.loadedSections.includes('timing.sessions'));assert.ok(!state.stats.loadedSections.includes('events'));
 const before=saved(d);await assert.rejects(d.mutateAsync('part.install',{carId:'car-b',partId,quantity:2,field:'motor'},{snapshot:false}),/stock|quantity/i);assert.deepEqual(saved(d),before);
 await d.mutateAsync('part.install',{carId:'car-b',partId,quantity:1,field:'motor'},{snapshot:false});assert.equal(saved(d).installations.length,2);
 await assert.rejects(d.mutateAsync('part.delete',{id:partId,revision:d.data.revision},{snapshot:false}),/linked/);
});
test('scoped photo replacement prunes only the affected focus and keeps original media',async t=>{
 const {s,open}=fixture(t),picture='data:image/png;base64,AAAA';
 for(const id of ['car-a','car-b']){s.mutate('car.save',{id,revision:s.data.cars.find(c=>c.id===id).revision,data:{picture}});s.mutate('planning.focus',{revision:s.data.revision,carId:id,photoKey:'main',x:10,y:20});}
 const before=s.snapshot(),d=open();await d.mutateAsync('car.save',{id:'car-a',revision:before.cars[0].revision,data:{picture:'data:image/png;base64,AQID'}},{snapshot:false});
 const after=saved(d);assert.deepEqual(after.planning.focus,before.planning.focus.filter(f=>f.carId==='car-b'));assert.equal(after.cars[1].picture,picture);assert.deepEqual(d.previousSnapshot(),before);
});
test('Timing retries, corrections and withdrawals read only the addressed session',t=>{
 const {s,f,open}=fixture(t),second=structuredClone(f.normal);second.sessionId='another';T.receive(s,second);
 const before=s.snapshot(),d=open(),state=d.deferredState;
 assert.equal(T.receive(d,f.normal).duplicate,true);assert.equal(d.data.revision,before.revision);
 T.receive(d,f.correction);assert.ok(d.deferredState);assert.ok(!state.stats.loadedSections.includes('timing.sessions'));assert.ok(!state.stats.loadedSections.includes('parts'));
 T.receive(d,f.withdrawal);assert.equal(saved(d).timing.sessions[0].payload.state,'withdrawn');assert.deepEqual(saved(d).timing.sessions[1],before.timing.sessions[1]);
 assert.throws(()=>T.receive(d,f.normal),e=>e.apiCode==='STALE_REVISION');
});
test('first configuration capture persists its key without loading cars or inventory into the model',t=>{
 const {s,open}=fixture(t);s.transact(d=>{d.timing={key:null,sessions:[]};});const d=open(),state=d.deferredState,profile=T.profile(d,'car-a');
 assert.ok(profile.configuration.signature);assert.ok(d.deferredState);assert.ok(!state.stats.loadedSections.includes('cars'));assert.ok(!state.stats.loadedSections.includes('parts'));assert.ok(saved(d).timing.key);
});
test('Dealership proposals and approvals remain scoped and commit car and receipt together',async t=>{
 const {s,dir}=fixture(t),{Club}=require('../src/club.cjs'),{Network}=require('../src/network.cjs');
 let net=new Network(s),club=new Club(s,net,dir);club.enable('Host','race',false);club.close();net.close();
 const d=new Store(s.file,{deferred:true});net=new Network(d);club=new Club(d,net,dir);t.after(()=>{club.close();net.close();});const state=d.deferredState;
 const queued=await club.propose('car.save',{id:'car-a',revision:s.data.cars[0].revision,data:{name:'Reviewed name',livery:'Club colours'}},{snapshot:false});assert.equal(queued.queued,true);
 assert.ok(d.deferredState);assert.ok(!state.stats.loadedSections.includes('timing.sessions'));assert.ok(!state.stats.loadedSections.includes('cars'));assert.notEqual(saved(d).cars[0].name,'Reviewed name');
 const q=d.data.club.proposals[0],preview=club.preview(q.id);assert.equal(preview.error,'');
 await club.reviewAsync({id:q.id,token:preview.token,decision:'accept',fields:['name']});
 assert.ok(d.deferredState);const after=saved(d);assert.equal(after.cars[0].name,'Reviewed name');assert.notEqual(after.cars[0].livery,'Club colours');assert.equal(after.club.proposals[0].status,'accepted');assert.equal(after.cars.length,2);assert.equal(after.timing.sessions.length,1);
});
test('metadata limits are checked against the whole stored collection inside the transaction',t=>{
 const {s,open}=fixture(t);s.transact(d=>{d.parts[0].notes='x'.repeat(20000);d.cars[1].privateNotes='y'.repeat(20000);});const d=open(),before=fs.readFileSync(s.file),resources=require('../src/storage-resources.cjs'),check=resources.checkCollectionSize;
 resources.checkCollectionSize=bytes=>{if(bytes>40000)throw Error('synthetic metadata limit');return check(bytes);};
 try{assert.throws(()=>d.mutate('settings.save',{name:'Must not commit'},{snapshot:false}),/synthetic metadata limit/);}finally{resources.checkCollectionSize=check;}
 assert.deepEqual(fs.readFileSync(s.file),before);assert.equal(d.data.revision,s.data.revision);assert.ok(d.deferredState);
});
test('unrelated corruption is preserved, and fails when its record is actually needed',async t=>{
 const {s,open}=fixture(t),db=new DatabaseSync(s.file),key=JSON.stringify(['parts','id:'+s.data.parts[0].id]);db.prepare("UPDATE record_fields SET json='-1' WHERE record=? AND path=?").run(key,'["quantity"]');db.close();
 const d=open();await d.mutateAsync('settings.save',{name:'Allowed independent edit'},{snapshot:false});assert.equal(d.data.settings.name,'Allowed independent edit');assert.throws(()=>d.data.parts,/integrity/);
 await assert.rejects(d.mutateAsync('part.install',{carId:'car-a',partId:s.data.parts[0].id,quantity:1,field:'motor'},{snapshot:false}),/integrity/);
});
test('unknown future fields survive scoped writes including original image accessors',async t=>{
 const {s,open}=fixture(t);s.transact(d=>{d.future={nested:[1,'two']};d.futurePhoto='data:image/png;base64,AAAA';});const d=open();
 await d.mutateAsync('work.add',{carId:'car-a',type:'modification',title:'Test history'},{snapshot:false});const after=saved(d);assert.deepEqual(after.future,{nested:[1,'two']});assert.equal(after.futurePhoto,'data:image/png;base64,AAAA');
});
test('a queued scoped save remains valid if the preceding caller requests a full snapshot',async t=>{
 const {open}=fixture(t),d=open();
 await Promise.all([d.mutateAsync('settings.save',{name:'First'}),d.mutateAsync('settings.save',{name:'Second'},{snapshot:false})]);
 assert.equal(saved(d).settings.name,'Second');assert.equal(d.pendingWrite,null);
});
test('setup jobs, shopping receipts and manual tests retain their dependent records across scoped saves',async t=>{
 const {s,open}=fixture(t),d=open(),partId=s.data.parts[0].id;
 const act=async(action,p={})=>(await d.mutateAsync(action,{revision:d.data.revision,...p},{snapshot:false})).result;
 await act('part.install',{carId:'car-a',partId,quantity:1,field:'motor'});
 await act('setup.save',{carId:'car-a',name:'Target'});const setupId=saved(d).setups[0].id;
 const jobId=await act('job.start',{setupId});
 const shoppingId=await act('planning.shopping.add',{partId,jobId,quantity:2});
 await act('planning.receive',{partId,shoppingId,quantity:1,confirmed:true});
 await act('planning.job.save',{jobId,priority:'High',targetDate:'',waiting:false,checklist:[{text:'Run motor in'}]});
 await act('test.add',{carId:'car-a',track:'Club',lane:'1',laps:'10',best:'4.2',average:'4.8'});
 await assert.rejects(act('job.complete',{id:jobId,confirmed:true}),/checklist/);
 await act('planning.job.check',{jobId,id:saved(d).planning.jobs[0].checklist[0].id,done:true});
 await act('job.complete',{id:jobId,confirmed:true});
 assert.ok(d.deferredState);const after=saved(d);assert.equal(after.parts[0].quantity,4);assert.equal(after.planning.shopping[0].received,1);assert.equal(after.planning.jobs[0].priority,'High');assert.equal(after.tests[0].jobId,jobId);assert.equal(after.jobs[0].status,'completed');assert.equal(after.timing.sessions.length,1);
});
test('incoming selected stock overrides return fitted parts while retaining other specifications',async t=>{
 const {s,open}=fixture(t),partId=s.data.parts[0].id;s.mutate('part.install',{carId:'car-a',partId,quantity:1,field:'motor'});
 const pack=require('../src/store.cjs').makePackage(s.data,['car-a']);pack.cars[0].technical={motor:'Incoming motor',gear:'99'};
 const d=open(),id=(await d.mutateAsync('submission.add',{package:pack},{snapshot:false})).result;
 await d.mutateAsync('submission.review',{id,carId:'car-a',decision:'accept',revision:s.data.cars[0].revision,fields:['technical.motor'],stockOverrides:['motor']},{snapshot:false});
 const after=saved(d);assert.equal(after.cars[0].technical.motor,'Incoming motor');assert.equal(after.cars[0].technical.gear,'27');assert.equal(after.installations.filter(i=>!i.removed).length,0);assert.equal(after.parts.find(p=>p.sourcePartId===partId).quantity,1);assert.equal(after.submissions[0].status,'reviewed');assert.ok(d.deferredState);
});
test('SQL size counters stay exact through media, Unicode, deletion, correction and replacement',async t=>{
 const {s,f,open}=fixture(t),encoding=require('../src/json-encoding.cjs');
 const verify=d=>{const data=saved(d),db=new DatabaseSync(d.file);try{const identity=JSON.stringify([data.id,data.revision]),cache=require('../src/sqlite-sizes.cjs').cached(db,identity),tree=JSON.parse(db.prepare("SELECT value FROM state WHERE key='manifest'").get().value);assert.deepEqual(cache,{logicalBytes:encoding.byteLength(data),metadataBytes:encoding.metadataByteLength(data)});assert.deepEqual(cache,require('../src/deferred-store.cjs').measure(db,tree));}finally{db.close();}};
 verify(s);const d=open();
 await d.mutateAsync('car.save',{id:'car-a',revision:s.data.cars[0].revision,data:{name:'é漢字😀',picture:'data:image/png;base64,AAAA'}},{snapshot:false});verify(d);
 await d.mutateAsync('car.save',{id:'car-a',revision:saved(d).cars[0].revision,data:{picture:''}},{snapshot:false});verify(d);
 T.receive(d,f.correction);verify(d);T.receive(d,f.withdrawal);verify(d);
 await d.mutateAsync('part.delete',{id:s.data.parts[0].id,revision:d.data.revision},{snapshot:false});verify(d);
 const data=saved(d);data.settings.name='Replacement';await d.replaceAsync(data);verify(d);
});
test('missing or stale size counters rebuild from SQL without hydrating the collection',async t=>{
 const {s,open}=fixture(t),db=new DatabaseSync(s.file);db.prepare("UPDATE state SET value=? WHERE key='collection_sizes_v1'").run(JSON.stringify({identity:'outdated',logicalBytes:2,metadataBytes:2}));db.close();
 const d=open(),state=d.deferredState;await d.mutateAsync('settings.save',{name:'Rebuilt'},{snapshot:false});assert.ok(!state.stats.loadedSections.includes('cars'));
 const check=new DatabaseSync(s.file);try{const cache=require('../src/sqlite-sizes.cjs').cached(check,d.expectedIdentity);assert.equal(cache.metadataBytes,require('../src/json-encoding.cjs').metadataByteLength(saved(d)));}finally{check.close();}
});
test('size counters reject an older writer changing epoch or sequence at the same identity',t=>{
 const {s}=fixture(t),db=new DatabaseSync(s.file),sizes=require('../src/sqlite-sizes.cjs');
 try{assert.ok(sizes.cached(db,s.expectedIdentity));db.exec("UPDATE state SET value=CAST(value AS INTEGER)+1 WHERE key='change_sequence'");assert.equal(sizes.cached(db,s.expectedIdentity),null);}finally{db.close();}
});
test('first profile capture cannot silently replace a missing key under existing signed sessions',t=>{
 const {s,open}=fixture(t),data=s.snapshot();data.timing.key=null;
 const sqlite=require('../src/sqlite-storage.cjs');sqlite.write(s.file,sqlite.pack(data),s.expectedIdentity);
 const d=open(),before=fs.readFileSync(s.file);assert.throws(()=>T.profile(d,'car-a'),/signing key/);assert.deepEqual(fs.readFileSync(s.file),before);
});
