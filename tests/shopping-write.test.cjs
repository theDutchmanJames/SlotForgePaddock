'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),receipts=require('../src/command-receipts.cjs'),{view}=require('../src/view-query.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-shopping-write-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));
 const car=act(s,'car.save',{data:{name:'Keep this car',picture:'data:image/png;base64,AAAA'}}),part=act(s,'part.save',{data:{name:'Motor',maker:'NSR',reference:'King',tracking:'quantity',quantity:2}}),job=act(s,'job.start',{kind:'general',carId:car,name:'Service'});
 act(s,'planning.shelf.save',{name:'Collection',carIds:[car]});act(s,'planning.focus',{carId:car,photoKey:'main',x:10,y:30});act(s,'planning.job.save',{jobId:job,priority:'High',targetDate:'',waiting:false,checklist:[{text:'Keep this step'}]});
 const line=act(s,'planning.shopping.add',{partId:part,jobId:job,quantity:2});
 s.transact(d=>{const p=d.parts[0];for(let i=0;i<1000;i++)d.parts.push({...p,id:'unrelated-'+i,name:'Other '+i,notes:'Other specifications'});d.planning.futureShoppingOption={preserve:true};});
 return {s,part,job,line,open:()=>new Store(s.file,{deferred:true})};
}
function save(s,action,p={},id=require('node:crypto').randomUUID()){
 const command={id,action,payload:{revision:s.data.revision,...p},databaseId:s.data.id,epoch:s.deferredState.token.epoch};return {command,response:receipts.execute(s,command)};
}
test('checklist-only commits read no catalogue/stock groups and preserve unrelated planning, cars and history',t=>{
 const {s,part,line,open}=fixture(t),before=s.snapshot(),d=open(),state=d.deferredState;
 const {response}=save(d,'planning.shopping.add',{partId:part,quantity:1});
 for(const section of ['parts','supplies','cars','jobs','installations','setups','buildDrafts','planning.jobs','planning.shelves','planning.focus'])assert.ok(!state.stats.loadedSections.includes(section),section);
 assert.ok(state.stats.recordReads<30,JSON.stringify(state.stats));assert.equal(d.lastWrite.recordWrites,2);
 const added=new Store(s.file).snapshot();assert.equal(added.planning.shopping.at(-1).id,response.result);
 for(const key of Object.keys(before))if(!['revision','planning'].includes(key))assert.deepEqual(added[key],before[key],key);
 for(const key of Object.keys(before.planning))if(key!=='shopping')assert.deepEqual(added.planning[key],before.planning[key],key);
 save(d,'planning.checklist.delete',{id:line});save(d,'planning.checklist.restore',{id:line});save(d,'planning.checklist.edit',{id:line,quantity:4,listId:'general'});save(d,'planning.checklist.done',{id:line,done:true});
 const after=new Store(s.file).snapshot();assert.equal(after.parts[0].quantity,2);const l=after.planning.shopping.find(l=>l.id===line);assert.equal(l.purchase.checklist.quantity,4);assert.equal(l.purchase.checklist.done,true);assert.equal(l.jobId,before.planning.shopping[0].jobId);
});
test('narrowed writes retain validation, stale-write rejection, durable retries and rollback',t=>{
 const {s,part,line,open}=fixture(t),d=open(),{command,response}=save(d,'planning.shopping.add',{partId:part,quantity:1});
 assert.deepEqual(receipts.execute(open(),command),{result:response.result,duplicate:true});
 assert.throws(()=>receipts.execute(open(),{...command,id:'stale'}),/changed/);
 for(const [action,p]of [['planning.shopping.add',{partId:'missing',quantity:1}],['planning.shopping.add',{partId:part,quantity:0}],['planning.shopping.add',{partId:part,quantity:1,jobId:'missing'}],['planning.shopping.add',{partId:part,quantity:1,listId:'missing'}],['planning.checklist.edit',{id:line,quantity:1.5}],['planning.checklist.edit',{id:line,listId:'missing'}],['planning.checklist.done',{id:line,done:true,addStock:0}],['planning.checklist.delete',{id:'missing'}]]){
  const before=new Store(s.file).snapshot();assert.throws(()=>save(open(),action,p));assert.deepEqual(new Store(s.file).snapshot(),before);
 }
 const before=new Store(s.file).snapshot(),failed=open();failed.persist=()=>{throw Error('Disk full');};assert.throws(()=>save(failed,'planning.checklist.delete',{id:line}),/Disk full/);assert.deepEqual(new Store(s.file).snapshot(),before);
});
test('legacy purchases upgrade with original job/car names and no loss of other planning data',t=>{
 const {s,line,open}=fixture(t);s.transact(d=>{delete d.planning.purchasingVersion;delete d.planning.shoppingLists;for(const l of d.planning.shopping)delete l.purchase;});
 const before=s.snapshot();save(open(),'planning.checklist.delete',{id:line});const after=new Store(s.file).snapshot();
 assert.equal(after.planning.shoppingLists.find(l=>l.source.kind==='job').name,'Keep this car · Service');assert.deepEqual(after.planning.jobs,before.planning.jobs);assert.deepEqual(after.planning.shelves,before.planning.shelves);assert.deepEqual(after.planning.focus,before.planning.focus);
});
test('shopping page, finder and editor do not hydrate the catalogue and match the complete query',t=>{
 const {s,open}=fixture(t),d=open(),state=d.deferredState;
 for(const request of [{page:'Shopping List',shopping:{status:'all'}},{page:'Shopping List',shoppingFinder:{query:'NSR King',kind:'part'}},{page:'Shopping List',editor:{action:'shop-add'}}]){
  const actual=view(d,request),expected=view(s,request);assert.deepEqual(actual.planning.shopping,expected.planning.shopping);assert.deepEqual(actual._view.shoppingFinder,expected._view.shoppingFinder);
 }
 assert.ok(!state.stats.loadedSections.includes('parts'));assert.ok(!state.stats.loadedSections.includes('supplies'));assert.ok(!state.stats.loadedSections.includes('timing.sessions'));assert.ok(!state.stats.loadedSections.includes('events'));
 assert.ok(state.stats.recordReads<80,JSON.stringify(state.stats));
});
test('individual quantities, supply state and assembly restrictions still apply on the narrowed path',t=>{
 const {s,part,open}=fixture(t),individual=act(s,'part.save',{data:{name:'Unique motor',tracking:'individual',quantity:0}});
 save(open(),'planning.shopping.add',{partId:individual,quantity:1});assert.throws(()=>save(open(),'planning.shopping.add',{partId:individual,quantity:1}),/individually/);
 const id=new Store(s.file).data.planning.shopping.at(-1).id;assert.throws(()=>save(open(),'planning.checklist.edit',{id,quantity:2}),/individually/);
 act(new Store(s.file),'assembly.create',{name:'Motor assembly',components:[{partId:part,quantity:1}]});const reserved=new Store(s.file).data.assemblies[0].components[0].partId;assert.throws(()=>save(open(),'planning.shopping.add',{partId:reserved,quantity:1}),/assembly/);
 const current=new Store(s.file),supply=act(current,'supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:0,remaining:10,minimum:1,unit:'ml'}});
 const supplyLine=save(open(),'planning.shopping.add',{item:{kind:'supply',id:supply},quantity:1}).response.result;save(open(),'planning.checklist.done',{id:supplyLine,done:true});assert.equal(new Store(s.file).data.supplies[0].quantity,0);
});
