'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../src/car-merge-model.cjs'),A=require('../src/car-merge-archive.cjs'),S=require('../src/sqlite-storage.cjs'),Q=require('../src/sqlite-query.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history-read.cjs'),V=require('../src/history-view.cjs');
function setup(t,{include=true}={}){
 const f=require('./support/timing-fixtures.cjs').fixtures();T.receive(f.store,f.normal);T.receive(f.store,f.endurance);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-merge-query-')),file=path.join(root,'data.sqlite');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let db=f.store.data;M.init(db);let seq=0;
 function command(action,payload){const result=M.prepare(db,{databaseId:db.id,recoveryId:'test-recovery',sourceId:'reviewer',operationId:'op-'+ ++seq,action,payload},{recoveryId:'test-recovery',backup:{verified:true,path:'fixture',digest:'a'.repeat(64),databaseId:db.id,recoveryId:'test-recovery',dependencyToken:action==='approve'?M.token(db,'car-b','car-a'):undefined}});db=result.data;return result.result;}
 let p=command('create',{mainCarId:'car-b',retiredCarId:'car-a'});const choices=structuredClone(p.choices);choices.history[M.historyKey('timing-demo','session-endurance','entry-1')]=include;p=command('save',{id:p.id,expectedRevision:p.revision,choices});command('approve',{id:p.id,expectedRevision:p.revision});
 S.write(file,S.pack(db),null);
 const store=()=>({file,expectedIdentity:JSON.stringify([db.id,db.revision]),data:{id:db.id,revision:db.revision}});
 const state=()=>S.syncState(file);
 const read=input=>V.read(store(),{databaseId:db.id,recoveryId:state().epoch,...input});
 const change=fn=>{const before=db;db=require('../src/json-data.cjs').cloneJSON(db);fn(db);db.revision++;S.write(file,S.packChanges(before,db),JSON.stringify([before.id,before.revision]));};
 return {f,file,store,read,state,change,get db(){return db;}};
}
test('snapshot identity resolution reads small metadata without reconstructing archives or cars',t=>{
 const x=setup(t);const value=Q.read(x.store(),null,r=>r.merges.identity('car-a'));
 assert.equal(value.value.canonicalCarId,'car-b');assert.equal(value.value.mergeRevision,1);assert.ok(value.recordReads<=2);
 assert.throws(()=>Q.read(x.store(),null,r=>r.merges.identity('missing')),{code:'CAR_NOT_FOUND'});
});
test('selected history reaches main statistics, session cards and lane records without altering evidence',t=>{
 const x=setup(t,{include:false}),before=A.digest(x.db.timing.sessions),view=x.read({operation:'car',carId:'car-b'});
 assert.deepEqual(view.entries.map(v=>v.sessionId),['session-normal']);assert.equal(view.entries[0].participants[0].id,'entry-1');
 assert.equal(view.statistics.acceptedSessions,1);assert.equal(view.statistics.distanceM,60);assert.equal(view.statistics.validLaps,2);assert.equal(view.consistency.sampleLaps,2);assert.equal(view.records.rows.length,1);assert.equal(view.records.rows[0].durationMs,10000);
 const detail=x.read({operation:'session',carId:'car-b',sourceId:'timing-demo',sessionId:'session-normal'});
 assert.equal(detail.requestedCarAbsent,false);assert.equal(detail.linkedCars['car-a'].id,'car-b');assert.equal(detail.statistics.distanceM,60);
 assert.equal(detail.body.payload.participants[0].carId,'car-a');assert.deepEqual(detail.body.payload.participants[0].configuration,x.f.normal.participants[0].configuration);
 assert.equal(x.read({operation:'car',carId:'car-a'}).statistics.acceptedSessions,0);assert.equal(A.digest(S.read(x.file).timing.sessions),before);
});
test('late history remains absent until reviewed and rejection cannot be bypassed by a correction',t=>{
 const x=setup(t);x.change(db=>{const s=require('../src/json-data.cjs').cloneJSON(db.timing.sessions[0]);s.payload.sessionId='late';s.contentHash=T.digest(s.payload);db.timing.sessions.push(s);M.reconcileHistory(db);});
 assert.equal(x.read({operation:'car',carId:'car-b'}).statistics.acceptedSessions,2);
 const late=x.db.mergeInclusions.find(i=>i.key.includes('late'));assert.equal(late.status,'pending');
 x.change(db=>{db.mergeInclusions.find(i=>i.id===late.id).status='excluded';db.mergeMeta.revision++;});
 x.change(db=>{const s=db.timing.sessions.find(s=>s.payload.sessionId==='late');s.payload.revision++;s.contentHash=T.digest(s.payload);M.reconcileHistory(db);});
 assert.equal(x.read({operation:'car',carId:'car-b'}).statistics.acceptedSessions,2);
});
test('withdrawals remove statistics but retain selected session notices and unchanged source identities',t=>{
 const x=setup(t,{include:false});x.change(db=>{const record=db.timing.sessions.find(s=>s.payload.sessionId==='session-normal');record.lastName=record.payload.name;record.payload=structuredClone(x.f.withdrawal);record.contentHash=T.digest(record.payload);});
 const view=x.read({operation:'car',carId:'car-b'});assert.equal(view.statistics.acceptedSessions,0);assert.equal(view.records.rows.length,0);assert.equal(view.entries.length,1);assert.equal(view.entries[0].accepted.state,'withdrawn');
});
test('a reassigned contribution does not escape its original merge decision',t=>{
 const x=setup(t);x.change(db=>{const record=db.timing.sessions[0];record.payload.participants[0].carId='car-b';record.payload.revision++;record.contentHash=T.digest(record.payload);});
 const view=x.read({operation:'car',carId:'car-b'});assert.equal(view.statistics.acceptedSessions,1);
});
test('mapping generation invalidates old list snapshots while original session tokens remain unchanged',t=>{
 const x=setup(t),head=H.read(x.store(),'http://local/v1/shared-history/sessions/timing-demo/session-normal');
 x.change(db=>{db.mergeMeta.revision++;});
 const next=H.read(x.store(),'http://local/v1/shared-history/sessions/timing-demo/session-normal');assert.equal(head.resultToken,next.resultToken);
 assert.notEqual(x.state().after,0);
});
test('Compare pace resolves selected participants while retaining their raced configuration',t=>{
 const x=setup(t,{include:false}),P=require('../src/history-pace.cjs');
 const base={databaseId:x.db.id,recoveryId:x.state().epoch};
 const list=P.read(x.store(),{...base,operation:'pace-sessions',carId:'car-b'});
 assert.equal(list.total,1);assert.equal(list.rows[0].participantId,'entry-1');
 const side={carId:'car-b',sourceId:'timing-demo',sessionId:'session-normal',participantId:'entry-1'};
 const compared=P.read(x.store(),{...base,operation:'pace-compare',snapshot:list.snapshot,left:side,right:side});
 assert.equal(compared.left.metrics.validLaps,2);assert.deepEqual(compared.left.configuration,x.f.normal.participants[0].configuration);
 assert.throws(()=>P.read(x.store(),{...base,operation:'pace-compare',snapshot:list.snapshot,left:{...side,sessionId:'session-endurance'},right:side}),e=>e.apiCode==='PARTICIPANT_NOT_FOUND');
});
test('service counts use included contributions without summing duplicate baselines',t=>{
 const x=setup(t,{include:false}),service=require('../src/shared-library-service.cjs');
 const result=service.read(x.store(),{carId:'car-b'});assert.equal(result.service.recordedLaps,3);
 assert.equal(result.service.lapsDriven,3);assert.equal(service.read(x.store(),{carId:'car-a'}).service.recordedLaps,0);
});

test('unticked history keeps global Timing records, wins and mileage but not main-car totals',t=>{
 const x=setup(t,{include:false}),read=require('../src/shared-library-timing-read.cjs').read;
 const global=read(x.store(),{kind:'home'}),main=read(x.store(),{kind:'carStatistics',carId:'car-b'});
 assert.equal(global.summary.acceptedSessions,2);assert.equal(main.summary.acceptedSessions,1);
 assert.ok(global.summary.recordedLaps>main.summary.recordedLaps);
 assert.ok(global.summary.distanceM>main.summary.distanceM);
 const source=structuredClone(x.db);source.mergeMappings=[];source.mergeInclusions=[];source.mergeMeta.revision=0;
 const file=path.join(path.dirname(x.file),'without-merge.sqlite');S.write(file,S.pack(source),null);
 const original=read({file,expectedIdentity:JSON.stringify([source.id,source.revision]),data:{id:source.id,revision:source.revision}},{kind:'home'});
 assert.deepEqual(global.summary,original.summary);
 assert.deepEqual(global.topWinners,original.topWinners);
 // Global lists retain the original participant identity for the excluded run.
 const records=read(x.store(),{kind:'records',scope:'personal'});
 assert.ok(records.rows.some(r=>r.carId==='car-a'&&r.sessionId==='session-endurance'));
 assert.equal(read(x.store(),{kind:'records',carId:'car-b',scope:'personal'}).rows.some(r=>r.sessionId==='session-endurance'),false);
});

test('Timing Results metadata retains excluded sessions and exposes subsequent withdrawal once',t=>{
 const x=setup(t,{include:false}),read=require('../src/shared-library-timing-read.cjs').read;
 const first=read(x.store(),{kind:'resultSessions',limit:1});assert.equal(first.rows.length,1);assert.equal(first.nextOffset,1);
 const second=read(x.store(),{kind:'resultSessions',offset:1,limit:1,token:first.token});assert.equal(second.rows.length,1);assert.notEqual(first.rows[0].sessionId,second.rows[0].sessionId);
 x.change(db=>{const s=db.timing.sessions.find(s=>s.payload.sessionId==='session-endurance');s.payload={...structuredClone(x.f.withdrawal),sessionId:'session-endurance'};s.contentHash=T.digest(s.payload);});
 const state=read(x.store(),{kind:'sessionState',sourceId:'timing-demo',sessionId:'session-endurance'});assert.equal(state.row.state,'withdrawn');
 assert.equal(read(x.store(),{kind:'resultSessions'}).rows.length,1);
 assert.equal(read(x.store(),{kind:'home'}).summary.acceptedSessions,1);
 assert.throws(()=>read(x.store(),{kind:'resultSessions',offset:1,token:first.token}),{code:'QUERY_CHANGED'});
 assert.throws(()=>read(x.store(),{kind:'home',sessionId:'ignored'}),{code:'INVALID_QUERY'});
});

test('Timing record grouping occurs before pagination while the default retains lane records',t=>{
 const x=setup(t,{include:false}),read=require('../src/shared-library-timing-read.cjs').read;
 x.change(db=>{const s=structuredClone(db.timing.sessions.find(s=>s.payload.sessionId==='session-normal'));s.payload.sessionId='another-lane';s.payload.participants[0].stints.forEach(st=>{st.lane=2;});s.contentHash=T.digest(s.payload);db.timing.sessions.push(s);M.reconcileHistory(db);});
 const all=read(x.store(),{kind:'records',grouping:'timing',scope:'track',limit:1});
 assert.equal(all.total,1);assert.equal(all.nextOffset,null);
 const lanes=read(x.store(),{kind:'records',scope:'track',limit:1});assert.ok(lanes.total>1);assert.equal(lanes.nextOffset,1);
 const personal=read(x.store(),{kind:'records',grouping:'timing',scope:'personal'});assert.equal(new Set(personal.rows.map(r=>JSON.stringify([r.sourceId,r.trackId,r.driverId]))).size,personal.total);
});
test('storage rejects retired-car edits/deletion and removal of the main identity atomically',t=>{
 const x=setup(t),before=S.read(x.file);
 for(const change of [d=>{d.cars[0].name='Changed';},d=>{d.cars=d.cars.filter(c=>c.id!=='car-a');},d=>{d.cars=d.cars.filter(c=>c.id!=='car-b');},d=>{d.mergeArchives=[];}]){
  const next=structuredClone(before);change(next);next.revision++;
  assert.throws(()=>S.write(x.file,S.packChanges(before,next),JSON.stringify([before.id,before.revision])),e=>['CAR_MERGED','MERGE_IMMUTABLE'].includes(e.code));
  assert.deepEqual(S.read(x.file),before);
 }
});
test('new car edits reject the retired identity before revision errors; successful receipts still replay',t=>{
 const x=setup(t),C=require('../src/shared-car-library.cjs'),R=require('../src/command-receipts.cjs');
 const input={version:1,databaseId:x.db.id,recoveryId:x.state().epoch,sourceId:'test',operationId:'old-save',action:'patch',carId:'car-a',expectedRevision:1,set:{name:'new'}};
 assert.throws(()=>C.prepare(x.store(),{payload:input}),e=>e.apiCode==='CAR_MERGED'&&e.details.identity.canonicalCarId==='car-b');
 const command={id:'old-success',databaseId:x.db.id,epoch:x.state().epoch,action:'car.save',payload:input},receipt={carId:'car-a',revision:1};
 const db=new (require('node:sqlite').DatabaseSync)(x.file);try{db.exec('BEGIN IMMEDIATE');const release=require('../src/car-merge-fence.cjs').begin(db);R.insert(db,R.receipt(command,receipt));release();db.exec('COMMIT');}finally{db.close();}
 const result=R.execute(x.store(),command,()=>{throw Error('A successful receipt must not execute again');});assert.equal(result.duplicate,true);assert.deepEqual(result.result,receipt);
});
test('mapping pagination is bounded and recovery/generation bound independently from race hashes',t=>{
 const x=setup(t),page=Q.read(x.store(),null,r=>r.merges.mappings({limit:1})).value;
 assert.equal(page.rows.length,1);assert.equal(page.rows[0].mainCarId,'car-b');assert.equal(page.nextCursor,null);
 assert.throws(()=>Q.read(x.store(),null,r=>r.merges.mappings({limit:101})),{code:'INVALID_QUERY'});
 const cursor=Buffer.from(JSON.stringify({snapshot:{databaseId:x.db.id,recoveryId:x.state().epoch,mergeRevision:page.mergeRevision},offset:0})).toString('base64url');
 x.change(db=>{db.mergeMeta.revision++;});assert.throws(()=>Q.read(x.store(),null,r=>r.merges.mappings({cursor})),{code:'SNAPSHOT_CHANGED'});
});

test('contribution metadata is separately paged and changes without rewriting session evidence',t=>{
 const x=setup(t,{include:false}),read=require('../src/car-merge-query.cjs').contributions;
 const selected=read(x.store(),{sourceId:'timing-demo',sessionId:'session-normal',limit:1});
 require('../src/timing-schema.cjs').validate(selected,require('./fixtures/contracts/car-merges-v1/contributions.schema.json').$defs.response);
 require('../src/timing-schema.cjs').validate(Q.read(x.store(),null,r=>r.merges.mappings({limit:1})).value,require('./fixtures/contracts/car-merges-v1/mappings.schema.json').$defs.response);
 assert.equal(selected.rows[0].canonicalCarId,'car-b');assert.equal(selected.rows[0].originalCarId,'car-a');assert.equal(selected.rows[0].status,'included');
 const excluded=read(x.store(),{sourceId:'timing-demo',sessionId:'session-endurance'});assert.equal(excluded.rows[0].status,'excluded');
 assert.throws(()=>read(x.store(),{sourceId:'timing-demo',sessionId:'session-normal',offset:1}),{code:'SNAPSHOT_REQUIRED'});
 assert.throws(()=>read(x.store(),{sourceId:'timing-demo',sessionId:'session-normal',token:'wrong'}),{code:'INVALID_QUERY'});
 x.change(db=>{db.mergeMeta.revision++;});assert.throws(()=>read(x.store(),{sourceId:'timing-demo',sessionId:'session-normal',token:selected.token}),{code:'QUERY_CHANGED'});
});

test('a legacy connection opened before retirement cannot mutate merged storage or receipts',t=>{
 const x=setup(t),{DatabaseSync}=require('node:sqlite'),F=require('../src/car-merge-fence.cjs');
 const file=path.join(path.dirname(x.file),'old-open.sqlite'),initial=x.f.store.data;
 S.write(file,S.pack(initial),null);const legacy=new DatabaseSync(file);try{
 const before=S.read(x.file);S.write(file,S.pack(before),JSON.stringify([initial.id,initial.revision]));
 for(const sql of ["UPDATE state SET value=value WHERE key='identity'",'DELETE FROM records','DELETE FROM record_fields','DELETE FROM assets','DELETE FROM command_receipts']){
  // Empty tables do not fire row triggers. Insert a receipt first to exercise
  // that independent no-op-save path used by older engines.
  if(sql==='DELETE FROM command_receipts'){
   const d=new DatabaseSync(file);try{d.exec('BEGIN IMMEDIATE');const end=F.begin(d);d.exec("INSERT INTO command_receipts VALUES('fixture','epoch','hash','null')");end();d.exec('COMMIT');}finally{d.close();}
  }
  if(sql==='DELETE FROM assets'&&!legacy.prepare('SELECT 1 FROM assets').get())continue;
  assert.throws(()=>legacy.exec(sql),/MERGE_ENGINE_REQUIRED/);
 }
 assert.deepEqual(S.read(file),before);assert.equal(legacy.prepare('SELECT count(*) n FROM merge_write_permit').get().n,0);
 const next=structuredClone(before);next.settings.welcomeTitle='Still writable by a compatible engine';next.revision++;S.write(file,S.packChanges(before,next),JSON.stringify([before.id,before.revision]));
 assert.equal(legacy.prepare('SELECT count(*) n FROM merge_write_permit').get().n,0);
 // The same long-lived connection stays fenced after subsequent commits.
 assert.throws(()=>legacy.exec("UPDATE state SET value=value WHERE key='identity'"),/MERGE_ENGINE_REQUIRED/);
 }finally{legacy.close();}
});

test('a failed compatible write rolls back its permit and preserves the old-writer fence',t=>{
 const x=setup(t),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(x.file),F=require('../src/car-merge-fence.cjs');
 try{db.exec('BEGIN IMMEDIATE');F.begin(db);assert.equal(db.prepare('SELECT count(*) n FROM merge_write_permit').get().n,1);db.exec('ROLLBACK');assert.equal(db.prepare('SELECT count(*) n FROM merge_write_permit').get().n,0);assert.throws(()=>db.exec('DELETE FROM records'),/MERGE_ENGINE_REQUIRED/);}finally{db.close();}
});

test('backup restoration reinstalls merge writer fencing and compatible asset staging still works',t=>{
 const x=setup(t),B=require('../src/portable-backup.cjs'),{DatabaseSync}=require('node:sqlite'),folder=path.dirname(x.file),backup=path.join(folder,'merged.sfpbackup'),restored=path.join(folder,'restored.sqlite');
 B.exportBackup(x.file,backup);B.stageBackup(backup,restored,{validate:false});
 assert.deepEqual(S.read(restored),S.read(x.file));assert.notEqual(S.syncState(restored).epoch,S.syncState(x.file).epoch);
 const db=new DatabaseSync(restored);try{assert.throws(()=>db.exec('DELETE FROM records'),/MERGE_ENGINE_REQUIRED/);assert.equal(db.prepare('SELECT count(*) n FROM merge_write_permit').get().n,0);}finally{db.close();}
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',meta=require('../src/lazy-assets.cjs').metadata(image);
 assert.equal(S.stageAsset(restored,meta.hash,image).hash,meta.hash);assert.throws(()=>S.stageAsset(restored,'a'.repeat(64),image),/verification/);
 const check=new DatabaseSync(restored);try{assert.equal(check.prepare('SELECT count(*) n FROM merge_write_permit').get().n,0);assert.throws(()=>check.exec('DELETE FROM assets'),/MERGE_ENGINE_REQUIRED/);}finally{check.close();}
});
