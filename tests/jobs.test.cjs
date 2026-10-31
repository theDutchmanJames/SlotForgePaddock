const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store,migrate,validateDatabase,makePackage}=require('../src/store.cjs');
const {available}=require('../src/workshop.cjs');
const act=(s,a,p={})=>s.mutate(a,{...p,revision:s.data.revision}).result;
const car=(s,name='Car')=>s.mutate('car.save',{data:{name,technical:{weight:'80'}}}).result;
const part=(s,name='Motor',quantity=1,tracking='individual')=>s.mutate('part.save',{data:{name,quantity,tracking,category:'Component',condition:'New'}}).result;
const install=(s,c,p,field='motor',quantity=1)=>s.mutate('part.install',{carId:c,partId:p,quantity,field,position:field});
const save=(s,c)=>{s.mutate('setup.save',{carId:c,name:'Club target'});return s.data.setups[0].id;};
const start=(s,id)=>act(s,'job.start',{setupId:id});
const view=(s,id)=>s.plan('job.view',{id});
const step=(s,a,id,p={})=>act(s,a,{id,confirmed:true,...p});
function fixture(){const s=new Store(),c=car(s),p=part(s);install(s,c,p);const setup=save(s,c),j=start(s,setup);return {s,c,p,setup,j};}

test('starting a job freezes the target without moving stock or changing actual settings',()=>{
  const {s,c,setup,j}=fixture(),before=s.snapshot();assert.deepEqual(s.data.jobs[0].target,s.data.setups[0]);assert.equal(view(s,j).remaining,0);assert.deepEqual(s.snapshot(),before);
  assert.throws(()=>start(s,setup),/already has/);assert.deepEqual(s.snapshot(),before);
  assert.equal(s.data.cars.find(x=>x.id===c).technical.motor,'Motor');
  assert.equal(makePackage(s.data,[c],{setups:true}).cars[0].jobs,undefined);
});
test('partial jobs survive restart and preserve intended versus actual settings and used stock',t=>{
  const {s,c,j}=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-jobs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));s.file=path.join(dir,'database.json');
  step(s,'job.remove',j,{installationId:s.data.installations[0].id});
  s.mutate('car.save',{id:c,revision:s.data.cars[0].revision,data:{technical:{weight:'90'}}});
  const reopened=new Store(s.file);assert.equal(view(reopened,j).remaining,2);assert.equal(reopened.data.cars[0].technical.motor,'');assert.equal(reopened.data.jobs[0].target.technical.motor,'Motor');
  step(reopened,'job.setting',j,{key:'weight'});assert.equal(view(reopened,j).remaining,1);assert.equal(reopened.data.parts[0].condition,'Used');
});
test('explicit substitutes complete jobs with actual configuration while targets remain immutable',()=>{
  const {s,c,j}=fixture(),target=structuredClone(s.data.jobs[0].target);step(s,'job.remove',j,{installationId:s.data.installations[0].id});const replacement=part(s,'Fast motor');
  step(s,'job.fit',j,{key:'0',selection:'p:'+replacement});assert.equal(view(s,j).remaining,0);assert.equal(view(s,j).rows[0].actual,'Fast motor');
  step(s,'job.complete',j);assert.equal(s.data.jobs[0].actual.technical.motor,'Fast motor');assert.equal(s.data.jobs[0].actual.installations[0].partId,replacement);assert.deepEqual(s.data.jobs[0].target,target);
  const old=s.data.jobs[0].actual;s.mutate('car.save',{id:c,revision:s.data.cars[0].revision,data:{technical:{weight:'85'}}});assert.deepEqual(s.data.jobs[0].actual,old);assert.throws(()=>step(s,'job.setting',j,{key:'weight'}),/closed/);
});
test('missing stock, occupied slots, stale revisions and unconfirmed steps roll back',()=>{
  const {s,j}=fixture(),replacement=part(s,'Replacement'),before=s.snapshot();
  assert.throws(()=>step(s,'job.fit',j,{key:'0',selection:'p:'+replacement}),/occupied/);assert.deepEqual(s.snapshot(),before);
  assert.throws(()=>step(s,'job.fit',j,{key:'0',selection:'p:missing'}),/available/);assert.deepEqual(s.snapshot(),before);
  assert.throws(()=>s.mutate('job.remove',{id:j,revision:s.data.revision,installationId:s.data.installations[0].id}),/physical/);assert.deepEqual(s.snapshot(),before);
  assert.throws(()=>s.mutate('job.complete',{id:j,revision:s.data.revision-1,confirmed:true}),/database changed/);assert.deepEqual(s.snapshot(),before);
});
test('outside physical edits reopen completed checklist steps and prevent premature completion',()=>{
  const {s,c,j}=fixture();s.mutate('part.remove',{id:s.data.installations[0].id,destination:'spares'});assert.equal(view(s,j).rows[0].done,false);assert.throws(()=>step(s,'job.complete',j),/outstanding/);
  const replacement=part(s,'Other motor');install(s,c,replacement);assert.equal(view(s,j).extras.length,1);const row=s.data.installations.find(i=>!i.removed);
  step(s,'job.fit',j,{key:'0',selection:'i:'+row.id});assert.equal(view(s,j).remaining,0);
  s.mutate('car.save',{id:c,revision:s.data.cars[0].revision,data:{technical:{weight:'95'}}});assert.equal(view(s,j).remaining,1);
});
test('job transfers require confirmation and preserve donor history',()=>{
  const {s,j,p}=fixture(),donor=car(s,'Donor');step(s,'job.remove',j,{installationId:s.data.installations[0].id});install(s,donor,p);const row=s.data.installations.find(i=>!i.removed),before=s.snapshot();
  assert.throws(()=>step(s,'job.fit',j,{key:'0',selection:'i:'+row.id}),/Confirm the transfer/);assert.deepEqual(s.snapshot(),before);
  step(s,'job.fit',j,{key:'0',selection:'i:'+row.id,allowTransfer:true});assert.equal(view(s,j).remaining,0);assert.equal(s.data.cars.find(c=>c.id===donor).technical.motor,'');assert.ok(s.data.events.some(e=>e.carId===donor&&e.title==='Transferred Motor'));
});
test('cancel keeps partial physical work and allows a new job',()=>{
  const {s,j,setup}=fixture();step(s,'job.remove',j,{installationId:s.data.installations[0].id});step(s,'job.cancel',j);assert.equal(s.data.jobs[0].status,'cancelled');assert.equal(s.data.jobs[0].actual.installations.length,0);assert.equal(s.data.cars[0].technical.motor,'');assert.ok(start(s,setup));
});
test('current test records capture partial actual inventory and job identity; historical tests stay explicit',()=>{
  const {s,c,j,setup}=fixture();step(s,'job.remove',j,{installationId:s.data.installations[0].id});const replacement=part(s,'Actual motor');step(s,'job.fit',j,{key:'0',selection:'p:'+replacement});
  s.mutate('test.add',{carId:c,track:'Home'});const actual=structuredClone(s.data.tests[0]);assert.equal(actual.jobId,j);assert.equal(actual.technical.motor,'Actual motor');assert.equal(actual.installations[0].partId,replacement);assert.equal(actual.configurationSource,'current');
  s.mutate('test.add',{carId:c,setupId:setup});assert.equal(s.data.tests[0].technical.motor,'Motor');assert.equal(s.data.tests[0].configurationSource,'saved');assert.equal(s.data.tests[0].jobId,undefined);
  step(s,'job.remove',j,{installationId:s.data.installations.find(i=>!i.removed).id});assert.deepEqual(s.data.tests[1],actual);
});
test('job writes and assembly replacements roll back on persistence failure',()=>{
  const {s,j}=fixture(),before=s.snapshot();s.persist=()=>{throw Error('Disk full');};assert.throws(()=>step(s,'job.remove',j,{installationId:s.data.installations[0].id}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
function grouped(){const s=new Store(),c=car(s),tyres=part(s,'Tyres',6,'quantity'),motor=part(s),a=act(s,'assembly.create',{name:'Drive unit',components:[{partId:tyres,quantity:2,field:'rearTyres',position:'Rear'},{partId:motor,quantity:1,field:'motor',position:'Motor'}]});return {s,c,a,tyres,motor};}
test('stored assembly replacement releases used stock, reserves a new dedicated lot and keeps identity',()=>{
  const {s,a}=grouped(),replacement=part(s,'Soft tyres',8,'quantity'),old=s.data.assemblies[0].components[0].partId,total=s.data.parts.reduce((n,p)=>n+p.quantity,0);
  act(s,'assembly.replace',{id:a,componentId:old,partId:replacement,confirmed:true});const assembly=s.data.assemblies[0],p=s.data.parts.find(p=>p.id===old),newId=assembly.components[0].partId;
  assert.equal(assembly.id,a);assert.equal(p.condition,'Used');assert.equal(available(s.data,p),2);assert.equal(s.data.parts.find(p=>p.id===replacement).quantity,6);assert.equal(available(s.data,s.data.parts.find(p=>p.id===newId)),0);assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),total);assert.equal(assembly.history[0].before[0].partId,old);validateDatabase(s.snapshot());
});
test('installed assembly replacement changes only the member and keeps historical setups and tests',()=>{
  const {s,c,a,motor}=grouped();act(s,'assembly.install',{id:a,carId:c});const setup=save(s,c),target=structuredClone(s.data.setups[0]),untouched=s.data.installations.find(i=>i.field==='rearTyres').id;
  s.mutate('test.add',{carId:c});const originalTest=structuredClone(s.data.tests[0]),replacement=part(s,'New motor');act(s,'assembly.replace',{id:a,componentId:motor,partId:replacement,confirmed:true});
  assert.equal(s.data.cars[0].technical.motor,'New motor');assert.equal(s.data.installations.find(i=>i.id===untouched).removed,null);assert.ok(s.data.installations.find(i=>i.partId===motor).removed);assert.deepEqual(s.data.setups[0],target);assert.deepEqual(s.data.tests[0],originalTest);
  const j=start(s,setup);assert.equal(view(s,j).rows[0].done,false);step(s,'job.fit',j,{key:'0',selection:'a:'+a});assert.equal(view(s,j).remaining,0);
});
test('replacement rejects reserved, insufficient, stale, unconfirmed stock without changing the group',()=>{
  const {s,a,motor}=grouped(),small=part(s,'One tyre'),old=s.data.assemblies[0].components[0].partId,before=s.snapshot();
  for(const p of [{componentId:old,partId:small,confirmed:true},{componentId:motor,partId:small},{componentId:old,partId:motor,confirmed:true}]){assert.throws(()=>act(s,'assembly.replace',{id:a,...p}));assert.deepEqual(s.snapshot(),before);}
  s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'assembly.replace',{id:a,componentId:motor,partId:small,confirmed:true}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('assembly job removal stays intact and confirmation is invalidated by a later member replacement',()=>{
  const {s,c,a,motor}=grouped();act(s,'assembly.install',{id:a,carId:c});const j=start(s,save(s,c));assert.equal(view(s,j).remaining,0);
  step(s,'job.remove',j,{installationId:s.data.installations[0].id});assert.equal(s.data.assemblies[0].carId,null);assert.equal(s.data.installations.filter(i=>!i.removed).length,0);
  step(s,'job.fit',j,{key:'0',selection:'a:'+a});const replacement=part(s,'New motor');act(s,'assembly.replace',{id:a,componentId:motor,partId:replacement,confirmed:true});assert.equal(view(s,j).rows[0].done,false);assert.throws(()=>step(s,'job.complete',j),/outstanding/);
});
test('schema 3 migrates to jobs without losing data; malformed job backup is rejected',()=>{
  const {s,j}=fixture(),legacy=s.snapshot();legacy.schema=3;delete legacy.jobs;const upgraded=migrate(legacy);assert.equal(upgraded.schema,9);assert.deepEqual(upgraded.jobs,[]);assert.deepEqual(upgraded.cars,legacy.cars);assert.equal(legacy.schema,3);
  const corrupt=s.snapshot();corrupt.jobs[0].target.technical.motor='Changed';assert.throws(()=>migrate(corrupt),/target snapshot/);
  const duplicate=s.snapshot();duplicate.jobs.push({...duplicate.jobs[0],id:'another'});assert.throws(()=>migrate(duplicate),/one active/);
  step(s,'job.complete',j);const restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.data.jobs,s.data.jobs);
});
test('assembly replacement history prevents rewriting a formerly reserved individual as quantity stock',()=>{
  const {s,a,motor}=grouped(),replacement=part(s,'Replacement');act(s,'assembly.replace',{id:a,componentId:motor,partId:replacement,confirmed:true});const before=s.snapshot();
  assert.throws(()=>s.mutate('part.save',{id:motor,data:{name:'Motor',quantity:2,tracking:'quantity'}}),/Cannot change tracking/);assert.deepEqual(s.snapshot(),before);
});
test('staged quantity replacements keep piece counts and new versus used lots separate',()=>{
  const s=new Store(),c=car(s),p=part(s,'Tyres',8,'quantity');install(s,c,p,'frontTyres',2);install(s,c,p,'rearTyres',2);const j=start(s,save(s,c));
  const rows=s.data.installations.slice();for(const i of rows)step(s,'job.remove',j,{installationId:i.id});
  assert.equal(s.data.parts.find(x=>x.id===p).quantity,4);assert.equal(s.data.parts.filter(p=>p.condition==='Used').reduce((n,p)=>n+p.quantity,0),4);
  step(s,'job.fit',j,{key:'0',selection:'p:'+p});assert.equal(view(s,j).remaining,1);step(s,'job.fit',j,{key:'1',selection:'p:'+p});assert.equal(view(s,j).remaining,0);assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),8);
});
test('untracked specifications and extra inventory are individually resolved before a job completes',()=>{
  const s=new Store(),c=car(s),setup=save(s,c),p=part(s);install(s,c,p);const j=start(s,setup);assert.equal(view(s,j).extras.length,1);assert.equal(view(s,j).settings.find(r=>r.key==='motor').target,'');
  assert.throws(()=>step(s,'job.setting',j,{key:'motor'}),/Remove the tracked component/);step(s,'job.remove',j,{installationId:s.data.installations[0].id});assert.equal(view(s,j).remaining,0);step(s,'job.complete',j);
});
