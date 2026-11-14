'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,publicCatalogue,makePackage}=require('../src/store.cjs'),Q=require('../src/sqlite-query.cjs'),V=require('../src/view-query.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-purchase-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));s.persist(s.data);return s;}
const add=s=>s.mutate('car.save',{data:{name:'Desired GT',collectionStatus:'wishlist',ownership:'Ordered',price:'70',currency:'EUR',seller:'Original seller',acquired:'2026-10-01',picture:'data:image/png;base64,AAAA',photos:[{id:'photo',name:'Side',data:'data:image/png;base64,BBBB'}],technical:{motor:'King'},factory:{motor:'Original'},privateNotes:'Keep me',usage:['Vintage'],custom:{test:'Value'},realHistory:{history:'Race story'}}}).result;
const get=(s,id)=>Q.read(s,null,r=>r.one('cars',id)).value;
for(const deferred of [false,true])test('purchase preserves identity and unrelated data; eager='+!deferred,async t=>{
 let s=fixture(t),id=add(s);s.mutate('setup.save',{carId:id,name:'Planned configuration'});const before=s.snapshot();if(deferred)s=await Store.open(s.file);
 const c=get(s,id),result=await s.mutateAsync('car.purchase',{id,revision:c.revision,confirmed:true,details:{price:'65.50',currency:'GBP',seller:'Vintage shop',acquired:'2026-11-14'}},{snapshot:false});
 assert.equal(result.result,id);if(deferred)assert.ok(s.deferredState);
 const after=get(s,id);for(const k of Object.keys(c).filter(k=>!['collectionStatus','ownership','price','currency','seller','acquired','updated','revision'].includes(k)))assert.deepEqual(after[k],c[k],k);
 assert.equal(after.revision,c.revision+1);assert.equal(after.collectionStatus,'collection');assert.equal(after.ownership,'Owned');assert.equal(after.price,'65.50');assert.equal(after.acquired,'2026-11-14');assert.equal(s.data.catalogueRevision,before.catalogueRevision+1);
 const snapshot=s.snapshot();assert.deepEqual(snapshot.events.slice(1),before.events);assert.deepEqual(snapshot.setups,before.setups);assert.equal(snapshot.events[0].type,'purchase');assert.equal(snapshot.events[0].performedDate,'2026-11-14');assert.equal(snapshot.events[0].carId,id);
 assert.equal(V.view(s,{page:'Cars',collectionStatus:'wishlist'})._view.list.total,0);assert.equal(V.view(s,{page:'Cars'})._view.list.total,1);assert.equal(V.view(s,{page:'Showroom'})._view.activeCars,1);
 assert.equal(publicCatalogue(snapshot).cars[0].id,id);assert.equal(makePackage(snapshot,[id]).cars[0].id,id);assert.equal(require('../src/shared-car-library.cjs').readCar(s,id).id,id);assert.equal(require('../src/timing-integration.cjs').profile(s,id).car.id,id);
 assert.equal((await require('../src/shared-library-engine.cjs').call(s,{},'catalogue',{})).cars[0].id,id);
 const reopened=await Store.open(s.file);assert.deepEqual(reopened.snapshot(),s.snapshot());
});
test('omitted purchase details preserve recorded values and zero is accepted',t=>{
 const s=fixture(t),id=add(s);s.mutate('car.purchase',{id,revision:get(s,id).revision,confirmed:true});assert.equal(get(s,id).price,'70');assert.equal(get(s,id).acquired,'2026-10-01');
 const zero=add(s);s.mutate('car.purchase',{id:zero,revision:get(s,zero).revision,confirmed:true,details:{price:'0',acquired:''}});assert.equal(get(s,zero).price,'0');assert.equal(get(s,zero).acquired,'');
});
test('invalid, stale, archived and duplicate purchases never partially commit',async t=>{
 let s=fixture(t),id=add(s);s=await Store.open(s.file);
 const base={id,revision:get(s,id).revision,confirmed:true};
 for(const p of [{...base,confirmed:false},{...base,revision:0},{...base,details:{price:'-1'}},{...base,details:{price:'NaN'}},{...base,details:{acquired:'2026-02-30'}},{...base,details:{name:'Hijacked'}},{...base,details:[]}]){const before=s.snapshot();assert.throws(()=>s.mutate('car.purchase',p));assert.deepEqual(s.snapshot(),before);}
 s.mutate('car.archive',{id,revision:get(s,id).revision});let before=s.snapshot();assert.throws(()=>s.mutate('car.purchase',{...base,revision:get(s,id).revision}),/Restore/);assert.deepEqual(s.snapshot(),before);
 s.mutate('car.archive',{id,revision:get(s,id).revision});s.mutate('car.purchase',{...base,revision:get(s,id).revision});before=s.snapshot();assert.throws(()=>s.mutate('car.purchase',{...base,revision:get(s,id).revision}),/no longer/);assert.deepEqual(s.snapshot(),before);
});
test('failed persistence rolls purchase and history back together',t=>{
 const s=fixture(t),id=add(s),before=s.snapshot(),persist=s.persist;s.persist=()=>{throw Error('Disk failure');};
 assert.throws(()=>s.mutate('car.purchase',{id,revision:1,confirmed:true}),/Disk failure/);assert.deepEqual(s.snapshot(),before);s.persist=persist;assert.deepEqual(new Store(s.file).snapshot(),before);
});
test('durable purchase command retries after restart do not duplicate history',async t=>{
 let s=fixture(t),id=add(s),epoch=require('../src/club-sync.cjs').cursor(s).epoch,p={id,revision:1,confirmed:true,details:{price:'45'}},options={snapshot:false,commandId:'purchase-once',databaseId:s.data.id,epoch};
 await s.mutateAsync('car.purchase',p,options);const before=s.snapshot();s=await Store.open(s.file);assert.equal((await s.mutateAsync('car.purchase',p,options)).duplicate,true);assert.deepEqual(s.snapshot(),before);
 await assert.rejects(s.mutateAsync('car.purchase',{...p,details:{price:'46'}},options),/different content/);assert.deepEqual(s.snapshot(),before);
});
test('purchase invalidates public car caches and backup restore rejects uncertain old retries',async t=>{
 const s=fixture(t),id=add(s),backup=s.snapshot(),API=require('../src/scalable-api.cjs');
 const read=route=>API.handle(s,'GET',new URL('http://localhost/v1/scalable/'+route),{browse:true,timingResults:true},s.data.id);
 const cursor=read('status').cursor,epoch=require('../src/club-sync.cjs').cursor(s).epoch,p={id,revision:1,confirmed:true},options={snapshot:false,commandId:'restore-purchase',databaseId:s.data.id,epoch};
 assert.equal(read('cars').cars.length,0);await s.mutateAsync('car.purchase',p,options);
 assert.deepEqual(read('changes?kind=cars&cursor='+encodeURIComponent(cursor)).entries,[{carId:id,operation:'invalidate'}]);assert.equal(read('cars').cars[0].id,id);
 await s.restoreAsync(backup,s.data.revision);assert.notEqual(require('../src/club-sync.cjs').cursor(s).epoch,epoch);const restored=s.snapshot();
 await assert.rejects(s.mutateAsync('car.purchase',p,options));assert.deepEqual(s.snapshot(),restored);assert.equal(get(s,id).collectionStatus,'wishlist');assert.equal(read('cars').cars.length,0);
});

test('legacy JSON upgrade preserves ownership labels and purchases only the selected wish after reopening',async t=>{
 const seed=fixture(t),old=seed.mutate('car.save',{data:{name:'Existing wanted label',ownership:'Wanted',usage:['Wishlist'],price:'30'}}).result;
 const wish=add(seed),original=seed.snapshot(),file=path.join(path.dirname(seed.file),'legacy.json');fs.writeFileSync(file,JSON.stringify(original));
 let s=await Store.open(file);assert.deepEqual(get(s,old),original.cars.find(c=>c.id===old));assert.equal(get(s,old).collectionStatus,undefined);assert.deepEqual(get(s,wish),original.cars.find(c=>c.id===wish));
 await s.mutateAsync('car.purchase',{id:wish,revision:1,confirmed:true},{snapshot:false});s=await Store.open(file);
 assert.deepEqual(get(s,old),original.cars.find(c=>c.id===old));assert.equal(get(s,wish).collectionStatus,'collection');assert.equal(get(s,wish).picture,original.cars.find(c=>c.id===wish).picture);
 assert.equal(s.snapshot().events.filter(e=>e.carId===wish&&e.type==='purchase').length,1);assert.equal(V.view(s,{page:'Cars'})._view.list.total,2);
});

test('independent SQLite writers cannot purchase over a concurrent car edit or create two purchases',async t=>{
 const seed=fixture(t),id=add(seed),first=await Store.open(seed.file);let second=await Store.open(seed.file);
 await first.mutateAsync('car.save',{id,revision:1,data:{price:'81',privateNotes:'Concurrent change'}},{snapshot:false});
 await assert.rejects(second.mutateAsync('car.purchase',{id,revision:1,confirmed:true,details:{price:'70'}},{snapshot:false}),/(car|collection) changed/i);
 assert.equal(get(first,id).price,'81');assert.equal(get(first,id).collectionStatus,'wishlist');
 second=await Store.open(seed.file);const revision=get(first,id).revision;
 const outcomes=await Promise.allSettled([first,second].map(s=>s.mutateAsync('car.purchase',{id,revision,confirmed:true},{snapshot:false})));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
 const reopened=await Store.open(seed.file);assert.equal(get(reopened,id).price,'81');assert.equal(get(reopened,id).privateNotes,'Concurrent change');assert.equal(reopened.snapshot().events.filter(e=>e.carId===id&&e.type==='purchase').length,1);
});

test('pending Dealership purchases survive restart and backup restore without replaying an approval',async t=>{
 const {Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),seed=fixture(t),id=add(seed),folder=path.dirname(seed.file),instances=[];
 const open=store=>{const net=new Network(store),club=new Club(store,net,folder);instances.push({club,net});return club;};
 t.after(async()=>{for(const {club,net}of instances){club.close();await club.idle();net.close();}});
 let club=open(seed);club.enable('Review recovery test','test password');await club.mutate('car.purchase',{id,revision:1,confirmed:true,details:{price:'55'}});
 const pending=seed.snapshot(),proposal=pending.club.proposals[0];club.close();await club.idle();
 const reopened=await Store.open(seed.file);club=open(reopened);assert.equal(club.coordinator,true);assert.equal(V.view(reopened,{page:'Cars',carId:id})._view.wishlistPurchasePending,true);
 let preview=club.preview(proposal.id);club.review({id:proposal.id,token:preview.token,decision:'accept',confirmConflict:true});assert.equal(get(reopened,id).collectionStatus,'collection');
 assert.throws(()=>club.review({id:proposal.id,token:preview.token,decision:'accept',confirmConflict:true}),/already been reviewed/);
 await reopened.restoreAsync(pending,reopened.data.revision);assert.equal(get(reopened,id).collectionStatus,'wishlist');assert.equal(get(reopened,id).price,'70');assert.equal(reopened.snapshot().events.filter(e=>e.type==='purchase').length,0);
 assert.throws(()=>club.review({id:proposal.id,token:preview.token,decision:'accept',confirmConflict:true}),/changed again/);
 preview=club.preview(proposal.id);assert.equal(preview.error,'');club.review({id:proposal.id,token:preview.token,decision:'accept',confirmConflict:true});
 const final=await Store.open(seed.file);assert.equal(get(final,id).price,'55');assert.equal(final.snapshot().events.filter(e=>e.carId===id&&e.type==='purchase').length,1);assert.equal(final.data.club.proposals[0].status,'accepted');
});
