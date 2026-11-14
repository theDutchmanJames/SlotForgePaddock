'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),Q=require('../src/sqlite-query.cjs');
const engine=require(process.env.SLOTFORGE_WISHLIST_ENGINE||'../packages/shared-library/index.cjs');
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-wishlist-qualification-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const identity=s=>({databaseId:s.databaseId,recoveryId:s.recoveryId});
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/contracts/shared-racing-history-v1/fixtures',name+'.json')));
const car=(s,id)=>Q.read(s,null,r=>r.one('cars',id)).value;

test('shared worker pages exclude wishes; purchase invalidates snapshots and restore removes cached ownership',async t=>{
 const root=temp(t),h=await engine.open({application:'Timing qualification',installationId:'timing-test',sharedRoot:root,legacyProfiles:[]});t.after(()=>h.close());
 const state=await h.status();assert.equal(state.capabilities.wishlistFiltering,1);
 let s=await Store.open(state.file);s.mutate('car.save',{data:{name:'Seed'}});
 s.transact(db=>{const seed=db.cars[0];db.events=[];db.cars=Array.from({length:105},(_,i)=>({...seed,id:'car-'+i,name:String(i).padStart(3,'0'),...(i%2?{collectionStatus:'wishlist',raceClass:'Wishlist only class'}:{})}));});
 const list=await h.catalogueOverview({limit:48});assert.equal(list.total,53);assert.equal(list.cars.length,48);
 const next=await h.catalogueOverview({limit:48,offset:list.nextOffset,token:list.token});assert.equal(next.cars.length,5);assert.ok([...list.cars,...next.cars].every(c=>Number(c.id.slice(4))%2===0));
 assert.deepEqual((await h.timingRead({kind:'classes'})).rows,[]);
 const checkpoint=s.snapshot(),before=await h.status(),wish='car-1';
 for(const action of ['patch','archive','restore'])await assert.rejects(h.carWrite({...identity(before),operationId:action,action,carId:wish,expectedRevision:1,...(action==='patch'?{set:{name:'Wrong'}}:{})}),e=>e.code==='CAR_NOT_FOUND');
 await assert.rejects(h.profile({carId:wish}),e=>e.code==='CAR_WISHLIST');
 await s.mutateAsync('car.purchase',{id:wish,revision:1,confirmed:true},{snapshot:false});
 const changes=await h.changes({after:before.changeCursor});assert.deepEqual(changes.entries,[{carId:wish,operation:'invalidate'}]);
 assert.deepEqual((await h.timingRead({kind:'classes'})).rows,[{label:'Wishlist only class'}]);assert.equal((await h.car(wish)).id,wish);assert.equal((await h.catalogueOverview({limit:48})).total,54);
 await assert.rejects(h.catalogueOverview({limit:48,offset:list.nextOffset,token:list.token}),e=>e.code==='QUERY_CHANGED');
 const purchasedState=await h.status();await s.restoreAsync(checkpoint,s.data.revision);
 assert.notEqual((await h.status()).recoveryId,purchasedState.recoveryId);assert.equal((await h.changes({after:purchasedState.changeCursor})).resetRequired,true);
 await assert.rejects(h.car(wish),e=>e.code==='CAR_NOT_FOUND');assert.equal((await h.catalogue()).total,53);
 await assert.rejects(h.carWrite({...identity(purchasedState),operationId:'stale-edit',action:'patch',carId:wish,expectedRevision:2,set:{name:'Stale'}}),e=>e.code==='RECOVERY_CHANGED');
 assert.equal(car(await Store.open(state.file),wish).name,'001');
});

test('historical intake remains pending; approval and direct adoption reject Wishlist until purchased',async t=>{
 const root=temp(t);let s=new Store(path.join(root,'db.sqlite'));s.persist(s.data);s=await Store.open(s.file);
 const wish=s.mutate('car.save',{data:{name:'Wish',collectionStatus:'wishlist'}},{snapshot:false}).result;
 const H=require('../src/shared-history.cjs'),I=require('../src/history-imports.cjs'),R=require('../src/rich-history.cjs');
 const state=H.status(s),batch=fixture('historical-import');batch.databaseId=s.data.id;batch.recoveryId=state.recoveryId;
 for(const item of batch.items)for(const p of item.bundle.race.participants){p.carId=wish;p.configuration=null;}
 I.receive(s,batch);const row=s.data.timing.imports[0],approval={databaseId:s.data.id,recoveryId:state.recoveryId,id:row.id,requestHash:row.requestHash,action:'approve',note:'Checked'};
 const before=JSON.parse(JSON.stringify(s.data));assert.throws(()=>R.approveQualified(s,approval),e=>e.code==='CAR_WISHLIST');assert.deepEqual(JSON.parse(JSON.stringify(s.data)),before);
 const input={...identity(state),operationId:'history-adopt',sourceId:'test-source',originalId:'old-session',sessionId:'old-session',bundle:batch.items[0].bundle,rawOriginal:{id:'old-session'}};
 await assert.rejects(require('../src/shared-library-engine.cjs').call(s,{installationId:'Timing',application:'SlotForge Timing'},'adoptSession',input),e=>e.code==='CAR_WISHLIST');assert.deepEqual(JSON.parse(JSON.stringify(s.data)),before);
 s.mutate('car.purchase',{id:wish,revision:1,confirmed:true},{snapshot:false});R.approveQualified(s,approval);assert.equal(s.data.timing.imports[0].status,'approved');assert.equal(s.data.timing.sessions.length,1);
});

test('Wishlist edits and purchases preserve existing Telemetry payloads and snapshot tokens',async t=>{
 const f=require('./support/timing-fixtures.cjs').fixtures(),s=f.store,E=require('../src/telemetry-export.cjs');T.receive(s,f.normal);
 const read=route=>E.handleStore(s,'GET',new URL('http://localhost/v1/telemetry/'+route),{timingResults:true},s.data.id);
 const before=read('results'),detail=read('results/timing-demo/session-normal?snapshot='+before.snapshot),id=s.mutate('car.save',{data:{name:'Private wishlist name',collectionStatus:'wishlist',price:'100'}}).result;
 s.mutate('car.purchase',{id,revision:1,confirmed:true});
 assert.equal(read('results').snapshot,before.snapshot);assert.deepEqual(read('results/timing-demo/session-normal?snapshot='+before.snapshot).payload,detail.payload);
 assert.equal(JSON.stringify(read('results')).includes('Private wishlist name'),false);
 T.receive(s,f.correction);assert.equal(read('results').entries[0].revision,2);T.receive(s,f.withdrawal);assert.equal(read('results').entries[0].state,'withdrawn');
});

const timingRoot=process.env.SLOTFORGE_TIMING_SOURCE,telemetryRoot=process.env.SLOTFORGE_TELEMETRY_SOURCE;
test('local Timing client reads and prepares purchased cars with the candidate bundled engine',{skip:!timingRoot},async t=>{
 const root=temp(t);fs.mkdirSync(path.join(root,'private'));const Database=require(path.join(timingRoot,'db.js')),db=new Database(path.join(root,'private','slotforge-timing.json'));
 db.saveNow();const storage=new(require(path.join(timingRoot,'paddock-storage.js')).JsonPaddockStorage)(db);
 const Client=require(path.join(timingRoot,'shared-library-client.js')).SharedLibraryClient;
 const options={installationId:'timing-qualification',storage,sharedRoot:path.join(root,'shared'),legacyProfiles:[],engine};
 let client=await Client.open(options);t.after(async()=>{await client.close();await db.writesIdle();});
 const state=await client.status(),s=await Store.open(state.file),wish=s.mutate('car.save',{data:{name:'Desired NSR',collectionStatus:'wishlist',reference:'REF-1'}}).result;
 assert.equal((await client.catalogue()).total,0);await assert.rejects(client.editor(wish),e=>e.code==='CAR_NOT_FOUND');await assert.rejects(client.prepare([wish]));
 const installed=require(path.join(timingRoot,'vendor/slotforge-library/index.cjs')),old=await installed.open({application:'Timing bundled audit',installationId:'bundle-audit',sharedRoot:options.sharedRoot,legacyProfiles:[]});
 try{const status=await old.status();t.diagnostic('Existing Timing bundle wishlistFiltering: '+JSON.stringify(status.capabilities.wishlistFiltering??null));if(status.capabilities.wishlistFiltering!==1)t.diagnostic('Existing bundle exposes '+(await old.catalogue()).total+' car(s); replace bundle before activation.');}finally{await old.close();}
 s.mutate('car.purchase',{id:wish,revision:1,confirmed:true});assert.equal((await client.catalogue()).cars[0].id,wish);
 assert.equal((await client.editor(wish)).car.fields.reference,'REF-1');assert.ok(await client.prepare([wish]));
 await client.close();client=await Client.open(options);assert.equal((await client.catalogue()).total,1);assert.equal((await client.car(wish)).id,wish);
});

test('local Telemetry client syncs unchanged history, corrections and withdrawals beside Wishlist',{skip:!telemetryRoot},async t=>{
 const root=temp(t),f=require('./support/timing-fixtures.cjs').fixtures(),host=new(require('../src/network.cjs').Network)(f.store),Client=require(path.join(telemetryRoot,'src/paddock-client.cjs')).PaddockClient;
 const client=new Client(path.join(root,'telemetry-cache.json'));t.after(async()=>{client.disconnect();await host.stop();});
 T.receive(f.store,f.normal);await host.start();await client.connect({address:'http://127.0.0.1:'+host.port,password:host.timingCode});await client.sync();
 const before=structuredClone(client.data.hosts[0].results),wish=f.store.mutate('car.save',{data:{name:'Not a race car yet',collectionStatus:'wishlist'}}).result;
 f.store.mutate('car.purchase',{id:wish,revision:1,confirmed:true});await client.sync();assert.deepEqual(client.data.hosts[0].results,before);
 T.receive(f.store,f.correction);await client.sync();assert.equal(client.data.hosts[0].results[0].payload.revision,2);
 T.receive(f.store,f.withdrawal);await client.sync();assert.equal(client.data.hosts[0].results[0].payload.state,'withdrawn');
});
