'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),query=require('../src/sqlite-query.cjs');
const JobTypes=require('../renderer/job-types.js'),CarSort=require('../renderer/car-sort.js'),UiScale=require('../renderer/ui-scale.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-round-one-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(path.join(dir,'database.json'));}
test('job categories persist across reload, validate edits and preserve physical history',t=>{
 let s=fixture(t);const carId=act(s,'car.save',{data:{name:'Workshop car',technical:{motor:'Original'}}});
 for(const type of JobTypes.types){const id=act(s,'job.start',{kind:'general',carId,name:type.label,notes:'Plan',category:type.id});assert.equal(s.data.jobs[0].category,type.id);act(s,'job.cancel',{id,confirmed:true});}
 const id=act(s,'job.start',{kind:'general',carId,name:'Work',notes:''}),before=s.snapshot();
 act(s,'job.edit',{id,name:'Work',notes:'',category:'motor'});s=new Store(s.file);const job=s.data.jobs.find(j=>j.id===id);
 assert.equal(job.category,'motor');assert.equal(job.log.at(-1).note,'Category: General Work → Motor.');assert.deepEqual(s.data.cars,before.cars);assert.deepEqual(job.baseline,before.jobs[0].baseline);
 for(const category of ['unknown',null,{},'__proto__']){const before=s.snapshot();assert.throws(()=>act(s,'job.edit',{id,name:'Work',notes:'',category}),/category/);assert.deepEqual(s.snapshot(),before);}
 const legacy=s.snapshot();delete legacy.jobs[0].category;assert.equal(JobTypes.get(migrate(legacy).jobs[0].category).id,'general');
});
test('saved-setup categories do not alter target snapshots and filter before pagination',t=>{
 const s=fixture(t),carId=act(s,'car.save',{data:{name:'Setup car'}});act(s,'setup.save',{carId,name:'Race target'});const target=structuredClone(s.data.setups[0]);
 act(s,'job.start',{setupId:target.id,category:'rear-assembly'});assert.deepEqual(s.data.jobs[0].target,target);
 const matching=view(s,{page:'Workshop',jobCategory:'rear-assembly'});assert.equal(matching._view.jobCounts.active,1);assert.equal(matching.jobs[0].category,'rear-assembly');
 assert.equal(view(s,{page:'Workshop',jobCategory:'motor'}).jobs.length,0);assert.throws(()=>view(s,{page:'Workshop',jobCategory:'invalid'}),/category/);
 s.transact(db=>{delete db.jobs[0].category;});assert.equal(view(s,{page:'Workshop',jobCategory:'general'}).jobs.length,1);
});
test('all car sorts are global, stable across pages, blank-last and Unicode aware',t=>{
 let s=fixture(t);act(s,'car.save',{data:{name:'Seed'}});s.transact(db=>{const seed=db.cars[0];db.events=[];db.cars=Array.from({length:123},(_,i)=>({...seed,id:'car-'+String(i).padStart(3,'0'),name:'Car '+i,maker:i%7?'Maker '+(122-i):'',marque:i%4?'Äudi '+(122-i):'äudi '+i,model:i%5?'Model '+(122-i):'',scale:i%2?'1:32':'1:24',reference:'SKU '+String(122-i).padStart(3,'0'),created:new Date(2020,0,i+1).toISOString(),updated:new Date(2021,0,123-i).toISOString()}));});
 s=new Store(s.file);
 for(const sort of Object.keys(CarSort.fields))for(const direction of ['asc','desc']){
  const expected=s.data.cars.slice().sort((a,b)=>CarSort.compare(a,b,sort,direction)).map(c=>c.id),actual=[];
  for(let offset=0;offset<123;offset+=48){const result=query.read(s,null,r=>r.list('cars',{sort,direction,limit:48,offset}));assert.ok(result.recordReads<=48);actual.push(...result.value.rows.map(c=>c.id));}
  assert.deepEqual(actual,expected,sort+' '+direction);
 }
 assert.throws(()=>query.read(s,null,r=>r.list('cars',{sort:'marque',direction:'ASC;DELETE'})),/Invalid/);
 const selected=view(s,{page:'Cars',sort:'reference',sortDirection:'desc',query:'SKU',editor:{action:'select-filtered'}});assert.equal(selected.cars.length,123);assert.equal(new Set(selected.cars.map(c=>c.id)).size,123);
});
test('saved views retain new sort direction and accept older views without it',t=>{
 const s=fixture(t);act(s,'view.save',{name:'Models',sort:'model',sortDirection:'desc'});assert.equal(new Store(s.file).data.views[0].sortDirection,'desc');
 const legacy=s.snapshot();legacy.views[0].sort='updated';delete legacy.views[0].sortDirection;assert.equal(CarSort.direction('updated',migrate(legacy).views[0].sortDirection),'desc');
 legacy.views[0].sortDirection='sideways';assert.throws(()=>migrate(legacy),/saved view/);
});
test('standalone build page has the same stock and drafts as the prior route',t=>{
 const s=fixture(t);act(s,'part.save',{data:{name:'Motor',quantity:2,tracking:'quantity',partType:'Motor',category:'Motors & motor parts'}});
 const build={types:['Motor'],partIds:[],assemblyIds:[]};const next=view(s,{page:'Build from Scratch',build}),previous=view(s,{page:'Parts',partsTab:'Build from Scratch',build});assert.deepEqual(next.parts,previous.parts);assert.deepEqual(next._view.available,previous._view.available);assert.deepEqual(next.buildDrafts,previous.buildDrafts);
});
test('interface sizes accept supported values and recover from invalid stored values',()=>{for(const n of UiScale.levels)assert.equal(UiScale.normalize(String(n)),n);for(const n of [null,undefined,'bad',0,500,101])assert.equal(UiScale.normalize(n),100);});
