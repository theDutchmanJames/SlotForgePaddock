'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),S=require('../src/setup-suggestions.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-suggest-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=new Store(path.join(dir,'db.sqlite')),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Test racer',maker:'NSR',factory:{motor:'King Evo',ratedRpm:'21500',ratedVoltage:'12',rearTyres:'Supergrip',pinion:'9',gear:'27',weight:'80'},technical:{motor:'Modified motor',ratedRpm:'25000',weight:'75'}}});
 const motor=act('part.save',{data:{name:'King Evo',maker:'NSR',reference:'M-21',category:'Motors & motor parts',partType:'Motor',quantity:0,tracking:'quantity'}});
 const tyres=act('part.save',{data:{name:'Supergrip',maker:'NSR',reference:'T-1',category:'Wheels & tyres',partType:'Tyre',quantity:0,tracking:'quantity'}});
 const fitted=act('part.save',{data:{name:'Modified motor',maker:'NSR',partType:'Motor',quantity:1,tracking:'individual'}});act('part.install',{carId:car,partId:fitted,quantity:1,field:'motor'});
 return {s,car,motor,tyres,fitted,dir,act};
}
const payload=(m,rows)=>({carId:m.carId,carRevision:m.carRevision,name:'Proposed factory setup',suggestion:{source:m.source,rows:rows||m.rows.filter(r=>r.candidates.length).map(r=>({slot:r.slot,partId:r.candidates[0].id,quantity:r.quantity,signature:r.candidates[0].signature}))}});
for(const deferred of [false,true])test(`Factory and Current suggestions save plans without any inventory or car changes; deferred=${deferred}`,async t=>{
 const f=fixture(t),s=deferred?new Store(f.s.file,{deferred:true}):f.s,before=f.s.snapshot();
 const m=s.plan('setup.suggest',{carId:f.car});assert.equal(m.source,'factory');assert.equal(m.databaseId,before.id);assert.equal(m.rows.find(r=>r.slot==='motor').candidates[0].id,f.motor);assert.equal(m.rows.find(r=>r.slot==='pinionPart').candidates.length,0);
 assert.equal(s.plan('setup.suggest',{carId:f.car,source:'current'}).rows.find(r=>r.slot==='motor').candidates[0].id,f.fitted);
 const id=(await s.mutateAsync('setup.save',payload(m),{snapshot:false})).result,after=new Store(s.file).snapshot(),setup=after.setups.find(x=>x.id===id);
 assert.equal(setup.technical.weight,'80');assert.equal(setup.technical.motor,'King Evo');assert.equal(setup.plan.source,'factory');assert.equal(setup.installations.find(i=>i.partId===f.tyres).quantity,2);
 for(const key of ['cars','parts','installations','assemblies','jobs','planning','tests','timing'])assert.deepEqual(after[key],before[key],key);
 validateDatabase(after);
 if(deferred)for(const key of ['cars','parts','installations','setups'])assert.ok(!s.deferredState.stats.loadedSections.includes(key),key);
 const job=(await s.mutateAsync('job.start',{setupId:id,revision:s.data.revision},{snapshot:false})).result;
 assert.ok(job);const view=s.plan('job.view',{id:job});assert.ok(view.remaining>0);assert.ok(view.rows.some(r=>r.partId===f.motor&&!r.selected));
 assert.deepEqual(new Store(s.file).snapshot().installations,before.installations);
});
test('blank Factory never silently falls back to Current; specification-only plans are allowed',t=>{
 const f=fixture(t);f.act('car.save',{id:f.car,revision:f.s.data.cars[0].revision,data:{factory:{motor:'',ratedRpm:'',ratedVoltage:'',rearTyres:'',pinion:'',gear:'',weight:''}}});
 const m=f.s.plan('setup.suggest',{carId:f.car});assert.equal(m.rows.length,0);assert.throws(()=>f.s.mutate('setup.save',payload(m)),/No specifications/);
 const current=f.s.plan('setup.suggest',{carId:f.car,source:'current'});f.s.mutate('setup.save',payload(current,[]));assert.equal(f.s.data.setups[0].installations.length,0);assert.equal(f.s.data.setups[0].technical.weight,'75');
});
test('stale cars, changed parts, duplicate positions, invalid quantities and types fail atomically',async t=>{
 const f=fixture(t),s=new Store(f.s.file,{deferred:true}),m=s.plan('setup.suggest',{carId:f.car}),p=payload(m),before=f.s.snapshot();
 for(const altered of [{...p,carRevision:0},{...p,suggestion:{...p.suggestion,source:'other'}},{...p,suggestion:{...p.suggestion,rows:[p.suggestion.rows[0],p.suggestion.rows[0]]}},{...p,suggestion:{...p.suggestion,rows:[{...p.suggestion.rows[0],quantity:0}]}},{...p,suggestion:{...p.suggestion,rows:[{...p.suggestion.rows[0],signature:'stale'}]}},{...p,suggestion:{...p.suggestion,rows:[{...p.suggestion.rows[0],partId:f.tyres,signature:S.fingerprint(before.parts.find(x=>x.id===f.tyres))}]}}]){
  await assert.rejects(s.mutateAsync('setup.save',altered,{snapshot:false}));assert.deepEqual(new Store(s.file).snapshot(),before);
 }
 f.act('part.save',{id:f.motor,data:{...before.parts.find(x=>x.id===f.motor),name:'Changed name'}});
 await assert.rejects(s.mutateAsync('setup.save',p,{snapshot:false}),/changed/);
});
test('name/reference/spec evidence is explicit; ambiguous candidates remain separate and wrong makers are excluded',()=>{
 const car={id:'c',revision:1,maker:'NSR',factory:{motor:'King Evo M21',ratedRpm:'21500'}};
 const parts=[{id:'a',maker:'NSR',name:'King Evo',reference:'M21',partType:'Motor'},{id:'b',maker:'NSR',name:'King Evo',reference:'M22',partType:'Motor'},{id:'x',maker:'Other',name:'King Evo M21',partType:'Motor'}];
 const m=S.model(car,parts,'factory');assert.deepEqual(m.rows[0].candidates.map(x=>x.id),['a','b']);assert.match(m.rows[0].candidates[0].reason,/reference/);
});
test('failed persistence cannot save half a setup',async t=>{
 const f=fixture(t),s=new Store(f.s.file,{deferred:true}),m=s.plan('setup.suggest',{carId:f.car}),before=f.s.snapshot();
 const {DatabaseSync}=require('node:sqlite'),sql=new DatabaseSync(f.s.file);sql.exec("CREATE TRIGGER fail_setup BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'test failure'); END");sql.close();
 await assert.rejects(s.mutateAsync('setup.save',payload(m),{snapshot:false}),/test failure/);assert.deepEqual(new Store(f.s.file).snapshot(),before);
});
test('structured specifications match gear teeth and motor ratings without loading photos or full metadata',t=>{
 const f=fixture(t),catalogue=require('../src/catalogue-import.cjs');
 f.s.transact(db=>{
  const p=db.parts.find(p=>p.id===f.motor);p.name='Competition motor';
  p.catalogue={importedAt:new Date().toISOString(),product:catalogue.validateProduct({kind:'part',name:p.name,manufacturer:'NSR',reference:'M-21',category:'Motors & motor parts',partType:'Motor',specifications:[{name:'RPM',value:'21500',unit:'rpm'},{name:'Voltage',value:'12',unit:'V'}]},0).product};
  for(let i=0;i<300;i++)db.parts.push({...db.parts[1],id:'unrelated-'+i,maker:'Other brand',name:'Other '+i});
 });
 const s=new Store(f.s.file,{deferred:true}),m=s.plan('setup.suggest',{carId:f.car}),p=m.rows.find(r=>r.slot==='motor').candidates.find(p=>p.id===f.motor);
 assert.match(p.reason,/RPM matches 21500/);assert.match(p.reason,/Voltage matches 12/);assert.ok(!s.deferredState.stats.loadedSections.includes('parts'));
 assert.deepEqual(m,f.s.plan('setup.suggest',{carId:f.car}));
});
test('setup plan identity survives Paddock export and reviewed import',t=>{
 const f=fixture(t),m=f.s.plan('setup.suggest',{carId:f.car});f.s.mutate('setup.save',payload(m));
 const {makePackage}=require('../src/store.cjs'),pack=makePackage(f.s.data,[f.car],{setups:true}),target=new Store();
 const sub=target.mutate('submission.add',{package:pack}).result;
 target.mutate('submission.review',{id:sub,carId:f.car,decision:'accept',fields:Object.keys(pack.cars[0]).filter(k=>!['id','sharedSetups'].includes(k)),includeSetups:true,revision:0});
 assert.equal(target.data.setups[0].plan.source,'factory');assert.equal(target.data.setups[0].installations.length,0);validateDatabase(target.data);
});
test('Dealership reviews save a plan without stock changes and reject source changes while pending',async t=>{
 const f=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),host=new Store(f.s.file,{deferred:true}),network=new Network(host),club=new Club(host,network,path.join(f.dir,'club'));
 t.after(async()=>{club.close();await club.idle();await network.stop();network.close();});club.enable('Test dealer','test password');
 const m=host.plan('setup.suggest',{carId:f.car}),before=new Store(f.s.file).snapshot();await club.propose('setup.save',payload(m));
 let proposal=host.data.club.proposals.find(p=>p.status==='pending'),preview=club.preview(proposal.id);assert.equal(preview.error,'');
 await club.reviewAsync({id:proposal.id,token:preview.token,decision:'accept'});
 let after=new Store(f.s.file).snapshot();assert.equal(after.setups.length,1);for(const key of ['parts','cars','installations'])assert.deepEqual(after[key],before[key]);
 await club.propose('setup.save',{...payload(m),name:'Stale proposal'});proposal=host.data.club.proposals.find(p=>p.status==='pending');
 const car=host.data.cars.find(c=>c.id===f.car);await host.mutateAsync('car.save',{id:car.id,revision:car.revision,data:{factory:{weight:'90'}}},{snapshot:false});
 preview=club.preview(proposal.id);assert.match(preview.error,/changed/);await assert.rejects(club.reviewAsync({id:proposal.id,token:preview.token,decision:'accept',confirmConflict:true}),/changed/);
 assert.equal(new Store(f.s.file).data.setups.length,1);
});
test('numeric-only matches respect units and gear positions',()=>{
 const car={id:'c',revision:1,maker:'NSR',factory:{pinion:'9',gear:'27',rearDiameter:'20',ratedRpm:'21500'}};
 const part=(id,type,name,value,unit)=>({id,maker:'NSR',name:id,partType:type,catalogue:{product:{specifications:[{name,value,unit}]}}});
 const m=S.model(car,[part('pinion','Pinion','Teeth','9','teeth'),part('crown','Crown gear','Tooth count','27',''),part('wrong-size','Tyre','Diameter','20','inches'),part('right-size','Tyre','Diameter','20.0','mm'),part('wrong-speed','Motor','RPM','21500','rad/s')],'factory');
 assert.deepEqual(m.rows.find(r=>r.slot==='pinionPart').candidates.map(p=>p.id),['pinion']);assert.deepEqual(m.rows.find(r=>r.slot==='gearPart').candidates.map(p=>p.id),['crown']);assert.deepEqual(m.rows.find(r=>r.slot==='rearTyres').candidates.map(p=>p.id),['right-size']);assert.equal(m.rows.find(r=>r.slot==='motor').candidates.length,0);
});
test('large manufacturer catalogues find late exact matches with bounded suggestions and no whole-model load',t=>{
 const f=fixture(t);f.s.transact(db=>{const base=db.parts.find(p=>p.id===f.motor);for(let i=0;i<2100;i++)db.parts.push({...base,id:'catalogue-'+String(i).padStart(5,'0'),name:'King motor '+i});db.parts.push({...base,id:'zz-exact',name:'Late exact motor',reference:'LAST'});db.cars.find(c=>c.id===f.car).factory.motor='Late exact motor';});
 const s=new Store(f.s.file,{deferred:true}),m=s.plan('setup.suggest',{carId:f.car}),row=m.rows.find(r=>r.slot==='motor');assert.equal(row.candidates[0].id,'zz-exact');assert.ok(row.candidateCount>2000);assert.equal(row.candidates.length,8);assert.ok(!s.deferredState.stats.loadedSections.includes('parts'));assert.ok(!s.deferredState.stats.loadedSections.includes('installations'));
});
