'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history.cjs'),R=require('../src/rich-history.cjs'),I=require('../src/history-imports.cjs'),Q=require('../src/sqlite-query.cjs');
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/'+name+'.json')));
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-rich-history-')),file=path.join(root,'db.sqlite'),data=require('./support/timing-fixtures.cjs').fixtures(),seed=new Store(file,{deferred:true});seed.replace(data.store.snapshot());const store=new Store(file,{deferred:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const op=fixture('classes-and-eligibility');op.recoveryId=H.status(store).recoveryId;op.bundle.context.scoringSnapshot=null;return {store,file,data,op};}
const read=(s,route)=>require('../src/shared-history-read.cjs').read(s,'http://localhost/v1/shared-history/'+route);
const stats=s=>read(s,'cars/car-a/statistics');
const expect=(fn,code)=>assert.throws(fn,e=>e.apiCode===code,e=>e.message);

test('qualified handoff schemas and examples match real rich reads and statistics',t=>{
 const {store}=setup(t),root=path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/qualified'),get=name=>JSON.parse(fs.readFileSync(path.join(root,name+'.json')));
 const Ajv=require('ajv/dist/2020'),ajv=new Ajv({strict:false,allErrors:true}),schema=get('schema');ajv.addFormat('date-time',s=>Number.isFinite(Date.parse(s)));ajv.addSchema(schema);
 for(const entry of get('manifest').fixtures){const v=ajv.compile({$ref:schema.$id+'#/$defs/'+entry.definition});assert.ok(v(get(entry.file.replace('.json',''))),JSON.stringify(v.errors));}
 const op=get('create');op.recoveryId=H.status(store).recoveryId;R.receiveQualified(store,op);
 const head=read(store,'sessions/'+op.sourceId+'/'+op.sessionId);assert.deepEqual(head.body,get('head').body);assert.deepEqual(head.accepted,get('head').accepted);
 const laps=read(store,'sessions/'+op.sourceId+'/'+op.sessionId+'/laps/entry-1?token='+head.resultToken);assert.deepEqual(laps.laps,get('laps').laps);
 const expected=get('statistics'),actual=stats(store);for(const k of ['recoveryId','snapshot','cursor'])delete actual[k],delete expected[k];assert.deepEqual(actual,expected);
});

test('legacy performance models and renderer guard richer records without inventing statistics',t=>{
 const {store,op}=setup(t);R.receiveQualified(store,op);const records=store.data.timing.sessions;
 const model=require('../renderer/timing-results-model.js'),pace=require('../renderer/pace-model.js');assert.deepEqual(model.aggregate(records,'car-a'),model.aggregateStatistics([]));assert.deepEqual(pace.runs({timing:{sessions:records},tests:[]},'car-a'),[]);
 const vm=require('node:vm'),context={db:{timing:{sessions:records}},TimingResultsModel:model,badge:x=>x,panel:(name,body)=>name+body,esc:x=>x};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/timing-results.js'),'utf8'),context);
 const html=vm.runInContext("renderTimingResults({id:'car-a'})",context);assert.match(html,/expanded history is preserved/);assert.match(html,/excluded from the legacy totals/);
});
test('qualified rich history persists losslessly in the existing store, with exact paged reads and independent records',t=>{
 const {store,file,op}=setup(t),before=JSON.parse(JSON.stringify(store.data)),saved=R.receiveQualified(store,op);
 assert.equal(saved.accepted.contentHash,T.digest(op.bundle));assert.equal(store.data.timing.sessions.length,1);assert.deepEqual(store.data.timing.sessions[0].bundle,op.bundle);
 assert.deepEqual(store.data.cars,before.cars);assert.deepEqual(store.data.installations,before.installations);
 const list=read(store,'sessions'),head=read(store,'sessions/'+op.sourceId+'/'+op.sessionId);assert.equal(list.entries[0].format,'history-v1');assert.equal(head.body.race.participants[0].laps,undefined);
 for(const p of op.bundle.race.participants){const page=read(store,'sessions/'+op.sourceId+'/'+op.sessionId+'/laps/'+p.id+'?token='+head.resultToken);assert.deepEqual(page.laps,p.laps);assert.equal(page.format,'history-v1');}
 const s=stats(store);assert.equal(s.acceptedSessions,1);assert.equal(s.overallWins,1);assert.equal(s.classWins,1);assert.equal(s.personalRecordLaps,3);assert.equal(s.trackRecordLaps,2);assert.equal(s.validLaps,3);assert.equal(s.distanceM,80);
 const reopened=new Store(file,{deferred:true});assert.deepEqual(reopened.data.timing.sessions[0].bundle,op.bundle);assert.deepEqual(R.receiveQualified(reopened,op).accepted,saved.accepted);assert.equal(reopened.data.timing.audit.length,1);
 assert.equal(H.capability.formats.includes('history-v1'),false);expect(()=>H.receive(reopened,op),'INVALID_PAYLOAD');
});
test('correction, withdrawal, reactivation and restore keep atomic contributions and original receipts',async t=>{
 const {store,file,op}=setup(t),initial=R.receiveQualified(store,op),backup=JSON.parse(JSON.stringify(store.data)),head=read(store,'sessions/'+op.sourceId+'/'+op.sessionId);
 const edit={...structuredClone(op),operationId:'correction',action:'replace',expected:initial.accepted};edit.bundle.race.participants[0].laps.splice(0,1);edit.bundle.context.classification=edit.bundle.context.classification.filter(a=>a.participantId!=='entry-1');
 const corrected=R.receiveQualified(store,edit);assert.equal(stats(store).distanceM,60);assert.equal(stats(store).overallWins,0);assert.equal(stats(store).classWins,0);
 expect(()=>R.receiveQualified(store,{...edit,operationId:'competing'}),'REVISION_CONFLICT');expect(()=>read(store,'sessions/'+op.sourceId+'/'+op.sessionId+'/laps/entry-1?token='+head.resultToken),'RESULT_CHANGED');
 const withdrawal={...edit,operationId:'withdraw',action:'withdraw',expected:corrected.accepted,withdrawalReason:'Withdrawn'};delete withdrawal.bundle;
 const withdrawn=R.receiveQualified(store,withdrawal);assert.equal(stats(store).distanceM,0);assert.equal(read(store,'sessions').entries[0].accepted.state,'withdrawn');assert.equal(read(store,'sessions/'+op.sourceId+'/'+op.sessionId).body,null);
 assert.deepEqual(R.receiveQualified(store,op).accepted,initial.accepted);assert.deepEqual(H.lookup(store,op.editor.installationId,op.operationId,op.recoveryId).current,withdrawn.accepted);
 const reactivated=R.receiveQualified(store,{...op,operationId:'restore-session',action:'replace',expected:withdrawn.accepted,reason:'Deliberately restore'});assert.equal(reactivated.accepted.revision,4);assert.equal(stats(store).distanceM,80);assert.equal(store.data.timing.audit.length,4);
 await store.restoreAsync(backup,store.data.revision);expect(()=>R.receiveQualified(store,op),'RECOVERY_CHANGED');assert.equal(new Store(file,{deferred:true}).data.timing.audit.length,1);
});
test('historical approval commits evidence decision, session, audit, receipt and feed together',t=>{
 const {store,file,op}=setup(t),batch=fixture('historical-import');batch.recoveryId=op.recoveryId;I.receive(store,batch);
 const row=store.data.timing.imports[0],request={databaseId:store.data.id,recoveryId:op.recoveryId,id:row.id,requestHash:row.requestHash,action:'approve',note:'Original evidence checked'};
 expect(()=>I.review(store,request),'UNSUPPORTED_COVERAGE');assert.equal(stats(store).distanceM,0);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file);db.exec("CREATE TRIGGER fail_rich BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'injected'); END");db.close();
 const before=JSON.parse(JSON.stringify(store.data)),cursor=H.status(store).cursor;assert.throws(()=>R.approveQualified(store,request));assert.deepEqual(JSON.parse(JSON.stringify(store.data)),before);assert.equal(H.status(store).cursor,cursor);
 const clean=new DatabaseSync(file);clean.exec('DROP TRIGGER fail_rich');clean.close();const approved=R.approveQualified(store,request);
 assert.equal(store.data.timing.imports[0].status,'approved');assert.deepEqual(store.data.timing.imports[0].accepted,approved.accepted);assert.equal(store.data.timing.audit.length,1);assert.equal(stats(store).historicalSessions,1);assert.equal(stats(store).personalRecordLaps,0);assert.equal(stats(store).distanceComplete,false);
 assert.equal(R.approveQualified(new Store(file,{deferred:true}),request).duplicate,true);expect(()=>R.approveQualified(store,{...request,note:'Different'}),'OPERATION_CONFLICT');
 const cancelled=I.cancel(store,batch.editor.installationId,batch.operationId,{version:1,databaseId:store.data.id,recoveryId:op.recoveryId,operationId:batch.operationId,itemIds:[row.itemId]});assert.equal(cancelled.items[0].status,'approved');
 assert.equal(new Store(file,{deferred:true}).data.timing.sessions.length,1);
});
test('old interfaces cannot overwrite rich identities or serve malformed v1 payloads',t=>{
 const {store,op,data}=setup(t);R.receiveQualified(store,op);
 expect(()=>T.receive(store,{...data.normal,sessionId:op.sessionId}),'RESULT_REQUIRES_SHARED_HISTORY');
 expect(()=>Q.read(store,null,r=>require('../src/query-timing.cjs').receipt(r,op.sourceId,op.sessionId)),'RESULT_REQUIRES_SHARED_HISTORY');
 expect(()=>require('../src/scalable-api.cjs').handle(store,'GET',new URL('http://localhost/v1/scalable/results/'+op.sourceId+'/'+op.sessionId),{timingResults:true},store.data.id),'RESULT_REQUIRES_SHARED_HISTORY');
 const legacy={version:1,databaseId:store.data.id,recoveryId:op.recoveryId,operationId:'legacy',editor:op.editor,sourceId:op.sourceId,sessionId:data.normal.sessionId,reason:'Reviewed',action:'create',expected:null,bundle:{format:'timing-v1',payload:data.normal}};H.receive(store,legacy);
 assert.equal(read(store,'sessions').entries.length,2);assert.equal(stats(store).acceptedSessions,2);assert.equal(stats(store).distanceM,140);
 const telemetry=require('../src/telemetry-export.cjs').handleStore(store,'GET',new URL('http://localhost/v1/telemetry/results'),{timingResults:true},store.data.id);assert.equal(telemetry.entries.length,1);assert.equal(telemetry.entries[0].sessionId,data.normal.sessionId);
});
test('semantic and configuration checks reject contradictory evidence without changing the database',t=>{
 const {store,op}=setup(t);const before=JSON.parse(JSON.stringify(store.data));
 for(const mutate of [x=>x.bundle.race.participants[0].laps[0].pit=true,x=>x.bundle.race.participants[0].laps[0].driverId='missing',x=>x.bundle.race.participants[0].laps[0].durationMs=999999,x=>x.bundle.context.classification.push(x.bundle.context.classification[0]),x=>x.bundle.race.participants[0].configuration=null,x=>x.bundle.context.scoringSnapshot={script:'bad'},x=>x.bundle.race.participants[0].laps[1].endedAtMs=15000]){const bad=structuredClone(op);mutate(bad);assert.throws(()=>R.receiveQualified(store,bad));assert.deepEqual(JSON.parse(JSON.stringify(store.data)),before);}
 const bad=structuredClone(op);bad.bundle.race.participants[0].configuration.technical.motor='modified';expect(()=>R.receiveQualified(store,bad),'CONFIGURATION_INVALID');
 const missing=structuredClone(op);missing.bundle.race.participants[0].carId='missing';missing.bundle.race.participants[0].configuration=null;missing.bundle.provenance.kind='historical';for(const p of missing.bundle.race.participants)for(const l of p.laps){l.personalRecordEligible=false;l.trackRecordEligible=false;}expect(()=>R.receiveQualified(store,missing),'CAR_NOT_FOUND');
});
test('unknown historical timing stays unknown and lane/driver filters never invent a match',t=>{
 const {store,op}=setup(t),b=fixture('historical-import').items[0].bundle;b.race.participants[0].laps[0].durationMs=null;b.race.participants[0].laps[1].valid=null;b.race.participants[0].laps[2].lane=null;b.context.classification=[];
 const input={...op,sessionId:'unknowns',operationId:'unknowns',bundle:b};R.receiveQualified(store,input);
 const s=stats(store);assert.equal(s.historicalSessions,1);assert.equal(s.measuredLaps,2);assert.equal(s.validLaps,0);assert.equal(s.averageLapMs,null);assert.equal(s.bestPersonalLapMs,null);assert.equal(s.distanceM,0);assert.equal(s.unknownDistanceLaps,3);assert.equal(s.distanceComplete,false);
 const lane=read(store,'cars/car-a/statistics?lane=1');assert.equal(lane.unknownDistanceLaps,2);assert.equal(lane.overallWins,0);
 assert.equal(read(store,'cars/car-a/statistics?from=2026-01-01T00:00:00.000Z').historicalSessions,0);
 const w={...input,action:'withdraw',operationId:'unknown-withdraw',expected:tupleOf(store),withdrawalReason:'Withdraw evidence'};delete w.bundle;R.receiveQualified(store,w);assert.equal(read(store,'sessions').entries[0].provenance,'historical');
});
function tupleOf(store){const r=store.data.timing.sessions.at(-1);return {revision:r.payload.revision,contentHash:r.contentHash,state:r.payload.state};}
test('large lap pages are exact, old tokens fail after restore, and archived cars retain original history',async t=>{
 const {store,file,op}=setup(t),b=fixture('historical-import').items[0].bundle,p=b.race.participants[0];p.laps=Array.from({length:501},(_,i)=>({...p.laps[0],id:'lap-'+i,number:i+1}));
 const input={...op,bundle:b},beforeCars=JSON.parse(JSON.stringify(store.data.cars));store.mutate('car.archive',{id:'car-a',revision:store.data.cars[0].revision,value:true},{snapshot:false});R.receiveQualified(store,input);
 const head=read(store,'sessions/'+input.sourceId+'/'+input.sessionId),pages=[];let offset=0;do{const value=read(store,'sessions/'+input.sourceId+'/'+input.sessionId+'/laps/entry-1?token='+head.resultToken+'&offset='+offset);assert.ok(value.laps.length<=250);pages.push(...value.laps);offset=value.nextOffset;}while(offset!==null);assert.deepEqual(pages,p.laps);
 assert.equal(stats(store).measuredLaps,501);assert.equal(store.data.cars[0].name,beforeCars[0].name);
 const full=new Store(file).snapshot();assert.deepEqual(full.timing.sessions[0].bundle,b);await store.restoreAsync(full,store.data.revision);expect(()=>read(store,'sessions/'+input.sourceId+'/'+input.sessionId+'/laps/entry-1?token='+head.resultToken),'RESULT_CHANGED');
});
test('endurance driver statistics and class awards are independent of adjusted classification',t=>{
 const {store,op}=setup(t),b=op.bundle,p=b.race.participants[0];b.race.type='endurance';p.drivers.push({id:'driver-2',name:'Second driver'});p.stints[1].driverId='driver-2';p.laps.at(-1).driverId='driver-2';
 p.laps[1].personalRecordEligible=false;p.laps[1].trackRecordEligible=true;p.laps[0].personalRecordEligible=true;p.laps[0].trackRecordEligible=false;
 for(const award of b.context.classification)if(award.participantId===p.id){award.laps=999;award.elapsedMs=99999;award.effects=[{kind:'laps',amount:995,reason:'Awarded adjustment'}];}
 R.receiveQualified(store,op);const s=stats(store);assert.equal(s.distanceM,80);assert.equal(s.measuredLaps,4);assert.equal(s.overallWins,1);assert.equal(s.classWins,1);assert.equal(s.personalRecordLaps,2);assert.equal(s.trackRecordLaps,2);
 const first=read(store,'cars/car-a/statistics?sourceId='+op.sourceId+'&sessionId='+op.sessionId+'&participantId=entry-1&driverId=driver-1'),second=read(store,'cars/car-a/statistics?sourceId='+op.sourceId+'&sessionId='+op.sessionId+'&participantId=entry-1&driverId=driver-2');assert.equal(first.distanceM,60);assert.equal(second.distanceM,20);assert.equal(first.overallWins,0);assert.equal(second.classWins,0);
});
test('cancelled, stale and colliding historical approvals never add history',async t=>{
 const {store,op}=setup(t),b=fixture('historical-import');b.recoveryId=op.recoveryId;I.receive(store,b);const row=store.data.timing.imports[0],request={databaseId:store.data.id,recoveryId:op.recoveryId,id:row.id,requestHash:row.requestHash,action:'approve',note:''};
 const collision={...op,sourceId:row.sourceId,sessionId:row.sessionId};R.receiveQualified(store,collision);expect(()=>R.approveQualified(store,request),'REVISION_CONFLICT');assert.equal(store.data.timing.imports[0].status,'pending');
 I.cancel(store,b.editor.installationId,b.operationId,{version:1,databaseId:store.data.id,recoveryId:op.recoveryId,operationId:b.operationId,itemIds:[row.itemId]});expect(()=>R.approveQualified(store,request),'REVISION_CONFLICT');
 const copy=JSON.parse(JSON.stringify(store.data));await store.restoreAsync(copy,store.data.revision);expect(()=>R.approveQualified(store,{...request,recoveryId:H.status(store).recoveryId}),'RECOVERY_CHANGED');
});
