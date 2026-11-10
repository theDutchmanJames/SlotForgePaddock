'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const S=require('../src/sqlite-storage.cjs'),M=require('../src/car-merge-model.cjs'),Repo=require('../src/car-merge-storage.cjs'),T=require('../src/timing-integration.cjs'),Q=require('../src/sqlite-query.cjs'),{Store}=require('../src/store.cjs');
const fixture=t=>{
 const f=require('./support/timing-fixtures.cjs').fixtures(),root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-merge-host-')),file=path.join(root,'data.sqlite');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));S.write(file,S.pack(f.store.data),null);
 const repo=Repo.openHost(file);let n=0;
 const command=(action,payload)=>({databaseId:f.store.data.id,recoveryId:repo.state().recoveryId,sourceId:'host-review',operationId:'command-'+ ++n,action,payload});
 const send=(action,payload)=>repo.command(command(action,payload)).result;
 const merge=()=>{const p=send('create',{mainCarId:'car-b',retiredCarId:'car-a'});return send('approve',{id:p.id,expectedRevision:p.revision});};
 return {f,root,file,repo,command,send,merge,open:()=>new Store(file,{deferred:true})};
};
test('host approval keeps schema compatible, verifies a backup and survives reopen with exact receipts',t=>{
 const x=fixture(t),p=x.send('create',{mainCarId:'car-b',retiredCarId:'car-a'}),cmd=x.command('approve',{id:p.id,expectedRevision:p.revision});
 const accepted=x.repo.command(cmd);assert.equal(accepted.duplicate,false);assert.equal(x.repo.read().schema,11);
 assert.equal(fs.readdirSync(path.join(x.root,'merge-recovery')).length,1);
 assert.deepEqual(Repo.openHost(x.file).command(cmd),{...accepted,duplicate:true});
 const store=x.open();assert.equal(Q.read(store,null,r=>r.merges.identity('car-a')).value.canonicalCarId,'car-b');
 assert.equal(x.repo.read().mergeArchives.length,2);assert.equal(store.data.cars.length,2);
});
test('downloaded dealership copies cannot create or approve merge decisions',t=>{
 const x=fixture(t),before=x.repo.read(),next=structuredClone(before);next.club={id:'club-test',replica:true,proposals:[]};next.revision++;S.write(x.file,S.packChanges(before,next),JSON.stringify([before.id,before.revision]));
 assert.throws(()=>x.send('create',{mainCarId:'car-b',retiredCarId:'car-a'}),{code:'MERGE_AUTHORITY_REQUIRED'});assert.equal(x.repo.read().mergeProposals,undefined);
});

test('host receipt lookup reports the public recovery error and never replays a pre-restore command',t=>{
 const x=fixture(t),cmd=x.command('create',{mainCarId:'car-b',retiredCarId:'car-a'});x.repo.command(cmd);
 const before=x.repo.read(),packed=S.packChanges(before,before);packed.resetEpoch=true;
 S.write(x.file,packed,JSON.stringify([before.id,before.revision]));
 assert.throws(()=>x.repo.command(cmd),{code:'RECOVERY_CHANGED'});
 assert.throws(()=>x.repo.command({...cmd,databaseId:'different-database'}),{code:'DATABASE_MISMATCH'});
 assert.equal(x.repo.read().mergeProposals.length,1);
});
test('normal result intake atomically queues late old-car history, deduplicates retries and retains revisions',t=>{
 const x=fixture(t);x.merge();let store=x.open();T.receive(store,x.f.normal);
 let data=x.repo.read(),late=data.mergeInclusions;assert.equal(late.length,1);assert.equal(late[0].status,'pending');assert.equal(data.timing.sessions.length,1);
 assert.equal(Q.read(store,null,r=>r.merges.identity('car-a')).value.canonicalCarId,'car-b');
 const first=structuredClone(late[0]);T.receive(store,x.f.normal);assert.deepEqual(x.repo.read().mergeInclusions,[first]);
 T.receive(store,x.f.correction);late=x.repo.read().mergeInclusions;assert.equal(late.length,1);assert.equal(late[0].revision,first.revision+1);assert.equal(late[0].status,'pending');
 assert.notEqual(late[0].evidenceHash,first.evidenceHash);
 assert.throws(()=>x.send('includeHistory',{id:first.id,expectedRevision:first.revision,include:true}),{code:'MERGE_REVIEW_STALE'});
 const decision=x.send('includeHistory',{id:late[0].id,expectedRevision:late[0].revision,include:true});assert.ok(decision);
 store=x.open();T.receive(store,x.f.withdrawal);assert.equal(x.repo.read().timing.sessions[0].payload.state,'withdrawn');
});
test('history inclusion changes main-car attribution without relabelling any global record or mileage row',t=>{
 const x=fixture(t);x.merge();let store=x.open();T.receive(store,x.f.normal);
 const read=require('../src/shared-library-timing-read.cjs').read,records=()=>read(store,{kind:'records',grouping:'timing'}).rows,home=()=>read(store,{kind:'home',weekStart:'2026-10-25T00:00:00.000Z'});
 const before=records(),totals=home(),late=x.repo.read().mergeInclusions[0];assert.equal(before[0].carId,'car-a');assert.equal(totals.topDistanceCars[0].carId,'car-a');
 assert.equal(read(store,{kind:'carStatistics',carId:'car-b'}).summary.recordedLaps,0);
 x.send('includeHistory',{id:late.id,expectedRevision:late.revision,include:true});store=x.open();
 assert.deepEqual(records(),before);const after=home();assert.deepEqual(after.summary,totals.summary);assert.deepEqual(after.topDistanceCars,totals.topDistanceCars);assert.deepEqual(after.topWinners,totals.topWinners);assert.deepEqual(after.fastestThisWeek,totals.fastestThisWeek);
 const car=read(store,{kind:'carStatistics',carId:'car-b'});assert.equal(car.summary.recordedLaps,3);assert.equal(read(store,{kind:'records',carId:'car-b'}).rows[0].carId,'car-b');
 assert.equal(x.repo.read().timing.sessions[0].payload.participants[0].carId,'car-a');
});
test('main-car races do not create a merge review and unrelated writes preserve archives',t=>{
 const x=fixture(t);x.merge();const store=x.open(),payload=structuredClone(x.f.normal);payload.participants[0].carId='car-b';payload.participants[0].configuration=structuredClone(x.f.profiles[1].configuration);
 T.receive(store,payload);assert.equal(x.repo.read().mergeInclusions.length,0);
 const before=x.repo.read().mergeArchives;store.mutate('settings.save',{name:'Renamed collection'});assert.deepEqual(x.repo.read().mergeArchives,before);
});
test('failed result persistence publishes neither evidence nor its pending review',t=>{
 const x=fixture(t);x.merge();const store=x.open(),before=S.syncState(x.file),original=store.persist;store.persist=()=>{throw Error('Injected disk failure');};
 assert.throws(()=>T.receive(store,x.f.normal),/could not save this session/);assert.deepEqual(S.syncState(x.file),before);assert.equal(x.repo.read().mergeInclusions.length,0);assert.equal(x.repo.read().timing.sessions.length,0);
 store.persist=original;T.receive(store,x.f.normal);assert.equal(x.repo.read().mergeInclusions.length,1);
});
test('full-model result writes also create exactly one pending late review',t=>{
 const x=fixture(t);x.merge();const store=new Store(x.file);T.receive(store,x.f.normal);assert.equal(x.repo.read().mergeInclusions.length,1);assert.equal(x.repo.read().mergeInclusions[0].status,'pending');
});
test('withdrawn late history can be kept excluded without reviving a withdrawn result',t=>{
 const x=fixture(t);x.merge();const store=x.open();T.receive(store,x.f.normal);T.receive(store,x.f.withdrawal);
 const i=x.repo.read().mergeInclusions[0],state=x.repo.state(),page=require('../src/car-merge-review.cjs').read(state.data,state.recoveryId,{action:'late',databaseId:state.data.id});
 assert.equal(page.rows[0].canInclude,false);assert.throws(()=>x.send('includeHistory',{id:i.id,expectedRevision:i.revision,include:true}));
 x.send('includeHistory',{id:i.id,expectedRevision:i.revision,include:false});assert.equal(x.repo.read().mergeInclusions[0].status,'excluded');assert.equal(x.repo.read().timing.sessions[0].payload.state,'withdrawn');
});
test('original-only history preserves chunk hashes and durable receipts through correction and withdrawal',t=>{
 const x=fixture(t);x.merge();const raw=require('../src/shared-library-raw-history.cjs'),receipts=require('../src/command-receipts.cjs');let store=x.open();
 const input={databaseId:store.data.id,recoveryId:x.repo.state().recoveryId,sourceId:'timing-demo',originalId:'old-source-session',sessionId:'raw-session',operationId:'raw-once',action:'create',expectedRevision:0,reason:'Preserve original race',projectionReason:'unsupported session',carIds:['car-a'],rawOriginal:{session:{name:'Old race',slotcarId:'car-a'},laps:Array.from({length:1000},(_,i)=>({id:require('node:crypto').randomUUID(),slotcarId:'car-a',time:10000+i}))}};
 const cmd={id:'raw-receipt',action:'history.raw',databaseId:input.databaseId,epoch:input.recoveryId,payload:input};
 const write=(s,c)=>raw.prepare(s,c.payload),first=receipts.execute(store,cmd,write);
 const late=x.repo.read().mergeInclusions[0];assert.equal(late.status,'pending');assert.equal(x.repo.read().mergeInclusions.length,1);
 assert.deepEqual(receipts.execute(store,cmd,write),{...first,duplicate:true});
 // A stored lazy chunk and its in-memory original must produce the same hash.
 const row=M.contributions(x.repo.read()).find(r=>r.key===late.key);assert.equal(require('../src/car-merge-archive.cjs').digest(row.record),late.evidenceHash);
 x.send('includeHistory',{id:late.id,expectedRevision:late.revision,include:true});store=x.open();
 const withdraw={...input,action:'withdraw',expectedRevision:1,operationId:'raw-withdraw'};delete withdraw.rawOriginal;
 receipts.execute(store,{...cmd,id:'raw-withdraw',payload:withdraw},write);
 assert.equal(x.repo.read().mergeInclusions[0].revision,late.revision+2);
 assert.equal(raw.read(store,{kind:'sessions',state:'withdrawn'}).rows.length,1);
});
test('guarded rich intake and corrections commit one pending decision with the original result receipt',t=>{
 const x=fixture(t);x.merge();const store=x.open(),R=require('../src/rich-history.cjs');
 const op=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/qualified/create.json')));op.recoveryId=x.repo.state().recoveryId;
 const first=R.receiveQualified(store,op);assert.equal(first.accepted.contentHash,T.digest(op.bundle));assert.equal(x.repo.read().mergeInclusions.length,1);
 const initial=x.repo.read().mergeInclusions[0];assert.equal(initial.status,'pending');assert.equal(R.receiveQualified(store,op).duplicate,true);assert.deepEqual(x.repo.read().mergeInclusions,[initial]);
 const edit={...structuredClone(op),operationId:'rich-correction',action:'replace',expected:first.accepted};edit.bundle.race.participants[0].laps.splice(0,1);edit.bundle.context.classification=edit.bundle.context.classification.filter(c=>c.participantId!=='entry-1');
 const corrected=R.receiveQualified(store,edit);assert.equal(x.repo.read().mergeInclusions[0].revision,initial.revision+1);
 const withdrawal={...edit,operationId:'rich-withdrawal',action:'withdraw',expected:corrected.accepted,withdrawalReason:'Withdrawn fixture'};delete withdrawal.bundle;R.receiveQualified(store,withdrawal);
 assert.equal(x.repo.read().timing.sessions[0].payload.state,'withdrawn');assert.equal(x.repo.read().mergeInclusions.length,1);
});
test('actual background dispatcher updates the parent Store and serializes merge approval',async t=>{
 const threads=require('node:worker_threads'),Worker=threads.Worker;
 threads.Worker=class extends Worker{constructor(file,options){super(path.basename(String(file))==='domain-worker.cjs'?path.join(__dirname,'support/merge-host-worker.cjs'):file,options);}};
 const gate=require('../src/car-merge-activation.json'),old=gate.enabled;gate.enabled=true;
 t.after(()=>{gate.enabled=old;threads.Worker=Worker;});
 const service=require('../src/car-merge-review-service.cjs'),x=fixture(t),store=x.open();let emits=0;store.emit=()=>{emits++;};
 assert.equal(service.dispatch({action:'status'},store).enabled,true);
 const list=await service.dispatch({action:'list',databaseId:store.data.id},store);assert.equal(list.total,0);
 const created=await service.dispatch({command:x.command('create',{mainCarId:'car-b',retiredCarId:'car-a'})},store);assert.equal(created.result.status,'pending');assert.equal(emits,1);
 const cmd=x.command('approve',{id:created.result.id,expectedRevision:created.result.revision});
 await service.dispatch({command:cmd},store);assert.equal(emits,2);assert.equal(store.data.mergeMappings.length,1);
 assert.equal((await service.dispatch({command:cmd},store)).duplicate,true);assert.equal(emits,2);
 T.receive(store,x.f.normal);const info=require('../src/view-query.cjs').view(store,{page:'Overview'})._view.carMerges;assert.deepEqual(info,{proposals:0,history:1,total:1});
 let selected=true,release;store.pendingWrite=new Promise(resolve=>{release=resolve;});
 const queued=service.dispatch({action:'list',databaseId:store.data.id},store,()=>{if(!selected)throw Object.assign(Error('Selected collection changed'),{code:'MERGE_AUTHORITY_REQUIRED'});});
 selected=false;store.pendingWrite=null;release();await assert.rejects(queued,{code:'MERGE_AUTHORITY_REQUIRED'});
});
