'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {host,until,request}=require('./support/local-recovery-qualification.cjs'),{Store}=require('../src/store.cjs');
test('historical batches and cancellations survive real process death at commit boundaries',{timeout:120000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-history-import-')),file=path.join(root,'database.sqlite');new Store(file).replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());let h;
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
 try{
  h=await host(root);const state=ok(await request(h,'/v1/shared-history/status')),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));b.recoveryId=state.recoveryId;
  const route='/v1/shared-history/imports/'+b.editor.installationId+'/'+b.operationId,poll=()=>request(h,route+'?recoveryId='+b.recoveryId),send=()=>request(h,'/v1/shared-history/imports',b),cancel=()=>request(h,route+'/cancel',{version:1,databaseId:b.databaseId,recoveryId:b.recoveryId,operationId:b.operationId,itemIds:['item-1']});
  const crash=async(mode,fn)=>{fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode}));const pending=fn().catch(e=>({error:e.message}));await until(()=>fs.existsSync(path.join(root,'crash-reached.json')),mode);await h.kill();await pending;fs.unlinkSync(path.join(root,'crash-reached.json'));h=await host(root);};
  await crash('before-commit',send);assert.equal((await poll()).status,404);assert.equal(new Store(file).data.timing.imports?.length||0,0);
  await crash('after-commit',send);assert.equal(ok(await poll()).items[0].status,'pending');assert.deepEqual(ok(await send()),ok(await poll()));assert.equal(new Store(file).data.timing.imports.length,1);
  await crash('before-commit',cancel);assert.equal(ok(await poll()).items[0].status,'pending');
  await crash('after-commit',cancel);assert.equal(ok(await poll()).items[0].status,'cancelled');assert.deepEqual(ok(await send()),ok(await cancel()));assert.equal(new Store(file).data.timing.sessions.length,0);
  await h.command('backup');await h.command('restore');assert.equal((await poll()).value.code,'RECOVERY_CHANGED');assert.equal((await send()).value.code,'RECOVERY_CHANGED');await h.close();h=null;
 }finally{await h?.kill();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sf-local-qualify-history-import-'));fs.rmSync(root,{recursive:true,force:true});}
});
