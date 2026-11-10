'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {open}=require(process.env.SLOTFORGE_MERGE_TEST_ENGINE||'../packages/shared-library/index.cjs'),S=require('../src/sqlite-storage.cjs'),M=require('../src/car-merge-model.cjs');
const schema=require('./fixtures/contracts/car-merges-v1/timing-settings.schema.json'),validate=require('../src/timing-schema.cjs').validate;
async function fixture(t){
 const root=require('./support/temp-dir.cjs')('merge-settings-'),h=await open({application:'Timing',installationId:'timing-test',sharedRoot:root});
 t.after(async()=>{await h.close();fs.rmSync(root,{recursive:true,force:true});});
 const status=await h.status(),identity={databaseId:status.databaseId,recoveryId:status.recoveryId},sourceId='timing-test';
 const main=await h.adoptCar({...identity,operationId:'main',sourceId,originalId:'main-original',data:{name:'Main car'},rawOriginal:{damageFactor:2,tyreCompound:'M',picture:'preserve unchanged'}});
 const old=await h.adoptCar({...identity,operationId:'old',sourceId,originalId:'old-original',data:{name:'Duplicate'},rawOriginal:{damageFactor:0,failureFactor:null,tyreCompound:'SS'}});
 const before=S.read(status.file);let db=before,n=0;
 function cmd(action,payload){const out=M.prepare(db,{...identity,sourceId:'reviewer',operationId:'review-'+ ++n,action,payload},{recoveryId:identity.recoveryId,backup:{verified:true,path:'synthetic-reader-fixture',digest:'a'.repeat(64),databaseId:identity.databaseId,recoveryId:identity.recoveryId,dependencyToken:action==='approve'?M.token(db,main.carId,old.carId):undefined}});db=out.data;return out.result;}
 let p=cmd('create',{mainCarId:main.carId,retiredCarId:old.carId});const choices=structuredClone(p.choices);choices.settings['["timing-test","damageFactor"]']='["incoming","origin:old-original"]';p=cmd('save',{id:p.id,expectedRevision:p.revision,choices});cmd('approve',{id:p.id,expectedRevision:p.revision});
 // Synthetic committed state for common-engine protocol tests. Real backup
 // atomicity is covered separately by car-merges.test.cjs qualification.
 S.write(status.file,S.packChanges(before,db),JSON.stringify([before.id,before.revision]));
 return {h,identity,sourceId,main,old,file:status.file};
}
test('effective settings are source-scoped, preserve zero and original companions, and reject retired edits',async t=>{
 const {h,identity,sourceId,main,old}=await fixture(t),value=await h.timingSettings({carId:main.carId,sourceId});
 validate(value,schema.$defs.projection);
 assert.equal(value.localCarId,'main-original');assert.equal(value.fields.damageFactor,0);assert.equal(value.effective.damageFactor,0);assert.equal(value.effective.failureFactor,1);
 const evidence=await h.extensionRead({namespace:'timing.carExtras',sourceId,originalId:'old-original'});assert.equal(evidence.value.tyreCompound,'SS');
 await assert.rejects(h.timingSettings({carId:old.carId,sourceId}),e=>{validate({code:e.code,message:e.message,details:e.details},schema.$defs.error);return e.code==='CAR_MERGED'&&e.details.identity.canonicalCarId===main.carId;});
 await assert.rejects(h.extensionWrite({...identity,operationId:'stale-old',namespace:'timing.carExtras',sourceId,originalId:'old-original',expectedRevision:1,patch:{damageFactor:5}}),e=>e.code==='CAR_MERGED'&&e.details.identity.requestedCarId===old.carId);
 await assert.rejects(h.extensionWrite({...identity,operationId:'stale-main',namespace:'timing.carExtras',sourceId,originalId:'main-original',expectedRevision:1,patch:{damageFactor:5}}),e=>{validate({code:e.code,message:e.message,details:e.details},schema.$defs.error);return e.code==='MERGE_SETTINGS_REQUIRED';});
 const other=await h.timingSettings({carId:main.carId,sourceId:'other-installation'});assert.equal(other.revision,0);assert.equal(other.localCarId,main.carId);assert.equal(other.effective.damageFactor,1);
 await assert.rejects(h.timingSettingsWrite({...identity,sourceId:'other-installation',carId:main.carId,operationId:'wrong-source',action:'bind',expectedRevision:0,expectedBindingToken:other.bindingToken}),{code:'SOURCE_MISMATCH'});
});
test('settings clears, token checks, lost acknowledgements and combined car edits are atomic',async t=>{
 const {h,identity,sourceId,main,file}=await fixture(t),value=await h.timingSettings({carId:main.carId,sourceId}),car=await h.car(main.carId);
 const input={...identity,operationId:'combined',action:'patch',carId:main.carId,expectedRevision:car.revision,set:{name:'Main renamed'},timingSettings:{expectedRevision:value.revision,expectedBindingToken:value.bindingToken,set:{damageFactor:null,failureFactor:0}}};
 const receipt=await h.carWrite(input),after=await h.timingSettings({carId:main.carId,sourceId});assert.equal(after.effective.damageFactor,1);assert.equal(after.effective.failureFactor,0);assert.equal(after.fields.damageFactor,null);
 assert.equal((await h.car(main.carId)).fields.name,'Main renamed');assert.deepEqual(receipt.timingSettings,after);
 const retry=await h.carWrite(input);assert.equal(retry.duplicate,true);assert.deepEqual(retry.timingSettings,receipt.timingSettings);
 const current=await h.car(main.carId),before=S.read(file);
 await assert.rejects(h.carWrite({...input,operationId:'stale-binding',expectedRevision:current.revision,set:{name:'Must not commit'}}),{code:'REVISION_CONFLICT'});assert.deepEqual(S.read(file),before);
 await assert.rejects(h.timingSettingsWrite({...identity,operationId:'clear-tyre',action:'patch',sourceId,carId:main.carId,expectedRevision:after.revision,expectedBindingToken:after.bindingToken,set:{tyreCompound:null}}),{code:'INVALID_FIELD'});
});
test('a source without an origin receives a stable persisted binding and idempotent bind receipt',async t=>{
 const {h,identity,sourceId}=await fixture(t),car=(await h.carWrite({...identity,operationId:'fresh-car',action:'create',set:{name:'No origin'}})).car;
 const value=await h.timingSettings({carId:car.id,sourceId}),input={...identity,sourceId,carId:car.id,operationId:'bind',action:'bind',expectedRevision:value.revision,expectedBindingToken:value.bindingToken};
 const saved=await h.timingSettingsWrite(input);assert.equal(saved.localCarId,car.id);assert.equal(saved.revision,1);assert.equal(saved.bindingId,value.bindingId);assert.deepEqual((await h.timingSettingsWrite(input)).effective,saved.effective);
 validate(saved,schema.$defs.writeReceipt);
 const again=await h.timingSettingsWrite({...input,operationId:'bind-again',expectedRevision:saved.revision,expectedBindingToken:saved.bindingToken});assert.equal(again.revision,1);
});

test('published settings examples preserve missing, null, zero and opaque tyre values',()=>{
 const f=require('./fixtures/contracts/car-merges-v1/fixtures/timing-settings.json'),settings=require('../src/car-merge-settings.cjs');
 validate(f.readRequest,schema.$defs.readRequest);validate(f.writeRequest,schema.$defs.writeRequest);
 for(const row of f.cases){validate(row.response,schema.$defs.projection);assert.deepEqual(row.response.fields,{...row.main,...row.selected});assert.deepEqual(row.response.effective,settings.effective(row.response.fields));}
 validate(f.writeReceipt,schema.$defs.writeReceipt);validate(f.retryReceipt,schema.$defs.writeReceipt);
 for(const p of f.invalidPatches){assert.throws(()=>validate(p,schema.$defs.fields));assert.throws(()=>settings.validateFields(p));}
});

test('storage refuses alterations to preserved Timing origins, original extras and binding identity',async t=>{
 const {file,sourceId,main}=await fixture(t),before=S.read(file);
 for(const change of [d=>{d.libraryOrigins.find(o=>o.entity==='car'&&o.carId===main.carId).originalId='changed';},d=>{d.libraryExtras.find(e=>e.namespace==='timing.carExtras').revision++;},d=>{d.mergeCompanions.find(e=>e.sourceId===sourceId).localCarId='changed';}]){
  const next=structuredClone(before);next.revision++;change(next);assert.throws(()=>S.write(file,S.packChanges(before,next),JSON.stringify([before.id,before.revision])),{code:'MERGE_IMMUTABLE'});assert.deepEqual(S.read(file),before);
 }
});

test('native optional blanks project as clears while originals and strict new writes are preserved',async t=>{
 const {h,identity,sourceId,file}=await fixture(t),settings=require('../src/car-merge-settings.cjs'),codec=require('../src/shared-library-evidence.cjs');
 const cases=[{damageFactor:''},{failureFactor:''},{serviceInterval:''},{damageFactor:'',failureFactor:'',serviceInterval:''},{damageFactor:0,failureFactor:null,tyreCompound:'custom-opaque'},{serviceInterval:null},{}];
 for(const [n,raw]of cases.entries()){
  const car=await h.adoptCar({...identity,operationId:'legacy-'+n,sourceId,originalId:'legacy-'+n,data:{name:'Legacy '+n},rawOriginal:raw});
  const before=S.read(file),original=before.libraryExtras.find(e=>e.originalId==='legacy-'+n),read=await h.timingSettings({carId:car.carId,sourceId});
  const expected=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v===''?null:v]));assert.deepEqual(read.fields,expected);assert.deepEqual(read.effective,settings.effective(expected));validate(read,schema.$defs.projection);
  const bound=await h.timingSettingsWrite({...identity,sourceId,carId:car.carId,operationId:'legacy-bind-'+n,action:'bind',expectedRevision:read.revision,expectedBindingToken:read.bindingToken});assert.deepEqual(bound.fields,expected);
  assert.deepEqual(S.read(file).libraryExtras.find(e=>e.id===original.id),original);assert.deepEqual(codec.decode(original),raw);
  await assert.rejects(h.timingSettingsWrite({...identity,sourceId,carId:car.carId,operationId:'invalid-blank-'+n,action:'patch',expectedRevision:bound.revision,expectedBindingToken:bound.bindingToken,set:{damageFactor:''}}),{code:'INVALID_FIELD'});
 }
 // Review treats a legacy blank and an explicit null as the same clear, not
 // conflicting originals. Missing remains distinct; unrelated invalid text stays invalid.
 const state=raw=>({libraryOrigins:[{entity:'car',carId:'a',sourceId:'s',originalId:'o'}],libraryExtras:[{namespace:'timing.carExtras',sourceId:'s',originalId:'o',...codec.encode(raw)}]});
 const blank=settings.states(state({damageFactor:''}),'a','s')[0],clear=settings.states(state({damageFactor:null}),'a','s')[0];assert.equal(settings.baseline([blank,clear],'damageFactor').ambiguous,false);
 for(const raw of [{damageFactor:'garbage'},{damageFactor:' '},{serviceInterval:0},{tyreCompound:''}])assert.throws(()=>settings.validateFields(settings.states(state(raw),'a','s')[0].fields),{code:'INVALID_FIELD'});
});
