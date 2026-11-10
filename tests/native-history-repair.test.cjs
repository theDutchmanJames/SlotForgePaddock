'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{open}=require('../packages/shared-library/index.cjs'),E=require('../src/shared-library-engine.cjs'),T=require('../src/timing-integration.cjs');
const projection=require('../src/timing-legacy/projection/paddock-historical-evidence.js');
async function fixture(t){
 const root=require('./support/temp-dir.cjs')('native-history-'),options={application:'SlotForge Timing',installationId:'native-test',sharedRoot:root,legacyProfiles:[]};
 const h=await open(options),state=await h.status();await h.close();const identity={databaseId:state.databaseId,recoveryId:state.recoveryId},store=()=>new Store(state.file,{deferred:true});
 const car=await E.call(store(),options,'adoptCar',{...identity,operationId:'car',sourceId:'old-timing',originalId:'old-car',rawOriginal:{id:'old-car'},data:{name:'Native car'}});
 const raw={session:{id:'old-session',date:'2020-04-05T12:30:00.000Z',sessionType:'practice',setupName:'Native practice',trackId:'track',trackName:'Home'},laps:[{id:'lap1',carId:'old-car',driverId:'driver',driverName:'James',lapNumber:1,lane:2,time:7000},{id:'lap2',carId:'old-car',driverId:'driver',driverName:'James',lapNumber:2,lane:2,time:8000},{id:'lap3',carId:'old-car',driverId:'driver',driverName:'James',lapNumber:3,lane:2,time:3000,invalid:true}]};
 const bundle=projection.bundle(raw,state.databaseId,{'old-car':car.carId});bundle.context.notes='Pending historical evidence, not accepted. Saved reviewed classification.';
 const origin=await E.call(store(),options,'adoptSession',{...identity,operationId:'session',sourceId:'old-timing',originalId:'old-session',sessionId:'old-session',rawOriginal:raw,bundle});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,options,identity,store,state,car,raw,bundle,origin};
}
const operation=f=>({version:1,...f.identity,operationId:'correction',editor:{installationId:'native-test',application:'SlotForge Timing',name:'Timing'},sourceId:'old-timing',sessionId:'old-session',action:'replace',expected:f.origin.accepted,reason:'User correction',bundle:f.bundle});
test('already-adopted native history repairs once from retained originals; dates, lanes and records agree',async t=>{
 const f=await fixture(t),before=f.store().snapshot(),h=await open(f.options);
 try{
  assert.equal((await h.bootstrapInfo()).nativeHistoryRepair.repaired,1);
  const stats=await h.historyRead({kind:'statistics',carId:f.car.carId});assert.equal(stats.validLaps,2);assert.equal(stats.averageLapMs,7500);assert.equal(stats.bestTrackLapMs,7000);assert.equal(stats.unknownDistanceLaps,3);assert.equal(stats.distanceComplete,false);
  const list=await h.historyRead({kind:'sessions',from:'2020-04-01T00:00:00Z',to:'2020-05-01T00:00:00Z'});assert.equal(list.entries.length,1);assert.equal(list.entries[0].startedAt,null);assert.equal(list.entries[0].savedAt,f.raw.session.date);assert.equal(list.entries[0].dateBasis,'saved');assert.equal(list.entries[0].accepted.revision,2);
  const view=require('../src/history-view.cjs').read(f.store(),{...f.identity,operation:'car',carId:f.car.carId});assert.deepEqual(view.entries[0].participants[0].lanes,[2]);assert.equal(view.records.rows[0].savedAt,f.raw.session.date);assert.equal(view.records.rows[0].durationMs,7000);
  const timing=await h.timingRead({kind:'carStatistics',carId:f.car.carId});assert.equal(timing.summary.lastDrivenAt,f.raw.session.date);assert.equal(timing.summary.lastDrivenDateBasis,'saved');
  const home=await h.timingRead({kind:'home',weekStart:'2020-04-01T00:00:00Z'});assert.equal(home.fastestThisWeek.durationMs,7000);assert.equal(home.recentSessions[0].dateBasis,'saved');
  const after=f.store().snapshot();assert.deepEqual(after.cars,before.cars);assert.deepEqual(after.libraryExtras,before.libraryExtras);assert.equal(after.timing.sessions.length,1);assert.equal(after.timing.audit.length,2);assert.equal(after.timing.sessions[0].nativeTiming,1);
  assert(fs.readdirSync(path.join(f.root,'recovery')).some(n=>n.startsWith('native-history-')));
  const again=await open(f.options);try{assert.equal((await again.bootstrapInfo()).nativeHistoryRepair.repaired,0);assert.equal((await again.status()).revision,(await h.status()).revision);}finally{await again.close();}
  assert.equal((await h.extensionRead({namespace:'timing.historyOriginals',sourceId:'old-timing',originalId:'old-session'})).hash,T.digest(f.raw));
 }finally{await h.close();}
});
for(const action of ['replace','withdraw'])test('automatic native repair preserves subsequent '+action,async t=>{
 const f=await fixture(t),input={...operation(f),action};if(action==='withdraw'){delete input.bundle;input.withdrawalReason='Withdrawn by user';}
 await E.call(f.store(),f.options,'historyWrite',input);const before=f.store().snapshot(),h=await open(f.options);try{assert.equal((await h.bootstrapInfo()).nativeHistoryRepair.repaired,0);assert.deepEqual(f.store().snapshot(),before);}finally{await h.close();}
});
test('restored originals cannot trigger automatic reacceptance into a new recovery generation',async t=>{
 const f=await fixture(t),s=f.store(),backup=s.snapshot();await s.restoreAsync(backup,s.data.revision);const h=await open(f.options);try{assert.notEqual((await h.status()).recoveryId,f.identity.recoveryId);assert.equal((await h.bootstrapInfo()).nativeHistoryRepair.repaired,0);assert.equal((await h.historyRead({kind:'sessions'})).entries[0].accepted.revision,1);}finally{await h.close();}
});
test('native corrections require exact raw projection; public historical validation remains conservative',async t=>{
 const f=await fixture(t),h=await open(f.options);try{
  const head=await h.historyRead({kind:'detail',sourceId:'old-timing',sessionId:'old-session'}),raw=structuredClone(f.raw);raw.laps[0].time=9000;
  const bundle=projection.nativeBundle(raw,f.identity.databaseId,{'old-car':f.car.carId});
  assert.throws(()=>require('../src/rich-history.cjs').validateBundle(bundle),/record eligibility/);
  const input={...operation(f),expected:head.accepted,bundle,rawOriginal:raw};const saved=await h.historyWrite(input);assert.equal(saved.accepted.revision,3);assert.equal((await h.historyRead({kind:'statistics',carId:f.car.carId})).bestTrackLapMs,8000);
  const wrongSession=structuredClone(input);wrongSession.operationId='wrong-session';wrongSession.expected=saved.accepted;wrongSession.rawOriginal.session.id='another-race';await assert.rejects(h.historyWrite(wrongSession),/record eligibility/);
  const bad=structuredClone(input);bad.operationId='forged';bad.expected=saved.accepted;bad.bundle.race.participants[0].laps[2].valid=true;bad.bundle.race.participants[0].laps[2].trackRecordEligible=true;await assert.rejects(h.historyWrite(bad),/record eligibility/);
 }finally{await h.close();}
});
test('accepted history display replaces obsolete pending boilerplate without altering stored evidence',()=>{
 const b={format:'history-v1',race:{},provenance:{kind:'historical'},context:{notes:'Pending historical evidence, not accepted. Keep this note.'}};
 const display=require('../renderer/history-view-model.js').normalize({body:b,accepted:{state:'active'}});assert.equal(display.context.notes,'Accepted historical Timing evidence. Keep this note.');assert(b.context.notes.startsWith('Pending'));
});
test('repair retry returns its durable receipt and refuses stale recovery identities',async t=>{
 const f=await fixture(t),client={application:'SlotForge Paddock',installationId:'native-history-repair'},input={...f.identity,operationId:'native-v2-'+T.digest([f.origin.id,f.origin.sourceHash]),originId:f.origin.id,sourceHash:f.origin.sourceHash,expected:f.origin.accepted};
 const first=await E.call(f.store(),client,'repairNativeHistory',input),retry=await E.call(f.store(),client,'repairNativeHistory',input);assert.equal(retry.duplicate,true);assert.deepEqual(retry.accepted,first.accepted);assert.equal(f.store().data.timing.audit.length,2);
 await assert.rejects(E.call(f.store(),client,'repairNativeHistory',{...input,recoveryId:'old-generation'}),e=>e.code==='RECOVERY_CHANGED');
});
test('changed raw originals are skipped, never overwritten',async t=>{
 const f=await fixture(t);await E.call(f.store(),f.options,'extensionWrite',{...f.identity,operationId:'changed-evidence',namespace:'timing.historyOriginals',sourceId:'old-timing',originalId:'old-session',expectedRevision:1,rawOriginal:{...f.raw,extra:'Changed'}});
 const before=f.store().snapshot(),h=await open(f.options);try{assert.equal((await h.bootstrapInfo()).nativeHistoryRepair.repaired,0);assert.deepEqual(f.store().snapshot(),before);}finally{await h.close();}
});
test('native withdrawal retains saved-date context without pretending it is a start time',async t=>{
 const f=await fixture(t),h=await open(f.options);try{const head=await h.historyRead({kind:'detail',sourceId:'old-timing',sessionId:'old-session'}),input={...operation(f),action:'withdraw',operationId:'remove',expected:head.accepted,withdrawalReason:'Wrong race'};delete input.bundle;await h.historyWrite(input);const row=(await h.historyRead({kind:'sessions'})).entries[0];assert.equal(row.startedAt,null);assert.equal(row.savedAt,f.raw.session.date);assert.equal(row.accepted.state,'withdrawn');assert.equal((await h.historyRead({kind:'statistics',carId:f.car.carId})).measuredLaps,0);}finally{await h.close();}
});
