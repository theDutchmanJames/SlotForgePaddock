'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),{host,request,until}=require('./support/local-recovery-qualification.cjs');
const preload=path.join(__dirname,'support/rich-delivery-preload.cjs'),BASE='/v1/shared-history';
async function put(h,route,body){const d=h.descriptor,r=await fetch(d.address+route,{method:'PUT',headers:{Authorization:'Bearer '+d.token,'X-SlotForge-Instance':d.instanceId,'X-SlotForge-Database':d.databaseId,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
async function fixture(t,enabled=true){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-rich-route-')),file=path.join(root,'database.sqlite');new Store(file).replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());
 const cleanups=[];let h=await host(root,{preloads:enabled?[preload]:[]});
 t.after(async()=>{for(const close of cleanups)await close();await h?.kill();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sf-local-qualify-rich-route-'));fs.rmSync(root,{recursive:true,force:true});});
 const state=ok(await request(h,BASE+'/status')),f=require('./fixtures/timing-production-mapper/race.json');
 const op={version:1,databaseId:'paddock-demo',recoveryId:state.recoveryId,operationId:'create-rich',editor:{installationId:'timing-route',application:'SlotForge Timing',name:'Disposable test'},sourceId:'original-timing',sessionId:f.evidence.session.id,action:'create',expected:null,reason:'Reviewed',bundle:structuredClone(f.bundle)};
 return {root,file,state,op,cleanups,get h(){return h;},get:route=>request(h,route),post:op=>request(h,BASE+'/operations',op),lookup:op=>request(h,BASE+'/operations/'+op.editor.installationId+'/'+op.operationId+'?recoveryId='+op.recoveryId),stats:async()=>ok(await request(h,BASE+'/cars/car-a/statistics')),
  async restart(){await h.kill();h=await host(root,{preloads:enabled?[preload]:[]});},
  async crash(mode,fn){fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode,staging:false}));const pending=fn().catch(e=>({error:e.message}));await until(()=>fs.existsSync(path.join(root,'crash-reached.json')),mode);await h.kill();await pending;fs.unlinkSync(path.join(root,'crash-reached.json'));h=await host(root,{preloads:enabled?[preload]:[]});}
 };
}
async function stage(f,op,id,interrupt=false){
 const bytes=Buffer.from(JSON.stringify(op)),sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex'),base={version:1,databaseId:op.databaseId,recoveryId:op.recoveryId,uploadId:id},start={...base,editor:op.editor,kind:'operation',byteLength:bytes.length,sha256:sha(bytes)};
 const begun=ok(await request(f.h,BASE+'/uploads',start));for(let offset=0,index=0;offset<bytes.length;offset+=begun.chunkBytes,index++){const b=bytes.subarray(offset,offset+begun.chunkBytes);ok(await put(f.h,BASE+'/uploads/'+id+'/chunks/'+index,{...base,index,sha256:sha(b),data:b.toString('base64')}));if(interrupt&&index===0)await f.restart();}
 return {commit:()=>request(f.h,BASE+'/uploads/'+id+'/commit',{...base,sha256:start.sha256}),lookup:()=>f.get(BASE+'/uploads/'+id+'?recoveryId='+op.recoveryId)};
}
test('explicitly closed rich gate blocks inline/upload writes without disabling legacy delivery',async t=>{
 const gate=require('../src/rich-history-gate.cjs');assert(Object.isFrozen(gate));assert.equal(gate.enabled(),false);
 process.env.SLOTFORGE_RICH_HISTORY='1';const f=await fixture(t,false);delete process.env.SLOTFORGE_RICH_HISTORY;
 assert.deepEqual(f.state.capability.formats,['timing-v1']);assert.equal(f.state.capability.features.historicalImports,false);
 assert.equal((await f.post(f.op)).value.code,'INVALID_PAYLOAD');const upload=await stage(f,f.op,'closed-upload');assert.equal((await upload.commit()).value.code,'INVALID_PAYLOAD');assert.equal((await f.stats()).acceptedSessions,0);
 const legacy=require('./support/timing-fixtures.cjs').fixtures().normal;ok(await f.post({...f.op,sourceId:legacy.source.id,sessionId:legacy.sessionId,bundle:{format:'timing-v1',payload:legacy}}));assert.equal((await f.stats()).distanceM,60);
});
test('actual local HTTP and domain worker preserve rich receipts, conflicts and withdrawal hashes',async t=>{
 const f=await fixture(t);assert.deepEqual(f.state.capability.formats,['timing-v1','history-v1']);assert.equal(f.state.capability.maxLaps,50000);assert.equal(f.state.capability.features.historicalImports,false);
 const first=ok(await f.post(f.op));assert.equal(first.accepted.contentHash,T.digest(f.op.bundle));await f.restart();assert.equal(ok(await f.post(f.op)).duplicate,true);assert.equal((await f.stats()).distanceM,40);
 const correction={...structuredClone(f.op),operationId:'correction',editor:{...f.op.editor,installationId:'changed-installation'},action:'replace',expected:first.accepted};correction.bundle.race.participants[0].laps[0].trackRecordEligible=false;
 const replies=await Promise.all([f.post(correction),f.post({...correction,operationId:'competing-editor'})]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);const second=ok(replies.find(r=>r.status===200));assert.equal((await f.stats()).bestPersonalLapMs,10000);assert.equal((await f.stats()).bestTrackLapMs,11000);
 assert.equal(ok(await f.lookup(f.op)).current.revision,2);assert.equal((await f.post({...f.op,reason:'conflicting bytes'})).value.code,'OPERATION_CONFLICT');
 const withdrawal={...f.op,operationId:'withdrawal',action:'withdraw',expected:second.accepted,withdrawalReason:'Race withdrawn'};delete withdrawal.bundle;
 const third=ok(await f.post(withdrawal));assert.equal(third.accepted.contentHash,T.digest({databaseId:f.op.databaseId,source:{id:f.op.sourceId},sessionId:f.op.sessionId,revision:3,state:'withdrawn',reason:'Race withdrawn'}));
 await f.restart();assert.equal(ok(await f.post(withdrawal)).duplicate,true);assert.equal(ok(await f.post(f.op)).current.state,'withdrawn');assert.equal((await f.stats()).distanceM,0);
 const historical=structuredClone(f.op);historical.operationId='historical-bypass';historical.sessionId='historical';historical.bundle.provenance.kind='historical';for(const l of historical.bundle.race.participants[0].laps){l.personalRecordEligible=false;l.trackRecordEligible=false;}
 assert.equal((await f.post(historical)).value.code,'UNSUPPORTED_COVERAGE');assert.equal(new Store(f.file).data.timing.sessions.length,1);
});
test('qualified rich routes keep authentication, browser-origin, database and recovery protections',async t=>{
 const f=await fixture(t);
 assert.equal((await request(f.h,BASE+'/operations',f.op,{Authorization:'Bearer wrong'})).status,401);
 assert.equal((await request(f.h,BASE+'/operations',f.op,{Origin:'http://localhost'})).status,403);
 assert.equal((await request(f.h,BASE+'/operations',f.op,{'X-SlotForge-Database':'wrong'})).status,409);
 assert.equal((await f.post({...f.op,databaseId:'wrong'})).value.code,'DATABASE_MISMATCH');
 assert.equal((await f.post({...f.op,recoveryId:'stale'})).value.code,'RECOVERY_CHANGED');
 await f.h.command('backup');ok(await f.post(f.op));await f.h.command('restore');
 assert.equal((await f.post(f.op)).value.code,'RECOVERY_CHANGED');assert.equal((await f.lookup(f.op)).value.code,'RECOVERY_CHANGED');assert.equal((await f.stats()).acceptedSessions,0);
});
test('rich HTTP upload survives interruption and lost commit acknowledgement without duplicate acceptance',{timeout:60000},async t=>{
 const f=await fixture(t),p=f.op.bundle.race.participants[0],n=1500;
 f.op.bundle.race.endedAt=new Date(Date.parse(f.op.bundle.race.startedAt)+n*10000).toISOString();f.op.bundle.race.heats[0].endedAtMs=n*10000;p.stints[0].endedAtMs=n*10000;
 p.laps=Array.from({length:n},(_,i)=>({...p.laps[0],id:'bulk-'+i,originLapId:'saved-'+i,number:i+1,durationMs:10000,endedAtMs:(i+1)*10000}));
 const upload=await stage(f,f.op,'rich-upload',true);await f.restart();assert.equal(ok(await upload.lookup()).state,'staging');
 await f.crash('after-commit',upload.commit);const status=ok(await upload.lookup());assert.equal(status.state,'committed');assert.equal(status.receipt.accepted.contentHash,T.digest(f.op.bundle));
 assert.equal(ok(await upload.commit()).receipt.accepted.revision,1);assert.equal((await f.stats()).distanceM,n*20);assert.equal(new Store(f.file).data.timing.audit.length,1);
});
test('rich worker death rolls back before commit and recovers durable receipts after commit',{timeout:60000},async t=>{
 const f=await fixture(t);await f.crash('before-commit',()=>f.post(f.op));assert.equal((await f.lookup(f.op)).status,404);assert.equal((await f.stats()).acceptedSessions,0);
 await f.crash('after-commit',()=>f.post(f.op));assert.equal(ok(await f.lookup(f.op)).accepted.revision,1);assert.equal(ok(await f.post(f.op)).duplicate,true);assert.equal((await f.stats()).distanceM,40);
});

if(process.env.SLOTFORGE_TIMING_SOURCE)for(const backend of ['json','sqlite'])for(const lapCount of [2,1800])test(backend+' '+lapCount+' laps: actual Timing delivery queue uses Paddock HTTP, worker, staging and recovery',{timeout:90000},async t=>{
 const f=await fixture(t),source=path.resolve(process.env.SLOTFORGE_TIMING_SOURCE),Module=require('node:module'),gatePath=path.join(source,'paddock-rich-gate.js'),original=require.cache[gatePath];
 const m=new Module(gatePath,module);m.filename=gatePath;m.paths=Module._nodeModulePaths(source);const code=fs.readFileSync(gatePath,'utf8');m._compile(require('./support/history-gates.cjs').compile(code,true),gatePath);m.loaded=true;require.cache[gatePath]=m;t.after(()=>{if(original)require.cache[gatePath]=original;else delete require.cache[gatePath];});
 const Database=require(path.join(source,'db'));let db=new Database(path.join(f.root,'timing.json'));db.data.paddock={sourceId:'timing-delivery',withdrawals:[],connection:{mode:'local',databaseId:f.op.databaseId,historyGuard:{databaseId:f.op.databaseId,recoveryId:f.op.recoveryId,richWrites:true}}};db.saveNow();let working;
 if(backend==='sqlite'){require(path.join(source,'sqlite-migration')).migrateCopy({source:db.file,destination:path.join(f.root,'copy')});require(path.join(source,'sqlite-working')).forkCopy(path.join(f.root,'copy'),path.join(f.root,'work'));working=new(require(path.join(source,'sqlite-working')).WorkingStore)(path.join(f.root,'work'));f.cleanups.push(()=>working.close());}
 const makeClient=()=>working?{outbox:async(...a)=>working.outbox(...a),deliverySnapshot:async(...a)=>working.deliverySnapshot(...a),deliveryPayload:async(...a)=>working.deliveryPayload(...a),command:async c=>working.command(c)}:new(require(path.join(source,'json-delivery-store')))(db);
 let client=makeClient();const routes=[];let loseReply=true;
 const call=async(route,body,_limit,_recovery,method)=>{routes.push(route);assert(!route.startsWith('/v1/timing/sessions'),'No legacy fallback');const d=f.h.descriptor,r=await fetch(d.address+route,{method:method|| (body===undefined?'GET':'POST'),headers:{Authorization:'Bearer '+d.token,'X-SlotForge-Instance':d.instanceId,'X-SlotForge-Database':d.databaseId,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)}),v=await r.json();if(!r.ok)throw Object.assign(Error(v.error),v);if(loseReply&&(route===BASE+'/operations'||route.endsWith('/commit'))){loseReply=false;throw Error('Synthetic lost response after server commit');}return v;};
 const service=new(require(path.join(source,'delivery-service')))(client,{call,historyCapability:()=>f.state.capability}),e=require(path.join(source,'tools/qa/rich-mapper-fixtures.cjs')).evidence();
 if(lapCount>2){const h=e.session.paddockJournal.heats[0],entry=h.entries[0];h.endedAt=h.startedAt+lapCount*10000;entry.laps=Array.from({length:lapCount},(_,i)=>({...entry.laps[0],number:i+1,time:10000,at:h.startedAt+(i+1)*10000}));e.laps=entry.laps.map(l=>({carId:'local',driverId:'driver',lane:1,lapNumber:l.number,time:l.time}));e.session.standings[0].laps=lapCount;}
 const id=working?working.command({id:'finalise',type:'finalizeSession',session:e.session,laps:e.laps}).sessionId:await db.saveSessionAsync(e.session,e.laps);
 const find=async()=>{const row=(await client.outbox(f.op.databaseId,{limit:200})).find(r=>r);return row?client.deliverySnapshot(row.key):null;};
 const initial=await find();assert.equal(initial.payload.format,'history-v1');
 // Service entry point and acknowledgement semantics are the actual Timing code.
 const row=(await client.outbox(f.op.databaseId,{limit:200}))[0];await assert.rejects(service.flush(f.op.databaseId),/Synthetic lost/);await f.restart();if(working){working.close();working=new(require(path.join(source,'sqlite-working')).WorkingStore)(path.join(f.root,'work'));}else{await db.writesIdle();db=new Database(db.file);}client=makeClient();service.client=client;await service.retry(f.op.databaseId);await service.flush(f.op.databaseId);
 assert.equal((await f.stats()).distanceM,lapCount*20);assert.equal(new Store(f.file).data.timing.audit.length,1);if(lapCount>2)assert(routes.some(r=>r.endsWith('/commit')),'Actual Timing resumable upload used');
 const saved=await client.deliverySnapshot(row.key);assert.equal(saved.status,'sent');
 if(working){const lap=working.lapsFor(id)[0];working.command({id:'eligibility',type:'setRecordEligibility',sessionId:id,expectedRevision:working.revision('sessions',id),edits:[{lapId:lap.id,flags:{noTrackRecord:true}}]});}else{db.update('laps',db.data.laps.find(l=>l.sessionId===id).id,{noTrackRecord:true});await db.saved();}
 await service.flush(f.op.databaseId);assert.equal((await f.stats()).trackRecordLaps,lapCount-1);assert.equal((await f.stats()).bestTrackLapMs,lapCount===2?11000:10000);assert.equal((await f.stats()).bestPersonalLapMs,10000);
 if(working)working.command({id:'withdraw',type:'deleteSession',sessionId:id,expectedRevision:working.revision('sessions',id)});else{db.removeSession(id);await db.saved();}
 const withdrawal=(await client.outbox(f.op.databaseId,{limit:200}))[0];await service.flush(f.op.databaseId);assert.equal((await f.stats()).distanceM,0);assert(routes.some(r=>r.startsWith(BASE+'/operations/')));
 const later=require(path.join(source,'tools/qa/rich-mapper-fixtures.cjs')).evidence();later.session.id='later-race';later.laps.forEach(l=>l.sessionId='later-race');
 if(working)working.command({id:'later-finalise',type:'finalizeSession',session:later.session,laps:later.laps});else await db.saveSessionAsync(later.session,later.laps);
 const pendingRow=(await client.outbox(f.op.databaseId,{status:'pending',limit:200}))[0],pending=await client.deliverySnapshot(pendingRow.key);
 await f.h.command('backup');await f.h.command('restore');await assert.rejects(service.flush(f.op.databaseId),{code:'RECOVERY_CHANGED'});
 const blocked=await client.deliverySnapshot(pendingRow.key);assert.equal(blocked.status,'attention');assert.deepEqual(blocked.guard,pending.guard);assert.deepEqual(blocked.payload,pending.payload);assert.equal((await f.stats()).distanceM,0);
});
