'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate}=require('../src/store.cjs'),V=require('../src/view-query.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-wishlist-page-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.json'));s.persist(s.data);return s;}
const add=(s,data)=>s.mutate('car.save',{data:{name:'Car',...data}}).result;
test('Wishlist pages, usage filters and select-all stay scoped beyond one page',t=>{
 const s=fixture(t);add(s,{});s.transact(db=>{const seed=db.cars[0];db.events=[];db.cars=Array.from({length:520},(_,i)=>({...seed,id:'car-'+i,name:String(i).padStart(3,'0'),collectionStatus:i%2?'wishlist':'collection',archived:i>=500,usage:[i%2?'Wish only':'Owned only']}));});
 for(const collectionStatus of ['collection','wishlist']){
  const req={page:'Cars',collectionStatus},first=V.view(s,req),second=V.view(s,{...req,offset:48});
  assert.deepEqual(first._view.carCounts,{collection:250,wishlist:250});assert.equal(first._view.list.total,250);assert.equal(second.cars.length,48);assert.equal(first.cars.some(c=>second.cars.some(d=>d.id===c.id)),false);
  assert.deepEqual(first._view.usage,[collectionStatus==='wishlist'?'Wish only':'Owned only']);
  const selected=V.view(s,{...req,editor:{action:'select-filtered'}});assert.equal(selected.cars.length,250);assert.ok(selected.cars.every(c=>c.collectionStatus===collectionStatus));
  const archived=V.view(s,{...req,archived:true});assert.equal(archived._view.list.total,10);assert.ok(archived.cars.every(c=>c.archived&&c.collectionStatus===collectionStatus));
  const none=V.view(s,{...req,query:'not found'});assert.equal(none._view.list.total,0);assert.equal(none._view.carCounts[collectionStatus],250);
 }
});
test('Wishlist saved views survive scoped writes and restart; legacy views remain normal',async t=>{
 let s=fixture(t);s.mutate('view.save',{name:'Original',query:'',usage:[],matchAll:false,mode:'gallery',sort:'name',archived:false});
 s.transact(db=>{delete db.views[0].collectionStatus;});s=await Store.open(s.file);
 s.mutate('view.save',{name:'Desired models',collectionStatus:'wishlist',query:'GT',usage:['Vintage'],matchAll:true,mode:'table',sort:'maker',sortDirection:'desc',archived:true},{snapshot:false});
 assert.ok(s.deferredState);const after=s.snapshot();assert.equal(after.views[0].collectionStatus,undefined);assert.equal(after.views[1].collectionStatus,'wishlist');
 assert.deepEqual(migrate(after).views,after.views);s=await Store.open(s.file);assert.deepEqual(V.view(s,{page:'Cars'}).views,after.views);
 for(const value of ['invalid',{},true]){const before=s.snapshot();assert.throws(()=>s.mutate('view.save',{name:'Bad',collectionStatus:value}),/collection status/);assert.deepEqual(s.snapshot(),before);}
 const bad=structuredClone(after);bad.views[0].collectionStatus='invalid';assert.throws(()=>migrate(bad),/collection status/);
});
test('Wishlist detail, print and edit contexts retain selected car and full details',t=>{
 const s=fixture(t),owned=add(s,{name:'Owned'}),wish=add(s,{name:'Wish',collectionStatus:'wishlist',price:'69.95',currency:'EUR',reference:'REF-1',technical:{motor:'Planned motor'},picture:'data:image/png;base64,AAAA'});
 for(const action of ['edit-car','reports','save-setup','slotcar-research','car-more']){
  const data=V.view(s,{page:'Cars',carId:wish,collectionStatus:'wishlist',editor:{action,id:wish}}),car=data.cars.find(c=>c.id===wish);
  assert.ok(car,action);assert.equal(car.price,'69.95',action);assert.equal(car.collectionStatus,'wishlist');assert.equal(car.technical.motor,'Planned motor');
 }
 const report=V.view(s,{page:'Cars',collectionStatus:'wishlist',editor:{action:'reports',selected:[]}});assert.deepEqual(report.cars.map(c=>c.id),[wish]);
 assert.equal(V.view(s,{page:'Cars'}).cars[0].id,owned);
});
test('qualified Wishlist interface is enabled for normal app startup',()=>{
 assert.equal(require('../src/wishlist-activation.json').enabled,true);
});
