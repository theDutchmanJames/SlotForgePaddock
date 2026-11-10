const test=require('node:test'),assert=require('node:assert/strict');
const {Store,initial,migrate,makePackage}=require('../src/store.cjs');
const Model=require('../renderer/build-model.js');
const w=require('../src/workshop.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
const part=(s,name='Motor',quantity=2)=>act(s,'part.save',{data:{name,quantity,tracking:'quantity',category:'Motors & motor parts',partType:'Motor'}});
const row=(partId,slot='motor',quantity=1,key='row')=>({key,partId,slot,quantity,position:'Extra',name:'Cached part name'});
const data=parts=>({...Model.blank(),name:'Scratch car',parts});

test('one part creates a normal car, installed inventory, history and optional initial setup',()=>{
  const s=new Store(),p=part(s),d=data([row(p)]);d.usage=['Club racing'];d.notes='Private build instructions';
  const before=s.snapshot(),preview=s.plan('build.preview',{data:d});assert.deepEqual(s.snapshot(),before);assert.equal(preview.pieces,1);
  const id=act(s,'build.create',{data:d,confirmed:true});const c=s.data.cars.find(c=>c.id===id);
  assert.equal(c.name,'Scratch car');assert.equal(c.technical.motor,'Motor');assert.equal(c.technical.chassis,undefined);
  assert.equal(s.data.parts[0].quantity,2);assert.equal(w.available(s.data,s.data.parts[0]),1);assert.equal(s.data.installations[0].carId,id);
  assert.equal(s.data.setups[0].name,'As built');assert.equal(s.data.setups[0].installations[0].partId,p);assert.equal(s.data.setups[0].installations[0].name,'Motor');
  assert.ok(s.data.events.some(e=>e.type==='created'&&e.installations.length===1));
  assert.equal(makePackage(s.data,[id]).cars[0].privateNotes,undefined);
  assert.equal(JSON.stringify(makePackage(s.data,[id],{setups:true})).includes(d.notes),false);
  act(s,'car.save',{id,revision:c.revision,data:{name:'Edited normally'}});assert.equal(s.data.cars[0].name,'Edited normally');
});
test('arbitrary inventory-only parts and a partial paired position are sufficient',()=>{
  const s=new Store(),p=part(s,'Single tyre',1),d=data([row(p,'frontTyres',1)]);d.saveSetup=false;
  act(s,'build.create',{data:d,confirmed:true});assert.equal(s.data.installations[0].quantity,1);assert.equal(s.data.setups.length,0);
  const extra=part(s,'Custom widget');act(s,'build.create',{data:data([row(extra,'')]),confirmed:true});assert.equal(s.data.installations.at(-1).field,'');
});
test('empty, unnamed, unconfirmed and malformed builds leave every record unchanged',()=>{
  const s=new Store(),p=part(s);const cases=[{data:data([]),confirmed:true},{data:{...data([row(p)]),name:' '},confirmed:true},{data:data([row(p)])}];
  for(const quantity of [0,-1,1.5,'1',null])cases.push({data:data([row(p,'motor',quantity)]),confirmed:true});
  for(const payload of cases){const before=s.snapshot();assert.throws(()=>act(s,'build.create',payload));assert.deepEqual(s.snapshot(),before);}
});
test('repeated stock assignments are aggregated and overlapping technical positions are rejected',()=>{
  const s=new Store(),p=part(s,'Tyres',3);
  for(const parts of [[row(p,'frontTyres',2),row(p,'rearTyres',2,'other')],[row(p,'motor'),row(p,'motor',1,'other')]]){
    const before=s.snapshot();assert.throws(()=>act(s,'build.create',{data:data(parts),confirmed:true}));assert.deepEqual(s.snapshot(),before);
  }
  act(s,'build.create',{data:data([row(p,'frontTyres',1),row(p,'rearTyres',2,'other')]),confirmed:true});assert.equal(w.available(s.data,s.data.parts[0]),0);
});
test('stock changes and stale reviews cannot create a partial car or consume a draft',()=>{
  const s=new Store(),p=part(s,'Motor',1),d=data([row(p)]),draftId=act(s,'build.draft.save',{data:d}),preview=s.plan('build.preview',{data:d,draftId});
  act(s,'part.save',{id:p,data:{name:'Motor',quantity:0,tracking:'quantity'}});
  const before=s.snapshot();assert.throws(()=>s.mutate('build.create',{revision:preview.revision,data:d,draftId,confirmed:true}),/changed/);
  assert.throws(()=>act(s,'build.create',{data:d,draftId,confirmed:true}),/stock/);assert.deepEqual(s.snapshot(),before);
});
test('drafts persist in backups without reserving stock and tolerate removed stock',()=>{
  const s=new Store(),p=part(s,'Motor',1),d=data([row(p)]),id=act(s,'build.draft.save',{data:d});
  assert.equal(s.data.cars.length,0);assert.equal(w.available(s.data,s.data.parts[0]),1);
  const restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.data.buildDrafts,s.data.buildDrafts);
  assert.throws(()=>act(s,'part.delete',{id:p}),/saved build drafts/);s.transact(db=>{db.parts=[];});assert.equal(s.data.buildDrafts.length,1);assert.throws(()=>s.plan('build.preview',{data:d,draftId:id}),/no longer exists/);
  act(s,'build.draft.delete',{id});assert.equal(s.data.buildDrafts.length,0);
});
test('a completed build consumes only its own draft and preserves an immutable setup',()=>{
  const s=new Store(),p=part(s),d=data([row(p)]),id=act(s,'build.draft.save',{data:d}),other=act(s,'build.draft.save',{data:Model.blank()});
  act(s,'build.create',{data:d,draftId:id,confirmed:true});assert.deepEqual(s.data.buildDrafts.map(d=>d.id),[other]);
  const initialSetup=structuredClone(s.data.setups[0]);act(s,'part.remove',{id:s.data.installations[0].id,destination:'spares'});assert.deepEqual(s.data.setups[0],initialSetup);
});
test('stored assemblies install together without double counting reserved components',()=>{
  const s=new Store(),p=part(s,'Motor',1),aId=act(s,'assembly.create',{name:'Pod unit',components:[{partId:p,quantity:1,field:'motor',position:'Motor'}]});
  const a=s.data.assemblies[0],d={...data([]),assemblies:[{id:aId,name:a.name,signature:Model.signature(a)}]};
  assert.equal(w.available(s.data,s.data.parts[0]),0);const id=act(s,'build.create',{data:d,confirmed:true});
  assert.equal(s.data.assemblies[0].carId,id);assert.equal(s.data.installations.length,1);assert.equal(s.data.installations[0].assemblyId,aId);assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),1);assert.equal(s.data.setups[0].installations[0].assemblyName,'Pod unit');
  assert.throws(()=>act(s,'build.create',{data:d,confirmed:true}),/already installed/);
});
test('assemblies cannot overlap loose selections, be duplicated, or silently change after drafting',()=>{
  const s=new Store(),p=part(s,'Motor',2),aId=act(s,'assembly.create',{name:'Pod unit',components:[{partId:p,quantity:1,field:'motor',position:'Motor'}]}),a=s.data.assemblies[0];
  const assembly={id:aId,name:a.name,signature:Model.signature(a)},d={...data([]),assemblies:[assembly]};
  for(const altered of [{...d,parts:[row(p)]},{...d,assemblies:[assembly,assembly]},{...d,assemblies:[{...assembly,signature:'changed'}]}]){
    const before=s.snapshot();assert.throws(()=>act(s,'build.create',{data:altered,confirmed:true}));assert.deepEqual(s.snapshot(),before);
  }
  const reserved=a.components[0].partId;assert.throws(()=>act(s,'build.create',{data:data([row(reserved)]),confirmed:true}),/assembly/);
});
test('failed persistence rolls back car creation, assembly placement and draft removal together',()=>{
  const s=new Store(),p=part(s),axle=part(s,'Axle',1),aId=act(s,'assembly.create',{name:'Rear axle',components:[{partId:axle,quantity:1,field:'rearAxle',position:'Rear axle'}]}),a=s.data.assemblies[0];
  const d={...data([row(p)]),assemblies:[{id:aId,name:a.name,signature:Model.signature(a)}]},draftId=act(s,'build.draft.save',{data:d}),before=s.snapshot();s.persist=()=>{throw Error('Disk full');};
  assert.throws(()=>act(s,'build.create',{data:d,draftId,confirmed:true}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('schema 7 upgrades on the next write and invalid restored build drafts are rejected',()=>{
  const legacy=initial();legacy.schema=7;delete legacy.buildDrafts;const before=structuredClone(legacy),next=migrate(legacy);
  assert.equal(next.schema,11);assert.deepEqual(next.buildDrafts,[]);assert.deepEqual(legacy,before);
  const s=new Store();act(s,'build.draft.save',{data:Model.blank()});const bad=s.snapshot();bad.buildDrafts[0].data.parts=[row('__proto__')];assert.throws(()=>migrate(bad));
});
