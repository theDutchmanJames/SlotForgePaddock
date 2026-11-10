'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history.cjs');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-write-')),file=path.join(root,'db.sqlite'),data=require('./support/timing-fixtures.cjs').fixtures();let store=new Store(file),host;store.replace(data.store.snapshot());
 const start=async()=>{host=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await host.start();assert.equal(host.error,'');};await start();
 const stop=async()=>{host.quiesce();await host.idle();host.close();};t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
 const request=async(route,body,headers={},method)=>{const r=await fetch('http://127.0.0.1:'+host.network.port+route,{method:method||(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json','X-SlotForge-Instance':host.instanceId,'X-SlotForge-Database':store.data.id,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};};
 const state=(await request('/v1/shared-history/status')).value;
 const input=(payload=data.normal,extra={})=>({version:1,databaseId:store.data.id,recoveryId:state.recoveryId,editor:{installationId:'timing-a',application:'SlotForge Timing',name:'Director'},operationId:'create-1',sourceId:payload.source.id,sessionId:payload.sessionId,reason:'Reviewed result',action:'create',expected:null,bundle:{format:'timing-v1',payload:structuredClone(payload)},...extra});
 return {data,file,state,request,input,get store(){return store;},get host(){return host;},post:op=>request('/v1/shared-history/operations',op),lookup:(op)=>request('/v1/shared-history/operations/'+op.editor.installationId+'/'+op.operationId+'?recoveryId='+op.recoveryId),async restart(){await stop();store=await Store.open(file);await start();}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
const U=require('../src/history-uploads.cjs'),ROOT='/v1/shared-history/uploads';
function upload(f,op=f.input(),id='upload-a',bytes=Buffer.from(JSON.stringify(op))){
 const base={version:1,databaseId:op.databaseId,recoveryId:op.recoveryId,uploadId:id},start={...base,editor:op.editor,kind:'operation',byteLength:bytes.length,sha256:U.hash(bytes)};
 const chunks=Array.from({length:Math.ceil(bytes.length/U.CHUNK)},(_,index)=>{const b=bytes.subarray(index*U.CHUNK,(index+1)*U.CHUNK);return {...base,index,sha256:U.hash(b),data:b.toString('base64')};});
 return {start,chunks,base,begin:()=>f.request(ROOT,start),get:()=>f.request(ROOT+'/'+id+'?recoveryId='+base.recoveryId),put:(index,body=chunks[index])=>f.request(ROOT+'/'+id+'/chunks/'+index,body,{},'PUT'),commit:()=>f.request(ROOT+'/'+id+'/commit',{...base,sha256:start.sha256}),cancel:()=>f.request(ROOT+'/'+id+'?recoveryId='+base.recoveryId,undefined,{},'DELETE'),async stage(){ok(await this.begin());for(let i=0;i<chunks.length;i++)ok(await this.put(i));}};
}
test('staging resumes out of order across restart and accepts exactly once',async t=>{
 const f=await fixture(t),op=f.input(),bytes=Buffer.from(JSON.stringify(op)+' '.repeat(600000)),u=upload(f,op,'resume',bytes),initial=require('../src/sqlite-storage.cjs').syncState(f.file);
 ok(await u.begin());ok(await u.put(2));ok(await u.put(0));assert.deepEqual(ok(await u.get()).received,[0,2]);assert.equal(f.store.data.timing.sessions.length,0);assert.deepEqual(require('../src/sqlite-storage.cjs').syncState(f.file),initial);
 assert.equal((await u.commit()).value.code,'UPLOAD_INCOMPLETE');await f.restart();assert.deepEqual(ok(await u.get()).received,[0,2]);ok(await u.put(1));const result=ok(await u.commit());assert.equal(result.state,'committed');assert.equal(result.receipt.accepted.contentHash,T.digest(op.bundle.payload));assert.equal(f.store.data.timing.sessions.length,1);
 for(const response of [await u.commit(),await u.get(),await u.begin(),await u.put(1)]){const v=ok(response);assert.equal(v.receipt.duplicate,true);assert.equal(v.receipt.accepted.revision,1);}
 assert.equal(f.store.data.timing.audit.length,1);assert.equal((await u.cancel()).value.code,'UPLOAD_COMMITTED');
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file+'.history-staging.sqlite');assert.equal(db.prepare('SELECT count(*) n FROM chunks WHERE bytes IS NOT NULL').get().n,0);db.close();
});
test('chunks and manifests are immutable and malformed data cannot change history',async t=>{
 const f=await fixture(t),u=upload(f);ok(await u.begin());assert.equal((await f.request(ROOT,{...u.start,sha256:'a'.repeat(64)})).value.code,'UPLOAD_CONFLICT');
 const bad={...u.chunks[0],sha256:'0'.repeat(64)};assert.equal((await u.put(0,bad)).value.code,'HASH_MISMATCH');assert.equal((await u.put(0,{...u.chunks[0],uploadId:'wrong'})).status,400);assert.equal((await u.put(0,{...u.chunks[0],data:u.chunks[0].data+'\n'})).status,400);
 ok(await u.put(0));const b=Buffer.from(u.chunks[0].data,'base64');b[0]=32;assert.equal((await u.put(0,{...u.chunks[0],data:b.toString('base64'),sha256:U.hash(b)})).value.code,'CHUNK_CONFLICT');
 assert.equal((await f.request(ROOT+'/'+u.base.uploadId+'/commit',{...u.base,sha256:'0'.repeat(64)})).value.code,'HASH_MISMATCH');assert.equal(f.store.data.timing.sessions.length,0);
 const malformed=upload(f,f.input(),'json',Buffer.from('{"version":1,"version":1}'));await malformed.stage();assert.equal((await malformed.commit()).value.code,'INVALID_PAYLOAD');
 const wrong=upload(f,{...f.input(),editor:{installationId:'other',application:'SlotForge Timing',name:'Other'}},'editor');wrong.start.editor=f.input().editor;await wrong.stage();assert.equal((await wrong.commit()).value.code,'INVALID_PAYLOAD');
 assert.equal(f.store.data.timing.sessions.length,0);
});
test('CAS conflicts, corrections, withdrawals and duplicate operations use the existing authority',async t=>{
 const f=await fixture(t),u=upload(f);await u.stage();const first=ok(await f.post(f.input()));assert.equal(ok(await u.commit()).receipt.duplicate,true);
 const edit=f.input(f.data.correction,{operationId:'correction',action:'replace',expected:first.accepted}),a=upload(f,edit,'edit'),b=upload(f,{...edit,operationId:'competing'},'competing');await a.stage();await b.stage();const next=ok(await a.commit());assert.equal((await b.commit()).value.code,'REVISION_CONFLICT');assert.equal(f.store.data.timing.audit.length,2);
 ok(await b.cancel());const withdraw={...f.input(),action:'withdraw',operationId:'withdraw',expected:next.receipt.accepted,withdrawalReason:'Review'};delete withdraw.bundle;const w=upload(f,withdraw,'withdraw');await w.stage();ok(await w.commit());assert.equal(ok(await u.get()).receipt.current.state,'withdrawn');assert.equal(f.store.data.timing.audit.length,3);
 assert.equal(ok(await f.request('/v1/shared-history/cars/car-a/statistics')).measuredLaps,0);
});
test('cancellation, expiry, recovery and staging quotas cannot resurrect pending work',async t=>{
 const f=await fixture(t),items=Array.from({length:5},(_,i)=>upload(f,f.input(),'u-'+i));for(const u of items.slice(0,4))ok(await u.begin());assert.equal((await items[4].begin()).value.code,'CAPACITY_EXCEEDED');
 ok(await items[0].cancel());ok(await items[0].cancel());assert.equal((await items[0].begin()).value.code,'UPLOAD_CANCELLED');ok(await items[4].begin());
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file+'.history-staging.sqlite');db.prepare('UPDATE uploads SET created=? WHERE id=?').run(Date.now()-U.TTL-1000,'u-1');db.close();assert.equal((await items[1].get()).value.code,'UPLOAD_EXPIRED');
 const snap=f.store.snapshot();await f.store.restoreAsync(snap,f.store.data.revision);for(const method of ['begin','get','commit','cancel'])assert.equal((await items[2][method]()).value.code,'RECOVERY_CHANGED');assert.equal((await items[2].put(0)).value.code,'RECOVERY_CHANGED');assert.equal(f.store.data.timing.sessions.length,0);
});
test('receipt insertion failure leaves staged bytes retryable with no partial acceptance',async t=>{
 const f=await fixture(t),u=upload(f);await u.stage();const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'test storage failure'); END");db.close();assert.equal((await u.commit()).status,503);assert.equal(f.store.data.timing.sessions.length,0);assert.equal(ok(await u.get()).state,'staging');
 const repair=new DatabaseSync(f.file);repair.exec('DROP TRIGGER reject_receipt');repair.close();ok(await u.commit());assert.equal(f.store.data.timing.sessions.length,1);
});
test('upload HTTP enforces local auth, strict parameters, methods and transport limits',async t=>{
 const f=await fixture(t),u=upload(f);
 for(const headers of [{Authorization:'Bearer bad'},{Origin:'null'},{'X-SlotForge-Instance':'wrong'},{'X-SlotForge-Database':'wrong'}])assert.notEqual((await f.request(ROOT,u.start,headers)).status,200);
 assert.equal((await f.request(ROOT,u.start,{'Content-Encoding':'gzip'})).status,415);assert.equal((await f.request(ROOT,JSON.stringify(u.start)+' '.repeat(4096))).status,413);assert.equal((await f.request(ROOT+'?x=1',u.start)).status,400);assert.equal((await f.request(ROOT)).status,405);
 ok(await u.begin());assert.equal((await f.request(ROOT+'/upload-a?recoveryId=x&recoveryId=x')).status,400);assert.equal((await u.put(32,{...u.chunks[0],index:32})).status,400);assert.equal((await f.request(ROOT+'/upload-a/chunks/0',' '.repeat(352*1024+1),{},'PUT')).status,413);
 assert.equal((await f.request(ROOT,{...u.start,uploadId:'large',byteLength:8388609})).status,400);assert.equal((await f.request(ROOT,{...u.start,uploadId:'unknown',kind:'unknown'})).status,400);
});
test('failure to publish staging completion preserves the authoritative receipt',async t=>{
 const f=await fixture(t),u=upload(f);await u.stage();const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file+'.history-staging.sqlite');db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON uploads WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'test completion failure'); END");db.close();
 assert.equal((await u.commit()).status,503);assert.equal(f.store.data.timing.sessions.length,1);assert.equal(ok(await f.lookup(f.input())).accepted.revision,1);
 const repair=new DatabaseSync(f.file+'.history-staging.sqlite');repair.exec('DROP TRIGGER fail_completion');repair.close();await f.restart();assert.equal(ok(await u.get()).state,'committed');assert.equal(ok(await u.commit()).receipt.duplicate,true);assert.equal(f.store.data.timing.audit.length,1);
});
test('8 MiB staging ceiling is bounded and chunk rollback cannot expose partial data',async t=>{
 const f=await fixture(t),op=f.input(),json=JSON.stringify(op),u=upload(f,op,'maximum',Buffer.from(json+' '.repeat(U.MAX-Buffer.byteLength(json))));ok(await u.begin());
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file+'.history-staging.sqlite');db.exec("CREATE TRIGGER fail_chunk BEFORE INSERT ON chunks BEGIN SELECT RAISE(ABORT,'test disk failure'); END");db.close();assert.equal((await u.put(0)).status,503);assert.deepEqual(ok(await u.get()).received,[]);
 const repair=new DatabaseSync(f.file+'.history-staging.sqlite');repair.exec('DROP TRIGGER fail_chunk');repair.close();for(let i=0;i<u.chunks.length;i++)ok(await u.put(i));const result=ok(await u.commit());assert.equal(result.received.length,32);assert.equal(result.receipt.accepted.contentHash,T.digest(f.data.normal));assert.equal(f.store.data.timing.sessions.length,1);
});
test('split UTF-8 characters are decoded only after complete byte verification',async t=>{
 const f=await fixture(t),op={...f.input(),reason:'🏁'},json=JSON.stringify(op),before=Buffer.byteLength(json.slice(0,json.indexOf('🏁'))),bytes=Buffer.from(' '.repeat(U.CHUNK-before-2)+json),u=upload(f,op,'unicode',bytes);
 assert.equal(bytes[U.CHUNK-2],0xf0);await u.stage();const committed=ok(await u.commit());assert.equal(committed.receipt.requestHash,T.digest(op));assert.equal(f.store.data.timing.audit[0].operation.reason,'🏁');
});
test('unexpected staging files fail closed and low-space preflight creates no upload',async t=>{
 const f=await fixture(t),u=upload(f),{DatabaseSync}=require('node:sqlite'),file=f.file+'.history-staging.sqlite',db=new DatabaseSync(file);db.exec('CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES (\'keep\');');db.close();const before=fs.readFileSync(file);assert.equal((await u.begin()).status,503);assert.deepEqual(fs.readFileSync(file),before);fs.unlinkSync(file);
 const resources=require('../src/storage-resources.cjs'),original=resources.requireSpace;resources.requireSpace=()=>{throw Error('Injected low disk space');};
 try{assert.throws(()=>U.run(f.store,{action:'start',bytes:Buffer.from(JSON.stringify(u.start))}),e=>e.apiCode==='CAPACITY_EXCEEDED');}finally{resources.requireSpace=original;}
 const check=new DatabaseSync(file);assert.equal(check.prepare('SELECT count(*) n FROM uploads').get().n,0);check.close();assert.equal(f.store.data.timing.sessions.length,0);ok(await u.begin());
});
