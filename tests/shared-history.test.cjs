'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history.cjs');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-write-')),file=path.join(root,'db.sqlite'),data=require('./support/timing-fixtures.cjs').fixtures();let store=new Store(file),host;store.replace(data.store.snapshot());
 const start=async()=>{host=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await host.start();assert.equal(host.error,'');};await start();
 const stop=async()=>{host.quiesce();await host.idle();host.close();};t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
 const request=async(route,body,headers={})=>{const r=await fetch('http://127.0.0.1:'+host.network.port+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json','X-SlotForge-Instance':host.instanceId,'X-SlotForge-Database':store.data.id,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};};
 const state=(await request('/v1/shared-history/status')).value;
 const input=(payload=data.normal,extra={})=>({version:1,databaseId:store.data.id,recoveryId:state.recoveryId,editor:{installationId:'timing-a',application:'SlotForge Timing',name:'Director'},operationId:'create-1',sourceId:payload.source.id,sessionId:payload.sessionId,reason:'Reviewed result',action:'create',expected:null,bundle:{format:'timing-v1',payload:structuredClone(payload)},...extra});
 return {data,file,state,request,input,get store(){return store;},get host(){return host;},post:op=>request('/v1/shared-history/operations',op),lookup:(op)=>request('/v1/shared-history/operations/'+op.editor.installationId+'/'+op.operationId+'?recoveryId='+op.recoveryId),async restart(){await stop();store=await Store.open(file);await start();}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
test('guarded result commits once with atomic audit, survives restart and preserves old receipts',async t=>{
 const f=await fixture(t),op=f.input(),replies=await Promise.all([f.post(op),f.post(op)]);replies.forEach(ok);assert.equal(replies.filter(r=>!r.value.duplicate).length,1);const first=replies[0].value;
 assert.equal(first.accepted.contentHash,T.digest(f.data.normal));assert.equal(first.requestHash,T.digest(op));assert.equal(f.store.data.timing.sessions.length,1);assert.equal(f.store.data.timing.audit.length,1);
 const edit=f.input(f.data.correction,{operationId:'edit',action:'replace',expected:first.accepted});const second=ok(await f.post(edit));await f.restart();
 const duplicate=ok(await f.post(op));assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.accepted,first.accepted);assert.deepEqual(duplicate.current,second.accepted);assert.deepEqual(ok(await f.lookup(op)),duplicate);
 assert.equal((await f.post({...op,reason:'different'})).value.code,'OPERATION_CONFLICT');assert.equal(f.store.data.timing.audit.length,2);
 assert.deepEqual(f.store.data.timing.audit.map(r=>r.payload),[f.data.normal,f.data.correction]);assert.equal(f.store.data.timing.audit[1].operation.editor.installationId,'timing-a');
});
test('two editors conflict, withdrawal removes contributions and stale retries cannot reactivate',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input())),edit=f.input(f.data.correction,{operationId:'editor-a',action:'replace',expected:first.accepted}),other={...edit,operationId:'editor-b',editor:{...edit.editor,installationId:'timing-b'}};
 const replies=await Promise.all([f.post(edit),f.post(other)]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);assert.deepEqual(replies.find(r=>r.status===409).value.current,replies.find(r=>r.status===200).value.accepted);
 const second=replies.find(r=>r.status===200).value,withdraw={...f.input(),operationId:'withdraw',action:'withdraw',expected:second.accepted,withdrawalReason:'Invalid race'};delete withdraw.bundle;
 const receipt=ok(await f.post(withdraw));assert.equal(receipt.accepted.state,'withdrawn');assert.equal(ok(await f.request('/v1/timing/sessions/timing-demo/session-normal')).summaries.length,0);
 assert.equal((await f.post({...other,operationId:'late'})).value.code,'REVISION_CONFLICT');
 const payload={...structuredClone(f.data.normal),revision:4},restore=f.input(payload,{operationId:'reactivate',action:'replace',expected:receipt.accepted,reason:''});assert.equal((await f.post(restore)).value.code,'INVALID_PAYLOAD');restore.reason='Deliberately restore';ok(await f.post(restore));assert.equal(f.store.data.timing.audit.length,4);
});
test('adopting a legacy session retains its original payload and prevents legacy mutations',async t=>{
 const f=await fixture(t);ok(await f.request('/v1/timing/sessions',f.data.normal));const current=ok(await f.request('/v1/timing/sessions/timing-demo/session-normal'));
 const edit=f.input(f.data.correction,{operationId:'adopt',action:'replace',expected:{revision:current.revision,contentHash:current.contentHash,state:current.state}});ok(await f.post(edit));
 assert.equal(f.store.data.timing.audit.length,2);assert.equal(f.store.data.timing.audit[0].operation,null);assert.deepEqual(f.store.data.timing.audit[0].payload,f.data.normal);
 assert.equal(ok(await f.request('/v1/timing/sessions',f.data.correction)).duplicate,true);
 for(const payload of [f.data.normal,f.data.withdrawal,{...f.data.correction,revision:999}])assert.equal((await f.request('/v1/timing/sessions',payload)).value.code,'HISTORY_GUARD_REQUIRED');
 ok(await f.request('/v1/timing/sessions',f.data.multi));await f.restart();assert.equal((await f.request('/v1/timing/sessions',f.data.withdrawal)).value.code,'HISTORY_GUARD_REQUIRED');
});
test('restored database identity rotates recovery and blocks acknowledged and uncertain operations',async t=>{
 const f=await fixture(t),before=f.store.snapshot(),op=f.input();ok(await f.post(op));const withHistory=f.store.snapshot();
 await f.store.restoreAsync(before,f.store.data.revision);assert.notEqual(ok(await f.request('/v1/shared-history/status')).recoveryId,op.recoveryId);
 for(const pending of [op,{...op,operationId:'uncertain'}])assert.equal((await f.post(pending)).value.code,'RECOVERY_CHANGED');assert.equal((await f.lookup(op)).value.code,'RECOVERY_CHANGED');assert.equal(f.store.data.timing.sessions.length,0);
 await f.store.restoreAsync(withHistory,f.store.data.revision);await f.restart();assert.deepEqual(f.store.data.timing.audit,withHistory.timing.audit);assert.equal((await f.post(op)).value.code,'RECOVERY_CHANGED');assert.equal((await f.request('/v1/timing/sessions',f.data.correction)).value.code,'HISTORY_GUARD_REQUIRED');
});
test('receipt insert failure rolls back result, audit, statistics and change cursor together',async t=>{
 const f=await fixture(t),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'injected failure'); END;");db.close();
 const before=f.store.snapshot(),cursor=require('../src/sqlite-storage.cjs').syncState(f.file),op=f.input();assert.equal((await f.post(op)).status,503);assert.deepEqual(f.store.snapshot(),before);assert.deepEqual(require('../src/sqlite-storage.cjs').syncState(f.file),cursor);assert.equal((await f.lookup(op)).value.code,'OPERATION_NOT_FOUND');
 const clean=new DatabaseSync(f.file);clean.exec('DROP TRIGGER fail_history');clean.close();ok(await f.post(op));
});
test('guarded input validates identities, captures, expected revision, Unicode and unambiguous JSON',async t=>{
 const f=await fixture(t),base=f.input();
 const bad=[{...base,databaseId:'wrong'},{...base,sourceId:'wrong'},{...base,expected:{revision:1,state:'active',contentHash:'a'.repeat(64)}},{...base,bundle:{format:'history-v1',payload:base.bundle.payload}}];
 for(const input of bad)assert.notEqual((await f.post(input)).status,200);
 const missing=structuredClone(base);missing.bundle.payload.participants[0].carId='missing';assert.equal((await f.post(missing)).value.code,'CAR_NOT_FOUND');
 const capture=structuredClone(base);capture.bundle.payload.participants[0].configuration.technical.motor='tampered';assert.equal((await f.post(capture)).value.code,'CONFIGURATION_INVALID');
 const number=structuredClone(base);number.bundle.payload.revision=9;assert.equal((await f.post(number)).value.code,'INVALID_PAYLOAD');
 const raw=JSON.stringify(base);for(const malformed of [raw.replace('"version":1','"version":1,"version":1'),raw.replace('"version":1','"version":1,"vers\\u0069on":1'),raw.replace('Reviewed result','\\ud800'),raw.replace('"version":1','"version":1e999')])assert.equal((await f.post(malformed)).value.code,'INVALID_PAYLOAD');
 assert.equal((await f.post(raw+' '.repeat(8388608))).status,413);assert.equal(f.store.data.timing.sessions.length,0);
 const archived=f.store.data.cars.find(c=>c.id==='car-a');f.store.mutate('car.archive',{id:archived.id,revision:archived.revision});ok(await f.post(base));
});
test('capabilities are opt-in, disabled features stay unavailable and trusted-local protection is unchanged',async t=>{
 const f=await fixture(t),status=ok(await f.request('/v1/status'));assert.equal(status.capabilities.sharedHistory,undefined);
 const extension=ok(await f.request('/v1/status',undefined,{'X-SlotForge-Extensions':'shared-history-v1'})).capabilities.sharedHistory;assert.deepEqual(extension,H.capability);assert.deepEqual(extension.formats,['timing-v1']);assert.equal(extension.features.resumableUploads,true);
 assert.ok(ok(await f.request('/v1/status',undefined,{'X-SlotForge-Extensions':'scalable-v1'})).capabilities.scalable);
 assert.equal(extension.features.historicalReview,true);assert.equal(extension.features.historicalImports,false);assert.equal((await f.request('/v1/shared-history/imports')).status,405);
 for(const headers of [{Authorization:'Bearer bad'},{Origin:'null'},{'X-SlotForge-Instance':'wrong'},{'X-SlotForge-Database':'wrong'}])assert.notEqual((await f.request('/v1/shared-history/operations',f.input(),headers)).status,200);
 assert.equal((await f.request('/v1/shared-history/status?x=1')).status,400);assert.equal((await f.request('/v1/shared-history/operations/a/b?recoveryId=x&recoveryId=x')).status,400);
 const n=new(require('../src/network.cjs').Network)(f.store);await n.start();t.after(async()=>{await n.stop();n.close();});const r=await fetch('http://127.0.0.1:'+n.port+'/v1/shared-history/operations',{method:'POST',headers:{Authorization:'Bearer '+n.timingCode,'Content-Type':'application/json','X-SlotForge-Database':f.store.data.id},body:JSON.stringify(f.input())});assert.equal(r.status,404);
});
test('unchanged legacy read formats reconstruct guarded payloads and audit corruption is rejected',async t=>{
 const f=await fixture(t);ok(await f.post(f.input()));const head=ok(await f.request('/v1/scalable/results/timing-demo/session-normal')),p=head.payload.participants[0];
 const page=ok(await f.request('/v1/scalable/results/timing-demo/session-normal/laps/'+p.id+'?token='+head.resultToken));p.laps=page.laps;assert.deepEqual(head.payload,f.data.normal);
 const snap=f.store.snapshot();snap.timing.audit[0].payload.name='Corrupted';assert.throws(()=>new Store().replace(snap),/hash/);
 assert.deepEqual(f.store.data.timing.audit[0].payload,f.data.normal);
 const index=ok(await f.request('/v1/telemetry/results'));const telemetry=ok(await f.request('/v1/telemetry/results/timing-demo/session-normal?snapshot='+index.snapshot));assert.deepEqual(telemetry.payload,f.data.normal);assert.equal(telemetry.receipt.contentHash,T.digest(f.data.normal));
 const invalid=f.store.snapshot();invalid.timing.sessions[0].guard=false;assert.throws(()=>new Store().replace(invalid));
});
test('portable backup preserves accepted revision audit and rotates recovery on staging',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input()));ok(await f.post(f.input(f.data.correction,{operationId:'edit',action:'replace',expected:first.accepted})));
 const before=f.store.snapshot(),backup=path.join(path.dirname(f.file),'history.sfpbackup'),staged=path.join(path.dirname(f.file),'restored.sqlite'),api=require('../src/portable-backup.cjs');
 api.exportBackup(f.file,backup);api.stageBackup(backup,staged);const restored=new Store(staged,{deferred:true});assert.deepEqual(restored.data.timing.audit,before.timing.audit);assert.notEqual(H.status(restored).recoveryId,f.state.recoveryId);assert.throws(()=>H.lookup(restored,'timing-a','create-1',f.state.recoveryId),e=>e.apiCode==='RECOVERY_CHANGED');
});
test('corrections append only new audit rows and never hydrate the complete collection',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input())),store=new Store(f.file,{deferred:true});store.ensureLoaded=()=>{throw Error('Unexpected full-model load');};
 const storage=require('../src/sqlite-storage.cjs'),original=storage.write,rows=[];storage.write=(...args)=>{rows.push(...args[1].records.map(r=>r.key));return original(...args);};
 try{const result=H.receive(store,f.input(f.data.correction,{operationId:'precise',action:'replace',expected:first.accepted}));assert.equal(result.accepted.revision,2);assert.equal(rows.filter(k=>k.startsWith('["timing","audit",')).length,1);assert.equal(rows.filter(k=>k.startsWith('["cars",')).length,0);}finally{storage.write=original;}
});
