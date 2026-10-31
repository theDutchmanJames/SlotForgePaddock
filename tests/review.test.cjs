const test=require('node:test');
const assert=require('node:assert/strict');
const {Store,makePackage}=require('../src/store.cjs');
const car=s=>s.mutate('car.save',{data:{name:'Review car',technical:{motor:'Original motor',weight:'80'}}}).result;
const part=s=>s.mutate('part.save',{data:{name:'Tracked motor',tracking:'individual',quantity:1,category:'Motor'}}).result;
test('partial submitted technical fields preserve omitted local specifications',()=>{
  const s=new Store(),id=car(s),pack=makePackage(s.data,[id]);pack.cars[0].technical={weight:'82'};
  s.mutate('submission.add',{package:pack});s.mutate('submission.review',{id:s.data.submissions[0].id,carId:id,decision:'accept',revision:1,fields:['technical']});
  assert.equal(s.data.cars[0].technical.motor,'Original motor');assert.equal(s.data.cars[0].technical.weight,'82');
});
test('ordinary technical edits cannot contradict an installed component',()=>{
  const s=new Store(),id=car(s),p=part(s);s.mutate('part.install',{carId:id,partId:p,quantity:1,field:'motor'});const before=s.snapshot();
  assert.throws(()=>s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{technical:{motor:'Untracked replacement'}}}),/installed/i);assert.deepEqual(s.snapshot(),before);
});
test('safe submitted measurements can update a car with tracked inventory',()=>{
  const s=new Store(),id=car(s),p=part(s);s.mutate('part.install',{carId:id,partId:p,quantity:1,field:'motor'});const pack=makePackage(s.data,[id]);pack.cars[0].technical={weight:'82'};
  s.mutate('submission.add',{package:pack});s.mutate('submission.review',{id:s.data.submissions[0].id,carId:id,decision:'accept',revision:s.data.cars[0].revision,fields:['technical']});
  assert.equal(s.data.cars[0].technical.motor,'Tracked motor');assert.equal(s.data.cars[0].technical.weight,'82');
});
test('renaming an installed stock part updates current specifications but preserves past names',()=>{
  const s=new Store(),id=car(s),p=part(s);s.mutate('part.install',{carId:id,partId:p,quantity:1,field:'motor'});s.mutate('setup.save',{carId:id,name:'Original'});
  s.mutate('part.save',{id:p,data:{...s.data.parts[0],name:'Corrected motor'}});
  assert.equal(s.data.cars[0].technical.motor,'Corrected motor');assert.equal(s.data.setups[0].technical.motor,'Tracked motor');assert.equal(s.data.installations[0].name,'Tracked motor');
});
test('stock names cannot overwrite measurement fields',()=>{
  const s=new Store(),id=car(s),p=part(s);assert.throws(()=>s.mutate('part.install',{carId:id,partId:p,quantity:1,field:'weight'}),/component field/i);
});
test('malformed backup review metadata is rejected without replacing the collection',()=>{
  const s=new Store(),id=car(s);s.mutate('submission.add',{package:makePackage(s.data,[id])});const backup=s.snapshot();delete backup.submissions[0].outcomes;const before=s.snapshot();
  assert.throws(()=>s.restore(backup,s.data.revision));assert.deepEqual(s.snapshot(),before);
});
test('duplicate setup identities in a backup are rejected',()=>{
  const s=new Store(),id=car(s);s.mutate('setup.save',{carId:id,name:'Baseline'});const backup=s.snapshot();backup.setups.push(structuredClone(backup.setups[0]));assert.throws(()=>s.restore(backup,s.data.revision),/Duplicate/);
});
test('prototype-property identities are rejected at the package boundary',()=>{
  const s=new Store(),id=car(s),pack=makePackage(s.data,[id]);for(const unsafe of ['__proto__','constructor','toString']){pack.cars[0].id=unsafe;assert.throws(()=>s.mutate('submission.add',{package:pack}),/identity/i);}
});
test('stale stock edits cannot undo newer quantity adjustments',()=>{
  const s=new Store(),p=part(s),revision=s.data.revision,data={...s.data.parts[0]};s.mutate('part.save',{id:p,revision,data:{...data,location:'New drawer'}});const before=s.snapshot();
  assert.throws(()=>s.mutate('part.save',{id:p,revision,data:{...data,location:'Old drawer'}}),/changed/);assert.deepEqual(s.snapshot(),before);
});
test('backdated maintenance rejects invalid calendar dates',()=>{
  const s=new Store(),id=car(s);assert.throws(()=>s.mutate('work.add',{carId:id,type:'maintenance',title:'Service',performedDate:'2026-02-30'}),/date/i);
});
test('a maximum-length car name can still be duplicated',()=>{
  const s=new Store(),id=s.mutate('car.save',{data:{name:'A'.repeat(200)}}).result;s.mutate('car.duplicate',{id});assert.equal(s.data.cars.length,2);assert.equal(s.data.cars[1].name.length,200);assert.match(s.data.cars[1].name,/\(copy\)$/);
});
test('discarded individual parts can still have their notes edited without resurrecting stock',()=>{
  const s=new Store(),id=car(s),p=part(s);s.mutate('part.install',{carId:id,partId:p,quantity:1,field:'motor'});s.mutate('part.remove',{id:s.data.installations[0].id,destination:'discarded'});s.mutate('part.save',{id:p,data:{...s.data.parts[0],notes:'Faulty winding'}});assert.equal(s.data.parts[0].quantity,0);assert.equal(s.data.parts[0].location,'Discarded');
});
test('malformed shared setup names and duplicate snapshot identities are rejected on receipt',()=>{
  const s=new Store(),id=car(s);s.mutate('setup.save',{carId:id,name:'Baseline'});const pack=makePackage(s.data,[id],{setups:true});pack.cars[0].sharedSetups[0].name='';assert.throws(()=>s.mutate('submission.add',{package:pack}),/needs a name/);pack.cars[0].sharedSetups[0].name='Baseline';pack.cars[0].sharedSetups.push(structuredClone(pack.cars[0].sharedSetups[0]));assert.throws(()=>s.mutate('submission.add',{package:pack}),/Duplicate shared setup/);
});
test('a partial local edit retains other specifications and custom values',()=>{
  const s=new Store(),id=car(s);s.mutate('car.save',{id,revision:1,data:{technical:{weight:'82'},custom:{customOne:'Keep'}}});s.mutate('car.save',{id,revision:2,data:{custom:{customTwo:'Add'}}});assert.equal(s.data.cars[0].technical.motor,'Original motor');assert.deepEqual(s.data.cars[0].custom,{customOne:'Keep',customTwo:'Add'});
});
