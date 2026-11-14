'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),W=require('../src/workshop.cjs');
function fixture(t,tracking='quantity',assembly=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-tech-override-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=new Store(path.join(dir,'db.sqlite')),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
 const car=act('car.save',{data:{name:'Research car',technical:{gear:'27',weight:'80'},factory:{motor:'Original',technicalNotes:'Keep'}}}),other=act('car.save',{data:{name:'Other car'}});
 const motor=act('part.save',{data:{name:'Fitted motor',tracking,quantity:tracking==='individual'?1:6}}),axle=act('part.save',{data:{name:'Rear axle',tracking:'individual',quantity:1}});
 let assemblyId;if(assembly){assemblyId=act('assembly.create',{name:'Rear assembly',components:[{partId:motor,quantity:1,field:'motor'},{partId:axle,quantity:1,field:'rearAxle'}]});act('assembly.install',{id:assemblyId,carId:car});}
 else {act('part.install',{partId:motor,carId:car,quantity:1,field:'motor'});if(tracking==='quantity')act('part.install',{partId:motor,carId:other,quantity:2,field:'motor'});}
 act('setup.save',{carId:car,name:'Historical setup'});act('test.add',{carId:car,track:'Test track',best:'7.1'});
 return {s,car,other,motor,axle,assemblyId};
}
for(const deferred of [false,true])for(const tracking of ['quantity','individual'])test(`technical override returns ${tracking} stock atomically; deferred=${deferred}`,async t=>{
 const f=fixture(t,tracking),before=f.s.snapshot(),s=deferred?new Store(f.s.file,{deferred:true}):f.s;
 const c=before.cars.find(c=>c.id===f.car),payload={id:c.id,revision:c.revision,data:{technical:{motor:'Researched replacement',ratedRpm:'21500'},factory:{motor:'Factory replacement'}},stockOverrides:['motor']};
 await s.mutateAsync('car.save',payload,{snapshot:false});const after=new Store(s.file).snapshot(),car=after.cars.find(c=>c.id===f.car);
 assert.equal(car.technical.motor,'Researched replacement');assert.equal(car.technical.ratedRpm,'21500');assert.equal(car.technical.gear,'27');assert.equal(car.technical.weight,'80');assert.equal(car.factory.technicalNotes,'Keep');
 assert.deepEqual(after.setups,before.setups);assert.deepEqual(after.tests,before.tests);assert.deepEqual(after.cars.find(c=>c.id===f.other),before.cars.find(c=>c.id===f.other));
 assert.equal(after.installations.filter(i=>i.carId===f.car&&!i.removed).length,0);assert.equal(after.parts.reduce((n,p)=>n+p.quantity,0),before.parts.reduce((n,p)=>n+p.quantity,0));
 const returned=after.parts.filter(p=>p.location==='Used spares');assert.equal(returned.length,1);assert.equal(returned[0].quantity,1);assert.equal(returned[0].condition,'Used');assert.equal(W.available(after,returned[0]),1);
 assert.equal(after.events.filter(e=>e.title.startsWith('Review override:')).length,1);validateDatabase(after);
 await assert.rejects(s.mutateAsync('car.save',payload,{snapshot:false}),/changed/);assert.deepEqual(new Store(s.file).snapshot(),after);
 if(deferred){assert.ok(!s.deferredState.stats.loadedSections.includes('parts'));assert.ok(!s.deferredState.stats.loadedSections.includes('events'));}
});
for(const all of [false,true])test(`assembly override preserves other members or dismantles only when empty; all=${all}`,async t=>{
 const f=fixture(t,'individual',true),before=f.s.snapshot(),s=new Store(f.s.file,{deferred:true}),c=before.cars.find(c=>c.id===f.car);
 await s.mutateAsync('car.save',{id:c.id,revision:c.revision,data:{technical:{motor:'Other motor',...(all?{rearAxle:'Other axle'}:{})}},stockOverrides:all?['motor','rearAxle']:['motor']},{snapshot:false});
 const after=new Store(s.file).snapshot(),assembly=after.assemblies.find(a=>a.id===f.assemblyId);
 assert.equal(after.installations.filter(i=>i.carId===f.car&&!i.removed).length,all?0:1);assert.equal(!!assembly.dismantled,all);assert.deepEqual(after.setups,before.setups);assert.equal(after.parts.filter(p=>p.location==='Used spares').length,all?2:1);validateDatabase(after);
});
test('missing consent, unrelated overrides, stale saves and storage failures cannot partially return stock',async t=>{
 const f=fixture(t),s=new Store(f.s.file,{deferred:true}),before=f.s.snapshot(),c=before.cars.find(c=>c.id===f.car),base={id:c.id,revision:c.revision,data:{technical:{motor:'Replacement'},factory:{motor:'Replacement'}}};
 for(const extra of [{},{stockOverrides:[]},{stockOverrides:['rearTyres']},{stockOverrides:'motor'},{stockOverrides:['motor'],revision:c.revision-1},{stockOverrides:['motor'],data:{...base.data,picture:''}}]){
  await assert.rejects(s.mutateAsync('car.save',{...base,...extra},{snapshot:false}));assert.deepEqual(new Store(s.file).snapshot(),before);
 }
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(s.file);db.exec("CREATE TRIGGER fail_override BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'override disk failure'); END");db.close();
 await assert.rejects(s.mutateAsync('car.save',{...base,stockOverrides:['motor']},{snapshot:false}),/override disk failure/);assert.deepEqual(new Store(s.file).snapshot(),before);
});
test('same fitted specification and factory-only imports never return installed parts',async t=>{
 const f=fixture(t),s=new Store(f.s.file,{deferred:true}),before=f.s.snapshot(),c=before.cars.find(c=>c.id===f.car);
 await s.mutateAsync('car.save',{id:c.id,revision:c.revision,data:{technical:{motor:'Fitted motor'},factory:{motor:'Researched motor'}},stockOverrides:['motor']},{snapshot:false});
 const after=new Store(s.file).snapshot();assert.deepEqual(after.installations,before.installations);assert.deepEqual(after.parts,before.parts);assert.equal(after.cars.find(c=>c.id===f.car).factory.motor,'Researched motor');
});
test('Dealership applies a selected stock override and preserves it across replica restart',async t=>{
 const f=fixture(t,'individual',true),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
 const host=new Store(f.s.file,{deferred:true}),hn=new Network(host),hc=new Club(host,hn,path.join(path.dirname(host.file),'host'));
 const member=new Store(path.join(path.dirname(host.file),'member','db.sqlite')),mn=new Network(member),mc=new Club(member,mn,path.dirname(member.file));
 t.after(async()=>{mc.close();hc.close();await mc.idle();await hc.idle();await mn.stop();await hn.stop();mn.close();hn.close();});
 hc.enable('Test host','test password');await hn.start();await mc.connect({address:'127.0.0.1:'+hn.port,code:hn.clubCode,name:'Test member'});
 const c=mc.store.data.cars.find(c=>c.id===f.car),payload={id:c.id,revision:c.revision,data:{technical:{motor:'Imported motor'},factory:{motor:'Factory motor'}},stockOverrides:['motor']};
 const result=await mc.mutate('car.save',payload);assert.ok(!result.queued);await mc.catchUp(host.data.revision,true);
 for(const db of [new Store(host.file).snapshot(),new Store(mc.store.file).snapshot()]){assert.equal(db.cars.find(c=>c.id===f.car).technical.motor,'Imported motor');assert.equal(db.parts.find(p=>p.id===f.motor).location,'Used spares');assert.equal(db.installations.filter(i=>i.carId===f.car&&!i.removed).length,1);assert.equal(db.events.filter(e=>e.title.startsWith('Review override:')).length,1);validateDatabase(db);}
 // Explicit proposals from existing clients still preview and approve atomically.
 const next=host.data.cars.find(c=>c.id===f.car);
 await hc.propose('car.save',{id:next.id,revision:next.revision,data:{technical:{rearAxle:'Imported axle'}},stockOverrides:['rearAxle']});
 const proposal=host.data.club.proposals.find(p=>p.status==='pending'),preview=hc.preview(proposal.id);assert.equal(preview.error,'');
 assert.equal(host.data.installations.filter(i=>i.carId===f.car&&!i.removed).length,1);
 await hc.reviewAsync({id:proposal.id,token:preview.token,decision:'accept'});await mc.catchUp(host.data.revision,true);
 for(const db of [new Store(host.file).snapshot(),new Store(mc.store.file).snapshot()]){assert.equal(db.cars.find(c=>c.id===f.car).technical.rearAxle,'Imported axle');assert.equal(db.installations.filter(i=>i.carId===f.car&&!i.removed).length,0);assert.ok(db.assemblies.find(a=>a.id===f.assemblyId).dismantled);validateDatabase(db);}
});
