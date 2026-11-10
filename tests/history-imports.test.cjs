'use strict';
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),T=require('../src/timing-integration.cjs'),H=require('../src/shared-history.cjs');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-import-')),file=path.join(root,'db.sqlite'),data=require('./support/timing-fixtures.cjs').fixtures();let store=new Store(file),host;store.replace(data.store.snapshot());
 const start=async()=>{host=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await host.start();assert.equal(host.error,'');};await start();
 const stop=async()=>{host.quiesce();await host.idle();host.close();};t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
 const request=async(route,body,headers={})=>{const r=await fetch('http://127.0.0.1:'+host.network.port+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json','X-SlotForge-Instance':host.instanceId,'X-SlotForge-Database':store.data.id,...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,value:await r.json()};};
 const state=(await request('/v1/shared-history/status')).value;
 const input=(payload=data.normal,extra={})=>({version:1,databaseId:store.data.id,recoveryId:state.recoveryId,editor:{installationId:'timing-a',application:'SlotForge Timing',name:'Director'},operationId:'create-1',sourceId:payload.source.id,sessionId:payload.sessionId,reason:'Reviewed result',action:'create',expected:null,bundle:{format:'timing-v1',payload:structuredClone(payload)},...extra});
 return {data,file,state,request,input,get store(){return store;},get host(){return host;},post:op=>request('/v1/shared-history/operations',op),lookup:(op)=>request('/v1/shared-history/operations/'+op.editor.installationId+'/'+op.operationId+'?recoveryId='+op.recoveryId),async restart(){await stop();store=await Store.open(file);await start();}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};

const I=require('../src/history-imports.cjs'),Q=require('../src/sqlite-query.cjs');
const historical=()=>JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));
const batch=f=>({...historical(),databaseId:f.store.data.id,recoveryId:f.state.recoveryId});
const submit=(f,b)=>f.request('/v1/shared-history/imports',b);
const poll=(f,b)=>f.request('/v1/shared-history/imports/'+b.editor.installationId+'/'+b.operationId+'?recoveryId='+b.recoveryId);
const cancel=(f,b,items=b.items.map(i=>i.itemId))=>f.request('/v1/shared-history/imports/'+b.editor.installationId+'/'+b.operationId+'/cancel',{version:1,databaseId:b.databaseId,recoveryId:b.recoveryId,operationId:b.operationId,itemIds:items});
const view=f=>require('../src/view-query.cjs').view(f.store,{page:'Review',reviewTab:'Historical imports'})._view.historyImports;
const decide=(f,row,action='reject',note='Insufficient evidence')=>require('../src/domain-tasks.cjs').run(f.store,{kind:'history-import',action:'review',input:{databaseId:f.store.data.id,recoveryId:H.status(f.store).recoveryId,id:row.id,requestHash:row.requestHash,action,note}});
test('historical intake is durable, isolated, idempotent and visible in Review',async t=>{
 const f=await fixture(t),b=batch(f),before=H.status(f.store);const replies=await Promise.all([submit(f,b),submit(f,b)]);replies.forEach(ok);assert.deepEqual(replies[0].value,replies[1].value);
 assert.equal(replies[0].value.items[0].status,'pending');assert.equal(f.store.data.timing.sessions.length,0);assert.equal(view(f).total,1);assert.equal(view(f).rows[0].summary.name,b.items[0].bundle.race.name);
 assert.equal(H.status(f.store).capability.features.historicalReview,true);assert.equal(H.status(f.store).capability.features.historicalImports,false);
 const revision=f.store.data.revision;ok(await submit(f,b));assert.equal(f.store.data.revision,revision);await f.restart();assert.deepEqual(ok(await poll(f,b)),replies[0].value);
 assert.equal((await submit(f,{...b,items:[{...b.items[0],originHash:'f'.repeat(64)}]})).value.code,'OPERATION_CONFLICT');
 const inspected=await decide(f,view(f).rows[0],'inspect');assert.equal(inspected.item.bundle.race.participants[0].lapCount,3);assert.equal(inspected.status,'pending');
 assert.deepEqual(ok(await f.request('/v1/shared-history/sessions')).entries,[]);
});
test('rejection, cancellation and stale decisions persist independently per item',async t=>{
 const f=await fixture(t),b=batch(f);b.items.push({...structuredClone(b.items[0]),itemId:'item-2',sessionId:'other'});ok(await submit(f,b));const rows=view(f).rows;
 await assert.rejects(decide(f,rows[0],'approve'),e=>e.apiCode==='UNSUPPORTED_COVERAGE');assert.equal(view(f).total,2);
 await decide(f,rows[0]);assert.equal((await decide(f,rows[0])).duplicate,true);await assert.rejects(decide(f,rows[0],'reject','changed note'),e=>e.apiCode==='REVISION_CONFLICT');
 const receipt=ok(await cancel(f,b));assert.deepEqual(receipt.items.map(i=>i.status).sort(),['cancelled','rejected']);assert.equal(view(f).total,0);
 assert.deepEqual(ok(await cancel(f,b)),receipt);assert.deepEqual(ok(await submit(f,b)),receipt);await f.restart();assert.deepEqual(ok(await poll(f,b)),receipt);
 assert.equal((await cancel(f,b,['missing'])).value.code,'INVALID_PAYLOAD');assert.equal(f.store.data.timing.sessions.length,0);
});
test('duplicate identities conflict without guessing from names or origin hashes',async t=>{
 const f=await fixture(t),b=batch(f);ok(await submit(f,b));const duplicate={...b,operationId:'second'};assert.equal(ok(await submit(f,duplicate)).items[0].status,'conflict');
 const accepted={...b,operationId:'accepted',items:[{...b.items[0],sourceId:f.data.normal.source.id,sessionId:f.data.normal.sessionId}]};ok(await f.request('/v1/timing/sessions',f.data.normal));const result=ok(await submit(f,accepted)).items[0];assert.equal(result.status,'conflict');assert.equal(result.accepted.contentHash,T.digest(f.data.normal));assert.deepEqual(ok(await poll(f,accepted)).items[0],result);assert.equal(f.store.data.timing.sessions.length,1);
 const sameName={...b,operationId:'new-identity',items:[{...b.items[0],sessionId:'different-identity'}]};assert.equal(ok(await submit(f,sameName)).items[0].status,'pending');
 const changed={...b,operationId:'duplicate-items',items:[b.items[0],{...b.items[0],itemId:'other-item'}]};assert.equal((await submit(f,changed)).value.code,'INVALID_PAYLOAD');
});
test('restore blocks old requests while retained evidence remains inspectable and rejectable',async t=>{
 const f=await fixture(t),b=batch(f);ok(await submit(f,b));const retained=f.store.snapshot();await f.store.restoreAsync(retained,f.store.data.revision);await f.restart();
 for(const result of [await submit(f,b),await poll(f,b),await cancel(f,b)])assert.equal(result.value.code,'RECOVERY_CHANGED');
 const row=view(f).rows[0];assert.equal(row.recoveryChanged,true);const blocked={...b,operationId:'after-restore',recoveryId:H.status(f.store).recoveryId};assert.equal(ok(await submit(f,blocked)).items[0].status,'conflict');await decide(f,row);assert.equal(view(f).total,0);
 const fresh={...b,recoveryId:H.status(f.store).recoveryId};assert.equal(ok(await submit(f,fresh)).items[0].status,'pending');assert.equal(view(f).count,3);
});
test('pending imports cannot alter legacy Timing or Telemetry results',async t=>{
 const f=await fixture(t);ok(await f.request('/v1/timing/sessions',f.data.normal));const snapshot=ok(await f.request('/v1/telemetry/results')).snapshot;const before=ok(await f.request('/v1/telemetry/results/timing-demo/session-normal?snapshot='+snapshot));
 ok(await submit(f,batch(f)));const after=ok(await f.request('/v1/telemetry/results/timing-demo/session-normal?snapshot='+snapshot));assert.deepEqual(after.payload,before.payload);assert.deepEqual(after.receipt,before.receipt);
 ok(await f.request('/v1/timing/sessions',f.data.correction));assert.equal(f.store.data.timing.sessions[0].payload.revision,2);assert.equal(view(f).total,1);
});
test('historical intake rejects malformed, unsupported, oversized and inconsistent evidence',async t=>{
 const f=await fixture(t),base=batch(f);
 const cases=[b=>b.databaseId='wrong',b=>b.recoveryId='old',b=>b.items=[],b=>b.items[0].bundle.context.scoringSnapshot={secret:'not allowed'},b=>b.items[0].bundle.race.participants[0].laps[0].durationMs=-1,b=>b.items[0].bundle.race.participants[0].laps[0].lane=64,b=>b.items[0].bundle.race.participants[0].laps[0].personalRecordEligible=true,b=>b.items[0].bundle.race.participants[0].kind='virtual',b=>b.items[0].bundle.provenance.kind='measured',b=>b.items[0].bundle.race.participants[0].laps.push(b.items[0].bundle.race.participants[0].laps[0])];
 for(const edit of cases){const b=structuredClone(base);edit(b);assert.notEqual((await submit(f,b)).status,200);}
 assert.equal((await submit(f,JSON.stringify(base).replace('"version":1','"version":1,"version":1'))).value.code,'INVALID_PAYLOAD');
 assert.equal((await submit(f,' '.repeat(T.MAX_BYTES+1))).status,413);assert.equal(view(f).count,0);
 assert.equal((await f.request('/v1/shared-history/imports',base,{Authorization:'Bearer wrong'})).status,401);
 assert.equal((await f.request('/v1/shared-history/imports',base,{Origin:'http://example.test'})).status,403);
});
test('atomic batch failure leaves no partial review records',async t=>{
 const f=await fixture(t),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.file);db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON records WHEN NEW.bucket='[\"timing\",\"imports\"]' BEGIN SELECT RAISE(ABORT,'injected import failure'); END;");db.close();
 const b=batch(f),revision=f.store.data.revision;assert.equal((await submit(f,b)).status,503);assert.equal(view(f).count,0);assert.equal(f.store.data.revision,revision);assert.equal((await poll(f,b)).status,404);
 const clean=new DatabaseSync(f.file);clean.exec('DROP TRIGGER fail_import');clean.close();ok(await submit(f,b));
});
test('paged review and receipt polling do not hydrate large lap evidence',async t=>{
 const f=await fixture(t),b=batch(f),p=b.items[0].bundle.race.participants[0];p.laps=Array.from({length:12000},(_,i)=>({...p.laps[0],id:'lap-'+i,number:i+1}));ok(await submit(f,b));
 const many={...batch(f),operationId:'many',items:Array.from({length:25},(_,i)=>({...structuredClone(batch(f).items[0]),itemId:'item-'+i,sessionId:'session-'+i}))};ok(await submit(f,many));
 Q.read(f.store,null,r=>{r.record=()=>{throw Error('List tried to hydrate historical evidence');};const first=I.inbox(r,0),last=I.inbox(r,20);assert.equal(first.total,26);assert.equal(first.rows.length,20);assert.equal(last.rows.length,6);assert.equal(new Set([...first.rows,...last.rows].map(x=>x.id)).size,26);});
 const before=f.store.deferredState.loaded;ok(await poll(f,b));assert.equal(f.store.deferredState.loaded,before);
 const row=view(f).rows.find(r=>r.batch.operationId==='many');await decide(f,row);assert.equal(view(f).total,25);assert.equal(ok(await poll(f,b)).items[0].status,'pending');
 const snapshot=f.store.snapshot(),broken=structuredClone(snapshot);broken.timing.imports[0].item.bundle.race.name='tampered';assert.throws(()=>require('../src/store.cjs').validateDatabase(broken),/hash|summary/);const incomplete=structuredClone(snapshot);incomplete.timing.imports.pop();assert.throws(()=>require('../src/store.cjs').validateDatabase(incomplete),/Incomplete/);
});
test('review resolves renamed, archived and missing cars without redirecting evidence',async t=>{
 const f=await fixture(t),b=batch(f);ok(await submit(f,b));let row=view(f).rows[0];
 const revision=()=>Q.read(f.store,null,r=>r.one('cars','car-a').revision).value;
 await f.store.mutateAsync('car.save',{id:'car-a',revision:revision(),data:{name:'Renamed original'}},{snapshot:false});await f.store.mutateAsync('car.archive',{id:'car-a',revision:revision()},{snapshot:false});
 const inspected=await decide(f,row,'inspect');assert.equal(inspected.item.bundle.race.participants[0].linkedCar.name,'Renamed original');assert.equal(inspected.item.bundle.race.participants[0].linkedCar.archived,1);assert.equal(inspected.item.bundle.race.participants[0].displayName,'Example GT3');
 const unknown={...b,operationId:'missing-car',items:[{...structuredClone(b.items[0]),sessionId:'missing-car-session'}]};unknown.items[0].bundle.race.participants[0].carId='missing';ok(await submit(f,unknown));row=view(f).rows.find(r=>r.batch.operationId==='missing-car');assert.equal((await decide(f,row,'inspect')).item.bundle.race.participants[0].linkedCar,null);
});
