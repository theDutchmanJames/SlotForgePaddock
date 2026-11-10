'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {host,until}=require('./support/local-recovery-qualification.cjs'),{Store}=require('../src/store.cjs'),U=require('../src/history-uploads.cjs');
test('historical upload survives process death during chunks and atomic Review commit',{timeout:120000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-import-upload-')),file=path.join(root,'database.sqlite');new Store(file).replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());let h;
 const request=async(route,body,method=body?'POST':'GET')=>{const d=h.descriptor,r=await fetch(d.address+route,{method,headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json','X-SlotForge-Instance':d.instanceId,'X-SlotForge-Database':d.databaseId},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
 try{
  h=await host(root);const state=ok(await request('/v1/shared-history/status')),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));b.recoveryId=state.recoveryId;
  const bytes=Buffer.from(JSON.stringify(b)+' '.repeat(300000)),base={version:1,databaseId:state.databaseId,recoveryId:state.recoveryId,uploadId:'crash-import'},url='/v1/shared-history/uploads/crash-import';
  ok(await request('/v1/shared-history/uploads',{...base,editor:b.editor,kind:'import',byteLength:bytes.length,sha256:U.hash(bytes)}));
  const put=index=>{const chunk=bytes.subarray(index*U.CHUNK,(index+1)*U.CHUNK);return request(url+'/chunks/'+index,{...base,index,sha256:U.hash(chunk),data:chunk.toString('base64')},'PUT');},commit=()=>request(url+'/commit',{...base,sha256:U.hash(bytes)}),get=()=>request(url+'?recoveryId='+base.recoveryId);
  const crash=async(mode,staging,fn)=>{fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode,staging}));const pending=fn().catch(e=>({error:e.message}));await until(()=>fs.existsSync(path.join(root,'crash-reached.json')),mode);await h.kill();await pending;fs.unlinkSync(path.join(root,'crash-reached.json'));h=await host(root);};
  await crash('before-commit',true,()=>put(0));assert.deepEqual(ok(await get()).received,[]);
  await crash('after-commit',true,()=>put(0));assert.deepEqual(ok(await get()).received,[0]);ok(await put(1));assert.equal(new Store(file).data.timing.imports?.length||0,0);
  await crash('before-commit',false,commit);assert.equal(ok(await get()).state,'staging');assert.equal(new Store(file).data.timing.imports?.length||0,0);
  await crash('after-commit',false,commit);
  const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file+'.history-staging.sqlite');db.prepare('UPDATE uploads SET created=0').run();db.close();
  const result=ok(await get());assert.equal(result.state,'committed');assert.equal(result.receipt.items[0].status,'pending');assert.deepEqual(ok(await commit()).receipt,result.receipt);assert.equal(new Store(file).data.timing.imports.length,1);assert.equal(new Store(file).data.timing.sessions.length,0);
  await h.command('backup');await h.command('restore');assert.equal((await get()).value.code,'RECOVERY_CHANGED');assert.equal((await commit()).value.code,'RECOVERY_CHANGED');await h.close();h=null;
 }finally{await h?.kill();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sf-local-qualify-import-upload-'));fs.rmSync(root,{recursive:true,force:true});}
});
