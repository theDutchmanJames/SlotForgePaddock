const test=require('node:test');
const assert=require('node:assert/strict');
const {Store,validateDatabase}=require('../src/store.cjs');
const {available}=require('../src/workshop.cjs');
const car=(s,name='Corvette')=>s.mutate('car.save',{data:{name,technical:{weight:'80'}}}).result;
const part=(s,name='Tyres',quantity=4,tracking='quantity')=>s.mutate('part.save',{data:{name,quantity,tracking,category:'Tyres',condition:'New'}}).result;
const act=(s,action,p={})=>s.mutate(action,{...p,revision:s.data.revision}).result;
const assembly=(s,p)=>act(s,'assembly.create',{name:'Rear axle',components:[{partId:p,quantity:2,field:'rearTyres',position:'Rear'}]});
const saved=(s,c)=>{s.mutate('setup.save',{carId:c,name:'Club setup'});return s.data.setups[0].id;};
function plan(s,id,selections){const options=s.plan('setup.options',{id});return {id,revision:options.revision,selections:selections||Object.fromEntries(options.rows.map(r=>[r.key,r.selected]))};}

test('assemblies reserve dedicated stock without increasing owned quantities',()=>{
  const s=new Store(),p=part(s),a=assembly(s,p),c=car(s);
  assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),4);
  assert.equal(available(s.data,s.data.parts.find(x=>x.id===p)),2);
  const component=s.data.assemblies[0].components[0];assert.equal(available(s.data,s.data.parts.find(x=>x.id===component.partId)),0);
  const before=s.snapshot();assert.throws(()=>s.mutate('part.install',{carId:c,partId:component.partId,quantity:1}),/Assembly stock/);assert.deepEqual(s.snapshot(),before);
  assert.throws(()=>s.mutate('part.save',{id:component.partId,data:{name:'Changed',tracking:'quantity',quantity:2}}),/Dismantle/);
  act(s,'assembly.install',{id:a,carId:c});assert.equal(s.data.cars[0].technical.rearTyres,'Tyres');
  assert.throws(()=>s.mutate('part.remove',{id:s.data.installations[0].id,destination:'spares'}),/complete assembly/);
});
test('assembly removal preserves group and separates used components from untouched stock',()=>{
  const s=new Store(),p=part(s),a=assembly(s,p),c=car(s);act(s,'assembly.install',{id:a,carId:c});act(s,'assembly.remove',{id:a,location:'Case B'});
  assert.equal(s.data.assemblies[0].carId,null);assert.equal(s.data.parts.find(x=>x.id===p).condition,'New');
  const member=s.data.parts.find(x=>x.id===s.data.assemblies[0].components[0].partId);assert.equal(member.condition,'Used');assert.equal(member.location,'Case B');assert.equal(available(s.data,member),0);
  act(s,'assembly.dismantle',{id:a});assert.equal(available(s.data,s.data.parts.find(x=>x.id===member.id)),2);
});
test('assembly transfers require confirmation and occupied destinations roll back completely',()=>{
  const s=new Store(),p=part(s),a=assembly(s,p),c=car(s,'A'),d=car(s,'B');act(s,'assembly.install',{id:a,carId:c});
  assert.throws(()=>act(s,'assembly.install',{id:a,carId:d}),/Confirm/);
  s.mutate('part.install',{carId:d,partId:p,quantity:1,field:'rearTyres'});const before=s.snapshot();
  assert.throws(()=>act(s,'assembly.install',{id:a,carId:d,allowTransfer:true}),/occupied/);assert.deepEqual(s.snapshot(),before);
  s.mutate('part.remove',{id:s.data.installations.find(i=>i.carId===d).id,destination:'spares'});
  act(s,'assembly.install',{id:a,carId:d,allowTransfer:true});assert.equal(s.data.assemblies[0].carId,d);
  assert.equal(s.data.installations.filter(i=>!i.removed&&i.carId===c).length,0);assert.ok(s.data.events.some(e=>e.carId===c&&e.title.startsWith('Transferred assembly')));
});
test('dismantling an installed assembly leaves components installed separately',()=>{
  const s=new Store(),p=part(s),a=assembly(s,p),c=car(s);act(s,'assembly.install',{id:a,carId:c});const id=saved(s,c);act(s,'assembly.dismantle',{id:a});
  assert.equal(s.data.installations[0].assemblyId,undefined);assert.equal(s.data.installations[0].removed,null);
  assert.equal(s.data.setups.find(x=>x.id===id).installations[0].assemblyId,a);assert.equal(s.plan('setup.options',{id}).rows[0].selected,'');
});
test('setup preview is read only and apply returns removed quantity stock to used spares',()=>{
  const s=new Store(),c=car(s),id=saved(s,c),p=part(s);s.mutate('part.install',{carId:c,partId:p,quantity:2,field:'rearTyres'});
  const payload=plan(s,id),before=s.snapshot(),preview=s.plan('setup.preview',payload);assert.deepEqual(s.snapshot(),before);assert.match(preview.changes[0],/Return 2/);
  assert.throws(()=>s.mutate('setup.apply',payload),/physical/);assert.deepEqual(s.snapshot(),before);
  s.mutate('setup.apply',{...payload,confirmed:true});assert.equal(s.data.installations.filter(i=>!i.removed).length,0);
  assert.equal(s.data.parts.find(x=>x.id===p).quantity,2);assert.equal(s.data.parts.find(x=>x.id!==p).condition,'Used');
});
test('explicit substitute sets actual component name while keeping original snapshot immutable',()=>{
  const s=new Store(),c=car(s),p=part(s,'Original',1,'individual');s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'motor'});const id=saved(s,c),snapshot=structuredClone(s.data.setups[0]);
  s.mutate('part.remove',{id:s.data.installations[0].id,destination:'discarded'});const replacement=part(s,'Replacement',1,'individual');
  assert.equal(plan(s,id).selections[0],'');const payload=plan(s,id,{'0':'p:'+replacement});s.mutate('setup.apply',{...payload,confirmed:true});
  assert.equal(s.data.cars[0].technical.motor,'Replacement');assert.deepEqual(s.data.setups[0],snapshot);assert.match(s.data.events[0].notes,/substitute for Original/);
});
test('loose components can transfer from another car only with explicit confirmation',()=>{
  const s=new Store(),c=car(s,'A'),d=car(s,'B'),p=part(s,'Motor',1,'individual');s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'motor'});const id=saved(s,c);
  s.mutate('part.remove',{id:s.data.installations[0].id,destination:'spares'});s.mutate('part.install',{carId:d,partId:p,quantity:1,field:'motor'});
  const donor=s.data.installations.find(i=>!i.removed),payload=plan(s,id,{'0':'i:'+donor.id}),before=s.snapshot();
  assert.equal(s.plan('setup.preview',payload).transfers.length,1);assert.throws(()=>s.mutate('setup.apply',{...payload,confirmed:true}),/listed transfers/);assert.deepEqual(s.snapshot(),before);
  s.mutate('setup.apply',{...payload,confirmed:true,allowTransfers:true});assert.equal(s.data.cars.find(x=>x.id===d).technical.motor,'');assert.equal(s.data.installations.filter(i=>!i.removed).length,1);
});
test('saved assembly can be applied intact from another car with both histories updated',()=>{
  const s=new Store(),c=car(s,'A'),d=car(s,'B'),p=part(s),a=assembly(s,p);act(s,'assembly.install',{id:a,carId:c});const id=saved(s,c);
  act(s,'assembly.install',{id:a,carId:d,allowTransfer:true});const payload=plan(s,id);assert.equal(s.plan('setup.preview',payload).transfers.length,1);
  s.mutate('setup.apply',{...payload,confirmed:true,allowTransfers:true});assert.equal(s.data.assemblies[0].carId,c);assert.equal(s.data.cars.find(x=>x.id===d).technical.rearTyres,'');
  assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),4);validateDatabase(s.snapshot());
});
test('stale setup review and missing stock never partly apply changes',()=>{
  const s=new Store(),c=car(s),p=part(s,'Motor',1,'individual');s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'motor'});const id=saved(s,c),payload=plan(s,id);
  s.mutate('settings.save',{name:'Changed'});const before=s.snapshot();assert.throws(()=>s.mutate('setup.apply',{...payload,confirmed:true}),/database changed/);assert.deepEqual(s.snapshot(),before);
  const missing=plan(s,id,{'0':'p:missing'});assert.throws(()=>s.mutate('setup.apply',{...missing,confirmed:true}),/available/);assert.deepEqual(s.snapshot(),before);
});
test('applying a settings-only setup removes complete assemblies without dismantling them',()=>{
  const s=new Store(),c=car(s),id=saved(s,c),p=part(s),a=assembly(s,p);act(s,'assembly.install',{id:a,carId:c});s.mutate('setup.apply',{...plan(s,id),confirmed:true});
  assert.equal(s.data.assemblies[0].carId,null);assert.ok(!s.data.assemblies[0].dismantled);assert.equal(s.data.installations.filter(i=>!i.removed).length,0);
});
test('legacy v0.1 backups migrate without losing cars, setups, photos or stock',()=>{
  const old=new Store(),c=car(old),p=part(old);old.mutate('part.install',{carId:c,partId:p,quantity:2,field:'rearTyres'});saved(old,c);
  const legacy=old.snapshot();legacy.schema=1;delete legacy.assemblies;const s=new Store();s.restore(legacy,0);
  assert.equal(s.data.schema,8);assert.deepEqual(s.data.assemblies,[]);assert.deepEqual(s.data.cars,legacy.cars);assert.deepEqual(s.data.setups,legacy.setups);assert.deepEqual(s.data.parts,legacy.parts);
  assert.equal(legacy.schema,1);assert.equal(legacy.assemblies,undefined);
});
test('assembly creation and setup application roll back if persistence fails',()=>{
  const s=new Store(),c=car(s),id=saved(s,c),p=part(s),before=s.snapshot();s.persist=()=>{throw Error('Disk full');};
  assert.throws(()=>assembly(s,p),/Disk full/);assert.deepEqual(s.snapshot(),before);assert.throws(()=>s.mutate('setup.apply',{...plan(s,id),confirmed:true}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('two positions can draw from the same quantity lot without overbooking it',()=>{
  const s=new Store(),c=car(s),p=part(s,'All-round tyres',8);
  for(const field of ['frontTyres','rearTyres'])s.mutate('part.install',{carId:c,partId:p,quantity:2,field});
  const id=saved(s,c),original=s.data.installations.map(i=>i.id);s.mutate('setup.apply',{...plan(s,id),confirmed:true});
  assert.deepEqual(s.data.installations.filter(i=>!i.removed).map(i=>i.id),original,'unchanged installations keep their original identities');
  for(const installation of original)s.mutate('part.remove',{id:installation,destination:'spares'});
  const payload=plan(s,id,{'0':'p:'+p,'1':'p:'+p});s.mutate('setup.apply',{...payload,confirmed:true});assert.equal(available(s.data,s.data.parts.find(x=>x.id===p)),0);
  const before=s.snapshot();assert.throws(()=>s.mutate('setup.apply',{...plan(s,id,{'0':'p:'+p,'1':'p:'+p}),confirmed:true}),/Insufficient/);assert.deepEqual(s.snapshot(),before);
});
test('an assembly can use one quantity lot in multiple distinct positions',()=>{
  const s=new Store(),p=part(s,'Tyres',4);act(s,'assembly.create',{name:'Complete running gear',components:[{partId:p,quantity:2,field:'frontTyres'},{partId:p,quantity:2,field:'rearTyres'}]});
  assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),4);assert.notEqual(s.data.assemblies[0].components[0].partId,s.data.assemblies[0].components[1].partId);validateDatabase(s.snapshot());
});
test('a setup cannot consume more than the combined available quantity',()=>{
  const s=new Store(),c=car(s),p=part(s,'Tyres',4);for(const field of ['frontTyres','rearTyres'])s.mutate('part.install',{carId:c,partId:p,quantity:2,field});const id=saved(s,c);
  const limited=part(s,'Alternative tyres',3),before=s.snapshot();
  assert.throws(()=>s.mutate('setup.apply',{...plan(s,id,{'0':'p:'+limited,'1':'p:'+limited}),confirmed:true}),/no longer available/);assert.deepEqual(s.snapshot(),before);
});
