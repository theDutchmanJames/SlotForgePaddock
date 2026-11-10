'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {host,request,until}=require('./support/local-recovery-qualification.cjs'),{Store}=require('../src/store.cjs');
test('shared creates, patches and archive receipts recover from real process death around commit',{timeout:120000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-shared-'));const store=new Store(path.join(root,'database.sqlite'));store.persist(store.data);let h;
 try{
  h=await host(root);const schema=await request(h,'/v1/local-library/car-schema');assert.equal(schema.status,200);const create={version:1,databaseId:store.data.id,recoveryId:schema.value.recoveryId,sourceId:'timing-crash',operationId:'create-1',action:'create',set:{name:'Recover this car',weight:81}};
  const post=input=>request(h,'/v1/local-library/car-operations',input),receipt=operationId=>request(h,'/v1/local-library/car-operations/timing-crash/'+operationId,undefined,{'X-SlotForge-Recovery':create.recoveryId});
  const crash=async(mode,input)=>{fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode}));const pending=post(input).catch(e=>({error:e.message}));await until(()=>fs.existsSync(path.join(root,'crash-reached.json')),'shared SQLite '+mode);await h.kill();await pending;fs.unlinkSync(path.join(root,'crash-reached.json'));h=await host(root);};
  await crash('before-commit',create);assert.equal((await receipt('create-1')).value.code,'OPERATION_NOT_FOUND');assert.equal((await request(h,'/v1/scalable/cars')).value.cars.length,0);
  await crash('after-commit',create);const saved=await receipt('create-1');assert.equal(saved.status,200);assert.equal(saved.value.car.revision,1);assert.equal((await post(create)).value.duplicate,true);assert.equal((await request(h,'/v1/scalable/cars')).value.cars.length,1);
  const patch={...create,operationId:'patch-1',action:'patch',carId:saved.value.car.id,expectedRevision:1,set:{name:'Edited once'}};await crash('after-commit',patch);assert.equal((await post(patch)).value.car.revision,2);assert.equal((await receipt('create-1')).value.car.fields.name,'Recover this car');assert.equal((await receipt('create-1')).value.current.revision,2);
  const archive={...patch,operationId:'archive-1',action:'archive',expectedRevision:2};delete archive.set;await crash('after-commit',archive);assert.equal((await post(archive)).value.car.archived,true);assert.equal((await receipt('archive-1')).value.current.revision,3);
  await h.command('backup');await h.command('restore');assert.equal((await post({...create,operationId:'uncertain-after-restore'})).value.code,'RECOVERY_CHANGED');assert.equal((await receipt('create-1')).value.code,'RECOVERY_CHANGED');await h.close();h=null;
 }finally{await h?.kill();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sf-local-qualify-shared-'));fs.rmSync(root,{recursive:true,force:true});}
});
