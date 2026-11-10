'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {open}=require('../packages/shared-library/index.cjs');
async function fixture(t){const root=require('./support/temp-dir.cjs')('raw-history-'),handles=[];t.after(async()=>{await Promise.all(handles.map(h=>h.close()));fs.rmSync(root,{recursive:true,force:true});});const start=async(id='Timing')=>{const h=await open({application:id,installationId:id,sharedRoot:root});handles.push(h);return h;};const h=await start(),s=await h.status(),identity={databaseId:s.databaseId,recoveryId:s.recoveryId},car=await h.carWrite({...identity,operationId:'car',action:'create',set:{name:'Tokens car'}});const raw={session:{id:'tokens-original',sessionType:'tokens',setupName:'Original token session',unknown:'Keep'},laps:[{id:'lap-1',carId:'timing-car',tokens:5,time:1000,unknown:true},{id:'lap-2',carId:'timing-car',tokens:7,time:900}]};const input={...identity,sourceId:'Timing',originalId:'tokens-original',sessionId:'tokens-shared',operationId:'raw-create',action:'create',expectedRevision:0,reason:'Saved original token race',projectionReason:'Token race has no supported measured projection.',carIds:[car.car.id],rawOriginal:raw};return {root,start,h,s,identity,carId:car.car.id,raw,input};}

test('raw-only create, correction, withdrawal and restore remain lossless and never contribute measured statistics',async t=>{
 const f=await fixture(t),first=await f.h.originalHistoryWrite(f.input),peer=await f.start('Paddock');assert.deepEqual(first.accepted,{revision:1,state:'active',contentHash:require('../src/timing-integration.cjs').digest(f.raw)});assert.equal(first.action,'create');assert.equal(first.originalOnly,true);
 assert.equal((await peer.originalHistory({kind:'sessions',carId:f.carId})).total,1);assert.equal((await peer.historyRead({kind:'sessions',carId:f.carId})).entries.length,0);
 const detail=await peer.originalHistory({kind:'detail',sourceId:'Timing',originalId:f.input.originalId});assert.deepEqual(detail.session,f.raw.session);assert.equal(detail.lapCount,2);
 const page=await peer.originalHistory({kind:'laps',sourceId:'Timing',originalId:f.input.originalId,limit:1});assert.deepEqual(page.rows,[f.raw.laps[0]]);assert.deepEqual((await peer.originalHistory({kind:'laps',sourceId:'Timing',originalId:f.input.originalId,limit:1,offset:1,token:page.token})).rows,[f.raw.laps[1]]);
 const changed={...f.input,action:'replace',operationId:'raw-edit',expectedRevision:1,rawOriginal:{...f.raw,session:{...f.raw.session,setupName:'Corrected tokens'}}},second=await f.h.originalHistoryWrite(changed);assert.equal(second.accepted.revision,2);await assert.rejects(peer.originalHistory({kind:'laps',sourceId:'Timing',originalId:f.input.originalId,offset:1,token:page.token}),e=>e.code==='QUERY_CHANGED');
 const withdrawal={...f.input,action:'withdraw',operationId:'raw-withdraw',expectedRevision:2,reason:'Withdraw token session'};delete withdrawal.rawOriginal;const removed=await f.h.originalHistoryWrite(withdrawal);assert.equal(removed.accepted.state,'withdrawn');assert.equal((await peer.originalHistory({kind:'sessions'})).total,0);assert.equal((await peer.originalHistory({kind:'sessions',state:'withdrawn'})).total,1);
 await f.h.close();const reopened=await f.start(),retry=await reopened.originalHistoryWrite(f.input);assert.equal(retry.duplicate,true);assert.equal((await peer.originalHistory({kind:'detail',sourceId:'Timing',originalId:f.input.originalId})).state,'withdrawn');
 const restored=await reopened.originalHistoryWrite({...withdrawal,action:'restore',operationId:'raw-restore',expectedRevision:3,reason:'Restore preserved session'});assert.equal(restored.accepted.revision,4);assert.equal(restored.accepted.state,'active');assert.deepEqual((await peer.originalHistory({kind:'laps',sourceId:'Timing',originalId:f.input.originalId})).rows,f.raw.laps);
 const store=new(require('../src/store.cjs').Store)((await peer.status()).file);assert.equal(store.data.timing.sessions.length,0);assert.equal(store.data.submissions.length,0);
});

test('original-only identity and revision conflicts reject the whole change',async t=>{
 const f=await fixture(t);await f.h.originalHistoryWrite(f.input);
 for(const bad of [
  {...f.input,action:'replace',operationId:'bad-revision',expectedRevision:0},
  {...f.input,action:'replace',operationId:'bad-identity',expectedRevision:1,sessionId:'another-session'},
  {...f.input,action:'replace',operationId:'bad-original',expectedRevision:1,rawOriginal:{...f.raw,session:{id:'other-original'}}},
  {...f.input,action:'replace',operationId:'missing-car',expectedRevision:1,carIds:['missing-car']},
  {...f.input,operationId:'double-session',originalId:'second-original',rawOriginal:{...f.raw,session:{id:'second-original'}}}
 ])await assert.rejects(f.h.originalHistoryWrite(bad));
 assert.equal((await f.h.originalHistory({kind:'detail',sourceId:'Timing',originalId:f.input.originalId})).revision,1);assert.equal((await f.h.originalHistory({kind:'sessions'})).total,1);
 await assert.rejects(f.h.originalHistoryWrite({...f.input,reason:'different retry'}),e=>e.code==='COMMAND_CONFLICT'||e.code==='OPERATION_CONFLICT');
});

test('bootstrap originals use revision one and can be corrected without creating another session',async t=>{
 const f=await fixture(t);await f.h.adoptSession({...f.identity,operationId:'adopt-token',sourceId:'Timing',originalId:f.input.originalId,sessionId:f.input.sessionId,bundle:null,projectionReason:f.input.projectionReason,carIds:[f.carId],rawOriginal:f.raw});
 assert.equal((await f.h.originalHistory({kind:'sessions'})).rows[0].revision,1);const saved=await f.h.originalHistoryWrite({...f.input,action:'replace',expectedRevision:1,operationId:'edit-adopted'});assert.equal(saved.accepted.revision,2);assert.equal((await f.h.originalHistory({kind:'sessions'})).total,1);
});

test('raw-only sessions cannot duplicate accepted statistics and Paddock can read canonical car lap identities',async t=>{
 const f=await fixture(t),raw={...f.raw,laps:f.raw.laps.map(l=>({...l,carId:f.carId}))};await f.h.originalHistoryWrite({...f.input,rawOriginal:raw});
 const store=new(require('../src/store.cjs').Store)(f.s.file,{deferred:true}),origin=await f.h.origin({sourceId:'Timing',originalId:f.input.originalId,entity:'session'}),view=require('../src/shared-library-originals.cjs').read(store,{...f.identity,operation:'original',carId:f.carId,originId:origin.id});assert.equal(view.total,2);assert.equal(view.laps[0].time,1000);
 const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))).items[0].bundle;bundle.race.participants[0].carId=f.carId;bundle.race.participants[0].configuration=null;
 await f.h.historyWrite({version:1,...f.identity,operationId:'accepted',sourceId:'Timing',sessionId:'accepted-session',editor:{installationId:'Timing',application:'SlotForge Timing',name:'Owner'},action:'create',expected:null,reason:'Historical evidence',bundle});
 await assert.rejects(f.h.originalHistoryWrite({...f.input,operationId:'duplicate-accepted',originalId:'accepted-original',sessionId:'accepted-session',rawOriginal:{session:{id:'accepted-original'},laps:[]}}),e=>e.code==='UNSUPPORTED_COVERAGE');
 assert.equal((await f.h.originalHistory({kind:'sessions'})).total,1);assert.equal((await f.h.historyRead({kind:'sessions',carId:f.carId})).entries.length,1);
});
