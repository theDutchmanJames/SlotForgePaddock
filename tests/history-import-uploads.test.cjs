'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history.cjs');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-import-upload-')),file=path.join(root,'db.sqlite'),data=require('./support/timing-fixtures.cjs').fixtures();let store=new Store(file),host;store.replace(data.store.snapshot());
 const start=async()=>{host=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await host.start();assert.equal(host.error,'');};await start();
 const stop=async()=>{host.quiesce();await host.idle();host.close();};t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
 const request=async(route,body,headers={},method)=>{const r=await fetch('http://127.0.0.1:'+host.network.port+route,{method:method||(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json','X-SlotForge-Instance':host.instanceId,'X-SlotForge-Database':store.data.id,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};};
 const state=(await request('/v1/shared-history/status')).value;
 const input=(payload=data.normal,extra={})=>({version:1,databaseId:store.data.id,recoveryId:state.recoveryId,editor:{installationId:'timing-a',application:'SlotForge Timing',name:'Director'},operationId:'create-1',sourceId:payload.source.id,sessionId:payload.sessionId,reason:'Reviewed result',action:'create',expected:null,bundle:{format:'timing-v1',payload:structuredClone(payload)},...extra});
 return {data,file,state,request,input,get store(){return store;},get host(){return host;},post:op=>request('/v1/shared-history/operations',op),lookup:(op)=>request('/v1/shared-history/operations/'+op.editor.installationId+'/'+op.operationId+'?recoveryId='+op.recoveryId),async restart(){await stop();store=await Store.open(file);await start();}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
const U=require('../src/history-uploads.cjs'),ROOT='/v1/shared-history/uploads';
function upload(f,op=batch(f),id='upload-a',bytes=Buffer.from(JSON.stringify(op)),kind='import'){
 const base={version:1,databaseId:op.databaseId,recoveryId:op.recoveryId,uploadId:id},start={...base,editor:op.editor,kind,byteLength:bytes.length,sha256:U.hash(bytes)};
 const chunks=Array.from({length:Math.ceil(bytes.length/U.CHUNK)},(_,index)=>{const b=bytes.subarray(index*U.CHUNK,(index+1)*U.CHUNK);return {...base,index,sha256:U.hash(b),data:b.toString('base64')};});
 return {start,chunks,base,begin:()=>f.request(ROOT,start),get:()=>f.request(ROOT+'/'+id+'?recoveryId='+base.recoveryId),put:(index,body=chunks[index])=>f.request(ROOT+'/'+id+'/chunks/'+index,body,{},'PUT'),commit:()=>f.request(ROOT+'/'+id+'/commit',{...base,sha256:start.sha256}),cancel:()=>f.request(ROOT+'/'+id+'?recoveryId='+base.recoveryId,undefined,{},'DELETE'),async stage(){ok(await this.begin());for(let i=0;i<chunks.length;i++)ok(await this.put(i));}};
}
const batch=f=>({...JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))),databaseId:f.store.data.id,recoveryId:f.state.recoveryId});
const pending=f=>require('../src/view-query.cjs').view(f.store,{page:'Review',reviewTab:'Historical imports'})._view.historyImports;
const poll=(f,b)=>f.request('/v1/shared-history/imports/'+b.editor.installationId+'/'+b.operationId+'?recoveryId='+b.recoveryId);
const cancelBatch=(f,b)=>f.request('/v1/shared-history/imports/'+b.editor.installationId+'/'+b.operationId+'/cancel',{version:1,databaseId:b.databaseId,recoveryId:b.recoveryId,operationId:b.operationId,itemIds:b.items.map(i=>i.itemId)});
const sql=(f,query,staging=false)=>{const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file+(staging?'.history-staging.sqlite':''));try{db.exec(query);}finally{db.close();}};
test('historical chunks resume across restart and atomically enter Review, never accepted results',async t=>{
 const f=await fixture(t),b=batch(f);b.items.push({...structuredClone(b.items[0]),itemId:'item-2',sessionId:'second-session'});
 const u=upload(f,b,'resume',Buffer.from(JSON.stringify(b)+' '.repeat(600000))),before=H.status(f.store);
 assert.equal(before.capability.features.resumableHistoricalImports,true);assert.equal(before.capability.features.historicalImports,false);
 ok(await u.begin());ok(await u.put(2));ok(await u.put(0));assert.equal(pending(f).total,0);assert.equal((await u.commit()).value.code,'UPLOAD_INCOMPLETE');
 await f.restart();assert.deepEqual(ok(await u.get()).received,[0,2]);ok(await u.put(1));const committed=ok(await u.commit());assert.equal(committed.state,'committed');assert.deepEqual(committed.receipt.items.map(i=>i.status),['pending','pending']);assert.equal(pending(f).total,2);
 assert.equal(f.store.data.timing.sessions.length,0);assert.deepEqual(ok(await f.request('/v1/shared-history/sessions')).entries,[]);assert.deepEqual(ok(await f.request('/v1/telemetry/results')).entries,[]);
 for(const response of [await u.get(),await u.commit(),await u.begin(),await u.put(1)])assert.deepEqual(ok(response).receipt,committed.receipt);
 assert.equal(pending(f).count,2);assert.equal((await u.cancel()).value.code,'UPLOAD_COMMITTED');
 const row=pending(f).rows[0];await require('../src/domain-tasks.cjs').run(f.store,{kind:'history-import',action:'review',input:{databaseId:b.databaseId,recoveryId:b.recoveryId,id:row.id,requestHash:row.requestHash,action:'reject',note:'Insufficient evidence'}});
 const cancelled=ok(await cancelBatch(f,b));assert.deepEqual(cancelled.items.map(i=>i.status).sort(),['cancelled','rejected']);assert.deepEqual(ok(await u.get()).receipt,cancelled);assert.deepEqual(ok(await u.commit()).receipt,cancelled);assert.equal(pending(f).total,0);
});
test('direct and uploaded batches share retry identity, conflicts and duplicate detection',async t=>{
 const f=await fixture(t),b=batch(f),u=upload(f,b);await u.stage();const direct=ok(await f.request('/v1/shared-history/imports',b));assert.deepEqual(ok(await u.commit()).receipt,direct);
 const twice=upload(f,b,'second-upload');await twice.stage();assert.deepEqual(ok(await twice.commit()).receipt,direct);assert.equal(pending(f).count,1);
 const different=structuredClone(b);different.items[0].bundle.race.name='Edited evidence';const conflict=upload(f,different,'conflict');await conflict.stage();assert.equal((await conflict.commit()).value.code,'OPERATION_CONFLICT');assert.equal(ok(await conflict.get()).state,'staging');ok(await conflict.cancel());
 const collision=upload(f,{...b,operationId:'other-batch'},'identity-collision');await collision.stage();assert.equal(ok(await collision.commit()).receipt.items[0].status,'conflict');assert.equal(pending(f).total,1);
});
test('import and operation kinds, editor identity, malformed evidence and eligibility stay separate',async t=>{
 const f=await fixture(t),b=batch(f);
 for(const [id,body,kind]of [['operation-as-import',f.input(),'import'],['import-as-operation',b,'operation']]){const u=upload(f,body,id,Buffer.from(JSON.stringify(body)),kind);await u.stage();assert.equal((await u.commit()).value.code,'INVALID_PAYLOAD');ok(await u.cancel());}
 const wrong=upload(f,b,'editor');wrong.start.editor={...b.editor,name:'Changed attribution'};await wrong.stage();assert.equal((await wrong.commit()).value.code,'INVALID_PAYLOAD');ok(await wrong.cancel());
 const invalid=structuredClone(b);invalid.items[0].bundle.race.participants[0].laps[0].trackRecordEligible=true;const u=upload(f,invalid,'eligibility');await u.stage();assert.equal((await u.commit()).value.code,'INVALID_PAYLOAD');ok(await u.cancel());
 const malformed=upload(f,b,'ambiguous',Buffer.from('{"version":1,"version":1}'));await malformed.stage();assert.equal((await malformed.commit()).value.code,'INVALID_PAYLOAD');assert.equal(pending(f).count,0);assert.equal(f.store.data.timing.sessions.length,0);
});
test('staging cancellation, expiry and restore cannot recreate historical work',async t=>{
 const f=await fixture(t),u=upload(f);await u.stage();ok(await u.cancel());ok(await u.cancel());assert.equal((await u.commit()).value.code,'UPLOAD_CANCELLED');assert.equal(pending(f).count,0);
 const expired=upload(f,batch(f),'expired');await expired.stage();sql(f,"UPDATE uploads SET created=0 WHERE id='expired'",true);assert.equal((await expired.get()).value.code,'UPLOAD_EXPIRED');assert.equal(pending(f).count,0);
 const staged=upload(f,batch(f),'old-generation');await staged.stage();await f.store.restoreAsync(f.store.snapshot(),f.store.data.revision);for(const method of ['begin','get','commit','cancel'])assert.equal((await staged[method]()).value.code,'RECOVERY_CHANGED');assert.equal((await staged.put(0)).value.code,'RECOVERY_CHANGED');assert.equal(pending(f).count,0);
});
test('failed historical transaction leaves the entire batch staged and retryable',async t=>{
 const f=await fixture(t),b=batch(f);b.items.push({...structuredClone(b.items[0]),itemId:'item-2',sessionId:'two'});const u=upload(f,b);await u.stage();
 sql(f,"CREATE TRIGGER fail_import BEFORE INSERT ON records WHEN NEW.bucket='[\"timing\",\"imports\"]' BEGIN SELECT RAISE(ABORT,'injected failure'); END");assert.equal((await u.commit()).status,503);assert.equal(pending(f).count,0);assert.equal(ok(await u.get()).state,'staging');
 sql(f,'DROP TRIGGER fail_import');assert.equal(ok(await u.commit()).receipt.items.length,2);assert.equal(pending(f).count,2);assert.equal(f.store.data.timing.sessions.length,0);
});
test('lost staging completion recovers live Review decisions before expiry',async t=>{
 const f=await fixture(t),b=batch(f),u=upload(f,b);await u.stage();
 sql(f,"CREATE TRIGGER fail_completion BEFORE UPDATE ON uploads WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'injected failure'); END",true);
 assert.equal((await u.commit()).status,503);assert.equal(pending(f).total,1);assert.equal(ok(await poll(f,b)).items[0].status,'pending');
 ok(await cancelBatch(f,b));sql(f,"DROP TRIGGER fail_completion; UPDATE uploads SET created=0",true);await f.restart();const status=ok(await u.get());assert.equal(status.state,'committed');assert.equal(status.receipt.items[0].status,'cancelled');assert.deepEqual(ok(await u.commit()).receipt,status.receipt);assert.equal(pending(f).count,1);
});
test('historical uploads enforce 8 MiB and share staging quota with operations',async t=>{
 const f=await fixture(t),b=batch(f),json=JSON.stringify(b),u=upload(f,b,'maximum',Buffer.from(json+' '.repeat(U.MAX-Buffer.byteLength(json))));await u.stage();assert.equal(ok(await u.commit()).received.length,32);assert.equal(pending(f).count,1);
 assert.equal((await f.request(ROOT,{...u.start,uploadId:'too-large',byteLength:U.MAX+1})).value.code,'INVALID_PAYLOAD');
 for(let i=0;i<4;i++){const op=i%2?f.input():batch(f);ok(await upload(f,op,'quota-'+i,Buffer.from(JSON.stringify(op)),i%2?'operation':'import').begin());}assert.equal((await upload(f,b,'fifth').begin()).value.code,'CAPACITY_EXCEEDED');
});
test('only newly committed historical batches emit a Review notice',async t=>{
 const f=await fixture(t),u=upload(f),notices=[];f.host.network.onChange=change=>notices.push(change.kind);await u.stage();assert.deepEqual(notices,[]);ok(await u.commit());assert.deepEqual(notices,['history-import']);
 ok(await u.get());ok(await u.begin());ok(await u.put(0));ok(await u.commit());assert.deepEqual(notices,['history-import']);
 const op=upload(f,f.input(),'ordinary',Buffer.from(JSON.stringify(f.input())),'operation');await op.stage();ok(await op.commit());assert.deepEqual(notices,['history-import','timing']);
});
test('lost staging retains authoritative import decisions and a fresh upload cannot duplicate them',async t=>{
 const f=await fixture(t),b=batch(f),u=upload(f,b);await u.stage();const receipt=ok(await u.commit()).receipt;
 fs.unlinkSync(f.file+'.history-staging.sqlite');assert.equal((await u.get()).value.code,'UPLOAD_NOT_FOUND');assert.deepEqual(ok(await poll(f,b)),receipt);
 const replacement=upload(f,b,'replacement');await replacement.stage();assert.deepEqual(ok(await replacement.commit()).receipt,receipt);assert.equal(pending(f).count,1);
});
test('identical editor and operation IDs in the two namespaces reconcile only their own receipts',async t=>{
 const f=await fixture(t),b=batch(f),op=f.input(undefined,{editor:b.editor,operationId:b.operationId});
 const historical=upload(f,b,'historical'),ordinary=upload(f,op,'ordinary',Buffer.from(JSON.stringify(op)),'operation');
 await historical.stage();await ordinary.stage();
 const imported=ok(await historical.commit()).receipt,accepted=ok(await ordinary.commit()).receipt;
 assert.equal(imported.items[0].status,'pending');assert.equal(accepted.accepted.state,'active');assert.notEqual(imported.requestHash,accepted.requestHash);
 await f.restart();assert.deepEqual(ok(await historical.get()).receipt,imported);
 const reconciled=ok(await ordinary.get()).receipt;assert.equal(reconciled.requestHash,accepted.requestHash);assert.equal(reconciled.duplicate,true);assert.deepEqual(reconciled.accepted,accepted.accepted);
 assert.equal(pending(f).count,1);assert.equal(ok(await f.request('/v1/shared-history/sessions')).entries.length,1);
});
