'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),H=require('../src/shared-history.cjs'),R=require('../src/rich-history.cjs'),V=require('../src/history-view.cjs'),T=require('../src/timing-integration.cjs');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-view-')),file=path.join(root,'db.sqlite'),f=require('./support/timing-fixtures.cjs').fixtures(),seed=new Store(file,{deferred:true});seed.replace(f.store.snapshot());const store=new Store(file,{deferred:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const op=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/qualified/create.json')));op.recoveryId=H.status(store).recoveryId;const call=input=>V.read(store,{databaseId:store.data.id,recoveryId:H.status(store).recoveryId,...input});return {store,file,f,op,call};}
test('desktop history mixes formats, retains original configurations, and computes consistency without loading the model',t=>{
 const {store,f,op,call}=setup(t);R.receiveQualified(store,op);H.receive(store,{...op,operationId:'legacy-ui',sessionId:f.normal.sessionId,bundle:{format:'timing-v1',payload:f.normal}});
 const result=call({operation:'car',carId:'car-a'});assert.equal(result.entries.length,2);assert.equal(result.statistics.distanceM,140);assert.equal(result.statistics.classWins,1);assert.equal(result.consistency.sampleLaps,result.statistics.validLaps);assert.ok(result.consistency.standardDeviationMs>0);
 assert.ok(result.entries.every(e=>e.participants.every(p=>!Object.hasOwn(p,'laps')&&!Object.hasOwn(p,'configuration'))));
 const head=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,carId:'car-a'});assert.deepEqual(head.body.race.participants[0].configuration,op.bundle.race.participants[0].configuration);assert.equal(head.body.race.participants[0].laps,undefined);assert.equal(head.statistics.distanceM,80);assert.equal(head.consistency.sampleLaps,3);
 const filtered=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,participantId:'entry-1',lane:1,driverId:'driver-1'});assert.equal(filtered.statistics.overallWins,0);assert.equal(filtered.consistency.sampleLaps,2);assert.equal(filtered.statistics.validLaps,2);
 assert.ok(store.deferredState);
});
test('desktop lap pages are token bound and withdrawals remove every contribution',t=>{
 const {store,op,call}=setup(t);const saved=R.receiveQualified(store,op),head=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,carId:'car-a'});
 assert.deepEqual(call({operation:'laps',sourceId:op.sourceId,sessionId:op.sessionId,participantId:'entry-1',resultToken:head.resultToken}).laps,op.bundle.race.participants[0].laps);
 const withdrawal={...op,operationId:'withdraw-ui',action:'withdraw',expected:saved.accepted,withdrawalReason:'Wrong event'};delete withdrawal.bundle;R.receiveQualified(store,withdrawal);
 assert.throws(()=>call({operation:'laps',sourceId:op.sourceId,sessionId:op.sessionId,participantId:'entry-1',resultToken:head.resultToken}),e=>e.apiCode==='RESULT_CHANGED');
 const now=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId});assert.equal(now.body,null);assert.equal(now.reason,'Wrong event');assert.equal(now.historyCount,1);assert.equal(call({operation:'car',carId:'car-a'}).statistics.distanceM,0);
});
test('desktop query identities, filters and recovery are checked; empty statistics stay unknown',t=>{
 const {store,op,call}=setup(t);assert.equal(call({operation:'car',carId:'car-a'}).consistency.standardDeviationMs,null);
 for(const patch of [{databaseId:'wrong'},{recoveryId:'old'},{carId:'no-car'},{lane:0},{offset:-1},{unexpected:true}])assert.throws(()=>call({operation:'car',carId:'car-a',...patch}));
 R.receiveQualified(store,op);assert.throws(()=>call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,participantId:'missing'}));
 assert.throws(()=>call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,driverId:'missing'}));
});
test('renderer model keeps unknown historical evidence distinct from zero and excludes no information from lap flags',()=>{
 const M=require('../renderer/history-view-model.js'),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))).items[0].bundle,p=b.race.participants[0],l=p.laps[0];l.durationMs=null;l.lane=null;l.pit=null;l.valid=null;
 const m=M.normalize({body:b}),row=M.lap(l,p,m.race,m.rich);assert.equal(row[3],'Unknown');assert.equal(row[4],'Unknown');assert.equal(row[6],'Unknown');assert.equal(row[7],'Unknown');assert.equal(M.seconds(0),'0.000 s');assert.equal(M.seconds(null),'Unknown');assert.equal(m.provenance.kind,'historical');l.flags=['invalid'];l.reason='Missed detection';assert.equal(M.lap(l,p,m.race,m.rich)[11],'invalid · Missed detection');
});

test('rich lane records use track eligibility, retain source identity, and disappear on correction',t=>{
 const {store,op,call}=setup(t),saved=R.receiveQualified(store,op),first=call({operation:'car',carId:'car-a'});
 assert.equal(first.records.rows.length,1);assert.equal(first.records.rows[0].durationMs,11000);assert.equal(first.records.rows[0].lane,1);assert.equal(first.records.rows[0].source,op.sourceId);
 const edit=structuredClone(op);edit.operationId='no-track-records';edit.action='replace';edit.expected=saved.accepted;for(const p of edit.bundle.race.participants)for(const l of p.laps)l.trackRecordEligible=false;R.receiveQualified(store,edit);
 assert.throws(()=>call({operation:'records',carId:'car-a',offset:0,resultToken:first.records.token}),e=>e.apiCode==='SNAPSHOT_CHANGED');
 const updated=call({operation:'car',carId:'car-a'});assert.equal(updated.records.rows.length,0);assert.equal(updated.statistics.bestPersonalLapMs,10000);assert.equal(updated.statistics.bestTrackLapMs,null);
});

test('history browser pages sessions and records without hydrating the full model',t=>{
 const {store,op,call}=setup(t);
 for(let i=0;i<22;i++){const x=structuredClone(op);x.operationId='page-'+i;x.sessionId='page-'+i;x.bundle.race.track.id='track-'+i;R.receiveQualified(store,x);}
 store.snapshot=()=>{throw Error('Whole model requested');};store.ensureLoaded=()=>{throw Error('Whole model requested');};
 const first=call({operation:'car',carId:'car-a'});assert.equal(first.entries.length,10);assert.ok(first.nextPage);assert.equal(first.records.rows.length,20);assert.equal(first.records.total,22);
 const next=call({operation:'car',carId:'car-a',page:first.nextPage});assert.equal(next.entries.length,10);assert.equal(new Set([...first.entries,...next.entries].map(x=>x.sessionId)).size,20);
 const records=call({operation:'records',carId:'car-a',offset:20,resultToken:first.records.token});assert.equal(records.rows.length,2);assert.equal(records.nextOffset,null);assert.equal(store.deferredState!==null,true);
});

test('desktop large session pages preserve all laps and restore invalidates old requests',async t=>{
 const {store,op,call}=setup(t),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))).items[0].bundle,p=b.race.participants[0];
 p.laps=Array.from({length:501},(_,i)=>({...p.laps[0],id:'lap-'+i,number:i+1}));R.receiveQualified(store,{...op,bundle:b});
 const h=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,carId:'car-a'}),all=[];let offset=0;
 do{const page=call({operation:'laps',sourceId:op.sourceId,sessionId:op.sessionId,participantId:'entry-1',resultToken:h.resultToken,offset});assert.ok(page.laps.length<=250);all.push(...page.laps);offset=page.nextOffset;}while(offset!==null);assert.deepEqual(all,p.laps);assert.equal(h.body.race.participants[0].configuration,null);
 const backup=JSON.parse(JSON.stringify(store.data)),identity={databaseId:store.data.id,recoveryId:H.status(store).recoveryId};await store.restoreAsync(backup,store.data.revision);
 assert.throws(()=>V.read(store,{...identity,operation:'session',sourceId:op.sourceId,sessionId:op.sessionId}),e=>e.apiCode==='RECOVERY_CHANGED');
});

test('historical evidence exposes bounded pages, missing fields and linked cars without accepting it',t=>{
 const {store,op}=setup(t),I=require('../src/history-imports.cjs'),batch=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));batch.recoveryId=op.recoveryId;
 const p=batch.items[0].bundle.race.participants[0];p.laps=Array.from({length:201},(_,i)=>({...p.laps[0],id:'item-'+i,number:i+1}));I.receive(store,batch);const row=store.data.timing.imports[0],input={databaseId:store.data.id,recoveryId:op.recoveryId,id:row.id,requestHash:row.requestHash,action:'inspect',participantId:p.id};
 const first=I.review(store,input).item.bundle.race.participants[0];assert.equal(first.laps.length,100);assert.equal(first.evidenceSummary.missing.crossing,201);assert.equal(first.linkedCar.name,'Example GT3');assert.equal(first.lapPage.nextOffset,100);
 const last=I.review(store,{...input,offset:200}).item.bundle.race.participants[0];assert.equal(last.laps.length,1);assert.equal(last.lapPage.nextOffset,null);
 for(const change of [{participantId:'unknown'},{offset:-1},{offset:202}])assert.throws(()=>I.review(store,{...input,...change}));
 assert.throws(()=>I.review(store,{...input,action:'approve'}),e=>e.apiCode==='UNSUPPORTED_COVERAGE');assert.equal(store.data.timing.sessions.length,0);assert.equal(store.data.timing.imports[0].status,'pending');
});

test('consistency remains accurate for nearly equal long laps and incomplete evidence',t=>{
 const {store,op,call}=setup(t),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))).items[0].bundle,p=b.race.participants[0];
 p.laps=p.laps.slice(0,2);p.laps[0].durationMs=80000000;p.laps[1].durationMs=80000000.1;R.receiveQualified(store,{...op,bundle:b});
 const s=call({operation:'car',carId:'car-a'});assert.ok(Math.abs(s.consistency.standardDeviationMs-0.05)<1e-8);assert.equal(s.consistency.sampleLaps,2);assert.equal(s.statistics.distanceComplete,false);
});

test('a removed car is identified explicitly and virtual participants never receive physical totals',t=>{
 const {store,op,call}=setup(t),saved=R.receiveQualified(store,op),edit=structuredClone(op);edit.operationId='remove-car';edit.action='replace';edit.expected=saved.accepted;
 const p=edit.bundle.race.participants[0];p.kind='virtual';p.carId=null;p.configuration=null;for(const l of p.laps){l.countsForDistance=false;l.personalRecordEligible=false;l.trackRecordEligible=false;}R.receiveQualified(store,edit);
 const car=call({operation:'car',carId:'car-a'});assert.equal(car.statistics.distanceM,0);assert.equal(car.records.rows.length,0);assert.equal(car.entries[0].participants.length,0);
 const h=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,carId:'car-a',participantId:p.id});assert.equal(h.requestedCarAbsent,true);assert.equal(h.statistics,null);assert.equal(h.consistency,null);
});

test('ten thousand laps remain in SQLite while the desktop receives bounded projections',t=>{
 const {store,op,call}=setup(t),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'))).items[0].bundle,p=b.race.participants[0];
 p.laps=Array.from({length:10000},(_,i)=>({...p.laps[0],id:'bulk-'+i,number:i+1}));R.receiveQualified(store,{...op,bundle:b});
 store.snapshot=()=>{throw Error('Whole model requested');};store.ensureLoaded=()=>{throw Error('Whole model requested');};
 const summary=call({operation:'car',carId:'car-a'}),head=call({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,carId:'car-a'});
 assert.equal(summary.statistics.validLaps,10000);assert.equal(summary.consistency.sampleLaps,10000);assert.ok(Buffer.byteLength(JSON.stringify(summary))<20000);assert.ok(Buffer.byteLength(JSON.stringify(head))<20000);
 const last=call({operation:'laps',sourceId:op.sourceId,sessionId:op.sessionId,participantId:p.id,resultToken:head.resultToken,offset:9750});assert.equal(last.laps.length,250);assert.equal(last.nextOffset,null);assert.equal(last.laps[249].id,'bulk-9999');assert.ok(Buffer.byteLength(JSON.stringify(last))<200000);
});
