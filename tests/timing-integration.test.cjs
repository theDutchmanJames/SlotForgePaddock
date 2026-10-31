const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Store,migrate,makePackage}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
const integration=require('../src/timing-integration.cjs'),contract=require('../src/timing-schema.cjs'),model=require('../renderer/timing-results-model.js');
const {fixtures}=require('./support/timing-fixtures.cjs');
const clone=structuredClone;
async function host(t){const f=fixtures(),network=new Network(f.store);await network.start();t.after(()=>network.stop());network.controls({allowTimingResults:true});const base='http://127.0.0.1:'+network.port;const request=async(route,body,options={})=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+(options.code??network.timingCode),'X-SlotForge-Database':f.store.data.id,'Content-Type':'application/json',...options.headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};return {...f,network,base,request};}
const send=(h,p,options)=>h.request('/v1/timing/sessions',p,options);
test('Timing API advertises version, limits, actual port and distinct permissions',async t=>{
  const h=await host(t);const status=await h.request('/v1/status');assert.equal(status.body.protocol,2);assert.deepEqual(status.body.capabilities.timing.versions,[1]);assert.equal(status.body.permissions.timingResults,true);assert.equal(status.body.permissions.submit,false);assert.ok(h.network.port>0);
  for(const code of [h.network.browseCode,h.network.code]){const r=await send(h,h.normal,{code});assert.equal(r.status,403);assert.equal(r.body.code,'TIMING_PERMISSION_REQUIRED');assert.equal((await h.request('/v1/timing/cars/car-a',undefined,{code})).status,200);}
  assert.equal((await send(h,h.normal,{code:'bad'})).body.code,'UNAUTHENTICATED');assert.equal((await send(h,h.normal,{headers:{Origin:'https://example.com'}})).body.code,'BROWSER_ORIGIN_FORBIDDEN');
  h.network.controls({allowTimingResults:false});assert.equal((await send(h,h.normal)).status,403);assert.equal((await h.request('/v1/collection')).status,200);
  const oldCode=h.network.timingCode;h.network.controls({rotate:true,allowTimingResults:true});assert.equal((await send(h,h.normal,{code:oldCode})).status,401);
  await h.network.stop();await h.network.start();assert.equal(h.network.status().allowTimingResults,false);
});
test('profile excludes private fields, preserves identity across renames, and captures historical configuration',async t=>{
  const h=await host(t),r=await h.request('/v1/timing/cars/car-a');assert.equal(r.status,200);contract.validate(r.body,contract.schema.$defs.profile);const serialized=JSON.stringify(r.body);assert.ok(!serialized.includes('private'));assert.equal(r.body.configuration.technical.technicalNotes,undefined);assert.equal(r.body.car.owner,undefined);
  const before=r.body.configuration;let car=h.store.data.cars[0];h.store.mutate('car.save',{id:car.id,revision:car.revision,data:{name:'Renamed'}});let next=(await h.request('/v1/timing/cars/car-a')).body;assert.equal(next.configuration.configurationId,before.configurationId);assert.equal(next.car.name,'Renamed');
  car=h.store.data.cars[0];h.store.mutate('car.save',{id:car.id,revision:car.revision,data:{technical:{gear:'30'}}});next=(await h.request('/v1/timing/cars/car-a')).body;assert.notEqual(next.configuration.configurationId,before.configurationId);
  h.normal.participants[0].configuration=before;assert.equal((await send(h,h.normal)).status,200);assert.equal(h.store.data.timing.sessions[0].payload.participants[0].configuration.technical.gear,'27');
});
test('database identity, media type, units, malformed JSON, version and unknown fields are explicit errors',async t=>{
  const h=await host(t);assert.equal((await send(h,h.normal,{headers:{'X-SlotForge-Database':''}})).body.code,'DATABASE_REQUIRED');assert.equal((await send(h,h.normal,{headers:{'X-SlotForge-Database':'other'}})).body.code,'DATABASE_MISMATCH');
  const other=clone(h.normal);other.databaseId='other';assert.equal((await send(h,other)).body.code,'DATABASE_MISMATCH');assert.equal((await send(h,'{')).body.code,'INVALID_JSON');
  assert.equal((await send(h,h.normal,{headers:{'Content-Type':'text/plain'}})).status,415);assert.equal((await send(h,h.normal,{headers:{'Content-Encoding':'gzip'}})).status,415);
  const bads=[p=>p.integrationVersion=2,p=>p.durationUnit='seconds',p=>p.participants[0].laps[0].durationMs='10',p=>p.participants[0].laps[0].durationMs=0.1,p=>p.track.lanes[0].lengthM=-2,p=>p.track.lanes[0].lane=0,p=>p.startedAt='2026-02-30T00:00:00.000Z',p=>p.startedAt='2026-10-31T10:01:00Z'];
  for(const change of bads){const p=clone(h.normal);change(p);assert.ok((await send(h,p)).status>=400);}assert.equal(h.store.data.timing.sessions.length,0);
});
test('oversized fixed and chunked bodies rejected before mutation',async t=>{
  const h=await host(t);const big=' '.repeat(integration.MAX_BYTES+1);assert.equal((await send(h,big)).status,413);
  const response=await new Promise((resolve,reject)=>{const req=http.request(h.base+'/v1/timing/sessions',{method:'POST',headers:{Authorization:'Bearer '+h.network.timingCode,'X-SlotForge-Database':h.store.data.id,'Content-Type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.write(big.slice(0,5000000));req.end(big.slice(5000000));});assert.equal(response.status,413);assert.equal(response.body.code,'PAYLOAD_TOO_LARGE');assert.equal(h.store.data.timing.sessions.length,0);
});
test('permission revocation during streamed upload prevents saving',async t=>{
  const h=await host(t),body=JSON.stringify(h.normal);
  const response=await new Promise((resolve,reject)=>{const req=http.request(h.base+'/v1/timing/sessions',{method:'POST',headers:{Authorization:'Bearer '+h.network.timingCode,'X-SlotForge-Database':h.store.data.id,'Content-Type':'application/json'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.write(body.slice(0,100));setTimeout(()=>{h.network.controls({allowTimingResults:false});req.end(body.slice(100));},30);});assert.equal(response.status,403);assert.equal(h.store.data.timing.sessions.length,0);
});
test('idempotent revisions, conflict, correction, withdrawal and stale retry cannot double count',async t=>{
  const h=await host(t);let r=await send(h,h.normal);assert.equal(r.status,200);contract.validate(r.body,contract.schema.$defs.receipt);const revision=h.store.data.revision;
  const ordered=Object.fromEntries(Object.entries(h.normal).reverse());r=await send(h,ordered);assert.equal(r.body.duplicate,true);assert.equal(h.store.data.revision,revision);
  const conflict=clone(h.normal);conflict.name='Conflicting';assert.equal((await send(h,conflict)).body.code,'REVISION_CONFLICT');
  r=await send(h,h.correction);assert.equal(r.status,200);assert.equal(r.body.summaries[0].statistics.validLaps,1);assert.equal(r.body.summaries[0].statistics.bestLapMs,11000);assert.equal(r.body.summaries[0].statistics.distanceM,60);assert.equal(model.aggregate(h.store.data.timing.sessions,'car-a').wins,1);
  assert.equal((await send(h,h.normal)).body.code,'STALE_REVISION');assert.equal((await send(h,h.withdrawal)).status,200);assert.equal(model.aggregate(h.store.data.timing.sessions,'car-a').sessions,0);assert.equal((await send(h,h.correction)).body.code,'STALE_REVISION');assert.equal((await send(h,h.withdrawal)).body.duplicate,true);assert.equal(h.store.data.timing.sessions.length,1);assert.equal(h.store.data.timing.sessions[0].history.length,2);
  assert.equal((await h.request('/v1/timing/sessions/timing-demo/session-normal')).body.state,'withdrawn');assert.equal((await h.request('/v1/timing/sessions/timing-demo/missing')).status,404);
});
test('withdrawal arriving first leaves a durable tombstone; explicit higher revision can reinstate',()=>{
  const f=fixtures();integration.receive(f.store,f.withdrawal);assert.throws(()=>integration.receive(f.store,f.normal),e=>e.apiCode==='STALE_REVISION');const restored=clone(f.normal);restored.revision=4;integration.receive(f.store,restored);assert.equal(model.aggregate(f.store.data.timing.sessions,'car-a').sessions,1);
});
test('multiple heats, cars and endurance drivers remain linked to captured configurations',()=>{
  const f=fixtures();for(const p of [f.multi,f.endurance])assert.equal(integration.receive(f.store,p).state,'active');assert.equal(model.aggregate(f.store.data.timing.sessions,'car-a').validLaps,5);assert.equal(model.aggregate(f.store.data.timing.sessions,'car-b').validLaps,3);assert.equal(f.store.data.timing.sessions[1].payload.participants[0].stints[1].driverId,'driver-2');
});
test('invalid and pit laps never set records; virtual and unlinked participants never add mileage',()=>{
  const f=fixtures(),p=f.normal.participants[0];p.laps[0].valid=false;p.laps[0].recordEligible=false;p.laps[0].distanceM=null;
  const virtual=clone(p);virtual.id='virtual';virtual.kind='virtual';virtual.carId=null;virtual.configuration=null;virtual.laps=virtual.laps.map(l=>({...l,id:'v-'+l.id}));f.normal.participants.push(virtual);
  const unlinked=clone(virtual);unlinked.id='unlinked';unlinked.kind='physical';unlinked.laps=unlinked.laps.map(l=>({...l,id:'u-'+l.id}));f.normal.participants.push(unlinked);
  const r=integration.receive(f.store,f.normal);assert.equal(r.summaries[0].statistics.bestLapMs,11000);assert.equal(r.summaries[0].statistics.distanceM,40);assert.equal(r.summaries[0].statistics.distanceComplete,false);for(const s of r.summaries.slice(1)){assert.equal(s.included,false);assert.equal(s.statistics.distanceM,0);assert.equal(s.statistics.bestLapMs,null);}
});
test('classification adjustments do not rewrite measured laps or record eligibility',()=>{
  const f=fixtures();f.normal.standings[0].classifiedLaps=100;f.normal.standings[0].classifiedElapsedMs=99999;f.normal.adjustments.push({participantId:'entry-1',kind:'time',amount:5000,reason:'Penalty already applied'});const s=integration.receive(f.store,f.normal).summaries[0].statistics;assert.equal(s.validLaps,2);assert.equal(s.measuredTimeMs,21000);assert.equal(s.bestLapMs,10000);assert.equal(s.wins,1);
});
test('missing cars reject atomically, archived cars accept explicitly and signatures cannot be changed',async t=>{
  const h=await host(t),car=h.store.data.cars[0];h.store.mutate('car.archive',{id:car.id,revision:car.revision});let r=await send(h,h.normal);assert.deepEqual(r.body.warnings,[{code:'CAR_ARCHIVED',carId:'car-a'}]);assert.equal((await h.request('/v1/timing/cars/car-a')).body.car.archived,true);
  const p=clone(h.multi);p.participants[1].carId='missing';assert.equal((await send(h,p)).body.code,'CAR_NOT_FOUND');assert.equal(h.store.data.timing.sessions.length,1);
  for(const change of [p=>p.participants[0].configuration.technical.gear='99',p=>p.participants[0].configuration.carId='car-b',p=>p.participants[0].configuration.signature='0'.repeat(64)]){const p=clone(h.correction);change(p);assert.equal((await send(h,p)).status,409);}
});
test('relational and semantic errors rejected, including virtual cars, overlaps and duplicate laps',()=>{
  const f=fixtures();for(const change of [p=>p.participants[0].kind='virtual',p=>p.participants[0].laps[2].recordEligible=true,p=>p.participants[0].laps.push(clone(p.participants[0].laps[0])),p=>p.participants[0].laps[1].stintId='missing',p=>p.participants[0].stints[0].lane=3,p=>p.participants[0].stints[0].driverId='missing',p=>p.participants[0].laps[1].endedAtMs=12000,p=>p.participants[0].stints.push({...p.participants[0].stints[0],id:'overlap'}),p=>p.standings[0].participantId='missing',p=>p.endedAt=p.startedAt,p=>p.heats.push(clone(p.heats[0])),p=>p.participants.push({...clone(p.participants[0]),id:'same-car'})]){const p=clone(f.normal);change(p);assert.throws(()=>integration.receive(f.store,p));}assert.equal(f.store.data.timing.sessions.length,0);
});
test('sessions and signed captures survive restart and backup; storage failure never acknowledges',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-timing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=fixtures();f.store.file=path.join(dir,'database.json');integration.receive(f.store,f.normal);let s=new Store(f.store.file);assert.equal(integration.receive(s,f.normal).duplicate,true);assert.equal(s.data.timing.sessions.length,1);integration.receive(s,f.withdrawal);s=new Store(f.store.file);assert.throws(()=>integration.receive(s,f.normal),e=>e.apiCode==='STALE_REVISION');assert.equal(integration.receive(s,f.withdrawal).duplicate,true);
  const restored=new Store();restored.restore(s.snapshot(),0);assert.equal(integration.receive(restored,f.withdrawal).duplicate,true);
  const failed=fixtures();const before=failed.store.snapshot();failed.store.persist=()=>{throw Object.assign(Error('disk full'),{code:'ENOSPC'});};assert.throws(()=>integration.receive(failed.store,failed.normal),e=>e.apiCode==='STORAGE_FAILED');assert.deepEqual(failed.store.snapshot(),before);
});
test('capture key persists before first profile, is stable after restart and rejects damaged backups',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.json'));s.mutate('car.save',{data:{name:'Car'}});const id=s.data.cars[0].id,p=integration.profile(s,id);const reopened=new Store(s.file);integration.verifyConfiguration(reopened.data,id,p.configuration);assert.equal(reopened.data.timing.key,s.data.timing.key);
  const bad=reopened.snapshot();bad.timing.key='broken';assert.throws(()=>migrate(bad));
});
test('legacy migration, manual records, private exports, submissions and inventory stay independent',async t=>{
  const h=await host(t),legacy=h.store.snapshot();legacy.schema=8;delete legacy.timing;assert.equal(migrate(legacy).schema,9);assert.equal(legacy.timing,undefined);
  h.store.mutate('test.add',{carId:'car-a',track:'Home',laps:'5',best:'9.5'});const before=h.store.snapshot();await send(h,h.normal);for(const field of ['tests','cars','parts','events','installations','jobs','supplies'])assert.deepEqual(h.store.data[field],before[field]);const pack=makePackage(h.store.data,['car-a']);assert.equal(pack.timing,undefined);const collection=(await h.request('/v1/collection')).body;assert.equal(collection.timing,undefined);assert.equal(collection.tests.length,0);
  const member=new Store();member.mutate('car.save',{data:{name:'Submitted car'}});const result=await h.request('/v1/submissions',makePackage(member.data,[member.data.cars[0].id]),{code:h.network.code});assert.equal(result.status,200);assert.equal(h.store.data.submissions[0].status,'pending');assert.equal(h.store.data.tests.length,1);
});
test('source scopes distinguish identical session and track names; correction removes old car contribution',()=>{
  const f=fixtures();integration.receive(f.store,f.normal);const other=clone(f.normal);other.source.id='timing-other';integration.receive(f.store,other);assert.equal(f.store.data.timing.sessions.length,2);const moved=clone(f.normal);moved.revision=2;moved.participants[0].carId='car-b';moved.participants[0].configuration=f.profiles[1].configuration;integration.receive(f.store,moved);assert.equal(model.aggregate(f.store.data.timing.sessions,'car-a').sessions,1);assert.equal(model.aggregate(f.store.data.timing.sessions,'car-b').sessions,1);assert.deepEqual(f.store.data.timing.sessions[0].carIds,['car-a','car-b']);
});
test('optional client summary is cross-checked, never trusted as accumulated totals',()=>{
  const f=fixtures();f.normal.participants[0].summary=model.statistics(f.normal,f.normal.participants[0]);integration.receive(f.store,f.normal);const bad=clone(f.normal);bad.revision=2;bad.participants[0].summary.distanceM=9999;assert.throws(()=>integration.receive(f.store,bad),e=>e.apiCode==='SUMMARY_MISMATCH');assert.equal(model.aggregate(f.store.data.timing.sessions,'car-a').distanceM,60);
});
test('simultaneous identical HTTP deliveries commit once; failure returns storage error and retry succeeds',async t=>{
  const h=await host(t);const before=h.store.data.revision;const replies=await Promise.all([send(h,h.normal),send(h,h.normal),send(h,h.normal)]);assert.equal(replies.filter(r=>r.body.duplicate===false).length,1);assert.equal(replies.filter(r=>r.body.duplicate===true).length,2);assert.equal(h.store.data.revision,before+1);
  const persist=h.store.persist;h.store.persist=()=>{throw Error('disk failed');};assert.equal((await send(h,h.correction)).body.code,'STORAGE_FAILED');assert.equal(h.store.data.timing.sessions[0].payload.revision,1);h.store.persist=persist;assert.equal((await send(h,h.correction)).status,200);
});
test('HTTP retry after server and store restart preserves session and withdrawal identity',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-restart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=fixtures();f.store.file=path.join(dir,'db.json');let network=new Network(f.store);t.after(()=>network.stop());await network.start();network.controls({allowTimingResults:true});
  const send=async payload=>{const r=await fetch('http://127.0.0.1:'+network.port+'/v1/timing/sessions',{method:'POST',headers:{Authorization:'Bearer '+network.timingCode,'X-SlotForge-Database':f.store.data.id,'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};};
  assert.equal((await send(f.normal)).body.duplicate,false);await network.stop();network=new Network(new Store(f.store.file));await network.start();network.controls({allowTimingResults:true});assert.equal((await send(f.normal)).body.duplicate,true);assert.equal((await send(f.withdrawal)).status,200);await network.stop();network=new Network(new Store(f.store.file));await network.start();network.controls({allowTimingResults:true});assert.equal((await send(f.normal)).body.code,'STALE_REVISION');
});
test('published schema, example requests and receipts match the executable contract',()=>{
  const root=path.join(__dirname,'..','integration-handoff','timing-v1'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
  assert.deepEqual(read('timing-v1.schema.json'),contract.schema);const s=new Store();s.data=migrate(read('fixtures/demo-database.json'));
  for(const file of ['profile-car-a','profile-car-b']){const p=read('fixtures/'+file+'.json');contract.validate(p,contract.schema.$defs.profile);integration.verifyConfiguration(s.data,p.car.id,p.configuration);}
  for(const file of ['normal','multi-heat','endurance','correction','withdrawal'])integration.receive(s,read('fixtures/'+file+'.json'));
  integration.validatePayload(read('fixtures/normal-with-summary.json'));
  for(const file of ['normal-response','correction-response','withdrawal-response','duplicate-response'])contract.validate(read('fixtures/'+file+'.json'),contract.schema.$defs.receipt);
  contract.validate(read('fixtures/status-response.json'),contract.schema.$defs.status);for(const file of ['conflict-response','stale-response'])contract.validate(read('fixtures/'+file+'.json'),contract.schema.$defs.error);
});
test('tampered backups cannot silently replace captured configurations or session hashes',()=>{
  const f=fixtures();integration.receive(f.store,f.normal);
  for(const mutate of [d=>d.timing.sessions[0].contentHash='0'.repeat(64),d=>d.timing.sessions.push(clone(d.timing.sessions[0])),d=>d.timing.key='2'.repeat(64),d=>d.timing.sessions[0].carIds=[],d=>d.timing.sessions[0].history.push({revision:1,state:'active',contentHash:'0'.repeat(64),receivedAt:new Date().toISOString()})]){const d=f.store.snapshot();mutate(d);assert.throws(()=>migrate(d));}
});
test('database replacement during upload cannot attach results to the replacement collection',async t=>{
  const h=await host(t),body=JSON.stringify(h.normal),databaseId=h.store.data.id;
  const result=await new Promise((resolve,reject)=>{const req=http.request(h.base+'/v1/timing/sessions',{method:'POST',headers:{Authorization:'Bearer '+h.network.timingCode,'X-SlotForge-Database':databaseId,'Content-Type':'application/json'}},res=>{let bytes='';res.on('data',c=>bytes+=c);res.on('end',()=>resolve({status:res.statusCode,...JSON.parse(bytes)}));});req.on('error',reject);req.write(body.slice(0,100));setTimeout(()=>{h.store.data=new Store().data;req.end(body.slice(100));},30);});assert.equal(result.status,409);assert.equal(result.code,'DATABASE_MISMATCH');assert.equal(h.store.data.timing.sessions.length,0);
});
test('contract rejects size/count limits and omitted units without changing state',()=>{
  const f=fixtures();for(const mutate of [p=>p.participants[0].laps=Array(50001).fill(p.participants[0].laps[0]),p=>p.participants=Array(257).fill(p.participants[0]),p=>p.heats=Array(1001).fill(p.heats[0]),p=>p.participants[0].laps[0].durationMs=86400001,p=>p.track.lanes[0].lengthM=100001,p=>p.name='x'.repeat(201),p=>delete p.participants[0].laps[0].durationMs,p=>p.revision=1000001]){const p=clone(f.normal);mutate(p);assert.throws(()=>integration.receive(f.store,p));}assert.equal(f.store.data.timing.sessions.length,0);
});
