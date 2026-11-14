'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),queries=require('../src/sqlite-query.cjs'),pages=require('../src/page-query.cjs'),demand=require('../src/shopping-demand-query.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-page-perf-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));
 const car=act(s,'car.save',{data:{name:'Car',picture:'data:image/png;base64,AAAA',privateNotes:'Private'}});
 const part=act(s,'part.save',{data:{name:'Motor',maker:'NSR',reference:'6530',category:'Motors & motor parts',partType:'Motor',quantity:6,tracking:'quantity'}});
 act(s,'supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:1,remaining:1,minimum:2,unit:'ml'}});
 act(s,'job.start',{kind:'general',carId:car,name:'Job'});
 s.transact(d=>{for(let i=0;i<150;i++){d.cars.push({...d.cars[0],id:'car-'+i,name:'Car '+i});d.parts.push({...d.parts[0],id:'part-'+i,name:'Motor '+i,reference:'REF-'+i});d.supplies.push({...d.supplies[0],id:'supply-'+i,name:'Oil '+i,remaining:i,archived:i===149});d.jobs.push({...JSON.parse(JSON.stringify(d.jobs[0])),id:'job-'+i,carId:'car-'+i,category:i%2?'tyres':'general',status:i%3?'active':'cancelled',...(i%3?{}:{finished:d.jobs[0].created,actual:JSON.parse(JSON.stringify(d.jobs[0].baseline))})});}});
 return {s,car,part,open:()=>new Store(s.file,{deferred:true})};
}
function cold(store){for(const bucket of ['parts','supplies','jobs','cars','installations','assemblies','buildDrafts','timing.sessions'])assert.ok(!store.deferredState.stats.loadedSections.includes(bucket),bucket+' hydrated');}
test('paged screens leave complete collections cold, including Showroom and rebuild assignments',t=>{
 const {s,car,part,open}=fixture(t);act(s,'part.install',{carId:car,partId:part,quantity:1,position:'Motor'});
 for(const request of [{page:'Showroom',offset:48},{page:'Workshop'},{page:'Workshop',closedJobs:true,jobCategory:'tyres'},{page:'Workshop',toolboxTab:'Workshop supplies',supply:{low:true}},{page:'Parts',partsTab:'Assemblies'},{page:'Build from Scratch',build:{types:['Motor'],partIds:['part-149'],rebuildCarId:car}},{page:'Shopping List'}]){
  const d=open(),result=view(d,request);cold(d);assert.equal(result.timing.sessions.length,0);
  if(request.page==='Build from Scratch'){assert.equal(result.parts.length,41);assert.equal(result._view.available[part],5);assert.equal(result._view.list.total,151);assert.equal(result._view.rebuild.installations[0].partId,part);}
  if(request.page==='Showroom'){assert.equal(result._view.allShowroomChoices.length,151);assert.equal(result._view.allShowroomChoices[0].hasPhoto,true);assert.equal(result._view.allShowroomChoices[0].privateNotes,undefined);}
 }
});
test('catalogue typeahead uses every term, literal text and reference ranking across the entire catalogue',t=>{
 const {s,open}=fixture(t);act(s,'part.save',{data:{name:'A 6530 mention',maker:'NSR',reference:'NOT6530',quantity:0,tracking:'quantity'}});
 const d=open();let v=view(d,{page:'Shopping List',shoppingFinder:{query:'6530',maker:'NSR'}});assert.equal(v._view.shoppingFinder.total,2);assert.equal(v._view.shoppingFinder.items[0].reference,'6530');assert.equal(v.planning.shopping.length,0);cold(d);
 v=view(open(),{page:'Shopping List',shoppingFinder:{query:'REF-149 NSR'}});assert.equal(v._view.shoppingFinder.total,1);assert.equal(v._view.shoppingFinder.items[0].id,'part-149');
 for(const query of ["' OR 1=1",'%','_'])assert.equal(view(open(),{page:'Shopping List',shoppingFinder:{query}})._view.shoppingFinder.total,0);
});
test('assemblies block search and loose build assignments, with exact stock for only displayed parts',t=>{
 const {s,car,part,open}=fixture(t);const id=act(s,'assembly.create',{name:'Assembly',components:[{partId:part,quantity:2,field:'motor',position:'Motor'}]});
 const component=s.data.assemblies[0].components[0].partId;
 for(const fitted of [false,true]){if(fitted)act(s,'assembly.install',{id,carId:car});
  const v=view(open(),{page:'Build from Scratch',build:{query:'no candidates',partIds:[component],assemblyIds:[id]}});assert.equal(v.parts.length,1);assert.equal(v._view.available[component],0);assert.equal(v.assemblies[0].id,id);
  const finder=view(open(),{page:'Shopping List',shoppingFinder:{query:'6530'}});assert.ok(!finder._view.shoppingFinder.items.some(p=>p.id===component));
  const pickerStore=open(),picker=view(pickerStore,{page:'Build from Scratch',build:{query:'no candidates'},editor:{action:'build-assemblies'}});cold(pickerStore);
  assert.equal(picker.parts.length,1);assert.equal(picker.parts[0].id,component);assert.equal(picker.parts[0].name,s.data.parts.find(p=>p.id===component).name);
  assert.equal(require('../renderer/build-model.js').signature(picker.assemblies[0]),require('../renderer/build-model.js').signature(s.data.assemblies[0]));assert.equal(picker._view.available[component],0);
 }
});
test('supply and job SQL pages preserve complete counts, low-stock rules and manifest ordering',t=>{
 const {s,open}=fixture(t),supplies=s.data.supplies,jobs=s.data.jobs;
 let v=view(open(),{page:'Workshop',toolboxTab:'Workshop supplies',supply:{low:true}});assert.deepEqual(v.supplies.map(x=>x.id),supplies.filter(x=>!x.archived&&x.remaining<=x.minimum).map(x=>x.id));
 v=view(open(),{page:'Workshop',toolboxTab:'Workshop supplies',supply:{archived:true}});assert.deepEqual(v.supplies.map(x=>x.id),['supply-149']);
 v=view(open(),{page:'Workshop',jobCategory:'tyres',closedJobs:true,offset:24});const rows=jobs.filter(x=>x.category==='tyres'&&x.status!=='active');assert.equal(v._view.list.total,rows.length);assert.deepEqual(v.jobs.map(x=>x.id),rows.slice(24,48).map(x=>x.id));
});
test('shopping demand cache reuses builds across checklist edits but refreshes stock, external edits and restoration',t=>{
 const {s,part,open}=fixture(t),blank=require('../renderer/build-model.js').blank;
 for(const name of ['First','Second'])act(s,'build.draft.save',{data:{...blank(),name,parts:[{key:'motor',slot:'motor',partId:part,quantity:5,field:'motor',position:'Motor',name:'Motor'}]}});
 const expected=()=>require('../src/shopping-requirements.cjs').conflicts(s.data);
 const run=()=>queries.read(open(),null,r=>{const rows=demand.conflicts(r);return {rows,reads:r.reads};}).value;
 assert.deepEqual(run().rows,expected());const saved=s.snapshot();
 act(s,'planning.shopping.add',{partId:part,quantity:1});assert.deepEqual(run().rows,expected());assert.equal(run().reads,0);
 act(s,'part.save',{id:part,data:{...s.data.parts.find(p=>p.id===part),quantity:20,name:'Renamed'}});assert.deepEqual(run().rows,[]);
 // A restored file may reuse a revision; epoch and source digests still protect cached demand.
 s.replace(saved);assert.deepEqual(run().rows,expected());
 const draft=s.data.buildDrafts[0];act(s,'build.draft.save',{id:draft.id,data:{...JSON.parse(JSON.stringify(draft.data)),parts:[]}});assert.deepEqual(run().rows,expected());
});
test('setup-job demand agrees with the domain model before and after physical changes',t=>{
 const {s,part}=fixture(t),car1='car-149',car2='car-148';
 // Reuse fixture jobs as general work; create two fresh cars for setup jobs.
 for(const name of [car1,car2]){const car=act(s,'car.save',{data:{name:'Setup '+name}});act(s,'part.install',{carId:car,partId:part,quantity:2,field:'motor',position:'Motor'});act(s,'setup.save',{carId:car,name:'Target'});const setup=s.data.setups[0].id;const installed=s.data.installations.find(i=>i.carId===car&&!i.removed);act(s,'part.remove',{id:installed.id,destination:'spares'});const job=act(s,'job.start',{setupId:setup});act(s,'job.shopping',{id:job});}
 const check=()=>assert.deepEqual(queries.read(s,null,r=>demand.conflicts(r)).value,require('../src/shopping-requirements.cjs').conflicts(s.data));check();
 act(s,'part.save',{id:part,data:{...s.data.parts.find(p=>p.id===part),quantity:1}});check();
});
