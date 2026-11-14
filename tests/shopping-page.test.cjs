'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase,makePackage}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),P=require('../src/purchasing.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-shopping2-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));const car=act(s,'car.save',{data:{name:'Club car'}}),part=act(s,'part.save',{data:{name:'Motor',maker:'NSR',reference:'M1',tracking:'quantity',quantity:0}}),supply=act(s,'supply.save',{data:{name:'Oil',maker:'Slot.it',category:'Cleaning & lubrication',kind:'Consumable',quantity:0,remaining:10,minimum:5,unit:'ml'}}),job=act(s,'job.start',{kind:'general',carId:car,name:'Service'});return {s,car,part,supply,job};}
test('free text plans no stock, links explicitly and retains its original description after receipt',t=>{
 const {s,part,job}=fixture(t),item={kind:'free',name:'Special motor',maker:'NSR',reference:'M1'},id=act(s,'planning.shopping.add',{item,quantity:3,jobId:job,url:'https://example.com/motor'});
 assert.equal(s.data.parts.length,1);assert.equal(s.data.parts[0].quantity,0);assert.equal(s.data.planning.shopping[0].partId,'');
 const before=s.snapshot();assert.throws(()=>act(s,'planning.receive',{shoppingId:id,partId:part,quantity:1,confirmed:true}),/not found/);assert.deepEqual(s.snapshot(),before);
 act(s,'planning.shopping.edit',{id,item:{kind:'part',id:part}});act(s,'planning.receive',{shoppingId:id,partId:part,quantity:2,confirmed:true});const line=s.data.planning.shopping[0];assert.deepEqual(line.purchase.originalItem,item);assert.equal(line.jobId,job);assert.equal(line.received,2);assert.equal(s.data.parts[0].quantity,2);assert.equal(s.data.installations.length,0);
 assert.throws(()=>act(s,'planning.shopping.edit',{id,quantity:1}),/received or ordered/);assert.throws(()=>act(s,'planning.shopping.remove',{id}),/history/);
});
test('supply receipt is atomic, counts containers only, persists and blocks deletion of linked supply',t=>{
 const {s,supply}=fixture(t),id=act(s,'planning.shopping.add',{item:{kind:'supply',id:supply},quantity:3}),d=new Store(s.file,{deferred:true});
 d.mutate('planning.receive',{revision:d.data.revision,shoppingId:id,quantity:2,confirmed:true},{snapshot:false});assert.ok(d.deferredState);const saved=new Store(s.file);assert.equal(saved.data.supplies[0].quantity,2);assert.equal(saved.data.supplies[0].remaining,10);assert.equal(saved.data.supplies[0].history.length,1);assert.equal(saved.data.planning.shopping[0].purchase.receipts.length,1);
 assert.throws(()=>d.mutate('supply.delete',{revision:d.data.revision,id:supply},{snapshot:false}),/purchasing history/);
 const before=saved.snapshot();assert.throws(()=>act(saved,'planning.receive',{shoppingId:id,quantity:2,confirmed:true}),/quantity/);assert.deepEqual(saved.snapshot(),before);
});
test('custom lists can be renamed and purchases moved without severing job or build identities',t=>{
 const {s,part,job}=fixture(t),id=act(s,'planning.shopping.add',{partId:part,quantity:1,jobId:job}),sourceList=s.data.planning.shopping[0].purchase.listId,list=act(s,'planning.list.save',{name:'Winter projects'});
 act(s,'planning.shopping.edit',{id,listId:list,supplier:'Shop'});act(s,'planning.list.save',{id:list,name:'Winter rebuilds'});assert.equal(s.data.planning.shopping[0].jobId,job);assert.equal(s.data.planning.shopping[0].purchase.listId,list);assert.equal(s.data.planning.shoppingLists.find(l=>l.id===list).name,'Winter rebuilds');assert.throws(()=>act(s,'planning.list.save',{id:sourceList,name:'Wrong'}),/custom lists/);assert.throws(()=>act(s,'planning.shopping.edit',{id,listId:'missing'}),/list/);
});
test('filters span pages, show complete manufacturer choices and do not load racing history',t=>{
 const {s,part}=fixture(t);act(s,'planning.shopping.add',{partId:part,quantity:2});s.transact(db=>{const line=db.planning.shopping[0];db.planning.shopping=Array.from({length:95},(_,i)=>({...line,id:'line-'+i,supplier:i===94?'Special shop':'Shop',notes:'Item '+i,purchase:JSON.parse(JSON.stringify(line.purchase))}));});
 const d=new Store(s.file,{deferred:true});d.snapshot=()=>{throw Error('No full snapshot');};let result=view(d,{page:'Shopping List'});assert.equal(result.planning.shopping.length,30);assert.equal(result._view.list.total,95);assert.deepEqual(result._view.shopping.makers,['NSR']);assert.ok(result._view.shopping.suppliers.includes('Special shop'));result=view(d,{page:'Shopping List',shopping:{supplier:'special SHOP',maker:'nsr'}});assert.equal(result.planning.shopping[0].id,'line-94');assert.equal(result._view.list.total,1);assert.deepEqual(result.timing.sessions,[]);assert.ok(!d.deferredState.stats.loadedSections.includes('timing.sessions'));
 result=view(d,{page:'Shopping List',offset:90});assert.equal(result.planning.shopping.length,5);
});
test('legacy read projection is non-mutating and editor receives the automatic job list',t=>{
 const {s,part,job}=fixture(t);s.transact(db=>{db.planning.shopping=[{id:'legacy',partId:part,jobId:job,quantity:3,received:0,notes:'',supplier:'',date:'',created:'',updated:''}];});const before=s.snapshot();
 const d=view(s,{page:'Shopping List',editor:{action:'shop-edit',id:'legacy'}});assert.equal(d.planning.shopping[0].purchase.item.id,part);assert.notEqual(d.planning.shopping[0].purchase.listId,'general');assert.deepEqual(s.snapshot(),before);
});
test('unknown filters fail explicitly instead of presenting an incorrect empty list',t=>{
 const {s}=fixture(t);for(const shopping of ['invalid',[],{query:{}},{status:'unknown'},{source:'unknown'}])assert.throws(()=>view(s,{page:'Shopping List',shopping}),{code:'INVALID_QUERY'});
});
test('free/supply editor choices and completed rows remain available outside the active page',t=>{
 const {s,supply}=fixture(t),id=act(s,'planning.shopping.add',{item:{kind:'free',name:'Oil',maker:'',reference:''},quantity:1});let result=view(s,{page:'Shopping List',editor:{action:'shop-receive',id}});assert.equal(result.supplies.length,0);result=view(s,{page:'Shopping List',shoppingFinder:{kind:'supply',query:'Oil'}});assert.ok(result._view.shoppingFinder.items.some(p=>p.id===supply));
 act(s,'planning.shopping.edit',{id,item:{kind:'supply',id:supply}});act(s,'planning.receive',{shoppingId:id,quantity:1,confirmed:true});result=view(s,{page:'Shopping List',shopping:{status:'received'}});assert.equal(result.planning.shopping[0].id,id);assert.equal(result._view.shopping.counts.outstanding,0);assert.equal(result.supplies[0].id,supply);
});
test('invalid inputs and persistence errors roll back free-text and supply purchases',t=>{
 const {s,supply}=fixture(t),free={kind:'free',name:'Gauge',maker:'',reference:''};
 for(const payload of [{item:free,quantity:0},{item:free,quantity:1,url:'javascript:alert(1)'},{item:free,quantity:1,url:'https://user:pass@example.com'},{item:free,quantity:1,date:'2026-02-30'},{item:{kind:'supply',id:'missing'},quantity:1},{item:free,quantity:1,listId:'missing'}]){const before=s.snapshot();assert.throws(()=>act(s,'planning.shopping.add',payload));assert.deepEqual(s.snapshot(),before);}
 const id=act(s,'planning.shopping.add',{item:{kind:'supply',id:supply},quantity:1}),before=s.snapshot();s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'planning.receive',{shoppingId:id,quantity:1,confirmed:true}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('new purchasing metadata survives scoped car edits and backups but stays out of public car exports',t=>{
 const {s,car,supply}=fixture(t);act(s,'planning.shopping.add',{item:{kind:'supply',id:supply},quantity:2,notes:'Private purchase'});act(s,'planning.shopping.add',{item:{kind:'free',name:'Private tool',maker:'',reference:''},quantity:1});const planning=structuredClone(s.data.planning),d=new Store(s.file,{deferred:true});d.mutate('car.save',{id:car,revision:s.data.cars[0].revision,data:{technical:{motor:'New motor'}}},{snapshot:false});assert.deepEqual(new Store(s.file).data.planning,planning);assert.ok(!JSON.stringify(makePackage(s.data,[car])).includes('Private purchase'));assert.doesNotThrow(()=>validateDatabase(s.snapshot()));
});
test('individual stock cannot be overbooked by linking or editing another purchase',t=>{
 const {s}=fixture(t),part=act(s,'part.save',{data:{name:'Unique',tracking:'individual',quantity:0}}),id=act(s,'planning.shopping.add',{partId:part,quantity:1}),free=act(s,'planning.shopping.add',{item:{kind:'free',name:'Second one',maker:'',reference:''},quantity:1});assert.throws(()=>act(s,'planning.shopping.edit',{id:free,item:{kind:'part',id:part}}),/individually tracked/);assert.throws(()=>act(s,'planning.shopping.edit',{id,quantity:2}),/individually tracked/);assert.equal(P.counts(s.data.planning.shopping[0]).toBuy,1);
});
