const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate,publicCar,PUBLIC_FIELDS,TECH_FIELDS}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
const contract=require('../src/timing-schema.cjs'),timing=require('../src/timing-integration.cjs');
const {fixtures}=require('./support/timing-fixtures.cjs');
function disk(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-catalogue-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function car(store){store.mutate('car.save',{data:{name:'Example'}});return store.data.cars.at(-1).id;}
function edit(store,id,data){const c=store.data.cars.find(c=>c.id===id);store.mutate('car.save',{id,revision:c.revision,data});}

test('older databases initialise the optional counter without mutating the input; malformed counters fail',()=>{
 const old=new Store().snapshot();delete old.catalogueRevision;
 for(const schema of [10,11]){old.schema=schema;assert.equal(migrate(old).catalogueRevision,0);assert.equal(old.catalogueRevision,undefined);}
 for(const value of [null,-1,0.5,Number.MAX_SAFE_INTEGER+1,'1'])assert.throws(()=>migrate({...old,catalogueRevision:value}),/catalogue revision/);
});

test('public edits advance once per transaction; identical saves and private edits do not',()=>{
 const s=new Store(),id=car(s);assert.equal(s.data.catalogueRevision,1);
 for(const data of [{name:'Renamed'},{maker:'Maker',raceClass:'GT3'},{technical:{motor:'21.5k',pinion:'9',gear:'27'}},{usage:['Club racing']},{picture:'data:image/png;base64,iVBORw0KGgo='},{technical:{technicalNotes:'Public collection note'}}]){
  const before=s.data.catalogueRevision;edit(s,id,data);assert.equal(s.data.catalogueRevision,before+1);edit(s,id,data);assert.equal(s.data.catalogueRevision,before+1);
 }
 const before=s.data.catalogueRevision,revision=s.data.revision;
 edit(s,id,{privateNotes:'Private',owner:'Owner',location:'Shelf',availability:'Unavailable'});
 s.mutate('work.add',{carId:id,title:'Inspection',type:'maintenance',notes:'Private work'});
 s.mutate('setup.save',{carId:id,name:'Saved configuration'});
 s.mutate('test.add',{carId:id,track:'Home',laps:'3',best:'5'});
 assert.equal(s.data.catalogueRevision,before);assert.ok(s.data.revision>revision);
});

test('membership, ordering and collection name change the counter; archived-only edits do not',()=>{
 const s=new Store(),id=car(s);car(s);let n=s.data.catalogueRevision;
 s.mutate('car.archive',{id,revision:s.data.cars[0].revision});assert.equal(s.data.catalogueRevision,++n);
 edit(s,id,{name:'Archived edit',technical:{motor:'30k'}});assert.equal(s.data.catalogueRevision,n);
 s.mutate('car.archive',{id,revision:s.data.cars[0].revision});assert.equal(s.data.catalogueRevision,++n);
 s.transact(db=>db.cars.reverse());assert.equal(s.data.catalogueRevision,++n);
 s.mutate('settings.save',{name:'Club collection'});assert.equal(s.data.catalogueRevision,++n);
 s.mutate('settings.save',{theme:'light'});assert.equal(s.data.catalogueRevision,n);
 s.transact(db=>{db.cars=[];db.events=[];});assert.equal(s.data.catalogueRevision,++n);
});

test('inventory changes refresh only when they alter a public car specification',()=>{
 const s=new Store(),id=car(s),n=s.data.catalogueRevision;
 const part=s.mutate('part.save',{data:{name:'Motor',quantity:1,tracking:'quantity'}}).result;
 assert.equal(s.data.catalogueRevision,n);
 s.mutate('part.install',{carId:id,partId:part,quantity:1,field:'motor'});assert.equal(s.data.catalogueRevision,n+1);
 s.mutate('part.save',{id:part,data:{name:'New motor name',quantity:1,tracking:'quantity'}});assert.equal(s.data.catalogueRevision,n+2);
});

test('capture keys and Timing delivery, corrections and withdrawal leave the catalogue unchanged',()=>{
 const f=fixtures(),n=f.store.data.catalogueRevision,revision=f.store.data.revision;
 f.store.transact(db=>db.timing.key=null);timing.profile(f.store,'car-a');assert.equal(f.store.data.catalogueRevision,n);
 // Use the original signing key for the historical artificial captures.
 f.store.transact(db=>db.timing.key='1'.repeat(64));
 for(const p of [f.normal,f.normal,f.correction,f.withdrawal]){timing.receive(f.store,p);assert.equal(f.store.data.catalogueRevision,n);}
 assert.ok(f.store.data.revision>revision);
});

test('counter persists across restarts and a failed disk save leaves both revisions unchanged',t=>{
 const s=new Store(path.join(disk(t),'database.json')),id=car(s);edit(s,id,{name:'Persisted'});
 assert.equal(new Store(s.file).data.catalogueRevision,2);const before=s.snapshot();
 s.persist=()=>{throw Error('disk full');};assert.throws(()=>edit(s,id,{name:'Not saved'}),/disk full/);assert.deepEqual(s.data,before);
 assert.equal(new Store(s.file).data.catalogueRevision,2);
});

test('same-database restore cannot reuse an older public revision; replica replacement preserves authority counter',()=>{
 const s=new Store(),id=car(s),old=s.snapshot();edit(s,id,{name:'Newer'});assert.equal(s.data.catalogueRevision,2);
 s.restore(old,s.data.revision);assert.equal(s.data.catalogueRevision,3);assert.equal(s.data.cars[0].name,'Example');
 s.restore(s.snapshot(),s.data.revision);assert.equal(s.data.catalogueRevision,3);
 const replica=new Store();replica.replace(s.snapshot());assert.equal(replica.data.catalogueRevision,3);
 const other=new Store().snapshot();s.restore(other,s.data.revision);assert.equal(s.data.id,other.id);assert.equal(s.data.catalogueRevision,0);
});

test('safe-integer exhaustion rejects a public edit atomically but permits private work',()=>{
 const s=new Store(),id=car(s);s.data.catalogueRevision=Number.MAX_SAFE_INTEGER;const before=s.snapshot();
 assert.throws(()=>edit(s,id,{name:'Overflow'}),/revision limit/);assert.deepEqual(s.data,before);
 edit(s,id,{privateNotes:'Still safe'});assert.equal(s.data.catalogueRevision,Number.MAX_SAFE_INTEGER);
});

test('review queue and rejections are quiet; approving public changes advances exactly once',async t=>{
 const dir=disk(t),s=new Store(path.join(dir,'database.json')),id=car(s),net=new Network(s),club=new Club(s,net,dir);t.after(()=>{club.close();net.close();});
 const n=s.data.catalogueRevision;club.enable('Club');assert.equal(s.data.catalogueRevision,n);
 async function propose(data,decision){await club.mutate('car.save',{id,revision:s.data.cars[0].revision,data});assert.equal(s.data.catalogueRevision,expected);const q=s.data.club.proposals[0],p=club.preview(q.id);club.review({id:q.id,token:p.token,decision});}
 let expected=n;await propose({name:'Rejected'},'reject');assert.equal(s.data.catalogueRevision,expected);
 await propose({privateNotes:'Approved private note'},'accept');assert.equal(s.data.catalogueRevision,expected);
 await propose({name:'Approved public name'},'accept');assert.equal(s.data.catalogueRevision,++expected);
});

test('HTTP status, legacy collection and every page expose one counter; pagination still guards private changes',async t=>{
 const s=new Store();for(let i=0;i<26;i++)car(s);const net=new Network(s);await net.start();t.after(async()=>{await net.stop();net.close();});
 const get=async(route,paged=false)=>{const r=await fetch('http://127.0.0.1:'+net.port+route,{headers:{Authorization:'Bearer '+net.browseCode,...(paged?{'X-SlotForge-Pages':'1'}:{})}});return {status:r.status,body:await r.json()};};
 const n=s.data.catalogueRevision,status=(await get('/v1/status')).body;contract.validate(status,contract.schema.$defs.status);
 const legacy=(await get('/v1/collection')).body;contract.validate(legacy,contract.schema.$defs.collection);assert.equal(legacy.catalogueRevision,n);
 const first=(await get('/v1/collection',true)).body;assert.equal(first.nextOffset,25);
 const next=p=>'/v1/collection?offset='+p.nextOffset+'&revision='+p.revision+'&database='+p.id;
 const second=(await get(next(first),true)).body;assert.equal(second.catalogueRevision,n);assert.equal(second.nextOffset,null);contract.validate(second,contract.schema.$defs.collection);
 edit(s,s.data.cars[0].id,{privateNotes:'Changed during paging'});assert.equal(s.data.catalogueRevision,n);assert.equal((await get(next(first),true)).status,409);
 const retry=(await get('/v1/collection',true)).body;assert.equal(retry.catalogueRevision,n);assert.equal((await get(next(retry),true)).status,200);
 edit(s,s.data.cars[0].id,{name:'Public edit'});assert.equal((await get(next(retry),true)).status,409);assert.equal((await get('/v1/status')).body.catalogueRevision,n+1);
 net.controls({access:'browse',password:'catalogue test password'});assert.equal(s.data.catalogueRevision,n+1);
});

test('response schemas allow old responses and all current public fields without weakening request schemas',()=>{
 const c=contract.schema.$defs.catalogueCar;
 assert.deepEqual(Object.keys(c.properties).sort(),['id',...PUBLIC_FIELDS,'technical','picture','usage'].sort());
 assert.deepEqual(Object.keys(c.properties.technical.properties).sort(),[...TECH_FIELDS].sort());
 const f=fixtures();contract.validate(publicCar(f.store.data.cars[0]),c);
 const root=path.join(__dirname,'..','integration-handoff','timing-v1','fixtures');
 const read=n=>JSON.parse(fs.readFileSync(path.join(root,n+'.json')));
 const status=read('status-response');contract.validate(status,contract.schema.$defs.status);
 for(const n of [1,2]){const page=read('collection-page-'+n);contract.validate(page,contract.schema.$defs.collection);assert.equal(page.catalogueRevision,status.catalogueRevision);assert.equal(page.revision,status.revision);delete page.catalogueRevision;contract.validate(page,contract.schema.$defs.collection);}
 delete status.catalogueRevision;contract.validate(status,contract.schema.$defs.status);
 status.capabilities.club=1;status.clubId='example-club';status.permissions.club=false;contract.validate(status,contract.schema.$defs.status);
 for(const value of [-1,null,0.2,'1'])assert.throws(()=>contract.validate({...status,catalogueRevision:value},contract.schema.$defs.status));
 assert.throws(()=>contract.validate({...f.normal,catalogueRevision:1}));
});
