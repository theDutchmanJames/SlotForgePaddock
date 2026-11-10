const nodeTest=require('node:test'),assert=require('node:assert/strict');
const test=(name,fn)=>nodeTest(name,{timeout:10000},fn);
const {fixtures}=require('./support/timing-fixtures.cjs');
const timing=require('../src/timing-integration.cjs'),{Network}=require('../src/network.cjs');
test('Telemetry reads complete results without private database fields and follows corrections/withdrawals',async t=>{
 const f=fixtures(),host=new Network(f.store);timing.receive(f.store,f.normal);await host.start();t.after(()=>host.stop());
 const get=async(route,{code=host.timingCode,method='GET',database=f.store.data.id,origin}={})=>{const r=await fetch('http://127.0.0.1:'+host.port+route,{method,headers:{Authorization:'Bearer '+code,'X-SlotForge-Database':database,...(origin?{Origin:origin}:{})}});return {status:r.status,body:await r.json()};};
 const status=await get('/v1/status');assert.equal(status.body.capabilities.telemetry.version,1);require('../src/timing-schema.cjs').validate(status.body,require('../src/timing-schema.cjs').schema.$defs.status);
 assert.equal((await get('/v1/telemetry/results',{code:host.browseCode})).status,403);
 assert.equal((await get('/v1/telemetry/results',{database:'another'})).status,409);
 assert.equal((await get('/v1/telemetry/results',{origin:'null'})).status,403);
 assert.equal((await get('/v1/telemetry/results',{method:'POST'})).status,404);
 const index=await get('/v1/telemetry/results');assert.equal(index.body.entries.length,1);
 const route='/v1/telemetry/results/timing-demo/session-normal?revision='+index.body.databaseRevision;
 const record=await get(route);assert.deepEqual(record.body.payload,f.normal);assert.equal(record.body.receipt.summaries[0].statistics.bestLapMs,10000);
 assert.equal(JSON.stringify(record.body).includes('private ownership note'),false);assert.equal(JSON.stringify(record.body).includes('private technical note'),false);assert.equal(JSON.stringify(record.body).includes(f.store.data.timing.key),false);
 timing.receive(f.store,f.correction);assert.equal((await get(route)).status,409);
 timing.receive(f.store,f.withdrawal);const latest=await get('/v1/telemetry/results');assert.equal(latest.body.entries[0].state,'withdrawn');assert.equal(latest.body.entries[0].revision,3);
 assert.equal((await get('/v1/telemetry/results?offset=1')).status,400);
});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),telemetry=require('../src/telemetry-export.cjs'),contract=require('../src/timing-schema.cjs');
async function setup(t,{dealership=false}={}){
 const f=fixtures(),network=new Network(f.store);let club;
 if(dealership){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-telemetry-'));club=new (require('../src/club.cjs').Club)(f.store,network,dir);club.enable('Telemetry test','race');t.after(()=>{club.close();fs.rmSync(dir,{recursive:true,force:true});});}
 await network.start();t.after(()=>network.stop());
 const url=route=>'http://127.0.0.1:'+network.port+route;
 const headers=(options={})=>({Authorization:'Bearer '+(options.code??(dealership?'race':network.timingCode)),'X-SlotForge-Database':options.database??f.store.data.id,...options.headers});
 const get=async(route,options={})=>{const r=await fetch(url(route),{method:options.method||'GET',headers:headers(options)});return {status:r.status,body:await r.json()};};
 return {...f,network,club,url,headers,get};
}
const route='/v1/telemetry/results';
const itemRoute='/v1/telemetry/results/timing-demo/session-normal';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function stream(h,t,options={}){
 const abort=new AbortController();t.after(()=>abort.abort());
 const response=await fetch(h.url('/v1/telemetry/events'),{headers:h.headers(options),signal:abort.signal});assert.equal(response.status,200);
 const reader=response.body.getReader();let buffer='';
 const next=async()=>{while(true){const i=buffer.indexOf('\n\n');if(i>=0){const frame=buffer.slice(0,i);buffer=buffer.slice(i+2);if(frame.startsWith('data: '))return JSON.parse(frame.slice(6));continue;}const {done,value}=await reader.read();if(done)return null;buffer+=Buffer.from(value).toString('utf8');}};
 return {next,abort};
}

test('Dealership shared password reads Telemetry; all endpoints enforce identity, origin, access and GET',async t=>{
 const h=await setup(t,{dealership:true});timing.receive(h.store,h.normal);
 const status=await h.get('/v1/status');assert.equal(status.body.capabilities.telemetry.events,'/v1/telemetry/events');contract.validate(status.body,contract.schema.$defs.status);
 for(const endpoint of [route,'/v1/telemetry/status','/v1/telemetry/events','/v1/telemetry/changes?since=test&wait=0',itemRoute+'?revision='+h.store.data.revision]){
  assert.equal((await h.get(endpoint,{code:'wrong'})).status,401);
  assert.equal((await h.get(endpoint,{database:''})).body.code,'DATABASE_REQUIRED');
  assert.equal((await h.get(endpoint,{database:'elsewhere'})).body.code,'DATABASE_MISMATCH');
  assert.equal((await h.get(endpoint,{headers:{Origin:'null'}})).status,403);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await h.get(endpoint,{method})).status,404);
 }
 assert.equal((await h.get(route)).status,200);assert.equal((await h.get('/v1/telemetry/status')).status,200);
 const s=await stream(h,t);contract.validate(await s.next(),contract.schema.$defs.telemetryEvent);
 h.club.setPassword('new race');assert.equal(await s.next(),null);assert.equal((await h.get(route)).status,401);assert.equal((await h.get(route,{code:'new race'})).status,200);
});

test('stable snapshot survives unrelated edits, detects corrections and preserves captured configurations',async t=>{
 const h=await setup(t);timing.receive(h.store,h.normal);const first=(await h.get(route)).body;
 contract.validate(first,contract.schema.$defs.telemetryIndex);assert.equal(first.entries[0].track.sourceId,'timing-demo');assert.deepEqual(first.entries[0].carIds,['car-a']);
 h.store.mutate('car.save',{id:'car-a',revision:h.store.data.cars[0].revision,data:{name:'Renamed',technical:{gear:'30'},privateNotes:'Do not disclose'}});
 assert.equal((await h.get('/v1/telemetry/status')).body.snapshot,first.snapshot);
 assert.equal((await h.get(itemRoute+'?revision='+first.databaseRevision)).body.code,'SNAPSHOT_CHANGED');
 const fetched=(await h.get(itemRoute+'?snapshot='+first.snapshot)).body;contract.validate(fetched,contract.schema.$defs.telemetryResult);assert.equal(fetched.payload.participants[0].configuration.technical.gear,'27');assert.equal(JSON.stringify(fetched).includes('Do not disclose'),false);
 timing.receive(h.store,h.correction);assert.equal((await h.get(itemRoute+'?snapshot='+first.snapshot)).status,409);
 const current=(await h.get(route)).body;assert.notEqual(current.snapshot,first.snapshot);assert.notEqual(current.entries[0].resultHash,first.entries[0].resultHash);
 const duplicate=timing.receive(h.store,h.correction);assert.equal(duplicate.duplicate,true);assert.equal((await h.get(route)).body.snapshot,current.snapshot);
 timing.receive(h.store,h.withdrawal);const withdrawn=(await h.get(route)).body;const result=(await h.get(itemRoute+'?snapshot='+withdrawn.snapshot)).body;
 assert.equal(result.payload.state,'withdrawn');assert.deepEqual(result.receipt.summaries,[]);assert.equal(result.payload.participants,undefined);
});

test('filtered browsing scopes tracks to their source and always retains withdrawal notices',async t=>{
 const h=await setup(t);for(const p of [h.normal,h.multi,h.endurance])timing.receive(h.store,p);
 const other=structuredClone(h.normal);other.source.id='another-source';other.sessionId='another-race';timing.receive(h.store,other);
 assert.equal((await h.get(route+'?carId=car-b')).body.entries.length,1);
 assert.equal((await h.get(route+'?sourceId=timing-demo&trackId=track-1')).body.entries.length,3);
 assert.equal((await h.get(route+'?trackId=track-1')).body.entries.length,4);
 assert.equal((await h.get(route+'?from=2027-01-01T00:00:00.000Z')).body.entries.length,0);
 assert.equal((await h.get(route+'?from=2026-10-31T10:01:00.000Z&to=2026-10-31T10:01:00.001Z')).body.entries.length,4);
 assert.equal((await h.get(route+'?from=2026-10-31T10:01:00.000Z&to=2026-10-31T10:01:00.000Z')).body.entries.length,0);
 timing.receive(h.store,h.withdrawal);
 const filtered=(await h.get(route+'?carId=car-b&sourceId=another-source&from=2027-01-01T00:00:00.000Z')).body;assert.deepEqual(filtered.entries.map(e=>e.state),['withdrawn']);
 for(const query of ['carId=','from=2026-02-30T00:00:00.000Z','from=tomorrow','from=2027-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z','offset=-1','offset=0.5','offset=9007199254740992','offset=1','offset=','snapshot=no','revision=NaN','unknown=1','carId=car-a&carId=car-b'])assert.equal((await h.get(route+'?'+query)).status,400,query);
 assert.equal((await h.get(itemRoute)).body.code,'REVISION_REQUIRED');
 assert.equal((await h.get('/v1/telemetry/results/timing-demo/missing?snapshot='+filtered.snapshot)).status,404);
});

test('pagination is bounded and pinned; client sees no duplicated or omitted sessions',async t=>{
 const h=await setup(t);
 for(let i=0;i<103;i++){const p=structuredClone(h.normal);p.sessionId='session-'+i;timing.receive(h.store,p);}
 const first=(await h.get(route)).body;assert.equal(first.entries.length,100);assert.equal(first.nextOffset,100);
 const second=(await h.get(route+'?offset=100&snapshot='+first.snapshot)).body;assert.equal(second.entries.length,3);assert.equal(second.nextOffset,null);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.sessionId)).size,103);
 assert.equal((await h.get(route+'?offset=104&snapshot='+first.snapshot)).status,400);
 timing.receive(h.store,h.normal);assert.equal((await h.get(route+'?offset=100&snapshot='+first.snapshot)).status,409);
});

test('large withdrawal metadata also respects response byte budget',()=>{
 const f=fixtures();timing.receive(f.store,f.withdrawal);
 const record=f.store.data.timing.sessions[0];record.carIds=Array.from({length:10000},(_,i)=>'car-'+String(i).padStart(95,'x'));
 f.store.data.timing.sessions=Array.from({length:3},(_,i)=>({...record,payload:{...record.payload,sessionId:'withdrawal-'+i}}));
 const page=telemetry.handle(f.store.data,'GET',new URL('http://localhost'+route),{timingResults:true},f.store.data.id);
 assert.equal(page.entries.length,1);assert.equal(page.nextOffset,1);assert.ok(Buffer.byteLength(JSON.stringify(page))<2*1024*1024);
});

test('HTTP notifications are quiet on private edits and include only tokens on result changes',async t=>{
 const h=await setup(t),s=await stream(h,t);const initial=await s.next();
 let delivered=false;const pending=s.next().then(value=>{delivered=true;return value;});
 h.store.transact(db=>{db.cars[0].privateNotes='Quiet private edit';});await tick();await tick();assert.equal(delivered,false);
 timing.receive(h.store,h.normal);const changed=await pending;assert.notEqual(changed.snapshot,initial.snapshot);assert.deepEqual(Object.keys(changed).sort(),['databaseId','snapshot','version']);
 const before=changed.snapshot;timing.receive(h.store,h.correction);assert.notEqual((await s.next()).snapshot,before);
 h.network.controls({access:'timing',password:'new password'});assert.equal(await s.next(),null);
});

test('streams close on database replacement and hosting stop; subscriptions do not accumulate',async t=>{
 // Hosting owns separate legacy Telemetry and optional scalable stream subscriptions.
 const h=await setup(t),baseline=h.store.listeners.size,s=await stream(h,t);await s.next();
 h.store.replace(new Store().data);assert.equal(await s.next(),null);
 const again=await stream(h,t);await again.next();await h.network.stop();assert.equal(await again.next(),null);assert.equal(h.store.listeners.size,baseline-2);
 await h.network.start();assert.equal(h.store.listeners.size,baseline);await h.network.stop();assert.equal(h.store.listeners.size,baseline-2);
});

test('stream limits and backpressure do not allow unbounded buffering',async t=>{
 const h=await setup(t);for(let i=0;i<10;i++){const s=await stream(h,t);await s.next();}
 const rejected=await h.get('/v1/telemetry/events');assert.equal(rejected.status,429);assert.equal(rejected.body.code,'STREAM_LIMIT');
 let destroyed=false,written=false;h.network.telemetryEvents.write({databaseId:h.store.data.id,code:h.network.timingCode,res:{writableLength:20000,destroy(){destroyed=true;},write(){written=true;return true;}}},'test');assert.equal(destroyed,true);assert.equal(written,false);
});

test('restart, older/same-revision restores and removed sessions reconcile using content tokens',async t=>{
 const h=await setup(t);timing.receive(h.store,h.normal);const saved=h.store.snapshot(),before=(await h.get(route)).body;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-telemetry-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'db.json');fs.writeFileSync(file,JSON.stringify(saved));const reloaded=new Store(file);assert.equal(telemetry.manifest(reloaded.data).snapshot,before.snapshot);
 timing.receive(h.store,h.correction);const corrected=(await h.get(route)).body;
 saved.revision=h.store.data.revision;h.store.replace(saved);const restored=(await h.get(route)).body;assert.equal(restored.databaseRevision,corrected.databaseRevision);assert.equal(restored.snapshot,before.snapshot);assert.notEqual(restored.snapshot,corrected.snapshot);
 assert.equal((await h.get(itemRoute+'?snapshot='+corrected.snapshot)).status,409);
 h.store.transact(db=>{db.timing.sessions=[];});const removed=(await h.get(route)).body;assert.equal(removed.entries.length,0);assert.notEqual(removed.snapshot,restored.snapshot);
});

test('multi-heat, endurance, invalid/pit laps and virtual entries retain exact measured data',async t=>{
 const h=await setup(t);for(const payload of [h.multi,h.endurance])timing.receive(h.store,payload);
 const virtual=structuredClone(h.normal);virtual.sessionId='virtual';const p=structuredClone(virtual.participants[0]);p.id='rival';p.kind='virtual';p.carId=null;p.configuration=null;p.laps.forEach(l=>l.id='rival-'+l.id);virtual.participants.push(p);timing.receive(h.store,virtual);
 const index=(await h.get(route)).body;
 for(const payload of [h.multi,h.endurance,virtual]){
  const response=(await h.get(route+'/'+payload.source.id+'/'+payload.sessionId+'?snapshot='+index.snapshot)).body;
  assert.deepEqual(response.payload,payload);contract.validate(response,contract.schema.$defs.telemetryResult);
  assert.equal(JSON.stringify(response).includes(h.store.data.timing.key),false);
  if(payload===virtual){assert.equal(response.receipt.summaries[1].included,false);assert.equal(response.receipt.summaries[0].statistics.recordEligibleLaps,2);}
 }
 const before=h.store.snapshot();h.store.mutate('car.archive',{id:'car-a',revision:h.store.data.cars[0].revision});assert.equal((await h.get(route)).body.snapshot,index.snapshot);
 const result=(await h.get(route+'/timing-demo/session-multi?snapshot='+index.snapshot)).body;assert.deepEqual(result.payload,before.timing.sessions[0].payload);
});

test('published Telemetry fixtures and standalone schema match executable responses',()=>{
 const root=path.join(__dirname,'fixtures','contracts','telemetry-v1');
 const schema=JSON.parse(fs.readFileSync(path.join(root,'telemetry-v1.schema.json'),'utf8'));assert.deepEqual(schema.$defs,contract.schema.$defs);
 for(const file of fs.readdirSync(path.join(root,'fixtures'))){
  const data=JSON.parse(fs.readFileSync(path.join(root,'fixtures',file),'utf8'));
  const definition=file==='host-status.json'?'status':file==='change-event.json'?'telemetryEvent':file==='change-status.json'?'telemetryStatus':typeof data.changed==='boolean'?'telemetryChanges':data.code?'error':data.payload?'telemetryResult':'telemetryIndex';
  contract.validate(data,contract.schema.$defs[definition]);
  if(data.payload){assert.equal(timing.digest(data.payload),data.receipt.contentHash);timing.validatePayload(data.payload,{stored:true});}
 }
 const f=fixtures();assert.equal(telemetry.handle(f.store.data,'GET',new URL('http://localhost/v1/telemetry/status'),{timingResults:true},f.store.data.id).version,1);
});

test('historical results remain attached to their ID when a restored collection lacks the car',async t=>{
 const h=await setup(t);timing.receive(h.store,h.normal);h.store.transact(db=>{db.cars=db.cars.filter(c=>c.id!=='car-a');});
 const index=(await h.get(route+'?carId=car-a')).body;assert.deepEqual(index.entries[0].carIds,['car-a']);
 const result=(await h.get(itemRoute+'?snapshot='+index.snapshot)).body;assert.equal(result.payload.participants[0].carId,'car-a');assert.equal(result.payload.participants[0].configuration.carId,'car-a');
});

async function beginWait(h,query,options={}){
 const arrived=new Promise(resolve=>h.network.server.once('request',resolve));
 const response=h.get('/v1/telemetry/changes?'+query,options);await arrived;return {response};
}
test('completed Telemetry contract has summaries, token aliases and bounded long-poll catch-up',async t=>{
 const h=await setup(t),status=(await h.get('/v1/status')).body;
 assert.equal(status.capabilities.telemetry.changes,'/v1/telemetry/changes');assert.ok(status.capabilities.telemetry.filters.includes('trackId'));
 const initial=(await h.get(route)).body;assert.equal(initial.changeToken,initial.snapshot);
 const pending=await beginWait(h,'since='+initial.changeToken+'&wait=25');assert.equal(h.network.telemetryEvents.waiters.size,1);
 h.store.transact(db=>{db.cars[0].privateNotes='Does not wake result wait';});await tick();assert.equal(h.network.telemetryEvents.waiters.size,1);
 timing.receive(h.store,h.normal);const changed=await pending.response;assert.equal(changed.status,200);assert.equal(changed.body.changed,true);contract.validate(changed.body,contract.schema.$defs.telemetryChanges);assert.equal(h.network.telemetryEvents.waiters.size,0);
 const index=(await h.get(route)).body;assert.equal(index.changeToken,changed.body.changeToken);assert.equal(index.entries[0].summary.name,h.normal.name);assert.deepEqual(index.entries[0].summary.carIds,['car-a']);
 const unchanged=await h.get('/v1/telemetry/changes?since='+index.changeToken+'&wait=0');assert.equal(unchanged.body.changed,false);
 // A missed notification still catches up immediately from the completed import token.
 timing.receive(h.store,h.correction);assert.equal((await h.get('/v1/telemetry/changes?since='+index.changeToken+'&wait=25')).body.changed,true);
 const latest=(await h.get(route)).body;const timeout=await beginWait(h,'since='+latest.changeToken+'&wait=1');assert.equal(h.network.telemetryEvents.waiters.size,1);assert.equal((await timeout.response).body.changed,false);assert.equal(h.network.telemetryEvents.waiters.size,0);
 for(const query of ['','since=','since='+('x'.repeat(257)),'since=a&wait=-1','since=a&wait=26','since=a&wait=0.5','since=a&wait=','since=a&wait=NaN','since=a&since=b','since=a&extra=1'])assert.equal((await h.get('/v1/telemetry/changes?'+query)).status,400,query);
});

test('pending change waits are revoked on password or database changes and share the SSE limit',async t=>{
 const h=await setup(t,{dealership:true}),token=(await h.get(route)).body.changeToken;
 const revoked=await beginWait(h,'since='+token+'&wait=25');h.club.setPassword('replacement');assert.equal(h.network.telemetryEvents.waiters.size,0);assert.equal((await revoked.response).status,403);
 // Restore original password for this helper, then replace the database identity.
 h.club.setPassword('race');const wrong=await beginWait(h,'since='+token+'&wait=25');h.store.replace(new Store().data);assert.equal((await wrong.response).body.code,'DATABASE_MISMATCH');
});

test('closing connections releases long-poll timers and slots without waiting for timeout',async t=>{
 const h=await setup(t),token=(await h.get(route)).body.changeToken;
 const controller=new AbortController(),arrived=new Promise(resolve=>h.network.server.once('request',resolve));
 const pending=fetch(h.url('/v1/telemetry/changes?since='+token+'&wait=25'),{headers:h.headers(),signal:controller.signal}).catch(e=>e);
 await arrived;assert.equal(h.network.telemetryEvents.waiters.size,1);const waiter=[...h.network.telemetryEvents.waiters][0];
 const closed=new Promise(resolve=>waiter.res.once('close',resolve));controller.abort();await pending;await closed;
 assert.equal(h.network.telemetryEvents.waiters.size,0);assert.equal(waiter.closed,true);
 for(let i=0;i<10;i++){const s=await stream(h,t);await s.next();}
 const rejected=await h.get('/v1/telemetry/changes?since='+token+'&wait=25');assert.equal(rejected.status,429);
 h.network.controls({rotate:true});assert.equal(h.network.telemetryEvents.clients.size,0);
});

test('late notification callbacks never write after the response has ended',()=>{
 const {EventEmitter}=require('node:events');let wrote=false;
 const store={data:{id:'db'},subscribe(){return ()=>{};}},hub=new telemetry.Events({store,access(){return {timingResults:true};}});
 const res=Object.assign(new EventEmitter(),{writableEnded:true,destroyed:false,write(){wrote=true;throw Error('write after end');}});
 const client={res,databaseId:'db',code:'password'};hub.clients.add(client);hub.write(client,'data: late\n\n');assert.equal(wrote,false);assert.equal(hub.clients.size,0);
 hub.close();
});

test('failed persistence cannot notify Telemetry that unsaved results are available',async t=>{
 const h=await setup(t);timing.receive(h.store,h.normal);const token=(await h.get(route)).body.changeToken;
 const waiting=await beginWait(h,'since='+token+'&wait=25');
 const persist=h.store.persist;h.store.persist=()=>{throw Error('Disk is full');};
 assert.throws(()=>timing.receive(h.store,h.correction),e=>e.apiCode==='STORAGE_FAILED');await tick();
 assert.equal(h.network.telemetryEvents.waiters.size,1);assert.equal((await h.get(route)).body.changeToken,token);
 h.store.persist=persist;timing.receive(h.store,h.correction);assert.equal((await waiting.response).body.changed,true);
});
