const test=require('node:test'),assert=require('node:assert/strict');
const {Store,makePackage,validateDatabase}=require('../src/store.cjs');
const {available}=require('../src/workshop.cjs'),model=require('../renderer/review-model.js');
function fixture(tracking='quantity'){
 const s=new Store(),car=s.mutate('car.save',{data:{name:'Aston Martin',technical:{pinion:'9',gear:'27',frontTyres:'Original fronts'},privateNotes:'Private'}}).result;
 const part=s.mutate('part.save',{data:{name:'Original rear tyres',category:'Tyres',quantity:tracking==='individual'?1:8,tracking,condition:'New'}}).result;
 s.mutate('part.install',{carId:car,partId:part,quantity:tracking==='individual'?1:2,field:'rearTyres'});
 return {s,car,part};
}
function submit(f,technical={rearTyres:'New tyres',pinion:'13',gear:'31'}){
 const pack=makePackage(f.s.data,[f.car]);pack.cars[0].technical=technical;
 return f.s.mutate('submission.add',{package:pack}).result;
}
function accept(f,id,extra={}){return f.s.mutate('submission.review',{id,carId:f.car,revision:f.s.data.cars[0].revision,decision:'accept',...extra});}
test('incoming technical fields can be selected independently without changing installed stock',()=>{
 const f=fixture(),id=submit(f),stock=structuredClone(f.s.data.parts),installs=structuredClone(f.s.data.installations);
 const incoming=f.s.data.submissions[0].package.cars[0],rows=model.incomingFields(incoming,f.s.data.cars[0]);
 assert.deepEqual(rows.map(r=>r.key).sort(),['technical.gear','technical.pinion','technical.rearTyres']);
 accept(f,id,{fields:['technical.pinion']});
 assert.equal(f.s.data.cars[0].technical.pinion,'13');assert.equal(f.s.data.cars[0].technical.gear,'27');assert.equal(f.s.data.cars[0].technical.rearTyres,'Original rear tyres');assert.equal(f.s.data.cars[0].technical.frontTyres,'Original fronts');assert.equal(f.s.data.cars[0].privateNotes,'Private');
 assert.deepEqual(f.s.data.parts,stock);assert.deepEqual(f.s.data.installations,installs);
});
test('overriding fitted quantity stock requires explicit consent and returns only fitted pieces to used spares',()=>{
 const f=fixture(),id=submit(f),before=f.s.snapshot();
 assert.throws(()=>accept(f,id,{fields:['technical.rearTyres']}),/stock-return/);assert.deepEqual(f.s.snapshot(),before);
 accept(f,id,{fields:['technical.rearTyres','technical.gear'],stockOverrides:['rearTyres']});
 const old=f.s.data.parts.find(p=>p.id===f.part),used=f.s.data.parts.find(p=>p.sourcePartId===f.part);
 assert.equal(old.quantity,6);assert.equal(old.condition,'New');assert.equal(used.quantity,2);assert.equal(used.condition,'Used');assert.equal(used.location,'Used spares');assert.equal(available(f.s.data,used),2);
 assert.equal(f.s.data.parts.reduce((n,p)=>n+p.quantity,0),8);assert.equal(f.s.data.installations.filter(i=>!i.removed).length,0);
 assert.equal(f.s.data.cars[0].technical.rearTyres,'New tyres');assert.equal(f.s.data.cars[0].technical.gear,'31');assert.equal(f.s.data.cars[0].technical.pinion,'9');
 assert.ok(f.s.data.events.some(e=>e.title.includes('returned Original rear tyres to stock')));
 assert.throws(()=>accept(f,id,{fields:['technical.rearTyres'],stockOverrides:['rearTyres']}),/reviewed/);assert.equal(f.s.data.parts.length,2);
});
test('individual stock returns to the same inventory record without creating duplicates',()=>{
 const f=fixture('individual'),id=submit(f);accept(f,id,{fields:['technical.rearTyres'],stockOverrides:['rearTyres']});
 assert.equal(f.s.data.parts.length,1);const p=f.s.data.parts[0];assert.equal(p.id,f.part);assert.equal(p.quantity,1);assert.equal(p.condition,'Used');assert.equal(available(f.s.data,p),1);
});
test('stale reviews, invalid selections and failed persistence cannot release fitted parts',()=>{
 const f=fixture(),id=submit(f),before=f.s.snapshot(),base={fields:['technical.rearTyres'],stockOverrides:['rearTyres']};
 for(const extra of [{...base,revision:0},{fields:['technical.nonexistent']},{fields:['id']},{fields:['technical.pinion','technical.pinion']},{fields:['technical.pinion'],stockOverrides:['rearTyres']}]){assert.throws(()=>accept(f,id,extra));assert.deepEqual(f.s.snapshot(),before);}
 f.s.persist=()=>{throw Error('Disk full');};assert.throws(()=>accept(f,id,base),/Disk full/);assert.deepEqual(f.s.snapshot(),before);
});
test('accepting an unchanged fitted name does not return stock, and rejecting never returns stock',()=>{
 const f=fixture(),id=submit(f,{rearTyres:'Original rear tyres'}),before=structuredClone(f.s.data.installations);accept(f,id,{fields:['technical.rearTyres'],stockOverrides:['rearTyres']});assert.deepEqual(f.s.data.installations,before);
 const next=submit(f);f.s.mutate('submission.review',{id:next,carId:f.car,decision:'reject',fields:['technical.rearTyres'],stockOverrides:['rearTyres']});assert.deepEqual(f.s.data.installations,before);
});
test('assembly overrides release one component while the other components remain fitted',()=>{
 const s=new Store(),car=s.mutate('car.save',{data:{name:'Assembly car'}}).result;
 const part=(name,quantity)=>s.mutate('part.save',{data:{name,quantity,tracking:'quantity',category:'Other'}}).result;
 const tyres=part('Tyres',4),axle=part('Axle',2),assembly=s.mutate('assembly.create',{revision:s.data.revision,name:'Rear assembly',components:[{partId:tyres,quantity:2,field:'rearTyres'},{partId:axle,quantity:1,field:'rearAxle'}]}).result;
 s.mutate('assembly.install',{id:assembly,carId:car,revision:s.data.revision});const f={s,car},id=submit(f),axleInstallation=structuredClone(s.data.installations.find(i=>i.field==='rearAxle'));
 accept(f,id,{fields:['technical.rearTyres'],stockOverrides:['rearTyres']});
 assert.equal(s.data.assemblies[0].components.length,1);assert.equal(s.data.assemblies[0].carId,car);assert.deepEqual(s.data.installations.find(i=>i.field==='rearAxle'),axleInstallation);assert.equal(s.data.cars[0].technical.rearAxle,'Axle');assert.equal(s.data.cars[0].technical.rearTyres,'New tyres');assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),6);validateDatabase(s.snapshot());
 const last=submit(f,{rearAxle:'Replacement axle'});accept(f,last,{fields:['technical.rearAxle'],stockOverrides:['rearAxle']});
 assert.ok(s.data.assemblies[0].dismantled);assert.equal(s.data.assemblies[0].carId,null);assert.equal(s.data.installations.filter(i=>!i.removed).length,0);assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),6);validateDatabase(s.snapshot());
});
test('new car submissions still need a name and support technical selection',()=>{
 const f=fixture(),pack=makePackage(f.s.data,[f.car]),s=new Store(),id=s.mutate('submission.add',{package:pack}).result;
 assert.throws(()=>s.mutate('submission.review',{id,carId:f.car,decision:'accept',revision:0,fields:['technical.pinion']}),/name/);
 s.mutate('submission.review',{id,carId:f.car,decision:'accept',revision:0,fields:['name','technical.pinion']});assert.equal(s.data.cars[0].name,'Aston Martin');assert.deepEqual(s.data.cars[0].technical,{pinion:'9'});
});
test('dealership review identities resolve work, jobs, renamed and removed cars without name matching',()=>{
 const db={cars:[{id:'one',name:'Corvette'},{id:'two',name:'Corvette'}],jobs:[{id:'job',carId:'two',name:'Tune gearing'}]};
 assert.deepEqual(model.proposalContext(db,{action:'work.add',payload:{carId:'one',title:'New tyres'}}),{carId:'one',name:'Corvette',picture:'',detail:'New tyres',renamedTo:''});
 assert.equal(model.proposalContext(db,{action:'job.edit',payload:{id:'job'}}).carId,'two');
 const renamed=model.proposalContext(db,{action:'car.save',payload:{id:'one',data:{name:'New name'}}});assert.equal(renamed.name,'Corvette');assert.equal(renamed.renamedTo,'New name');
 assert.equal(model.proposalContext(db,{action:'work.add',payload:{carId:'missing'}}).name,'Car no longer in collection');
});
test('setup-based workshop proposals and checklist steps identify their car and job',()=>{
 const db={cars:[{id:'car',name:'Car'}],jobs:[{id:'job',carId:'car',name:'Job'}],setups:[{id:'setup',carId:'car',name:'Setup'}],installations:[{id:'installation',carId:'car',partId:'part'}],parts:[{id:'part',name:'Motor'}]};
 const start=model.proposalContext(db,{action:'job.start',payload:{setupId:'setup'}});assert.equal(start.carId,'car');assert.equal(start.detail,'Setup');
 const check=model.proposalContext(db,{action:'planning.job.check',payload:{jobId:'job',id:'step'}});assert.equal(check.carId,'car');assert.equal(check.detail,'Job');
 const removal=model.proposalContext(db,{action:'part.remove',payload:{id:'installation'}});assert.equal(removal.carId,'car');assert.equal(removal.detail,'Motor');
});
test('review list markup does not repeat full-size photos for every pending or historical proposal',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),picture='data:image/png;base64,'+'A'.repeat(1024*1024),context={ReviewModel:model,db:{cars:[{id:'car',name:'Car',picture}]},esc:String,uiTile:()=>'<icon>',fieldLabel:String};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../renderer/club.js'),'utf8'),context);
 context.proposal={action:'work.add',payload:{carId:'car',title:'Work'}};
 const markup=vm.runInContext('clubReviewIdentity(proposal)',context);assert.ok(markup.length<1000);assert.ok(!markup.includes(picture));
 assert.ok(vm.runInContext('clubReviewIdentity(proposal,true)',context).includes(picture));
 assert.equal(vm.runInContext("clubReviewValue('Events → Work → carId','Not recorded')",context),'Not recorded');
});
test('overriding every assembly component in one review returns each once and dismantles the assembly',()=>{
 const f=fixture('individual'),s=f.s,axle=s.mutate('part.save',{data:{name:'Axle',quantity:1,tracking:'individual',category:'Other'}}).result;
 // Return the original independent installation before assembling it.
 s.mutate('part.remove',{id:s.data.installations[0].id,destination:'spares',location:'Stock'});
 const assembly=s.mutate('assembly.create',{revision:s.data.revision,name:'Rear assembly',components:[{partId:f.part,quantity:1,field:'rearTyres'},{partId:axle,quantity:1,field:'rearAxle'}]}).result;
 s.mutate('assembly.install',{id:assembly,carId:f.car,revision:s.data.revision});
 const id=submit(f,{rearTyres:'New tyres',rearAxle:'New axle'});accept(f,id,{fields:['technical.rearTyres','technical.rearAxle'],stockOverrides:['rearTyres','rearAxle']});
 assert.equal(s.data.parts.length,2);assert.equal(s.data.installations.filter(i=>!i.removed).length,0);assert.ok(s.data.assemblies[0].dismantled);assert.ok(s.data.parts.every(p=>available(s.data,p)===1&&p.condition==='Used'));
 assert.ok(s.data.events.some(e=>e.notes.includes('assembly dismantled')));validateDatabase(s.snapshot());
});
