'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {host,request,until}=require('./support/local-recovery-qualification.cjs'),{Store}=require('../src/store.cjs'),H=require('../src/shared-history.cjs');
test('guarded history recovers real process death before/after commit, including correction and withdrawal',{timeout:120000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-history-')),f=require('./support/timing-fixtures.cjs').fixtures(),file=path.join(root,'database.sqlite');new Store(file).replace(f.store.snapshot());let h;
 try{
  h=await host(root);const state=(await request(h,'/v1/shared-history/status')).value,create={version:1,databaseId:state.databaseId,recoveryId:state.recoveryId,editor:{installationId:'timing-crash',application:'SlotForge Timing',name:'Test'},operationId:'create',action:'create',sourceId:f.normal.source.id,sessionId:f.normal.sessionId,expected:null,reason:'Reviewed',bundle:{format:'timing-v1',payload:f.normal}};
  const post=op=>request(h,'/v1/shared-history/operations',op),receipt=id=>request(h,'/v1/shared-history/operations/timing-crash/'+id+'?recoveryId='+create.recoveryId);
  const crash=async(mode,op)=>{fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode}));const pending=post(op).catch(e=>({error:e.message}));await until(()=>fs.existsSync(path.join(root,'crash-reached.json')),'guarded history '+mode);await h.kill();await pending;fs.unlinkSync(path.join(root,'crash-reached.json'));h=await host(root);};
  await crash('before-commit',create);assert.equal((await receipt('create')).value.code,'OPERATION_NOT_FOUND');assert.equal(new Store(file).data.timing.sessions.length,0);
  await crash('after-commit',create);const first=await receipt('create');assert.equal(first.status,200);assert.equal((await post(create)).value.duplicate,true);assert.equal(new Store(file).data.timing.audit.length,1);
  const edit={...create,operationId:'edit',action:'replace',expected:first.value.accepted,bundle:{format:'timing-v1',payload:f.correction}};await crash('after-commit',edit);const second=await receipt('edit');assert.equal(second.status,200);assert.equal((await post(edit)).value.duplicate,true);assert.equal(new Store(file).data.timing.audit.length,2);
  const withdraw={...create,operationId:'withdraw',action:'withdraw',expected:second.value.accepted,withdrawalReason:'Withdraw reviewed session'};delete withdraw.bundle;await crash('after-commit',withdraw);assert.equal((await post(withdraw)).value.duplicate,true);assert.equal((await post(edit)).value.current.state,'withdrawn');assert.equal(new Store(file).data.timing.audit.length,3);
  await h.command('backup');await h.command('restore');assert.equal((await receipt('create')).value.code,'RECOVERY_CHANGED');assert.equal((await post(create)).value.code,'RECOVERY_CHANGED');await h.close();h=null;
 }finally{await h?.kill();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sf-local-qualify-history-'));fs.rmSync(root,{recursive:true,force:true});}
});
test('publication failure after commit is uncertain and the original receipt survives',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-publication-'));
 try{const file=path.join(root,'db.sqlite'),f=require('./support/timing-fixtures.cjs').fixtures();new Store(file).replace(f.store.snapshot());const store=new Store(file,{deferred:true}),state=H.status(store),op={version:1,databaseId:state.databaseId,recoveryId:state.recoveryId,editor:{installationId:'a',application:'SlotForge Timing',name:'Test'},operationId:'create',action:'create',sourceId:f.normal.source.id,sessionId:f.normal.sessionId,expected:null,reason:'Reviewed',bundle:{format:'timing-v1',payload:f.normal}};
  store.finishPersistence=()=>{throw Error('Injected post-commit publication failure');};assert.throws(()=>H.receive(store,op),e=>e.code==='WRITE_UNCERTAIN');
  const reopened=new Store(file,{deferred:true});assert.equal(H.lookup(reopened,'a','create',op.recoveryId).accepted.revision,1);assert.equal(H.receive(reopened,op).duplicate,true);assert.equal(reopened.data.timing.audit.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
