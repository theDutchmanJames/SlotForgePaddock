const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase,TEXT_FIELDS}=require('../src/store.cjs');
const {Writer}=require('../src/sqlite-writer.cjs');
const {EventEmitter}=require('node:events');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-targeted-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'db.json'));const id=store.mutate('car.save',{data:{name:'Target',technical:{motor:'Keep motor'}}}).result;store.mutate('car.save',{data:{name:'Unrelated',picture:'data:image/png;base64,AAAA'}});return {store,id};}
test('targeted text edits share unchanged records internally but return detached snapshots',t=>{
 const {store:s,id}=fixture(t),before=s.data,other=before.cars[1],timing=before.timing;
 const result=s.mutate('car.save',{id,revision:1,data:{livery:'Gulf'}});
 assert.equal(s.data.cars[1],other);assert.equal(s.data.timing,timing);assert.equal(s.data.installations,before.installations);assert.equal(before.cars[0].livery,undefined);
 assert.equal(s.data.cars[0].technical.motor,'Keep motor');assert.equal(s.data.events[0].carId,id);assert.equal(s.data.catalogueRevision,before.catalogueRevision+1);
 result.data.cars[1].name='Changed response';assert.equal(s.data.cars[1].name,'Unrelated');validateDatabase(s.data);assert.deepEqual(new Store(s.file).data,s.data);
});
test('unchanged text edits leave revision, history, database and notifications untouched',t=>{
 const {store:s,id}=fixture(t),before=s.data,bytes=fs.readFileSync(s.file);let calls=0;s.subscribe(()=>calls++);
 s.mutate('car.save',{id,revision:1,data:{name:'Target'}});assert.equal(s.data,before);assert.equal(calls,0);assert.deepEqual(fs.readFileSync(s.file),bytes);
 assert.throws(()=>s.mutate('car.save',{id,revision:0,data:{name:'Target'}}),/changed/);
});
test('private and archived car edits do not advance the public catalogue',t=>{
 const {store:s,id}=fixture(t);let catalogue=s.data.catalogueRevision;
 s.mutate('car.save',{id,revision:1,data:{owner:'Private owner'}});assert.equal(s.data.catalogueRevision,catalogue);
 s.mutate('car.archive',{id,revision:2});catalogue=s.data.catalogueRevision;
 s.mutate('car.save',{id,revision:3,data:{name:'Hidden'}});assert.equal(s.data.catalogueRevision,catalogue);
});
test('targeted failures preserve committed choices, history, recovery and queue state',async t=>{
 const {store:s,id}=fixture(t),before=s.snapshot(),previous=s.previousSnapshot();let notices=0;s.subscribe(()=>notices++);
 const persist=s.persistAsync;s.persistAsync=async()=>{throw Error('injected write failure');};
 await assert.rejects(s.mutateAsync('car.save',{id,revision:1,data:{maker:'New maker'}}),/injected/);
 assert.deepEqual(s.data,before);assert.deepEqual(new Store(s.file).data,before);assert.deepEqual(s.previousSnapshot(),previous);assert.equal(notices,0);assert.equal(s.pendingWrite,null);
 s.persistAsync=persist;await s.mutateAsync('car.save',{id,revision:1,data:{maker:'New maker'}});assert.equal(s.data.cars[0].maker,'New maker');assert.equal(notices,1);
});
test('targeted validation matches fallback restrictions and accepts all textual fields',t=>{
 const {store:s,id}=fixture(t);
 for(const field of TEXT_FIELDS){const before=s.snapshot();assert.throws(()=>s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{[field]:23}}),/text/);assert.deepEqual(s.data,before);s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{[field]:'Value '+field}});validateDatabase(s.data);}
 assert.throws(()=>s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{name:' '}}),/name/);
});
test('ordinary text preparation does not inspect unrelated cars or lap histories',t=>{
 const {store:s,id}=fixture(t),before=s.data;
 const old=s.prepareCarEdit(before,{id,revision:1,data:{livery:'Test'}});assert.ok(old);
 // Preparation uses only IDs to locate the car; it must not serialize other data.
 Object.defineProperty(before.cars[1],'picture',{get(){throw Error('Unrelated photograph was read');},enumerable:true,configurable:true});
 Object.defineProperty(before.timing,'sessions',{get(){throw Error('Unrelated sessions were read');},enumerable:true,configurable:true});
 assert.equal(s.prepareCarEdit(before,{id,revision:1,data:{livery:'Test'}}).data.cars[0].livery,'Test');
});
test('queued application commands recheck the latest car revision',async t=>{
 const {store:s,id}=fixture(t);const a=s.mutateAsync('car.save',{id,revision:1,data:{livery:'First'}}),b=s.mutateAsync('car.save',{id,revision:1,data:{livery:'Second'}});
 await a;await assert.rejects(b,/changed/);assert.equal(new Store(s.file).data.cars[0].livery,'First');
});
test('targeted mixed car changes match the fully validated command implementation',t=>{
 const {store:s,id}=fixture(t),legacy=new Store();legacy.replace(s.snapshot());legacy.prepareCarEdit=()=>null;
 const normalized=db=>{const copy=structuredClone(db);for(const c of copy.cars)c.updated='time';for(const e of copy.events){e.id='event';e.date='time';}return copy;};
 for(const data of [{technical:{motor:'New motor',gear:'27'}},{realHistory:{classification:'Fantasy Livery',history:'Research'}},{custom:{fieldA:'Value'}},{picture:'data:image/png;base64,AABB'},{photos:[{id:'extra',name:'Extra',data:'data:image/png;base64,BBBB'}]},{usage:['Club racing'],tags:['Test']},{archived:true},{archived:false},{name:'After'}]){
  s.mutate('car.save',{id,revision:s.data.cars[0].revision,data});legacy.mutate('car.save',{id,revision:legacy.data.cars[0].revision,data});
  assert.deepEqual(normalized(s.data),normalized(legacy.data));validateDatabase(s.data);
 }
});
test('targeted edits keep stock guards, combined custom limits and photo focus cleanup',t=>{
 const {store:s,id}=fixture(t),part=s.mutate('part.save',{data:{name:'Tracked motor',tracking:'quantity',quantity:1}}).result;s.mutate('part.install',{carId:id,partId:part,quantity:1,field:'motor'});
 assert.throws(()=>s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{technical:{motor:'Bypass'}}}),/installed component/);
 s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{custom:Object.fromEntries(Array.from({length:100},(_,i)=>['field'+i,'value'])),picture:'data:image/png;base64,AAAA'}});
 assert.throws(()=>s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{custom:{overflow:'value'}}}),/100 custom/);
 s.mutate('planning.focus',{revision:s.data.revision,carId:id,photoKey:'main',x:20,y:30});
 s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{picture:'data:image/png;base64,BBBB'}});assert.equal(s.data.planning.focus.length,0);validateDatabase(s.data);
});
test('Dealership no-op creates no proposal and failed approval cannot mutate shared committed state',async t=>{
 const {store:s,id}=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),network=new Network(s),club=new Club(s,network,path.dirname(s.file));t.after(()=>{club.close();network.close();});club.enable('QA dealership','Test password');
 const revision=s.data.revision;assert.equal((await club.mutate('car.save',{id,revision:1,data:{name:'Target'}})).queued,false);assert.equal(s.data.revision,revision);assert.equal(s.data.club.proposals.length,0);
 await club.mutate('car.save',{id,revision:1,data:{livery:'Pending'}});const proposal=s.data.club.proposals[0],before=s.snapshot(),view=club.preview(proposal.id),persist=s.persist;
 s.persist=()=>{throw Error('Review disk failure');};assert.throws(()=>club.review({id:proposal.id,token:view.token,decision:'accept'}),/disk failure/);s.persist=persist;
 assert.deepEqual(s.data,before);assert.deepEqual(new Store(s.file).data,before);assert.equal(s.data.club.proposals[0].status,'pending');
 club.review({id:proposal.id,token:view.token,decision:'accept'});assert.equal(s.data.cars[0].livery,'Pending');assert.equal(s.data.club.proposals[0].status,'accepted');
});
test('worker creation failure rejects work without replaying it later',async()=>{
 let starts=0;const worker=new EventEmitter();worker.ref=()=>{};worker.unref=()=>{};worker.terminate=async()=>{};const writes=[];worker.postMessage=job=>{writes.push(job.file);queueMicrotask(()=>worker.emit('message',{id:job.id,value:{ok:true}}));};
 const writer=new Writer(()=>{if(++starts===1)throw Error('Cannot start worker');return worker;});
 await assert.rejects(writer.write('failed',{},null),/Cannot start/);await writer.write('retry',{},null);assert.deepEqual(writes,['retry']);
});
test('worker failure rejects active and queued tasks; subsequent work starts a new worker',async()=>{
 const workers=[];const writer=new Writer(()=>{const w=new EventEmitter();w.ref=()=>{};w.unref=()=>{};w.terminate=async()=>{};w.postMessage=j=>{w.job=j;};workers.push(w);return w;});
 const a=writer.write('a',{},null),b=writer.write('b',{},null);const result=Promise.allSettled([a,b]);workers[0].emit('error',Error('Worker failed'));assert.ok((await result).every(x=>x.status==='rejected'));
 const c=writer.write('c',{},null);assert.equal(workers.length,2);workers[1].emit('message',{id:workers[1].job.id,value:'saved'});assert.equal(await c,'saved');
});
