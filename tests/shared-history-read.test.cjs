'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history.cjs');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-write-')),file=path.join(root,'db.sqlite'),data=require('./support/timing-fixtures.cjs').fixtures();let store=new Store(file),host;store.replace(data.store.snapshot());
 const start=async()=>{host=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await host.start();assert.equal(host.error,'');};await start();
 const stop=async()=>{host.quiesce();await host.idle();host.close();};t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
 const request=async(route,body,headers={})=>{const r=await fetch('http://127.0.0.1:'+host.network.port+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json','X-SlotForge-Instance':host.instanceId,'X-SlotForge-Database':store.data.id,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};};
 const state=(await request('/v1/shared-history/status')).value;
 const input=(payload=data.normal,extra={})=>({version:1,databaseId:store.data.id,recoveryId:state.recoveryId,editor:{installationId:'timing-a',application:'SlotForge Timing',name:'Director'},operationId:'create-1',sourceId:payload.source.id,sessionId:payload.sessionId,reason:'Reviewed result',action:'create',expected:null,bundle:{format:'timing-v1',payload:structuredClone(payload)},...extra});
 return {data,file,state,request,input,get store(){return store;},get host(){return host;},post:op=>request('/v1/shared-history/operations',op),lookup:(op)=>request('/v1/shared-history/operations/'+op.editor.installationId+'/'+op.operationId+'?recoveryId='+op.recoveryId),async restart(){await stop();store=await Store.open(file);await start();}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
const ROOT='/v1/shared-history',READ=ROOT+'/sessions',HEAD=READ+'/timing-demo/session-normal',STATS=ROOT+'/cars/car-a/statistics';
const schema={$defs:require('../src/shared-history-schema.cjs').reads};
function conforms(value,name){require('../src/timing-schema.cjs').validate(value,schema.$defs[name]);return value;}
test('chronological pages are filtered, signed and snapshot bound',async t=>{
 const f=await fixture(t);for(const payload of [f.data.normal,f.data.multi,f.data.endurance])ok(await f.post(f.input(payload,{operationId:payload.sessionId})));
 const first=conforms(ok(await f.request(READ+'?limit=1')),'list');assert.equal(first.entries[0].sessionId,'session-endurance');assert.ok(first.nextPage);
 const second=ok(await f.request(READ+'?limit=1&page='+first.nextPage));assert.equal(second.entries[0].sessionId,'session-multi');const third=ok(await f.request(READ+'?limit=1&page='+second.nextPage));assert.equal(third.entries[0].sessionId,'session-normal');assert.equal(third.nextPage,null);
 for(const suffix of ['?page='+first.nextPage,'?limit=1&page='+first.nextPage.replace(/.$/,'z'),'?trackId=track-1','?state=bad','?limit=0','?q=a&q=b','?from=2026-02-30T10:00:00Z','?from=2027-01-01T00:00:00Z&to=2026-01-01T00:00:00Z'])assert.equal((await f.request(READ+suffix)).status,400,suffix);
 assert.equal(ok(await f.request(READ+'?q=TWO%20CARS')).entries.length,1);assert.equal(ok(await f.request(READ+'?q=%25')).entries.length,0);
 assert.equal(ok(await f.request(READ+'?carId=car-b')).entries.length,1);assert.equal(ok(await f.request(READ+'?sourceId=timing-demo&trackId=track-1&from=2026-10-31T10:01:00Z&to=2026-10-31T10:02:00Z')).entries.length,3);
 const old=f.store.data.cars[0];f.store.mutate('car.save',{id:old.id,revision:old.revision,data:{name:'Renamed'}});assert.equal((await f.request(READ+'?limit=1&page='+first.nextPage)).value.code,'SNAPSHOT_CHANGED');
});
test('head and laps reconstruct exactly and reject mixed revisions',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input())),head=conforms(ok(await f.request(HEAD)),'head');
 const laps=conforms(ok(await f.request(HEAD+'/laps/entry-1?token='+head.resultToken)),'laps');head.body.payload.participants[0].laps=laps.laps;assert.deepEqual(head.body.payload,f.data.normal);assert.equal(laps.nextOffset,null);
 const old=f.store.data.cars[0];f.store.mutate('car.archive',{id:old.id,revision:old.revision});assert.equal(ok(await f.request(HEAD)).resultToken,head.resultToken);
 assert.equal((await f.request(HEAD+'/laps/entry-1')).value.code,'TOKEN_REQUIRED');assert.equal((await f.request(HEAD+'/laps/entry-1?token='+head.resultToken+'&offset=4')).value.code,'INVALID_PAGE');
 ok(await f.post(f.input(f.data.correction,{operationId:'edit',action:'replace',expected:first.accepted})));assert.equal((await f.request(HEAD+'/laps/entry-1?token='+head.resultToken)).value.code,'RESULT_CHANGED');assert.equal((await f.request(READ+'/timing-demo/missing')).value.code,'SESSION_NOT_FOUND');
});
test('withdrawals retain searchable metadata and remove active contributions',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input()));const op={...f.input(),operationId:'withdraw',action:'withdraw',expected:first.accepted,withdrawalReason:'Review'};delete op.bundle;ok(await f.post(op));await f.restart();
 const list=ok(await f.request(READ+'?state=withdrawn&sourceId=timing-demo&trackId=track-1&from=2026-01-01T00:00:00Z'));assert.equal(list.entries.length,1);assert.equal(list.entries[0].startedAt,f.data.normal.startedAt);assert.equal(list.entries[0].name,f.data.normal.name);
 const head=conforms(ok(await f.request(HEAD)),'head');assert.equal(head.body,null);assert.deepEqual(head.lapCounts,[]);assert.equal((await f.request(HEAD+'/laps/entry-1?token='+head.resultToken)).value.code,'SESSION_WITHDRAWN');
 const stats=conforms(ok(await f.request(STATS)),'statistics');assert.equal(stats.measuredLaps,0);assert.equal(stats.overallWins,0);assert.equal(stats.averageLapMs,null);
 const snap=f.store.snapshot();delete snap.timing.sessions[0].lastActive;f.store.replace(snap);assert.equal(ok(await f.request(READ)).entries[0].startedAt,null);assert.equal(ok(await f.request(READ+'?from=2026-01-01T00:00:00Z')).entries.length,0);
});
test('statistics separate physical distance, valid pace, scoped drivers and classification',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input()));let stats=conforms(ok(await f.request(STATS)),'statistics');
 assert.equal(stats.acceptedSessions,1);assert.equal(stats.measuredLaps,3);assert.equal(stats.validLaps,2);assert.equal(stats.measuredTimeMs,21000);assert.equal(stats.averageLapMs,10500);assert.equal(stats.distanceM,60);assert.equal(stats.personalRecordLaps,2);assert.equal(stats.trackRecordLaps,2);assert.equal(stats.bestPersonalLapMs,10000);assert.equal(stats.overallWins,1);assert.equal(stats.classWins,0);
 const changed=structuredClone(f.data.correction);changed.participants[0].laps[0].distanceM=null;ok(await f.post(f.input(changed,{operationId:'edit',action:'replace',expected:first.accepted})));
 stats=ok(await f.request(STATS));assert.equal(stats.validLaps,1);assert.equal(stats.measuredLaps,3);assert.equal(stats.bestPersonalLapMs,11000);assert.equal(stats.distanceM,40);assert.equal(stats.unknownDistanceLaps,1);assert.equal(stats.distanceComplete,false);
 assert.equal(ok(await f.request(STATS+'?lane=1')).overallWins,0);assert.equal(ok(await f.request(STATS+'?lane=2')).acceptedSessions,0);
 ok(await f.post(f.input(f.data.endurance,{operationId:'endurance'})));const driver=ok(await f.request(STATS+'?sourceId=timing-demo&sessionId=session-endurance&participantId=entry-1&driverId=driver-2'));assert.equal(driver.measuredLaps,1);assert.equal(driver.validLaps,0);assert.equal(driver.distanceM,20);assert.equal(driver.overallWins,0);
 for(const q of ['driverId=driver-1','sessionId=session-normal','lane=0','trackId=track-1','snapshot=wrong'])assert.notEqual((await f.request(STATS+'?'+q)).status,200,q);assert.equal((await f.request(ROOT+'/cars/missing/statistics')).value.code,'CAR_NOT_FOUND');
});
test('reads avoid full model loads, lap pages preserve order and restore invalidates tokens',async t=>{
 const f=await fixture(t),p=structuredClone(f.data.normal);p.endedAt='2026-10-31T11:01:00.000Z';p.heats[0].endedAtMs=3600000;p.participants[0].stints[0].endedAtMs=3600000;p.participants[0].laps=Array.from({length:501},(_,i)=>({...p.participants[0].laps[0],id:'lap-'+i,number:i+1,durationMs:1000,endedAtMs:(i+1)*1000}));ok(await f.post(f.input(p)));
 const store=new Store(f.file,{deferred:true});store.ensureLoaded=()=>{throw Error('Unexpected collection load');};const read=route=>require('../src/shared-history-read.cjs').read(store,'http://localhost'+route);
 const head=read(HEAD),a=read(HEAD+'/laps/entry-1?token='+head.resultToken),b=read(HEAD+'/laps/entry-1?token='+head.resultToken+'&offset='+a.nextOffset),c=read(HEAD+'/laps/entry-1?token='+head.resultToken+'&offset='+b.nextOffset);
 assert.deepEqual([...a.laps,...b.laps,...c.laps],p.participants[0].laps);assert.equal(c.nextOffset,null);assert.equal(read(STATS).measuredLaps,501);assert.equal(read(READ).entries.length,1);
 const saved=f.store.snapshot();await f.store.restoreAsync(saved,f.store.data.revision);assert.equal((await f.request(HEAD+'/laps/entry-1?token='+head.resultToken)).value.code,'RESULT_CHANGED');
});
test('virtual, unlinked and quarantined laps never contribute; manual records remain independent',async t=>{
 const f=await fixture(t),race={...structuredClone(f.data.multi),sessionId:'session-normal'};
 for(const [id,kind]of [['virtual','virtual'],['unlinked','physical']]){const p=structuredClone(race.participants[0]);p.id=id;p.kind=kind;p.carId=null;p.configuration=null;p.laps.forEach(l=>l.id=id+'-'+l.id);race.participants.push(p);}
 ok(await f.post(f.input(race)));assert.equal(ok(await f.request(STATS)).measuredLaps,4);
 const snap=f.store.snapshot(),r=snap.timing.sessions[0];r.payload.heats[1].startedAtMs=0;r.payload.participants[0].laps.at(-1).durationMs=50000;r.contentHash=T.digest(r.payload);delete r.guard;delete snap.timing.audit;f.store.replace(snap);
 const stats=ok(await f.request(STATS));assert.equal(stats.quarantinedSessions,1);assert.equal(stats.acceptedSessions,0);assert.equal(stats.measuredLaps,0);assert.equal(stats.overallWins,0);assert.equal(stats.manualIncluded,false);
 assert.equal(ok(await f.request(READ)).entries.length,1);const head=ok(await f.request(HEAD));assert.equal(ok(await f.request(HEAD+'/laps/entry-1?token='+head.resultToken)).laps.at(-1).durationMs,50000);
});
test('many sessions use bounded pages in date order, preserve source-scoped tracks and do not hydrate',async t=>{
 const f=await fixture(t),sample=new Store();sample.replace(f.data.store.snapshot());
 for(let i=0;i<120;i++){const p=structuredClone(f.data.normal);p.sessionId='s-'+String(i).padStart(3,'0');p.source.id=i%2?'source-a':'source-b';p.startedAt=new Date(Date.UTC(2026,10,1+i,10)).toISOString();p.endedAt=new Date(Date.parse(p.startedAt)+60000).toISOString();T.receive(sample,p);}
 f.store.replace(sample.snapshot());const store=new Store(f.file,{deferred:true});store.ensureLoaded=()=>{throw Error('Unexpected complete model');};const read=route=>require('../src/shared-history-read.cjs').read(store,'http://localhost'+route);
 const seen=[];let page=null;do{const result=conforms(read(READ+'?limit=50'+(page?'&page='+page:'')),'list');assert.ok(result.entries.length<=50);seen.push(...result.entries);page=result.nextPage;}while(page);
 assert.equal(seen.length,120);assert.equal(new Set(seen.map(s=>s.sessionId)).size,120);assert.equal(seen[0].sessionId,'s-119');assert.equal(seen.at(-1).sessionId,'s-000');
 const stats=read(STATS+'?sourceId=source-a&trackId=track-1');assert.equal(stats.acceptedSessions,60);assert.equal(stats.measuredLaps,180);assert.equal(stats.distanceM,3600);assert.equal(stats.overallWins,60);
 assert.equal(read(STATS+'?sourceId=other&trackId=track-1').acceptedSessions,0);
});
test('list snapshots work for aggregates and incompatible history stays disabled',async t=>{
 const f=await fixture(t),first=ok(await f.post(f.input())),list=ok(await f.request(READ)),stats=ok(await f.request(STATS+'?snapshot='+list.snapshot));assert.equal(stats.snapshot,list.snapshot);
 ok(await f.post(f.input(f.data.correction,{action:'replace',operationId:'change',expected:first.accepted})));assert.equal((await f.request(STATS+'?snapshot='+list.snapshot)).value.code,'SNAPSHOT_CHANGED');
 const capabilities=ok(await f.request(ROOT+'/status')).capability;assert.deepEqual(capabilities.formats,['timing-v1']);assert.equal(capabilities.features.historyReads,true);assert.equal(capabilities.features.statistics,true);assert.equal(capabilities.features.historicalImports,false);
 for(const path of [READ,HEAD,STATS]){assert.notEqual((await f.request(path,undefined,{Authorization:'Bearer bad'})).status,200);assert.notEqual((await f.request(path,undefined,{Origin:'null'})).status,200);}
});
