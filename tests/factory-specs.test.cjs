'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const M=require('../renderer/factory-specs-model.js'),{Store}=require('../src/store.cjs');
const labels={motor:'Motor',gear:'Gear',rearTyres:'Rear tyres',weight:'Weight',technicalNotes:'Technical notes'};
test('Factory comparison selects empty fields, keeps modified values opt-in and ignores empty/equal values',()=>{
 const car={id:'c',factory:{motor:'Stock',gear:'27',rearTyres:' ',weight:'0',technicalNotes:'Source notes',unsupported:'x'},technical:{motor:'Upgrade',gear:'27'}};
 const rows=M.preview(car,labels);assert.deepEqual(rows.map(r=>[r.field,r.selected]),[['motor',false],['weight',true],['technicalNotes',true]]);
 assert.deepEqual(M.patch(rows,['weight']),{data:{technical:{weight:'0'}}});
 assert.throws(()=>M.patch(rows,[]),/Select/);assert.throws(()=>M.patch(rows,['unsupported']),/Invalid/);
 assert.deepEqual(M.preview({id:'c'},labels),[]);
});
test('active fitted conflicts require individual selection; matching parts and removed/unrelated installations do not return',()=>{
 const car={id:'c',factory:{motor:'Factory motor'},technical:{}};
 const installations=[{carId:'c',field:'motor',partId:'p',quantity:2,assemblyId:'a'},{carId:'other',field:'motor',partId:'p',quantity:1},{carId:'c',field:'motor',partId:'p',quantity:1,removed:'yesterday'}];
 const rows=M.preview(car,labels,installations,[{id:'p',name:'Upgrade'}]);assert.equal(rows[0].selected,false);assert.deepEqual(rows[0].returns,[{name:'Upgrade',quantity:2,assembly:true}]);assert.deepEqual(M.patch(rows,['motor']).stockOverrides,['motor']);
 assert.deepEqual(M.preview(car,labels,installations,[{id:'p',name:'Factory motor'}])[0].returns,[]);
});
for(const wishlist of [false,true])test(`selective Factory save persists and preserves original Factory data and other fields; wishlist=${wishlist}`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-factory-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'database.sqlite'));
 const id=s.mutate('car.save',{data:{name:'Factory test',...(wishlist?{collectionStatus:'wishlist'}:{}),factory:{motor:'Original',gear:'27',weight:'80'},technical:{motor:'Modified',gear:'25'}}}).result;
 if(!wishlist){s.mutate('setup.save',{carId:id,name:'Saved configuration'});s.mutate('test.add',{carId:id,track:'Track',best:'7.1'});}
 const before=s.snapshot(),car=before.cars.find(c=>c.id===id),rows=M.preview(car,labels),deferred=new Store(s.file,{deferred:true});
 await deferred.mutateAsync('car.save',{id,revision:car.revision,...M.patch(rows,['gear','weight'])},{snapshot:false});
 const after=new Store(s.file).snapshot(),updated=after.cars.find(c=>c.id===id);assert.equal(updated.technical.gear,'27');assert.equal(updated.technical.weight,'80');assert.equal(updated.technical.motor,'Modified');assert.deepEqual(updated.factory,car.factory);assert.equal(updated.collectionStatus,car.collectionStatus);
 assert.deepEqual(after.setups,before.setups);assert.deepEqual(after.tests,before.tests);assert.deepEqual(after.timing,before.timing);assert.deepEqual(after.parts,before.parts);
 await assert.rejects(deferred.mutateAsync('car.save',{id,revision:car.revision,...M.patch(rows,['motor'])},{snapshot:false}),/changed/);assert.deepEqual(new Store(s.file).snapshot(),after);
});
test('Factory replacement returns fitted stock while retaining Factory reference and setup snapshot',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-factory-stock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'database.sqlite'));
 const id=s.mutate('car.save',{data:{name:'Car',factory:{motor:'Factory motor'}}}).result,part=s.mutate('part.save',{data:{name:'Upgrade',quantity:2,tracking:'quantity'}}).result;
 s.mutate('part.install',{carId:id,partId:part,field:'motor',quantity:1});s.mutate('setup.save',{carId:id,name:'Before'});
 const before=s.snapshot(),car=before.cars.find(c=>c.id===id),rows=M.preview(car,labels,before.installations,before.parts),payload={id,revision:car.revision,...M.patch(rows,['motor'])};
 const focused=new Store(s.file,{deferred:true}),context=require('../src/view-query.cjs').view(focused,{page:'Cars',carId:id,section:'Technical & parts',editor:{action:'factory-specs',id}});
 assert.equal(context.cars.length,1);assert.equal(context.parts.length,1);assert.equal(context.installations.length,1);assert.equal(context.setups.length,0);
 assert.deepEqual(M.preview(context.cars[0],labels,context.installations,context.parts),rows);
 await new Store(s.file,{deferred:true}).mutateAsync('car.save',payload,{snapshot:false});const after=new Store(s.file).snapshot();
 assert.equal(after.cars[0].technical.motor,'Factory motor');assert.deepEqual(after.cars[0].factory,car.factory);assert.deepEqual(after.setups,before.setups);assert.equal(after.installations.filter(i=>!i.removed).length,0);assert.equal(after.parts.find(p=>p.location==='Used spares').quantity,1);assert.equal(after.parts.reduce((n,p)=>n+p.quantity,0),2);
});
test('Factory dialog escapes text, requires consent, saves only selected fields and rejects a stale review',async()=>{
 let dialog,write,stale=false;const car={id:'c',name:'<Car>',revision:4,factory:{motor:'<Factory>',gear:'27'},technical:{motor:'Upgrade'}};
 const ctx=vm.createContext({FactorySpecs:M,techLabels:labels,db:{cars:[car],installations:[],parts:[]},local:()=>true,slotcarResearchContext:()=>({carId:'c',revision:4}),checkSlotcarResearch:()=>{if(stale)throw Error('changed');},esc:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),ReviewSelection:{toolbar:()=>'<button>Select all</button>'},modal:(title,html,save,action)=>{dialog={title,html,save,action};},change:async(action,p)=>{write={action,p};}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/factory-specs.js'),'utf8'),ctx);ctx.useFactorySpecifications('c');
 assert.match(dialog.html,/&lt;Factory&gt;/);assert.doesNotMatch(dialog.html,/<Factory>/);assert.match(dialog.html,/name="factory-copy-gear" checked/);assert.doesNotMatch(dialog.html,/name="factory-copy-motor" checked/);
 await assert.rejects(dialog.save({'factory-copy-gear':'on'}),/Confirm/);assert.equal(write,undefined);
 await dialog.save({confirmed:'on','factory-copy-gear':'on'});assert.equal(write.action,'car.save');assert.deepEqual(JSON.parse(JSON.stringify(write.p)),{id:'c',revision:4,data:{technical:{gear:'27'}}});
 stale=true;await assert.rejects(dialog.save({confirmed:'on','factory-copy-motor':'on'}),/changed/);
 car.factory={};ctx.useFactorySpecifications('c');assert.equal(dialog.save,null);assert.match(dialog.html,/No Factory specifications/);
});
