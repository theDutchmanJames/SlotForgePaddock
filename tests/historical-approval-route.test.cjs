'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),I=require('../src/history-imports.cjs'),H=require('../src/shared-history.cjs');
const {host,request,until}=require('./support/local-recovery-qualification.cjs'),BASE='/v1/shared-history';
const preload=path.join(__dirname,'support/historical-approval-preload.cjs');
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
async function fixture(t,enabled=true,rich=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-approval-')),file=path.join(root,'database.sqlite');new Store(file).replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());
 const preloads=[...(enabled?[preload]:[]),...(rich?[path.join(__dirname,'support/rich-delivery-preload.cjs')]:[])];let h=await host(root,{preloads});
 t.after(async()=>{await h.kill();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('sf-local-qualify-approval-'));fs.rmSync(root,{recursive:true,force:true});});
 const state=ok(await request(h,BASE+'/status')),batch=structuredClone(require('./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'));batch.recoveryId=state.recoveryId;
 const lookup=()=>request(h,BASE+'/imports/'+batch.editor.installationId+'/'+batch.operationId+'?recoveryId='+batch.recoveryId);
 const input=(index=0)=>({databaseId:batch.databaseId,recoveryId:batch.recoveryId,id:'import-'+T.digest(['import-'+T.digest([batch.recoveryId,batch.editor.installationId,batch.operationId]),batch.items[index].itemId]),requestHash:T.digest(batch),action:'approve',note:'Original evidence reviewed'});
 return {root,file,state,batch,input,lookup,get h(){return h;},get:route=>request(h,BASE+route),submit:()=>request(h,BASE+'/imports',batch),review:p=>h.command('history-review',p),stats:async()=>ok(await request(h,BASE+'/cars/car-a/statistics')),
  cancel:ids=>request(h,BASE+'/imports/'+batch.editor.installationId+'/'+batch.operationId+'/cancel',{version:1,databaseId:batch.databaseId,recoveryId:batch.recoveryId,operationId:batch.operationId,itemIds:ids}),
  async restart(){await h.kill();h=await host(root,{preloads});},
  async crash(mode,fn){fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode,staging:false}));const pending=fn().catch(e=>e);await until(()=>fs.existsSync(path.join(root,'crash-reached.json')),mode);await h.kill();await pending;fs.unlinkSync(path.join(root,'crash-reached.json'));h=await host(root,{preloads});}
 };
}
const code=c=>e=>e.code===c;

test('explicitly closed approval gate is immutable and has no remote approval route',async t=>{
 const gate=require('../src/historical-approval-gate.cjs');assert(Object.isFrozen(gate));assert.equal(gate.enabled(),false);
 const f=await fixture(t,false);assert.equal(f.state.capability.features.historicalImports,false);assert.deepEqual(f.state.capability.formats,['timing-v1']);ok(await f.submit());
 const inspected=await f.review({...f.input(),action:'inspect'});assert.equal(inspected.approvalEnabled,false);
 await assert.rejects(f.review({...f.input(),approvalEnabled:true}),code('UNSUPPORTED_COVERAGE'));
 assert.equal((await f.stats()).acceptedSessions,0);
 const r=await request(f.h,BASE+'/imports/'+f.batch.editor.installationId+'/'+f.batch.operationId+'/approve',f.input());assert.notEqual(r.status,200);
});

test('owner Review commits approval and sender receipt atomically, survives restart and preserves car data',async t=>{
 const f=await fixture(t),before=new Store(f.file).snapshot();assert.equal(f.state.capability.features.historicalImports,true);assert.deepEqual(f.state.capability.formats,['timing-v1']);
 ok(await f.submit());assert.equal((await f.stats()).acceptedSessions,0);
 const inspected=await f.review({...f.input(),action:'inspect'});assert.equal(inspected.approvalEnabled,true);assert.equal(inspected.recoveryChanged,false);
 const a=await f.review(f.input());assert.equal(a.status,'approved');assert.equal(a.accepted.contentHash,T.digest(f.batch.items[0].bundle));
 const receipt=ok(await f.lookup());assert.equal(receipt.items[0].status,'approved');assert.deepEqual(receipt.items[0].accepted,a.accepted);
 await f.restart();assert.equal((await f.review(f.input())).duplicate,true);assert.deepEqual(ok(await f.submit()),receipt);
 const after=new Store(f.file).snapshot();assert.deepEqual(after.cars,before.cars);assert.deepEqual(after.installations,before.installations);assert.deepEqual(after.tests,before.tests);assert.equal(after.timing.audit.length,1);
 const s=await f.stats();assert.equal(s.historicalSessions,1);assert.equal(s.personalRecordLaps,0);assert.equal(s.trackRecordLaps,0);assert.equal(s.distanceComplete,false);
 await assert.rejects(f.review({...f.input(),note:'Changed retry'}),code('OPERATION_CONFLICT'));
 await assert.rejects(f.review({...f.input(),requestHash:'0'.repeat(64)}),code('REVISION_CONFLICT'));
});

test('per-item approval, rejection and cancellation preserve already approved results',async t=>{
 const f=await fixture(t);for(let i=1;i<3;i++)f.batch.items.push({...structuredClone(f.batch.items[0]),itemId:'extra-'+i,sessionId:'session-'+i});
 ok(await f.submit());await f.review(f.input());await f.review({...f.input(1),action:'reject',note:'Insufficient evidence'});
 const receipt=ok(await f.cancel(f.batch.items.map(i=>i.itemId)));assert.deepEqual(receipt.items.map(i=>i.status),['approved','rejected','cancelled']);
 await assert.rejects(f.review(f.input(2)),code('REVISION_CONFLICT'));assert.equal((await f.stats()).historicalSessions,1);
 await f.restart();assert.deepEqual(ok(await f.lookup()),receipt);
});

test('competing cancellation and owner approval yield one durable decision',async t=>{
 const f=await fixture(t);ok(await f.submit());const responses=await Promise.allSettled([f.review(f.input()),f.cancel([f.batch.items[0].itemId])]);
 const receipt=ok(await f.lookup()),status=receipt.items[0].status;assert(['approved','cancelled'].includes(status));assert.equal((await f.stats()).historicalSessions,status==='approved'?1:0);
 if(status==='cancelled')assert.equal(responses[0].status,'rejected');else assert.equal(responses[0].status,'fulfilled');
});

test('approval crashes before and after commit recover without partial decisions or duplicate contributions',{timeout:60000},async t=>{
 const f=await fixture(t);ok(await f.submit());await f.crash('before-commit',()=>f.review(f.input()));assert.equal(ok(await f.lookup()).items[0].status,'pending');assert.equal((await f.stats()).acceptedSessions,0);
 await f.crash('after-commit',()=>f.review(f.input()));assert.equal(ok(await f.lookup()).items[0].status,'approved');assert.equal((await f.review(f.input())).duplicate,true);assert.equal((await f.stats()).historicalSessions,1);assert.equal(new Store(f.file).data.timing.audit.length,1);
});

test('restore blocks old and rewritten approval guards while retaining inspectable evidence',async t=>{
 const f=await fixture(t);ok(await f.submit());await f.h.command('backup');await f.review(f.input());await f.h.command('restore');
 await assert.rejects(f.review(f.input()),code('RECOVERY_CHANGED'));assert.equal((await f.lookup()).value.code,'RECOVERY_CHANGED');
 const current=ok(await f.get('/status')),fresh={...f.input(),recoveryId:current.recoveryId};await assert.rejects(f.review(fresh),code('RECOVERY_CHANGED'));
 assert.equal((await f.review({...fresh,action:'inspect'})).recoveryChanged,true);assert.equal((await f.stats()).acceptedSessions,0);
});

test('approval rechecks missing cars and never silently remaps a participant',async t=>{
 const f=await fixture(t);f.batch.items[0].bundle.race.participants[0].carId='missing-car';f.batch.items[0].bundle.race.participants[0].configuration=null;ok(await f.submit());
 await assert.rejects(f.review(f.input()),code('CAR_NOT_FOUND'));assert.equal(ok(await f.lookup()).items[0].status,'pending');assert.equal((await f.stats()).acceptedSessions,0);
});

test('approval rejects a late conflicting session instead of overwriting accepted history',async t=>{
 const f=await fixture(t);ok(await f.submit());const legacy=require('./support/timing-fixtures.cjs').fixtures().normal;legacy.sessionId=f.batch.items[0].sessionId;legacy.source.id=f.batch.items[0].sourceId;
 ok(await request(f.h,BASE+'/operations',{version:1,databaseId:f.batch.databaseId,recoveryId:f.batch.recoveryId,operationId:'competing-race',editor:f.batch.editor,sourceId:legacy.source.id,sessionId:legacy.sessionId,action:'create',expected:null,reason:'Measured session',bundle:{format:'timing-v1',payload:legacy}}));
 await assert.rejects(f.review(f.input()),e=>['REVISION_CONFLICT','RESULT_REQUIRES_SHARED_HISTORY','UNSUPPORTED_COVERAGE'].includes(e.code));assert.equal(ok(await f.lookup()).items[0].status,'pending');assert.equal((await f.stats()).historicalSessions,0);
});

test('historical approval receipt stays immutable after guarded withdrawal and retry cannot reactivate it',async t=>{
 const f=await fixture(t,true,true);ok(await f.submit());const approval=await f.review(f.input()),receipt=ok(await f.lookup()),item=f.batch.items[0];
 const withdrawal={version:1,databaseId:f.batch.databaseId,recoveryId:f.batch.recoveryId,operationId:'withdraw-approved-history',editor:f.batch.editor,sourceId:item.sourceId,sessionId:item.sessionId,action:'withdraw',expected:approval.accepted,reason:'Evidence withdrawn',withdrawalReason:'Evidence withdrawn'};
 const removed=ok(await request(f.h,BASE+'/operations',withdrawal));assert.equal(removed.current.state,'withdrawn');
 await f.restart();assert.deepEqual(ok(await f.lookup()),receipt);const retry=await f.review(f.input());assert.equal(retry.duplicate,true);assert.deepEqual(retry.accepted,approval.accepted);assert.deepEqual(retry.current,removed.current);assert.equal((await f.stats()).historicalSessions,0);
 const cancelled=ok(await f.cancel([item.itemId]));assert.equal(cancelled.items[0].status,'approved');assert.deepEqual(cancelled.items[0].accepted,approval.accepted);
 // A historical replacement must still not bypass owner Review.
 assert.equal((await request(f.h,BASE+'/operations',{...withdrawal,operationId:'bypass',action:'replace',expected:removed.current,bundle:item.bundle,withdrawalReason:undefined})).value.code,'UNSUPPORTED_COVERAGE');
});

test('a rejected SQL commit leaves approval, session, audit and feed unchanged',async t=>{
 const f=await fixture(t);ok(await f.submit());const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_approval BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'injected approval failure'); END");db.close();
 const cursor=ok(await f.get('/status')).cursor;await assert.rejects(f.review(f.input()));assert.equal(ok(await f.lookup()).items[0].status,'pending');assert.equal((await f.stats()).acceptedSessions,0);assert.equal(ok(await f.get('/status')).cursor,cursor);
 const clean=new DatabaseSync(f.file);clean.exec('DROP TRIGGER fail_approval');clean.close();await f.review(f.input());assert.equal(new Store(f.file).data.timing.audit.length,1);
});

test('handoff receipts and hashes match production per-item decisions',async t=>{
 const f=await fixture(t),folder=path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/historical-approval'),load=name=>JSON.parse(fs.readFileSync(path.join(folder,name+'.json'))),S=require('../src/history-import-schema.cjs');
 const original=load('request'),manifest=load('manifest');S.validate(original,S.request);assert.equal(T.digest(original),manifest.requestHash);assert.equal(T.digest(original.items[0].bundle),manifest.approvedBundleHash);
 for(const name of ['pending','mixed-decisions','after-cancellation'])S.validate(load(name),S.receipt);
 require('../src/shared-history-schema.cjs').validate(load('withdrawal-operation'),require('../src/shared-history-schema.cjs').operation);
 Object.assign(f.batch,original,{recoveryId:f.state.recoveryId});
 const expected=name=>({...load(name),recoveryId:f.batch.recoveryId,requestHash:T.digest(f.batch)});
 assert.deepEqual(ok(await f.submit()),expected('pending'));await f.review(f.input());await f.review({...f.input(2),action:'reject',note:'Original evidence insufficient'});
 assert.deepEqual(ok(await f.lookup()),expected('mixed-decisions'));assert.deepEqual(ok(await f.cancel(f.batch.items.map(i=>i.itemId))),expected('after-cancellation'));
});

if(process.env.SLOTFORGE_TIMING_SOURCE)test('current Timing verifies pending and approved receipts without enabling host approval',()=>{
 const root=path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/historical-approval'),load=name=>JSON.parse(fs.readFileSync(path.join(root,name+'.json'))),client=require(path.join(path.resolve(process.env.SLOTFORGE_TIMING_SOURCE),'paddock-historical-store.js'));
 const request=load('request');assert.deepEqual(client.receipt(load('pending'),request),load('pending'));
 assert.deepEqual(client.receipt(load('mixed-decisions'),request),load('mixed-decisions'));
 const bad=load('mixed-decisions');bad.items.find(i=>i.status==='approved').accepted.contentHash='f'.repeat(64);assert.throws(()=>client.receipt(bad,request),code('RECEIPT_MISMATCH'));
 assert.equal(require('../src/historical-approval-gate.cjs').enabled(),false);
});
