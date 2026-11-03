'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),tasks=require('../src/domain-tasks.cjs'),sqlite=require('../src/sqlite-storage.cjs'),{fixtures}=require('./support/timing-fixtures.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-background-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=fixtures(),s=new Store(path.join(dir,'db.sqlite'));s.replace(f.store.snapshot());return {...f,s:new Store(s.file,{deferred:true}),dir};}
const save=(s,action,payload,id,epoch)=>s.mutateAsync(action,payload,{snapshot:false,commandId:id,epoch});
const read=s=>new Store(s.file).snapshot();
const bytes=p=>Buffer.from(JSON.stringify(p));
test('backpressure bounds uploads waiting for the collection lock and rechecks authorization',async t=>{
 const {s,normal}=fixture(t);let release;s.pendingWrite=new Promise(resolve=>{release=resolve;});
 const waiting=Array.from({length:16},()=>T.receiveAsync(s,bytes(normal),()=>{throw T.fault('TIMING_PERMISSION_REQUIRED','revoked while queued',403);}));
 const settled=Promise.allSettled(waiting);await assert.rejects(T.receiveAsync(s,bytes(normal)),e=>e.code==='WORKER_BUSY'&&e.httpStatus===503);
 s.pendingWrite=null;release();assert.ok((await settled).every(r=>r.status==='rejected'&&r.reason.apiCode==='TIMING_PERMISSION_REQUIRED'));assert.equal(s.domainPending,0);assert.equal(s.domainPendingBytes,0);assert.equal(read(s).timing.sessions.length,0);
});
test('a real worker exit after commit can be retried using the same durable command identity',async t=>{
 const {s}=fixture(t),{Worker}=require('node:worker_threads'),{Writer}=require('../src/sqlite-writer.cjs');
 const entry=path.resolve(__dirname,'../src/domain-worker.cjs');
 const writer=new Writer(()=>new Worker(`const {parentPort}=require('node:worker_threads');const send=parentPort.postMessage.bind(parentPort);parentPort.postMessage=message=>{if(!message.error)process.exit(19);send(message);};require(${JSON.stringify(entry)});`,{eval:true}));
 const command={id:'lost-ack',databaseId:s.data.id,epoch:sqlite.syncState(s.file).epoch,action:'work.add',payload:{carId:'car-a',type:'maintenance',title:'Acknowledgement lost'}};
 await assert.rejects(writer.write(s.file,require('../src/domain-transfer.cjs').pack({kind:'command',command}),s.expectedIdentity),e=>e.code==='WRITE_UNCERTAIN');await writer.stopping;
 assert.equal(read(s).events.filter(e=>e.title===command.payload.title).length,1);
 await assert.rejects(tasks.run(s,{kind:'command',command},()=>{throw Object.assign(Error('Acknowledgement lost'),{code:'WRITE_UNCERTAIN'});}),e=>e.code==='WRITE_UNCERTAIN');const revision=s.data.revision;assert.equal(revision,read(s).revision);
 const retry=await save(s,command.action,command.payload,command.id,command.epoch);assert.equal(retry.duplicate,true);assert.equal(s.data.revision,revision);assert.equal(read(s).events.filter(e=>e.title===command.payload.title).length,1);
});
test('large bulk-operation receipts remain exact and bounded through lossless compression',t=>{
 const {s}=fixture(t),R=require('../src/command-receipts.cjs'),command={id:'large-result',databaseId:s.data.id,epoch:sqlite.syncState(s.file).epoch,action:'car.bulk',payload:{}};
 const result={rows:Array.from({length:10000},(_,i)=>({id:'car-'+i,name:'A long named car '+i,before:'a'.repeat(200),after:'b'.repeat(200)}))};assert.ok(Buffer.byteLength(JSON.stringify(result))>1024*1024);
 const db=new DatabaseSync(s.file);try{const value=R.receipt(command,result);assert.ok(value.result.startsWith('z1:'));R.insert(db,value);assert.deepEqual(R.find(db,R.receipt(command,null)).result,result);}finally{db.close();}
});
test('background receipt, duplicate, correction and withdrawal preserve Timing and Telemetry shapes after restart',async t=>{
 const f=fixture(t),s=f.s,notify=[];s.listeners.add(()=>notify.push(s.data.revision));
 const first=await T.receiveAsync(s,bytes(f.normal));assert.equal(first.ok,true);assert.ok(s.deferredState);assert.equal(notify.length,1);
 const duplicate=await T.receiveAsync(s,bytes(f.normal));assert.equal(duplicate.duplicate,true);assert.equal(notify.length,1);
 const checked=await tasks.run(s,{kind:'timing-receipt',sourceId:f.normal.source.id,sessionId:f.normal.sessionId});assert.deepEqual({...checked,duplicate:false},{...first,duplicate:false});
 assert.ok(!s.deferredState.stats.loadedSections.includes('timing.sessions'));
 const conflict=structuredClone(f.normal);conflict.name='Different';await assert.rejects(T.receiveAsync(s,bytes(conflict)),e=>e.httpStatus===409);
 await T.receiveAsync(s,bytes(f.correction));await T.receiveAsync(s,bytes(f.withdrawal));assert.equal(notify.length,3);
 const reopened=new Store(s.file,{deferred:true});assert.equal((await T.receiveAsync(reopened,bytes(f.withdrawal))).duplicate,true);
 await assert.rejects(T.receiveAsync(reopened,bytes(f.normal)),e=>e.httpStatus===409);
 const A=require('../src/scalable-api.cjs'),result=A.handle(reopened,'GET',new URL('http://localhost/v1/scalable/results/timing-demo/session-normal'),{timingResults:true},s.data.id);assert.equal(result.payload.state,'withdrawn');
 assert.deepEqual(read(s).timing.sessions[0].payload,f.withdrawal);
});
test('background input errors, permissions at execution and competing saves leave committed data intact',async t=>{
 const f=fixture(t),s=f.s,before=read(s);for(const input of [Buffer.from('{'),Buffer.from([0xff])])await assert.rejects(T.receiveAsync(s,input),e=>e.apiCode==='INVALID_JSON');
 await assert.rejects(T.receiveAsync(s,bytes(f.normal),()=>{throw T.fault('TIMING_PERMISSION_REQUIRED','revoked',403);}),e=>e.httpStatus===403);
 assert.deepEqual(read(s),before);
 const sent=T.receiveAsync(s,bytes(f.multi));const changed=save(s,'work.add',{carId:'car-a',type:'maintenance',title:'Concurrent service'},'concurrent');await Promise.all([sent,changed]);
 const after=read(s);assert.equal(after.timing.sessions.length,1);assert.equal(after.events[0].title,'Concurrent service');assert.equal(after.revision,before.revision+2);
});
test('durable command receipts replay results across restart without repeating stock or history writes',async t=>{
 const {s}=fixture(t),epoch=sqlite.syncState(s.file).epoch,p={carId:'car-a',type:'maintenance',title:'Lubricate once'};
 const first=await save(s,'work.add',p,'work-once',epoch),before=read(s),cursor=sqlite.syncState(s.file);
 const opened=new Store(s.file,{deferred:true}),second=await save(opened,'work.add',p,'work-once',epoch);assert.equal(second.duplicate,true);assert.deepEqual(second.result,first.result);assert.deepEqual(read(s),before);assert.deepEqual(sqlite.syncState(s.file),cursor);
 await assert.rejects(save(opened,'work.add',{...p,title:'Not the same command'},'work-once',epoch),e=>e.code==='COMMAND_CONFLICT');
 const part=(await save(opened,'part.save',{data:{name:'Motor',quantity:3,tracking:'quantity'}},'stock')).result;
 const install={carId:'car-a',partId:part,quantity:2,field:'motor'};await save(opened,'part.install',install,'install-once');const installed=read(opened);await save(opened,'part.install',install,'install-once');assert.deepEqual(read(opened),installed);
 const edit={id:'car-a',revision:installed.cars[0].revision,data:{name:'Renamed once'}};await save(opened,'car.save',edit,'car-once');assert.equal((await save(opened,'car.save',edit,'car-once')).duplicate,true);
 await assert.rejects(save(opened,'part.install',{...install,carId:'car-b',quantity:2},'insufficient'),/stock|quantity/i);
 const db=new DatabaseSync(s.file);try{assert.equal(db.prepare("SELECT count(*) n FROM command_receipts WHERE id='insufficient'").get().n,0);}finally{db.close();}
});
test('receipt insertion failure rolls back data, undo, indexes and change cursor together',async t=>{
 const {s}=fixture(t),R=require('../src/command-receipts.cjs'),db=new DatabaseSync(s.file);try{R.ensure(db);db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'simulated receipt storage failure'); END;");}finally{db.close();}
 const before=read(s),cursor=sqlite.syncState(s.file);await assert.rejects(save(s,'work.add',{carId:'car-a',type:'maintenance',title:'Must roll back'},'rollback'),/simulated receipt/);
 assert.deepEqual(read(s),before);assert.deepEqual(sqlite.syncState(s.file),cursor);assert.equal(s.data.revision,before.revision);
});
test('restoring a collection rejects old command epochs, even at the same identity and revision',async t=>{
 const {s}=fixture(t),epoch=sqlite.syncState(s.file).epoch,p={carId:'car-a',type:'maintenance',title:'Before restore'};
 await save(s,'work.add',p,'restored-command',epoch);s.replace(s.snapshot());
 await assert.rejects(save(s,'work.add',p,'restored-command',epoch),e=>e.code==='COMMAND_EPOCH_CHANGED');
 const db=new DatabaseSync(s.file);try{assert.equal(db.prepare('SELECT count(*) n FROM command_receipts').get().n,0);}finally{db.close();}
});
test('first invalid command leaves a new collection usable; no-op receipts survive restart',async t=>{
 const {dir}=fixture(t),s=new Store(path.join(dir,'new.sqlite'));
 await assert.rejects(save(s,'car.save',{data:{name:''}},'invalid-first'));
 const id=(await save(s,'car.save',{data:{name:'First car'}},'valid-first')).result;assert.equal(read(s).cars[0].id,id);
 const c=read(s).cars[0],p={id,revision:c.revision,data:{name:c.name}},revision=s.data.revision;
 await save(s,'car.save',p,'noop');assert.equal(s.data.revision,revision);
 assert.equal((await save(new Store(s.file,{deferred:true}),'car.save',p,'noop')).duplicate,true);
});
test('lazy photographs cross the worker boundary without reading originals on the calling thread',async t=>{
 const {s}=fixture(t),lazy=require('../src/lazy-assets.cjs'),photo='data:image/png;base64,'+Buffer.alloc(500000,7).toString('base64');
 s.mutate('car.save',{id:'car-a',revision:s.data.cars[0].revision,data:{picture:photo}});
 const d=new Store(s.file,{deferred:true}),car=d.deferredState.read(r=>r.record('["cars","id:car-a"]',{assetHandle:true})),payload={id:car.id,revision:car.revision,data:car};car.name='With photograph';lazy.clearCache();
 const packed=require('../src/domain-transfer.cjs').pack(payload);assert.equal(packed.assets.length,1);assert.equal(lazy.stats().reads,0);
 await save(d,'car.save',payload,'photo-edit');assert.equal(lazy.stats().reads,0);assert.equal(read(d).cars[0].picture,photo);
});
