'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate,publicCatalogue,makePackage,validatePackage}=require('../src/store.cjs');
const Q=require('../src/sqlite-query.cjs'),V=require('../src/view-query.cjs'),M=require('../src/car-membership.cjs');
const T=require('../src/timing-integration.cjs'),C=require('../src/shared-car-library.cjs'),API=require('../src/scalable-api.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-wishlist-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.json'));s.persist(s.data);return s;}
const add=(s,data)=>s.mutate('car.save',{data:{name:'Car',...data}}).result;
const car=(s,id)=>Q.read(s,null,r=>r.one('cars',id)).value;
const api=(s,route)=>API.handle(s,'GET',new URL('http://localhost/v1/scalable/'+route),{browse:true,timingResults:true},s.data.id);

test('legacy ownership text and usage labels do not migrate cars to Wishlist',t=>{
 const s=fixture(t);for(const ownership of ['Owned','Wanted','Ordered','Sold'])add(s,{ownership,usage:['Wishlist']});
 const before=s.snapshot(),after=migrate(before);assert.deepEqual(after,before);
 assert.ok(after.cars.every(c=>!Object.hasOwn(c,'collectionStatus')));
 assert.equal(Q.read(s,null,r=>r.summary()).value.cars,4);assert.equal(publicCatalogue(after).cars.length,4);
});

test('Wishlist metadata, pictures and identity survive edits, restart, backup and Dealership snapshots',async t=>{
 let s=fixture(t);const id=add(s,{name:'Desired GT',collectionStatus:'wishlist',maker:'NSR',price:'59.95',currency:'EUR',picture:'data:image/png;base64,AAAA',photos:[{id:'photo',name:'Other view',data:'data:image/png;base64,BBBB'}],technical:{motor:'King'},privateNotes:'Keep this',usage:['Vintage']});
 const before=car(s,id);assert.equal(before.ownership,'Wanted');
 s=await Store.open(s.file);assert.ok(s.deferredState);assert.deepEqual(car(s,id),before);
 s.mutate('car.save',{id,revision:1,data:{model:'GT',ownership:'Ordered'}},{snapshot:false});assert.ok(s.deferredState);
 const updated=car(s,id);assert.equal(updated.collectionStatus,'wishlist');assert.equal(updated.picture,before.picture);assert.deepEqual(updated.photos,before.photos);
 const backup=s.snapshot(),copy=require('../src/club-model.cjs').shared(backup);assert.deepEqual(copy.cars,backup.cars);
 const restored=new Store();restored.restore(backup,0);assert.deepEqual(restored.data.cars,backup.cars);
 assert.equal(Q.read(s,null,r=>r.count('cars',{collectionStatus:'wishlist'})).value,1);
});

test('membership validates strictly and ordinary edits cannot promote or demote cars',async t=>{
 let s=fixture(t);const owned=add(s,{name:'Owned'}),wish=add(s,{name:'Wish',collectionStatus:'wishlist'});
 for(const value of [null,'',false,{},'Wishlist','wanted'])assert.throws(()=>add(s,{collectionStatus:value}),/collection status/);
 for(const deferred of [false,true]){
  if(deferred)s=await Store.open(s.file);
  for(const [id,status] of [[owned,'wishlist'],[wish,'collection']]){const before=s.snapshot();assert.throws(()=>s.mutate('car.save',{id,revision:car(s,id).revision,data:{collectionStatus:status,name:'Must not save'}}),/membership cannot/);assert.deepEqual(s.snapshot(),before);}
 }
 const before=s.snapshot();before.cars[0].collectionStatus='invalid';assert.throws(()=>migrate(before),/collection status/);
});

test('SQL filtering precedes pagination and selection; overview and Showroom exclude wishes',t=>{
 const s=fixture(t),id=add(s,{name:'Seed'});s.transact(db=>{const seed=db.cars[0];db.events=[];db.cars=Array.from({length:240},(_,i)=>({...seed,id:'car-'+i,name:String(i).padStart(3,'0'),collectionStatus:i%2?'wishlist':'collection',favourite:true,usage:[i%2?'Wanted group':'Owned group']}));});
 const first=V.view(s,{page:'Cars'}),second=V.view(s,{page:'Cars',offset:48,token:first._view.token});assert.equal(first._view.list.total,120);assert.equal(first.cars.length,48);assert.equal(second.cars.length,48);assert.ok([...first.cars,...second.cars].every(c=>!M.isWishlist(c)));
 const wishes=V.view(s,{page:'Cars',collectionStatus:'wishlist'});assert.equal(wishes._view.list.total,120);assert.equal(wishes.cars.length,48);assert.ok(wishes.cars.every(M.isWishlist));
 assert.equal(Q.read(s,null,r=>r.count('cars')).value,240);assert.equal(Q.read(s,null,r=>r.summary()).value.cars,120);
 assert.throws(()=>Q.read(s,null,r=>r.list('cars',{collectionStatus:'anything'})),/Invalid collection status/);
 const overview=V.view(s,{page:'Overview'});assert.equal(overview._view.stats.cars,120);assert.ok(overview.cars.every(c=>!M.isWishlist(c)));
 const showroom=V.view(s,{page:'Showroom',showroom:{cover:{mode:'fixed',carId:'car-1'},viewerId:'car-3'}});assert.equal(showroom._view.activeCars,120);assert.ok(showroom.cars.every(c=>!M.isWishlist(c)));assert.deepEqual(showroom._view.usage,['Owned group']);
 assert.deepEqual(require('../renderer/showroom-domain.js').cars(s.snapshot()).map(c=>c.id),s.data.cars.filter(M.active).map(c=>c.id));
 const choices=V.view(s,{page:'Workshop',editor:{action:'new-job'}});assert.ok(choices.cars.every(c=>!M.isWishlist(c)));
});

test('Wishlist edits do not advance the public catalogue revision, even archive and duplicate',t=>{
 const s=fixture(t);add(s,{name:'Owned'});const revision=s.data.catalogueRevision,id=add(s,{name:'Wish',collectionStatus:'wishlist'});
 s.mutate('car.save',{id,revision:1,data:{name:'Changed wish'}});assert.equal(s.data.catalogueRevision,revision);
 s.mutate('car.archive',{id,revision:2});s.mutate('car.archive',{id,revision:3});assert.equal(s.data.catalogueRevision,revision);
 const duplicate=s.mutate('car.duplicate',{id}).result;assert.equal(car(s,duplicate).collectionStatus,'wishlist');assert.equal(car(s,duplicate).ownership,'Wanted');assert.equal(s.data.catalogueRevision,revision);
});

test('public exports, Timing captures and shared-car editors cannot expose Wishlist as owned',async t=>{
 const s=fixture(t),owned=add(s,{name:'Owned'}),wish=add(s,{name:'Wish',collectionStatus:'wishlist'});
 assert.deepEqual(publicCatalogue(s.data).cars.map(c=>c.id),[owned]);assert.throws(()=>makePackage(s.data,[owned,wish]),/Wishlist/);
 const pack=makePackage(s.data,[owned]);pack.cars[0].collectionStatus='wishlist';assert.throws(()=>validatePackage(pack),/Wishlist/);
 assert.throws(()=>T.profile(s,wish),e=>e.apiCode==='CAR_WISHLIST');assert.throws(()=>C.readCar(s,wish),e=>e.apiCode==='CAR_NOT_FOUND');assert.equal(C.readCar(s,owned).id,owned);
 assert.deepEqual(api(s,'cars').cars.map(c=>c.id),[owned]);
 assert.deepEqual(require('../src/shared-catalogue.cjs').read(s,{installationId:'timing'},{limit:48}).cars.map(c=>c.id),[owned]);
 assert.deepEqual((await require('../src/shared-library-engine.cjs').call(s,{},'catalogue',{})).cars.map(c=>c.id),[owned]);
 await assert.rejects(()=>require('../src/shared-library-engine.cjs').call(s,{},'car',{id:wish}),e=>e.code==='CAR_NOT_FOUND');
 const input={version:1,databaseId:s.data.id,recoveryId:C.schema(s).recoveryId,sourceId:'timing',operationId:'wish-edit',action:'patch',carId:wish,expectedRevision:1,set:{name:'Changed'}};
 assert.throws(()=>C.receive(s,input),e=>e.apiCode==='CAR_NOT_FOUND');assert.equal(car(s,wish).name,'Wish');
 const deferred=await Store.open(s.file),portal=require('../src/portal-store.cjs'),expected={databaseId:s.data.id,recoveryId:C.schema(s).recoveryId};
 assert.deepEqual(portal.read(deferred,{},expected).cars.map(c=>c.id),[owned]);
 assert.throws(()=>portal.read(deferred,{kind:'thumbnail',carId:wish,revision:1},expected),e=>e.code==='CAR_WISHLIST');
});

test('public change feed never advertises a Wishlist invalidation as a raceable car',t=>{
 const s=fixture(t);add(s,{name:'Owned'});const cursor=api(s,'status').cursor,wish=add(s,{name:'Wish',collectionStatus:'wishlist'});
 const changes=api(s,'changes?kind=cars&cursor='+encodeURIComponent(cursor));assert.equal(changes.resetRequired,false);assert.deepEqual(changes.entries,[{carId:wish,operation:'remove'}]);
});

test('physical workflows reject Wishlist cars atomically in eager and deferred stores',async t=>{
 let s=fixture(t);const wish=add(s,{name:'Wish',collectionStatus:'wishlist'}),part=s.mutate('part.save',{data:{name:'Tyres',tracking:'quantity',quantity:4,category:'Tyres'}}).result;
 const assembly=s.mutate('assembly.create',{revision:s.data.revision,name:'Rear axle',components:[{partId:part,quantity:2,field:'rearTyres',position:'Rear'}]}).result;
 s.mutate('setup.save',{carId:wish,name:'Planned specification'});const setup=s.data.setups[0].id;
 for(const deferred of [false,true]){
  if(deferred)s=await Store.open(s.file);
  const actions=[['part.install',{carId:wish,partId:part,quantity:1}],['assembly.install',{id:assembly,carId:wish}],['work.add',{carId:wish,type:'maintenance',title:'Oil'}],['test.add',{carId:wish}],['job.start',{carId:wish,kind:'general',name:'Service'}],['rebuild.start',{carId:wish}],['planning.shelf.save',{name:'Group',carIds:[wish]}],['settings.save',{showroomFeaturedId:wish}]];
  actions.push(['setup.apply',{id:setup}]);
  for(const [action,payload]of actions){const before=s.snapshot();assert.throws(()=>s.mutate(action,{...payload,revision:s.data.revision}),/Wishlist|active car|active collection/);assert.deepEqual(s.snapshot(),before,action+' must not partially commit');}
 }
});

test('merging cannot bypass purchase status; local transfer linking cannot make wishes raceable',t=>{
 const s=fixture(t),owned=add(s,{name:'Owned'}),wish=add(s,{name:'Wish',collectionStatus:'wishlist'}),before=s.snapshot();
 const merge={databaseId:s.data.id,recoveryId:'recovery',sourceId:'test',operationId:'merge',action:'create',payload:{mainCarId:owned,retiredCarId:wish}};
 assert.throws(()=>require('../src/car-merge-model.cjs').prepare(s.data,merge,{recoveryId:'recovery'}),/purchase status/);assert.deepEqual(s.snapshot(),before);
 const sub={localTransfer:{items:[{paddockCarId:wish,action:'link',expectedRevision:1}]}};
 assert.throws(()=>require('../src/local-library-model.cjs').accept(s.data,sub,car(s,wish)),e=>e.apiCode==='TARGET_CHANGED');
});

test('an invalid backup cannot attach installed stock or active jobs to a Wishlist car',t=>{
 const s=fixture(t),owned=add(s,{name:'Owned'}),part=s.mutate('part.save',{data:{name:'Motor',tracking:'quantity',quantity:1,category:'Motor'}}).result;
 s.mutate('part.install',{carId:owned,partId:part,quantity:1});const installed=s.snapshot();installed.cars[0].collectionStatus='wishlist';assert.throws(()=>migrate(installed),/Wishlist/);
 const other=fixture(t),id=add(other,{name:'Owned'});other.mutate('job.start',{revision:other.data.revision,carId:id,kind:'general',name:'Work'});const job=other.snapshot();job.cars[0].collectionStatus='wishlist';assert.throws(()=>migrate(job),/Wishlist/);
});

test('ordinary Wishlist additions use Dealership direct changes and preserve their status',t=>{
 const policy=require('../src/dealership-policy.cjs');assert.equal(policy.requiresReview('car.save',{data:{collectionStatus:'wishlist'}}),false);assert.equal(policy.requiresReview('car.save',{data:{name:'Owned'}}),true);
 const s=fixture(t);add(s,{collectionStatus:'wishlist'});assert.equal(migrate(require('../src/club-model.cjs').shared(s.data)).cars[0].collectionStatus,'wishlist');
});

test('the shared-folder worker sees normal cars but excludes Wishlist additions made by Paddock',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-wishlist-worker-'));let library;
 t.after(async()=>{await library?.close();fs.rmSync(root,{recursive:true,force:true});});
 library=await require('../packages/shared-library/index.cjs').open({application:'SlotForge Timing test',installationId:'timing-test',sharedRoot:root});
 const state=await library.status(),s=await Store.open(state.file),wish=add(s,{name:'Wishlist only',collectionStatus:'wishlist'}),owned=add(s,{name:'Owned and raceable'});
 const page=await library.catalogue();assert.deepEqual(page.cars.map(c=>c.id),[owned]);
 await assert.rejects(library.car(wish),e=>e.code==='CAR_NOT_FOUND');assert.equal((await library.car(owned)).id,owned);
 assert.equal(car(s,wish).name,'Wishlist only');
});
