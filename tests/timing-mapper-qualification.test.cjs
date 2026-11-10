'use strict';
require('./support/history-closed-preload.cjs');
// Frozen production evidence runs in every Paddock suite. Set SLOTFORGE_TIMING_SOURCE
// to additionally execute the current Timing mapper, without writing its checkout.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Store}=require('../src/store.cjs'),R=require('../src/rich-history.cjs'),H=require('../src/shared-history.cjs'),I=require('../src/history-imports.cjs'),T=require('../src/timing-integration.cjs'),V=require('../src/history-view.cjs'),M=require('../renderer/history-view-model.js');
const root=path.join(__dirname,'fixtures/timing-production-mapper'),manifest=require('./fixtures/timing-production-mapper/manifest.json');
const fixture=name=>JSON.parse(fs.readFileSync(path.join(root,name+'.json')));
const read=(store,route)=>require('../src/shared-history-read.cjs').read(store,'http://localhost/v1/shared-history/'+route);
const stats=store=>read(store,'cars/car-a/statistics');
const rejected=(fn,code)=>assert.throws(fn,e=>e.apiCode===code);
const Ajv=require('ajv/dist/2020'),ajv=new Ajv({strict:false,allErrors:true}),schema=require('./fixtures/contracts/shared-racing-history-v1/implemented/schema.json');
ajv.addFormat('date-time',s=>Number.isFinite(Date.parse(s)));ajv.addSchema(schema);
const validators=Object.fromEntries(['head','laps','list','statistics','receipt'].map(name=>[name,ajv.compile({$ref:schema.$id+'#/$defs/'+name})]));
function conforms(name,value){assert.ok(validators[name](value),name+': '+JSON.stringify(validators[name].errors));}
function setup(t,name='race'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-mapper-qualification-')),file=path.join(dir,'db.sqlite'),seed=require('./support/timing-fixtures.cjs').fixtures();
 new Store(file,{deferred:true}).replace(seed.store.snapshot());let store=new Store(file,{deferred:true});
 t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('sf-mapper-qualification-'));fs.rmSync(dir,{recursive:true,force:true});});
 const f=fixture(name),op={version:1,databaseId:'paddock-demo',recoveryId:H.status(store).recoveryId,operationId:'mapper-create',editor:{installationId:'timing-mapper',application:'SlotForge Timing',name:'Qualification'},sourceId:'timing-mapper',sessionId:f.evidence.session.id,action:'create',expected:null,reason:'Synthetic production evidence',bundle:f.bundle};
 return {store,file,seed,f,op,view:input=>V.read(store,{databaseId:op.databaseId,recoveryId:H.status(store).recoveryId,...input})};
}
function compare(view,op){const p=op.bundle.race.participants[0],s={carId:p.carId,sourceId:op.sourceId,sessionId:op.sessionId,participantId:p.id},list=view({operation:'pace-cars'});return view({operation:'pace-compare',snapshot:list.snapshot,left:s,right:s});}

test('production evidence copies retain their exact bytes and declared provenance',()=>{
 assert.equal(manifest.files.length,7);
 for(const f of manifest.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f.file))).digest('hex'),f.sha256);
});

for(const name of ['race','qualifying','endurance','classes','heats-finals','penalties']){
 test(name+': production evidence survives storage, reads, history views and Compare pace',t=>{
  const {store,file,op,view}=setup(t,name),original=structuredClone(op),cars=structuredClone(store.data.cars),saved=R.receiveQualified(store,op);
  assert.deepEqual(op,original);assert.equal(saved.accepted.contentHash,T.digest(op.bundle));assert.deepEqual(store.data.cars,cars);
  const reopened=new Store(file,{deferred:true});assert.equal(R.receiveQualified(reopened,op).duplicate,true);assert.equal(reopened.data.timing.audit.length,1);
  conforms('receipt',saved);conforms('head',read(store,'sessions/'+op.sourceId+'/'+op.sessionId));conforms('list',read(store,'sessions'));conforms('statistics',stats(store));
  const head=view({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,carId:'car-a'}),full=structuredClone(head.body);
  for(const p of full.race.participants){const page=read(store,'sessions/'+op.sourceId+'/'+op.sessionId+'/laps/'+p.id+'?token='+head.resultToken);conforms('laps',page);p.laps=page.laps;assert.equal(page.nextOffset,null);}
  assert.deepEqual(full,op.bundle);assert.deepEqual(M.normalize(head).context,op.bundle.context);
  const p=op.bundle.race.participants[0],n=name==='heats-finals'?6:2,s=stats(store),pace=compare(view,op).left;
  assert.equal(s.measuredLaps,n);assert.equal(s.validLaps,n);assert.equal(s.distanceM,n*20);assert.equal(s.averageLapMs,10500);
  assert.equal(s.overallWins,['qualifying','penalties'].includes(name)?0:1);assert.equal(s.classWins,name==='classes'?1:0);
  assert.equal(s.bestPersonalLapMs,10000);assert.equal(s.bestTrackLapMs,name==='penalties'?11000:10000);
  assert.equal(pace.metrics.validLaps,n);assert.equal(pace.metrics.averageMs,10500);assert.equal(pace.metrics.medianMs,10500);assert.equal(pace.metrics.standardDeviationMs,500);
  assert.equal(pace.metrics.sustained5Ms,null,'Heat boundaries cannot become a sustained run');assert.deepEqual(pace.configuration,p.configuration);
  assert.equal(head.records,undefined);assert.ok(view({operation:'car',carId:'car-a'}).records.rows.every(r=>r.durationMs===s.bestTrackLapMs));
  for(const l of p.laps){const row=M.lap(l,p,full.race,true);assert.equal(row[4],M.seconds(l.durationMs));assert.equal(row[8],l.personalRecordEligible?'Eligible':'Excluded');assert.equal(row[9],l.trackRecordEligible?'Eligible':'Excluded');}
  if(name==='endurance'){
   assert.equal(p.drivers.length,2);assert.equal(full.context.teams[0].name,'Endurance team');
   for(const d of p.drivers){const filtered=view({operation:'session',sourceId:op.sourceId,sessionId:op.sessionId,participantId:p.id,driverId:d.id});assert.equal(filtered.statistics.distanceM,20);assert.equal(filtered.statistics.validLaps,1);assert.equal(filtered.statistics.overallWins,0);}
  }
  if(name==='heats-finals'){assert.deepEqual(full.context.classification.map(a=>a.scope),['overall','heat','heat','final']);assert.deepEqual(full.context.classification[0].countedHeatIds,[full.race.heats[1].id]);assert.deepEqual(full.context.classification[0].droppedHeatIds,[full.race.heats[0].id]);}
  if(name==='penalties'){assert.equal(full.context.classification[0].laps,1);assert.equal(full.context.classification[0].elapsedMs,23000);assert.deepEqual(full.context.classification[0].effects.map(e=>e.amount),[2000,-1,-3]);}
 });

 test(name+': lost replies, conflicting corrections, withdrawal and restore preserve identity',async t=>{
  const {store,file,op,view}=setup(t,name),first=R.receiveQualified(store,op),backup=structuredClone(store.data),old=read(store,'sessions/'+op.sourceId+'/'+op.sessionId),selection=compare(view,op);
  const correction={...structuredClone(op),operationId:'mapper-correct',action:'replace',expected:first.accepted};
  correction.bundle.context.classification.forEach(a=>{a.position=null;a.status='disqualified';});
  const second=R.receiveQualified(store,correction);assert.equal(second.accepted.revision,2);assert.equal(stats(store).overallWins,0);assert.equal(stats(store).classWins,0);assert.equal(stats(store).distanceM,name==='heats-finals'?120:40);
  assert.equal(R.receiveQualified(new Store(file,{deferred:true}),correction).duplicate,true);
  rejected(()=>R.receiveQualified(store,{...correction,reason:'Changed bytes'}),'OPERATION_CONFLICT');
  rejected(()=>R.receiveQualified(store,{...correction,operationId:'competing-correction'}),'REVISION_CONFLICT');
  rejected(()=>read(store,'sessions/'+op.sourceId+'/'+op.sessionId+'/laps/'+op.bundle.race.participants[0].id+'?token='+old.resultToken),'RESULT_CHANGED');
  rejected(()=>view({operation:'pace-cars',snapshot:selection.snapshot}),'SNAPSHOT_CHANGED');
  const withdrawal={...correction,operationId:'mapper-withdraw',action:'withdraw',expected:second.accepted,withdrawalReason:'Reviewed withdrawal'};delete withdrawal.bundle;
  const third=R.receiveQualified(store,withdrawal);assert.equal(third.accepted.revision,3);assert.equal(stats(store).distanceM,0);assert.equal(stats(store).validLaps,0);assert.equal(view({operation:'car',carId:'car-a'}).records.rows.length,0);
  assert.equal(R.receiveQualified(new Store(file,{deferred:true}),op).duplicate,true,'An old acknowledgement never restores withdrawn results');assert.equal(stats(store).distanceM,0);
  assert.equal(H.lookup(store,op.editor.installationId,op.operationId,op.recoveryId).current.state,'withdrawn');
  await store.restoreAsync(backup,store.data.revision);rejected(()=>R.receiveQualified(store,withdrawal),'RECOVERY_CHANGED');rejected(()=>R.receiveQualified(store,op),'RECOVERY_CHANGED');
  assert.equal(new Store(file,{deferred:true}).data.timing.audit.length,1);
 });
}

test('unlinked historical production evidence stays pending, unknown and out of car totals',t=>{
 const {store,op,f,view}=setup(t,'historical-unknowns'),batch={version:1,databaseId:op.databaseId,recoveryId:op.recoveryId,operationId:'historical-mapper',editor:op.editor,items:[{itemId:'original',sourceId:op.sourceId,sessionId:op.sessionId,originHash:T.digest(f.evidence),bundle:op.bundle}]};
 const received=I.receive(store,batch);assert.equal(received.items[0].status,'pending');assert.equal(I.receive(new Store(store.file,{deferred:true}),batch).items[0].status,'pending');
 const row=store.data.timing.imports[0],request={databaseId:op.databaseId,recoveryId:op.recoveryId,id:row.id,requestHash:row.requestHash,action:'inspect',note:''};
 const inspected=I.review(store,request);assert.equal(inspected.item.bundle.race.startedAt,null);assert.equal(inspected.item.bundle.race.participants[0].configuration,null);assert.equal(stats(store).acceptedSessions,0);
 rejected(()=>I.review(store,{...request,action:'approve'}),'UNSUPPORTED_COVERAGE');
 // Internal test-only approval preserves all unknowns. No public gate is opened.
 R.approveQualified(store,{...request,action:'approve'});assert.equal(stats(store).acceptedSessions,0);assert.equal(view({operation:'pace-cars'}).total,0);
 const head=read(store,'sessions/'+op.sourceId+'/'+op.sessionId),p=head.body.race.participants[0],laps=read(store,'sessions/'+op.sourceId+'/'+op.sessionId+'/laps/'+p.id+'?token='+head.resultToken).laps;
 assert.deepEqual(laps,op.bundle.race.participants[0].laps);assert.equal(head.body.race.startedAt,null);assert.equal(p.carId,null);
 assert.equal(M.lap(laps[0],p,head.body.race,true)[5],'Unknown');assert.equal(M.lap(laps[0],p,head.body.race,true)[10],'Unknown');
 const cancelled=I.cancel(store,op.editor.installationId,batch.operationId,{version:1,databaseId:op.databaseId,recoveryId:op.recoveryId,operationId:batch.operationId,itemIds:['original']});assert.equal(cancelled.items[0].status,'approved');
});

test('production configurations remain historical after car edits, and archived or missing owners are explicit',t=>{
 const {store,op,view}=setup(t);const car=store.data.cars.find(c=>c.id==='car-a');
 store.mutate('car.save',{id:car.id,revision:car.revision,data:{...car,name:'Renamed now',technical:{...car.technical,motor:'New motor'}}},{snapshot:false});
 const updated=store.data.cars.find(c=>c.id===car.id);store.mutate('car.archive',{id:car.id,revision:updated.revision,value:true},{snapshot:false});
 R.receiveQualified(store,op);assert.deepEqual(compare(view,op).left.configuration,op.bundle.race.participants[0].configuration);assert.equal(compare(view,op).left.car.name,'Renamed now');assert.equal(compare(view,op).left.car.archived,1);
 const bad=structuredClone(op);bad.operationId='missing';bad.sessionId='missing';bad.bundle.race.participants[0].carId='absent';bad.bundle.race.participants[0].configuration=null;bad.bundle.provenance.kind='historical';for(const l of bad.bundle.race.participants[0].laps){l.personalRecordEligible=false;l.trackRecordEligible=false;}
 rejected(()=>R.receiveQualified(store,bad),'CAR_NOT_FOUND');assert.equal(store.data.timing.sessions.length,1);
});

test('rich production fixtures cannot escape public gates or corrupt existing Timing/Telemetry reads',t=>{
 const {store,op,seed}=setup(t);assert.deepEqual(H.capability.formats,['timing-v1']);assert.equal(H.capability.features.historicalImports,false);
 rejected(()=>H.receive(store,op),'INVALID_PAYLOAD');assert.equal(store.data.timing.sessions.length,0);
 T.receive(store,seed.normal);R.receiveQualified(store,op);
 const legacy=read(store,'sessions/'+seed.normal.source.id+'/'+seed.normal.sessionId);assert.equal(legacy.body.format,'timing-v1');assert.equal(stats(store).distanceM,100);
 const manifest=require('../src/telemetry-export.cjs').handleStore(store,'GET',new URL('http://localhost/v1/telemetry/results'),{timingResults:true},op.databaseId);assert.equal(manifest.entries.length,1);assert.equal(manifest.entries[0].sessionId,seed.normal.sessionId);
 rejected(()=>require('../src/sqlite-query.cjs').read(store,null,r=>require('../src/query-timing.cjs').receipt(r,op.sourceId,op.sessionId)),'RESULT_REQUIRES_SHARED_HISTORY');
 const cross={...op,operationId:'cross-format',action:'replace',sourceId:seed.normal.source.id,sessionId:seed.normal.sessionId,expected:legacy.accepted};rejected(()=>R.receiveQualified(store,cross),'UNSUPPORTED_COVERAGE');
});

if(process.env.SLOTFORGE_TIMING_SOURCE)test('current Timing production mapper reproduces pinned fixtures and corrections',t=>{
 const timing=path.resolve(process.env.SLOTFORGE_TIMING_SOURCE),generator=require(path.join(timing,'tools/qa/rich-mapper-fixtures.cjs')),mapper=require(path.join(timing,'paddock-rich-mapper.js'));
 for(const f of generator.generated())assert.deepEqual(f,fixture(f.name),'Production fixture drift: '+f.name);
 for(const name of ['race','qualifying','endurance','classes','heats-finals','penalties']){
  const {store,op,f}=setup(t,name),e=structuredClone(f.evidence),saved=R.receiveQualified(store,op);e.session.standings[0].dq=true;
  const mapped=mapper.measured(e.session,e.laps,op.databaseId);assert.equal(mapped.sourceSessionId,op.sessionId);assert.deepEqual(mapped.bundle.race,op.bundle.race);
  const next={...op,operationId:'actual-mapper-correction',action:'replace',expected:saved.accepted,bundle:mapped.bundle};R.receiveQualified(store,next);assert.equal(stats(store).overallWins,0);assert.equal(R.receiveQualified(store,next).duplicate,true);
 }
});

test('historical provenance cannot acquire record eligibility through internal corrections',t=>{
 const {store,op}=setup(t),bad=structuredClone(op);bad.bundle.provenance.kind='historical';
 rejected(()=>R.receiveQualified(store,bad),'INVALID_PAYLOAD');assert.equal(store.data.timing.sessions.length,0);
 for(const p of bad.bundle.race.participants)for(const l of p.laps){l.personalRecordEligible=false;l.trackRecordEligible=false;}
 const accepted=R.receiveQualified(store,bad),correction={...structuredClone(bad),operationId:'invent-record',action:'replace',expected:accepted.accepted};
 correction.bundle.race.participants[0].laps[0].trackRecordEligible=true;
 rejected(()=>R.receiveQualified(store,correction),'INVALID_PAYLOAD');assert.equal(stats(store).trackRecordLaps,0);
});

test('classification presentation keeps awarded points separate from scoring and exposes uncertainty',()=>{
 const f=fixture('heats-finals'),before=structuredClone(f.bundle),table=M.classification(f.bundle.race,f.bundle.context);
 const cell=(i,h)=>table.rows[i][table.headers.indexOf(h)];
 assert.equal(cell(0,'Points'),30);assert.equal(cell(0,'Score'),'20 points');assert.equal(cell(1,'Points'),10);assert.equal(cell(1,'Score'),'Unknown');
 assert.match(cell(0,'Counted / dropped heats'),/Heat 1 \[2\].*Heat 1 \[1\]/);assert.equal(table.rows.length,4);assert.deepEqual(f.bundle,before);
 const awards=f.bundle.context.classification;awards[0].gap={value:1250,unit:'ms'};awards[0].incomplete=true;awards[0].estimated=false;awards[1].points=0;
 const current=M.classification(f.bundle.race,f.bundle.context);assert.equal(current.rows[0][current.headers.indexOf('Gap')],'1.250 s');assert.match(current.rows[0].at(-2),/Incomplete: Yes.*Estimated: No/);assert.equal(current.rows[1][current.headers.indexOf('Points')],0);
 const penalty=fixture('penalties'),rendered=M.classification(penalty.bundle.race,penalty.bundle.context);assert.match(rendered.rows[0].at(-1),/2.000 s/);assert.match(rendered.rows[0].at(-1),/-1 laps/);assert.match(rendered.rows[0].at(-1),/-3 points/);
});

test('malformed production variants fail atomically without changing accepted laps or receipts',t=>{
 const {store,op}=setup(t),saved=R.receiveQualified(store,op),before=structuredClone(store.data),cursor=H.status(store).cursor;
 const edits=[b=>b.context.scoringSnapshot={formula:'invented'},b=>b.race.participants[0].configuration.technical.motor='tampered',b=>b.race.participants[0].laps[0].lane=0,b=>b.race.participants[0].laps[0].pit=true,b=>b.race.participants[0].laps[0].driverId='missing',b=>b.race.participants[0].laps[0].durationMs=Infinity,b=>b.context.classification.push(structuredClone(b.context.classification[0])),b=>b.context.classification[0].countedHeatIds=['missing'],b=>b.context.classification[0].effects[0]={kind:'time',amount:1000,reason:'x'.repeat(2001)}];
 for(const [i,edit] of edits.entries()){const bad={...structuredClone(op),operationId:'invalid-'+i,action:'replace',expected:saved.accepted};edit(bad.bundle);assert.throws(()=>R.receiveQualified(store,bad));assert.deepEqual(store.data,before);assert.equal(H.status(store).cursor,cursor);}
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(store.file);db.exec("CREATE TRIGGER reject_mapper BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'qualification rollback'); END");db.close();
 const change={...structuredClone(op),operationId:'atomic-correction',action:'replace',expected:saved.accepted};change.bundle.race.participants[0].laps.splice(0,1);
 assert.throws(()=>R.receiveQualified(store,change));assert.deepEqual(store.data,before);assert.equal(H.status(store).cursor,cursor);assert.equal(stats(store).distanceM,40);
 const clean=new DatabaseSync(store.file);clean.exec('DROP TRIGGER reject_mapper');clean.close();R.receiveQualified(store,change);assert.equal(stats(store).distanceM,20);
});
