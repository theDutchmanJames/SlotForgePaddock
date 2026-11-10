'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {compile}=require('./support/history-gates.cjs'),{Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs');
const {host,request}=require('./support/local-recovery-qualification.cjs'),BASE='/v1/shared-history';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
const gates=['rich-history-gate.cjs','historical-approval-gate.cjs'].map(n=>path.join(__dirname,'../src',n));
test('test compilation exercises both states from either release value without editing source or allowing runtime overrides',()=>{
 for(const file of gates){const original=fs.readFileSync(file,'utf8');for(const release of [false,true])for(const enabled of [false,true]){
  const context={module:{exports:{}},process:{env:{SLOTFORGE_RICH_HISTORY:'1'}}};vm.runInNewContext(compile(compile(original,release),enabled),context);
  const gate=context.module.exports;assert.equal(gate.enabled(),enabled);assert(Object.isFrozen(gate));assert.throws(()=>{gate.enabled=()=>!enabled;},TypeError);
 }assert.equal(fs.readFileSync(file,'utf8'),original);}
 for(const code of ['', 'const VERIFIED = false;\nconst VERIFIED = true;', 'const VERIFIED = process.env.ON;'])assert.throws(()=>compile(code,true),/exactly one/);
 assert.throws(()=>compile('const VERIFIED = false;',1),/exactly one/);
});
for(const rich of [false,true])for(const historical of [false,true])test(`HTTP/owner-worker gate matrix: rich=${rich}, historical=${historical}`,{timeout:60000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-gates-')),seed=require('./support/timing-fixtures.cjs').fixtures(),file=path.join(root,'database.sqlite');new Store(file).replace(seed.store.snapshot());
 const originals=gates.map(f=>fs.readFileSync(f));let h;
 t.after(async()=>{await h?.kill();gates.forEach((f,i)=>assert.deepEqual(fs.readFileSync(f),originals[i]));assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('sf-local-qualify-gates-'));fs.rmSync(root,{recursive:true,force:true});});
 const preloads=[...(rich?[path.join(__dirname,'support/rich-delivery-preload.cjs')]:[]),...(historical?[path.join(__dirname,'support/historical-approval-preload.cjs')]:[])];
 h=await host(root,{preloads});const state=ok(await request(h,BASE+'/status'));
 assert.deepEqual(state.capability.formats,rich?['timing-v1','history-v1']:['timing-v1']);assert.equal(state.capability.features.historicalImports,historical);
 const status=ok(await request(h,'/v1/status',undefined,{'X-SlotForge-Extensions':'shared-history-v1'}));assert.deepEqual(status.capabilities.sharedHistory,state.capability);
 const richFixture=require('./fixtures/timing-production-mapper/race.json'),op={version:1,databaseId:state.databaseId,recoveryId:state.recoveryId,operationId:'matrix-measured',editor:{installationId:'matrix-editor',application:'SlotForge Timing',name:'Synthetic'},sourceId:'matrix-source',sessionId:'matrix-measured',action:'create',expected:null,reason:'Measured',bundle:richFixture.bundle};
 const saved=await request(h,BASE+'/operations',op);if(rich)assert.equal(ok(saved).accepted.revision,1);else assert.equal(saved.value.code,'INVALID_PAYLOAD');
 const legacy=seed.normal;ok(await request(h,BASE+'/operations',{...op,operationId:'matrix-legacy',sourceId:legacy.source.id,sessionId:legacy.sessionId,bundle:{format:'timing-v1',payload:legacy}}));
 const batch=structuredClone(require('./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'));batch.recoveryId=state.recoveryId;
 const received=ok(await request(h,BASE+'/imports',batch));assert.equal(received.items[0].status,'pending');
 const statistics=()=>request(h,BASE+'/cars/car-a/statistics');assert.equal(ok(await statistics()).historicalSessions,0);
 const input={databaseId:batch.databaseId,recoveryId:batch.recoveryId,id:'import-'+T.digest(['import-'+T.digest([batch.recoveryId,batch.editor.installationId,batch.operationId]),batch.items[0].itemId]),requestHash:T.digest(batch),action:'approve',note:'Matrix approval'};
 const route=BASE+'/imports/'+batch.editor.installationId+'/'+batch.operationId;
 assert.notEqual((await request(h,route+'/approve',input)).status,200,'Remote clients never own approval');
 const inspected=await h.command('history-review',{...input,action:'inspect'});assert.equal(inspected.approvalEnabled,historical);
 if(historical)assert.equal((await h.command('history-review',input)).status,'approved');else await assert.rejects(h.command('history-review',{...input,approvalEnabled:true}),e=>e.code==='UNSUPPORTED_COVERAGE');
 assert.equal(ok(await statistics()).historicalSessions,historical?1:0);
 const receipt=ok(await request(h,route+'?recoveryId='+batch.recoveryId));
 // Roll back both write gates on restart: accepted history and original
 // decisions remain readable, while new rich writes/approvals are blocked.
 await h.kill();h=await host(root);
 assert.deepEqual(ok(await request(h,route+'?recoveryId='+batch.recoveryId)),receipt);
 assert.equal(ok(await statistics()).historicalSessions,historical?1:0);
 if(rich){const head=ok(await request(h,BASE+'/sessions/'+op.sourceId+'/'+op.sessionId));assert.equal(head.accepted.revision,1);assert.equal(head.body.format,'history-v1');}
 assert.equal((await request(h,BASE+'/operations',{...op,operationId:'after-rollback',sessionId:'after-rollback'})).value.code,'INVALID_PAYLOAD');
 const later=structuredClone(batch);later.operationId='new-pending';later.items[0].sessionId='new-pending';assert.equal(ok(await request(h,BASE+'/imports',later)).items[0].status,'pending');
});
