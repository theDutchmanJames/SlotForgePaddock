'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),lazy=require('../src/lazy-assets.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-deferred-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite')),f=require('./support/timing-fixtures.cjs').fixtures();s.replace(f.store.snapshot());require('../src/timing-integration.cjs').receive(s,f.normal);s.mutate('part.save',{data:{name:'Motor',quantity:5,tracking:'quantity'}});s.mutate('car.save',{id:'car-a',revision:s.data.cars[0].revision,data:{picture:'data:image/png;base64,AAAA'}});return {s,dir};}
test('deferred Overview and car pages leave inventory, history and Timing bodies unloaded',t=>{
 const {s}=fixture(t),opened=new Store(s.file,{deferred:true}),state=opened.deferredState;assert.ok(state);lazy.clearCache();
 const result=view(opened,{page:'Overview'});assert.equal(result._view.stats.cars,2);
 view(opened,{page:'Cars',carId:'car-a',section:'Overview'});view(opened,{page:'Cars'});
 for(const key of ['cars','parts','events','tests','documents','timing'])assert.equal(state.stats.loadedSections.includes(key),false,key);
 assert.equal(lazy.stats().reads,0);assert.ok(state.stats.recordReads<20);assert.equal(opened.data.parts[0].name,'Motor');assert.ok(state.stats.loadedSections.includes('parts'));assert.equal(state.stats.loadedSections.includes('timing'),false);assert.deepEqual(result,view(s,{page:'Overview'}));
});
test('first deferred writes retain unloaded sections, originals and undo',async t=>{
 const {s}=fixture(t),before=s.snapshot(),opened=new Store(s.file,{deferred:true});lazy.clearCache();
 await opened.mutateAsync('car.save',{id:'car-a',revision:before.cars[0].revision,data:{name:'Deferred edit'}},{snapshot:false});assert.ok(opened.deferredState);assert.equal(opened.deferredState.stats.loadedSections.includes('timing.sessions'),false);assert.equal(lazy.stats().reads,0);assert.equal(new Store(s.file).data.cars[0].name,'Deferred edit');assert.deepEqual(opened.previousSnapshot(),before);
 const next=new Store(s.file,{deferred:true});await next.mutateAsync('part.install',{carId:'car-a',partId:s.data.parts[0].id,quantity:1,field:'motor'},{snapshot:false});assert.equal(new Store(s.file).data.installations.filter(i=>!i.removed).length,1);
});
test('corrupted dependency fields block stock writes without changing disk',async t=>{
 const {s}=fixture(t),db=new DatabaseSync(s.file),key=JSON.stringify(['parts','id:'+s.data.parts[0].id]);db.prepare("UPDATE record_fields SET json='-1' WHERE record=? AND path=?").run(key,'["quantity"]');db.close();
 const opened=new Store(s.file,{deferred:true});assert.ok(view(opened,{page:'Overview'}));const bytes=fs.readFileSync(s.file);await assert.rejects(opened.mutateAsync('part.install',{carId:'car-a',partId:s.data.parts[0].id,quantity:1,field:'motor'},{snapshot:false}),/integrity/);assert.deepEqual(fs.readFileSync(s.file),bytes);assert.equal(opened.pendingWrite,null);
});
test('a deferred model never mixes records from a newer on-disk revision',t=>{
 const {s}=fixture(t),opened=new Store(s.file,{deferred:true});s.mutate('settings.save',{name:'Changed elsewhere'});assert.throws(()=>opened.data.parts,e=>e.code==='QUERY_CHANGED');assert.throws(()=>opened.snapshot(),e=>e.code==='QUERY_CHANGED');
});
test('deferred materialization retains scalar and array original-image accessors',t=>{
 const {s}=fixture(t),picture='data:image/png;base64,AAAA';s.transact(d=>{d.futurePicture=picture;d.futurePictures=[picture];});const opened=new Store(s.file,{deferred:true});lazy.clearCache();opened.ensureLoaded();assert.equal(lazy.stats().reads,0);assert.ok(lazy.property(opened.data,'futurePicture'));assert.ok(lazy.property(opened.data.futurePictures,0));assert.equal(opened.data.futurePictures[0],picture);
});
test('media retention does not hydrate a deferred collection and preserves displayed originals',t=>{
 const {s}=fixture(t),opened=new Store(s.file,{deferred:true}),{RendererMedia}=require('../src/media-registry.cjs');let time=0;const media=new RendererMedia({clock:()=>time,grace:1}),page=media.project(view(opened,{page:'Overview'})),image=page.cars.find(c=>c.picture).picture,reads=opened.deferredState.stats.recordReads;time=100;media.retain([opened.data]);assert.ok(media.lookup(image));assert.equal(opened.deferredState.stats.recordReads,reads);assert.equal(opened.deferredState.stats.loadedSections.includes('cars'),false);
});
test('outdated indexes take the fully validated upgrade path',t=>{
 const {s}=fixture(t),db=new DatabaseSync(s.file);db.exec("UPDATE state SET value='6' WHERE key='query_index_version'");db.close();const opened=new Store(s.file,{deferred:true});assert.equal(opened.deferredState,undefined);assert.deepEqual(opened.snapshot(),s.snapshot());assert.ok(new Store(s.file,{deferred:true}).deferredState);
});
test('malformed directories fail at open instead of silently omitting records',t=>{
 const {s}=fixture(t),db=new DatabaseSync(s.file),m=JSON.parse(db.prepare("SELECT value FROM state WHERE key='manifest'").get().value);m.object.find(([key])=>key==='cars')[1].array=[];db.prepare("UPDATE state SET value=? WHERE key='manifest'").run(JSON.stringify(m));db.close();assert.throws(()=>new Store(s.file,{deferred:true}),/Unreferenced/);
});

test('concurrent first saves serialize while deferred loading yields to the event loop',async t=>{
 const {s}=fixture(t);s.transact(d=>{const seed=d.events[0];d.events=Array.from({length:300},(_,i)=>({...seed,id:'event-'+i}));});const opened=new Store(s.file,{deferred:true});let ticks=0;const timer=setInterval(()=>ticks++,1);t.after(()=>clearInterval(timer));
 const before=s.data.revision;await Promise.all([opened.transactAsync(d=>{d.settings.name='First';}),opened.transactAsync(d=>{assert.equal(d.settings.name,'First');d.settings.name='Second';})]);assert.ok(ticks>1);assert.equal(opened.data.revision,before+2);assert.equal(new Store(s.file).data.settings.name,'Second');assert.equal(opened.pendingWrite,null);
});

test('deferred pending review counts do not load proposal bodies',async t=>{
 const {s,dir}=fixture(t),{Club}=require('../src/club.cjs'),{Network}=require('../src/network.cjs'),net=new Network(s),club=new Club(s,net,dir);t.after(()=>{club.close();net.close();});club.enable('Host','1234',false);await club.propose('car.save',{id:'car-a',revision:s.data.cars[0].revision,data:{name:'Proposed'}},{snapshot:false});
 const opened=new Store(s.file,{deferred:true});assert.equal(opened.pendingClubReviews(),1);assert.equal(view(opened,{page:'Overview'})._view.review.club,1);assert.equal(opened.deferredState.stats.loadedSections.includes('club.proposals'),false);
});

test('deferred Timing and Telemetry readers retain the existing payload contracts',t=>{
 const {s}=fixture(t),opened=new Store(s.file,{deferred:true}),T=require('../src/timing-integration.cjs'),telemetry=require('../src/telemetry-export.cjs'),f=require('./support/timing-fixtures.cjs').fixtures();
 const access={timingResults:true},route=suffix=>new URL('http://localhost/v1/telemetry/results'+suffix),index=telemetry.handleStore(opened,'GET',route(''),access,opened.data.id),session=telemetry.handleStore(opened,'GET',route('/timing-demo/session-normal?snapshot='+index.snapshot),access,opened.data.id);assert.deepEqual(session.payload,f.normal);assert.equal(opened.deferredState.stats.loadedSections.includes('timing.sessions'),false);
 assert.equal(T.profile(opened,'car-a').car.name,s.data.cars[0].name);assert.equal(T.receive(opened,f.normal).duplicate,true);T.receive(opened,f.correction);assert.ok(opened.deferredState);assert.equal(opened.deferredState.stats.loadedSections.includes('timing.sessions'),false);T.receive(opened,f.withdrawal);assert.equal(new Store(s.file).data.timing.sessions[0].payload.state,'withdrawn');
});

test('failed first persistence leaves the committed model and SQLite revision intact',async t=>{
 const {s}=fixture(t),opened=new Store(s.file,{deferred:true}),before=s.snapshot(),db=new DatabaseSync(s.file);db.exec("CREATE TRIGGER fail_first BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'disk failed'); END");db.close();
 await assert.rejects(opened.mutateAsync('car.save',{id:'car-a',revision:before.cars[0].revision,data:{name:'Not saved'}},{snapshot:false}),/disk failed/);assert.deepEqual(opened.snapshot(),before);assert.deepEqual(new Store(s.file).snapshot(),before);assert.equal(opened.pendingWrite,null);
});

test('a deferred host serves Telemetry and accepts Timing corrections over localhost',async t=>{
 const {s}=fixture(t),opened=new Store(s.file,{deferred:true}),{Network}=require('../src/network.cjs'),net=new Network(opened),f=require('./support/timing-fixtures.cjs').fixtures();t.after(()=>net.close());const status=await net.start(),url='http://127.0.0.1:'+status.port,headers={Authorization:'Bearer '+net.timingCode,'X-SlotForge-Database':opened.data.id};
 const index=await fetch(url+'/v1/telemetry/results',{headers});assert.equal(index.status,200);assert.equal(opened.deferredState.stats.loadedSections.includes('timing.sessions'),false);
 const result=await fetch(url+'/v1/timing/sessions',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(f.correction)});assert.equal(result.status,200,await result.text());assert.ok(opened.deferredState);assert.equal(opened.deferredState.stats.loadedSections.includes('timing.sessions'),false);assert.equal(new Store(s.file).data.timing.sessions[0].payload.revision,2);await net.stop();
});

test('an interrupted SQLite writer uses the writable recovery path before deferred opening',t=>{
 const {s}=fixture(t),before=s.snapshot(),child=require('node:child_process').spawnSync(process.execPath,['-e',"const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec(\"PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE records SET json='interrupted';\");process.exit(0);",s.file],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);assert.ok(fs.statSync(s.file+'-journal').size>0);
 const opened=new Store(s.file,{deferred:true});assert.ok(opened.deferredState);assert.equal(opened.deferredState.stats.loadedSections.includes('cars'),false);assert.deepEqual(opened.snapshot(),before);assert.ok(new Store(s.file,{deferred:true}).deferredState);
});

test('Settings sizes are exact without materializing deferred records or originals',t=>{
 const {s}=fixture(t);s.transact(d=>{d.futurePicture='data:image/png;base64,AAAA';d.futurePictures=['data:image/png;base64,AAAA'];d.extension={label:'é漢字😀\n',nested:{list:[1,true,null,'quoted"']}};});const opened=new Store(s.file,{deferred:true}),encoding=require('../src/json-encoding.cjs');lazy.clearCache();const usage=view(opened,{page:'Settings'})._view.storage;
 assert.equal(usage.logicalBytes,encoding.byteLength(s.data));assert.equal(usage.metadataBytes,encoding.metadataByteLength(s.data));assert.equal(lazy.stats().reads,0);assert.equal(opened.deferredState.stats.loadedSections.includes('cars'),false);assert.equal(opened.deferredState.stats.loadedSections.includes('timing'),false);
});
