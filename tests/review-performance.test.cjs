'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),M=require('../renderer/build-model.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
const product=(extra={})=>({kind:'part',name:'King motor',manufacturer:'Example Racing',reference:'M-01',category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'Single motor',sourceUrl:'https://example.com/motor',checkedDate:'2026-10-31',reviewNotes:'',specifications:[{name:'RPM',value:'21500',unit:'rpm'}],...extra});
const input=(products=[product()])=>({format:'slotforge-catalogue',version:1,products});
function fixture(t,configure=()=>{}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-reviews-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=new Store(),car=act(s,'car.save',{data:{name:'A',maker:'Nsr',technical:{motor:'Original'},factory:{motor:'Original'},picture:'data:image/png;base64,AAAA'}}),other=act(s,'car.save',{data:{name:'B',maker:'NSR'}}),part=act(s,'part.save',{data:{name:'Motor',tracking:'quantity',quantity:5}}),loose=act(s,'part.save',{data:{name:'Delete me',tracking:'quantity',quantity:0}});
 configure(s,{car,other,part,loose});s.transact(d=>{for(let i=0;i<120;i++){d.cars.push({...d.cars[1],id:'unrelated-car-'+i,maker:'Other'});d.parts.push({...d.parts[0],id:'unrelated-part-'+i,name:'Unrelated '+i});}});
 const file=path.join(dir,'db.sqlite');new Store(file).replace(s.snapshot());
 const open=()=>new Store(file,{deferred:true}),read=()=>new Store(file).snapshot();
 const bounded=(d,max=50)=>{assert.ok(d.stats.recordReads<max,JSON.stringify(d.stats));for(const key of ['cars','parts','supplies','installations','setups','tests','jobs','events','buildDrafts','timing.sessions'])assert.ok(!d.stats.loadedSections.includes(key),JSON.stringify(d.stats));};
 const run=(action,p={})=>{const d=open(),state=d.deferredState,result=act(d,action,p);bounded(state);validateDatabase(read());return result;};
 const preview=(a,p={})=>{const d=open(),before=read(),result=d.plan(a,{revision:d.data.revision,...p});bounded(d.deferredState);assert.deepEqual(read(),before);return result;};
 return {file,open,read,run,preview,bounded,car,other,part,loose};
}
test('bulk preview and apply load selected cars and preserve unrelated history/media',t=>{
 const f=fixture(t),before=f.read(),p={ids:[f.car],updates:{raceClass:'GT'},labels:{usage:{mode:'add',values:['Club']}}};
 assert.deepEqual(f.preview('bulk.preview',p),new Store(f.file).plan('bulk.preview',{revision:before.revision,...p}));
 f.run('car.bulk',{...p,confirmed:true});const after=f.read();assert.equal(after.cars[0].raceClass,'GT');assert.deepEqual(after.cars.slice(1),before.cars.slice(1));assert.deepEqual(after.parts,before.parts);assert.equal(after.cars[0].picture,before.cars[0].picture);
 assert.throws(()=>f.run('car.bulk',{...p,confirmed:true,revision:before.revision}),/changed/);
});
test('choice queries match full catalogue, including factory, aliases, tracks and drivers',t=>{
 const f=fixture(t,(s,{car})=>{act(s,'setup.save',{carId:car,name:'Setup',track:'Old track'});act(s,'test.add',{carId:car,track:'Old track',driver:'Jim'});});
 assert.deepEqual(f.preview('choices.catalogue'),new Store(f.file).plan('choices.catalogue'));
 for(const [field,from,to]of [['maker','Nsr','NSR'],['tech_motor','Original','Corrected'],['track','Old track','Home'],['driver','Jim','James']]){
  const p={field,from,to,updateCars:true},expected=new Store(f.file).plan('choice.preview',{revision:f.read().revision,...p});assert.deepEqual(f.preview('choice.preview',p),expected);f.run('choice.rename',{...p,confirmed:true});
 }
 const d=f.read();assert.equal(d.cars[0].factory.motor,'Original');assert.equal(d.setups[0].track,'Old track');assert.equal(d.tests[0].driver,'Jim');
});
test('choice technical skips an installed assembly field and never changes its stock',t=>{
 const f=fixture(t,(s,{car,part})=>{const a=act(s,'assembly.create',{name:'Pod',components:[{partId:part,quantity:1,field:'motor'}]});act(s,'assembly.install',{id:a,carId:car});});
 const before=f.read(),p={field:'tech_motor',from:'Motor',to:'Other name',updateCars:true};assert.equal(f.preview('choice.preview',p).skipped.length,1);f.run('choice.rename',{...p,confirmed:true});assert.deepEqual(f.read().parts,before.parts);assert.equal(f.read().cars[0].technical.motor,'Motor');
});
test('setup and build previews use stock dependencies, are read only and reject stale apply',t=>{
 const f=fixture(t,(s,{car,part})=>{act(s,'part.install',{carId:car,partId:part,quantity:1,field:'motor'});act(s,'setup.save',{carId:car,name:'Setup'});});
 const before=f.read(),p={id:before.setups[0].id,selections:{0:'p:'+f.part}};
 assert.deepEqual(f.preview('setup.options',{id:p.id}),new Store(f.file).plan('setup.options',{id:p.id}));
 assert.deepEqual(f.preview('setup.preview',p),new Store(f.file).plan('setup.preview',{revision:before.revision,...p}));
 const data={...M.blank(),name:'Build',parts:[{key:'motor',partId:f.part,quantity:1,slot:'motor',position:'Motor',name:'Motor'}]};assert.deepEqual(f.preview('build.preview',{data}),new Store(f.file).plan('build.preview',{data}));
 act(f.open(),'settings.save',{name:'Later'});assert.throws(()=>f.run('setup.apply',{...p,revision:before.revision,confirmed:true}),/changed/);
});
test('supply deletion protects purchasing history and removes only unlinked supplies',t=>{
 let linked,loose;const f=fixture(t,s=>{const data={name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:2,remaining:5,minimum:1,unit:'ml'};linked=act(s,'supply.save',{data});loose=act(s,'supply.save',{data:{...data,name:'Spare'}});act(s,'planning.shopping.add',{item:{kind:'supply',id:linked},quantity:1});});
 const before=f.read();assert.throws(()=>f.run('supply.delete',{id:linked}),/purchasing/);assert.deepEqual(f.read(),before);f.run('supply.delete',{id:loose});assert.deepEqual(f.read().supplies,[before.supplies[0]]);
});
test('deletion catches every historical reference family and batch reason ordering matches',t=>{
 const f=fixture(t,(s,{car,part})=>{
  act(s,'part.install',{carId:car,partId:part,quantity:1,field:'motor'});act(s,'setup.save',{carId:car,name:'Saved'});act(s,'test.add',{carId:car});act(s,'job.start',{setupId:s.data.setups[0].id});
  act(s,'planning.shopping.add',{partId:part,quantity:1});act(s,'build.draft.save',{data:{...M.blank(),name:'Draft',parts:[{key:'motor',partId:part,quantity:1,slot:'motor',name:'Motor',position:'Motor'}]}});
 });
 const before=f.read();for(const a of ['part.delete','part.deleteMany']){const p=a.endsWith('Many')?{ids:[f.part]}:{id:f.part};assert.deepEqual(f.preview(a,p),new Store(f.file).plan(a,p));}
 assert.throws(()=>f.run('part.deleteMany',{ids:[f.part],confirmed:true}),/stock|linked/);assert.deepEqual(f.read(),before);
});
test('deletion of a pending rebuild retains other shopping plans and returned assembly stock',t=>{
 const f=fixture(t,(s,{car,other,part})=>{
  const a=act(s,'assembly.create',{name:'Assembly',components:[{partId:part,quantity:1,field:'motor'}]});act(s,'assembly.install',{id:a,carId:car});
  for(const id of [car,other]){const draft=act(s,'rebuild.start',{carId:id});const data=structuredClone(s.data.buildDrafts.find(d=>d.id===draft).data);data.parts=[{key:'motor',partId:part,quantity:7,slot:'motor',position:'Motor',name:'Motor'}];act(s,'build.draft.save',{id:draft,data});}
 });
 const before=f.read();f.run('car.delete',{id:f.car,confirmed:true,confirmName:'A'});const after=f.read();assert.equal(after.assemblies[0].carId,null);assert.equal(after.buildDrafts.length,1);assert.equal(after.buildDrafts[0].data.rebuild.carId,f.other);assert.ok(after.planning.shopping.some(l=>l.jobId===before.jobs.find(j=>j.carId===f.other).id));assert.ok(after.planning.shopping.some(l=>l.jobId===null));
});
test('choice rename preserves usage views, custom values and future-only aliases',t=>{
 let custom;const f=fixture(t,(s,{car})=>{act(s,'custom.add',{label:'Class',type:'choice'});custom=s.data.customFields[0].id;act(s,'car.save',{id:car,revision:s.data.cars[0].revision,data:{custom:{[custom]:'Old'},usage:['Old']}});act(s,'view.save',{name:'View',usage:['Old']});});
 for(const field of ['usage','custom_'+custom])f.run('choice.rename',{field,from:'Old',to:'New',updateCars:true,confirmed:true});const d=f.read();assert.deepEqual(d.views[0].usage,['New']);assert.equal(d.cars[0].custom[custom],'New');
 f.run('choice.rename',{field:'maker',from:'Nsr',to:'Correct',updateCars:false,confirmed:true});assert.equal(f.read().cars[0].maker,'Nsr');assert.ok(f.read().choiceAliases.some(a=>a.from==='Nsr'&&a.to==='Correct'));
});
test('catalogue ambiguity, normalized identities and candidate limits match the original model',t=>{
 const f=fixture(t,s=>{
  act(s,'catalogue.apply',{input:input(),selections:[{index:0,create:true}],confirmed:true});
  const first=s.data.parts.find(p=>p.catalogue);s.transact(d=>{d.parts.push({...first,id:'duplicate',name:'Duplicate'});for(let i=0;i<320;i++)d.parts.push({...first,id:'candidate-'+i,maker:'',reference:'',catalogue:undefined,name:i<300?'King quite different':'King motor'});});
 });
 for(const pack of [input([product({manufacturer:'  EXAMPLE   Racing ',reference:'m-01'})]),input([product({reference:'Unknown'})])])assert.deepEqual(f.preview('catalogue.preview',{input:pack}),new Store(f.file).plan('catalogue.preview',{input:pack}));
});
test('catalogue matching preserves exact, fuzzy, ambiguous, unchanged and cross-kind behavior',t=>{
 const f=fixture(t,(s)=>{act(s,'catalogue.apply',{input:input(),selections:[{index:0,create:true}],confirmed:true});act(s,'part.save',{data:{name:'King motor alternative',maker:'Example Racing',reference:'ALT',quantity:0,tracking:'quantity'}});});
 for(const pack of [input(),input([product({specifications:[]})]),input([product({reference:'M-02'})]),input([product({reference:''})]),input([product({manufacturer:'Other',reference:'M-01'})])])assert.deepEqual(f.preview('catalogue.preview',{input:pack}),new Store(f.file).plan('catalogue.preview',{input:pack}));
 const pack=input([product({specifications:[]})]),target=f.read().parts.find(p=>p.catalogue).id,p={input:pack,selections:[{index:0,targetId:target}],confirmed:true};assert.deepEqual(f.preview('catalogue.selection',p),new Store(f.file).plan('catalogue.selection',{revision:f.read().revision,...p}));
 const before=f.read();f.run('catalogue.apply',p);const after=f.read();assert.deepEqual(after.parts.filter(p=>p.id!==target),before.parts.filter(p=>p.id!==target));assert.deepEqual(after.parts.find(p=>p.id===target).catalogue.product.specifications,[]);
});
test('catalogue create and multiple-file combined input preserve identities and require fresh confirmation',t=>{
 const f=fixture(t),pack=input([product(),product({name:'Tyre',reference:'T',category:'Wheels & tyres',partType:'Tyre'})]),p={input:pack,selections:[{index:0,create:true},{index:1,create:true}]};
 assert.throws(()=>f.run('catalogue.apply',p),/Confirm/);assert.deepEqual(f.run('catalogue.apply',{...p,confirmed:true}),{created:2,updated:0});assert.equal(f.read().parts.filter(p=>p.catalogue).length,2);
 assert.throws(()=>f.run('catalogue.apply',{...p,confirmed:true}),/Resolve|up to date/);
});
test('part deletion checks nested historical references and returned stock without decoding records',t=>{
 const f=fixture(t,(s,{car,part})=>{act(s,'part.install',{carId:car,partId:part,quantity:1});act(s,'setup.save',{carId:car,name:'Saved'});act(s,'test.add',{carId:car});act(s,'part.remove',{id:s.data.installations[0].id,destination:'spares'});});
 for(const a of ['part.delete','part.deleteMany']){const p=a.endsWith('Many')?{ids:[f.part,f.loose]}:{id:f.part};assert.deepEqual(f.preview(a,p),new Store(f.file).plan(a,p));}
 const before=f.read();assert.throws(()=>f.run('part.delete',{id:f.part}),/linked/);assert.deepEqual(f.read(),before);f.run('part.deleteMany',{ids:[f.loose],confirmed:true});assert.ok(!f.read().parts.some(p=>p.id===f.loose));
});
test('car deletion returns stock, removes only linked records and preserves neighboring plans/focus',t=>{
 const f=fixture(t,(s,{car,other,part})=>{
  for(const id of [car,other]){act(s,'part.install',{carId:id,partId:part,quantity:1,field:'motor'});act(s,'setup.save',{carId:id,name:'Saved'});act(s,'test.add',{carId:id});const j=act(s,'job.start',{kind:'general',carId:id,name:'Work'});act(s,'planning.job.save',{jobId:j,priority:'Normal',targetDate:'',waiting:false,checklist:[]});}
  act(s,'planning.shelf.save',{name:'Group',carIds:[car,other]});act(s,'planning.focus',{carId:car,photoKey:'main',x:50,y:50});
 });
 const before=f.read();assert.deepEqual(f.preview('car.delete',{id:f.car}),new Store(f.file).plan('car.delete',{id:f.car}));
 f.run('car.delete',{id:f.car,confirmed:true,confirmName:'A'});const after=f.read();assert.ok(!after.cars.some(c=>c.id===f.car));assert.deepEqual(after.planning.jobs,before.planning.jobs.filter(p=>p.jobId===before.jobs.find(j=>j.carId===f.other).id));assert.deepEqual(after.planning.shelves[0].carIds,[f.other]);assert.equal(after.parts.at(-1).quantity,1);assert.equal(after.cars.find(c=>c.id===f.other).technical.motor,'Motor');
});
test('deletion refuses linked rebuilds and stale confirmation; failed persistence rolls back bulk changes',t=>{
 const f=fixture(t),before=f.read();assert.throws(()=>f.run('car.delete',{id:f.car,confirmName:'wrong',confirmed:true}),/exact car name/);
 const d=f.open();d.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(d,'car.bulk',{ids:[f.car],updates:{owner:'New'},confirmed:true}),/Disk full/);assert.deepEqual(f.read(),before);
 const draft=act(f.open(),'rebuild.start',{carId:f.car});const data=f.read().buildDrafts.find(d=>d.id===draft).data;data.parts=[{key:'motor',partId:f.part,quantity:1,slot:'motor',position:'Motor',name:'Motor'}];act(f.open(),'build.create',{draftId:draft,data,confirmed:true});const snapshot=f.read();assert.throws(()=>f.run('car.delete',{id:f.car,confirmName:'A',confirmed:true}),/rebuild/);assert.deepEqual(f.read(),snapshot);
});

test('surviving index-keyed plans remain editable after deletion and restart',t=>{
 const f=fixture(t,(s,{car,other})=>{
  act(s,'car.save',{id:other,revision:s.data.cars.find(c=>c.id===other).revision,data:{picture:'data:image/png;base64,AAAA'}});
  for(const id of [car,other]){const j=act(s,'job.start',{kind:'general',carId:id,name:'Work'});act(s,'planning.job.save',{jobId:j,priority:'Normal',targetDate:'',waiting:false,checklist:[]});act(s,'planning.focus',{carId:id,photoKey:'main',x:50,y:50});}
 });
 f.run('car.delete',{id:f.car,confirmed:true,confirmName:'A'});
 const before=f.read(),job=before.jobs.find(j=>j.carId===f.other);
 f.run('planning.job.save',{jobId:job.id,priority:'High',targetDate:'',waiting:false,checklist:[]});
 f.run('planning.focus',{carId:f.other,photoKey:'main',x:25,y:75});
 const after=f.read();assert.equal(after.planning.jobs.length,1);assert.equal(after.planning.jobs[0].priority,'High');assert.equal(after.planning.focus.length,1);assert.equal(after.planning.focus[0].x,25);assert.equal(after.planning.focus[0].y,75);
 const newJob=f.run('job.start',{carId:'unrelated-car-0',kind:'general',name:'Another job'});
 f.run('planning.job.save',{jobId:newJob,priority:'Normal',targetDate:'',waiting:false,checklist:[]});
 const plans=f.read().planning.jobs;assert.equal(plans.length,2);assert.equal(plans.find(p=>p.jobId===job.id).priority,'High');assert.equal(plans.find(p=>p.jobId===newJob).priority,'Normal');
});

test('catalogue and bulk durable retries after restart never repeat changes',t=>{
 const f=fixture(t),receipts=require('../src/command-receipts.cjs');
 for(const [action,payload]of [['catalogue.apply',{input:input(),selections:[{index:0,create:true}],confirmed:true}],['car.bulk',{ids:[f.car],updates:{location:'Shelf'},confirmed:true}]]){
  const s=f.open(),command={id:action.replace('.','-'),action,databaseId:s.data.id,epoch:s.deferredState.token.epoch,payload:{revision:s.data.revision,...payload}};
  const first=receipts.execute(s,command),saved=f.read(),retry=receipts.execute(f.open(),command);
  assert.equal(retry.duplicate,true);assert.deepEqual(retry.result,first.result);assert.deepEqual(f.read(),saved);
  assert.throws(()=>receipts.execute(f.open(),{...command,payload:{...command.payload,confirmed:false}}),/different content/);
 }
});

test('invalid choice fields are rejected cleanly and previews reject a concurrent revision',t=>{
 const f=fixture(t);assert.throws(()=>f.preview('choice.preview',{field:null}),/Unknown choice field/);
 const stale=f.open();f.run('car.bulk',{ids:[f.car],updates:{location:'Shelf'},confirmed:true});const before=f.read();
 assert.throws(()=>stale.plan('catalogue.preview',{input:input()}),/changed|revision/i);assert.deepEqual(f.read(),before);
});
