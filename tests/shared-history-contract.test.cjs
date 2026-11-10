'use strict';
// Published implemented fixtures describe the closed rollout. The activation
// matrix separately verifies enabled capabilities; do not rewrite fixtures
// merely because this test process simulates a future enabled release.
require('./support/history-closed-preload.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Ajv=require('ajv/dist/2020'),{schema}=require('./fixtures/contracts/shared-racing-history-v1/contract.cjs');
const root=path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const ajv=new Ajv({strict:false,allErrors:true});ajv.addFormat('date-time',{type:'string',validate:s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s});ajv.addSchema(schema);
const validators=new Map();function validate(value,name){if(!validators.has(name))validators.set(name,ajv.compile({$ref:schema.$id+'#/$defs/'+name}));const v=validators.get(name);assert.ok(v(value),name+': '+JSON.stringify(v.errors));}
// Deliberately independent from the runtime's digest implementation.
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const fixture=name=>read('fixtures/'+name+'.json');
function historySemantics(bundle){
 if(bundle.format!=='history-v1')return;
 const race=bundle.race,unique=(rows)=>{assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,'Duplicate identity');return new Set(rows.map(r=>r.id));},heats=unique(race.heats),participants=unique(race.participants),classes=unique(bundle.context.classes),teams=unique(bundle.context.teams),carIds=new Set(),lapIds=new Set();
 for(const p of race.participants){const drivers=unique(p.drivers),stints=unique(p.stints);assert.ok(p.teamId===null||teams.has(p.teamId));
  if(p.kind==='virtual'){assert.equal(p.carId,null);assert.equal(p.configuration,null);}
  if(p.carId){assert.ok(!carIds.has(p.carId),'Repeated physical car');carIds.add(p.carId);if(bundle.provenance.kind==='measured')assert.equal(p.configuration?.carId,p.carId);}
  for(const s of p.stints){assert.ok(heats.has(s.heatId));assert.ok(drivers.has(s.driverId));}
  for(const l of p.laps){assert.ok(!lapIds.has(l.id),'Duplicate lap');lapIds.add(l.id);if(l.stintId!==null)assert.ok(stints.has(l.stintId));if(l.heatId!==null)assert.ok(heats.has(l.heatId));if(l.driverId!==null)assert.ok(drivers.has(l.driverId));if(l.lane!==null)assert.ok(race.track.lanes.some(x=>x.lane===l.lane));
   if(l.stintId!==null){const s=p.stints.find(s=>s.id===l.stintId);assert.equal(l.heatId,s.heatId);assert.equal(l.driverId,s.driverId);assert.equal(l.lane,s.lane);}
   if(l.personalRecordEligible===true||l.trackRecordEligible===true){assert.equal(l.valid,true);assert.equal(l.pit,false);assert.ok(l.durationMs>0);}
   if(bundle.provenance.kind==='historical'){assert.notEqual(l.personalRecordEligible,true);assert.notEqual(l.trackRecordEligible,true);}
  }
 }
 for(const c of bundle.context.classification){assert.ok(participants.has(c.participantId));if(c.classId!==null)assert.ok(classes.has(c.classId));if(c.scope==='class')assert.ok(classes.has(c.scopeId));if(c.scope==='heat')assert.ok(heats.has(c.scopeId));for(const id of [...c.countedHeatIds,...c.droppedHeatIds])assert.ok(heats.has(id));assert.ok(!c.countedHeatIds.some(id=>c.droppedHeatIds.includes(id)));assert.equal(c.score===null,c.scoreUnit===null);}
}
test('proposed shared-history schemas and all published fixtures are deterministic and structurally valid',()=>{
 assert.deepEqual(read('schema.json'),schema);const manifest=read('fixtures/manifest.json'),generated=require('./support/history-contract-examples.cjs').examples();assert.equal(manifest.fixtures.length,generated.length);
 for(const r of generated){assert.deepEqual(read('fixtures/'+r.file),r.value);validate(r.value,r.definition);assert.equal(manifest.fixtures.find(x=>x.file===r.file).status,'proposed');}
 for(const v of manifest.hashes)assert.equal(hash(read('fixtures/'+v.file)),v.sha256);
});
test('implemented wire subset matches runtime schemas and advertised feature flags',()=>{
 const runtime=require('../src/shared-history-schema.cjs'),wire=read('implemented/schema.json');assert.deepEqual(wire.$defs.operation,runtime.operation);assert.deepEqual(wire.$defs.receipt,runtime.receipt);assert.deepEqual(read('implemented/capability.json'),runtime.capability);validate(runtime.capability,'capability');
 const actual=new Ajv({strict:false,allErrors:true});actual.addFormat('date-time',s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s);actual.addSchema(wire);
 for(const entry of read('implemented/manifest.json').fixtures){const validator=actual.compile({$ref:wire.$id+'#/$defs/'+entry.definition});assert.ok(validator(read('implemented/'+entry.file)),JSON.stringify(validator.errors));}
});
test('implemented historical upload fixtures preserve bytes, batch identity and Review-only commitment',()=>{
 const start=read('implemented/import-upload-start.json'),chunk=read('implemented/import-upload-chunk.json'),commit=read('implemented/import-upload-commit.json'),done=read('implemented/import-upload-committed.json'),bytes=Buffer.from(chunk.data,'base64');
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),start.sha256);assert.equal(bytes.length,start.byteLength);assert.equal(chunk.sha256,commit.sha256);assert.equal(commit.sha256,start.sha256);
 const input=JSON.parse(bytes);assert.deepEqual(input,read('implemented/import-request.json'));assert.equal(hash(input),done.receipt.requestHash);assert.equal(start.kind,'import');assert.equal(done.state,'committed');assert.ok(done.receipt.items.every(i=>i.status==='pending'&&i.accepted===null));
 assert.equal(read('implemented/import-upload-after-cancellation.json').receipt.items[0].status,'cancelled');
});
test('guarded fixtures preserve request identity, accepted content hashes and stale expected revisions',()=>{
 const normal=fixture('create'),edit=fixture('correction'),withdraw=fixture('withdrawal');
 for(const [op,result]of [[normal,fixture('create-receipt')],[edit,fixture('correction-receipt')],[withdraw,fixture('withdrawal-receipt')]]){assert.equal(result.requestHash,hash(op));assert.equal(result.operationId,op.operationId);assert.equal(result.sessionId,op.sessionId);if(op.bundle)assert.equal(result.accepted.contentHash,hash(op.bundle.payload));assert.equal(result.accepted.revision,(op.expected?.revision||0)+1);}
 assert.equal(normal.expected,null);assert.deepEqual(edit.expected,fixture('create-receipt').accepted);assert.deepEqual(withdraw.expected,fixture('correction-receipt').accepted);
 assert.deepEqual(fixture('duplicate-after-correction').accepted,fixture('create-receipt').accepted);assert.deepEqual(fixture('duplicate-after-correction').current,fixture('correction-receipt').accepted);
 assert.notDeepEqual(fixture('stale-editor').expected,fixture('revision-conflict').current);assert.notEqual(normal.recoveryId,fixture('recovery-changed').recoveryId);
});
test('coverage examples preserve class context, independent eligibility and honest historical unknowns',()=>{
 for(const name of ['classes-and-eligibility','unlinked-and-virtual'])historySemantics(fixture(name).bundle);
 const c=fixture('classes-and-eligibility').bundle;assert.equal(c.race.participants[0].laps[0].personalRecordEligible,true);assert.equal(c.race.participants[0].laps[0].trackRecordEligible,false);assert.equal(c.context.classification.filter(r=>r.scope==='class').length,2);
 const old=fixture('historical-import').items[0].bundle;historySemantics(old);assert.equal(old.race.startedAt,null);assert.equal(old.race.participants[0].configuration,null);assert.ok(old.race.participants[0].laps.every(l=>l.endedAtMs===null&&l.distanceM===null));
 assert.equal(fixture('import-pending').items[0].accepted,null);assert.equal(fixture('import-cancelled').items[0].accepted,null);assert.equal(fixture('import-approved').items[0].accepted.contentHash,hash(old));
 assert.equal(fixture('historical-import').items[0].originHash,hash(fixture('origin-evidence')));
 const delivered=fixture('already-delivered').items[0],original=fixture('create');assert.equal(delivered.sourceId,original.sourceId);assert.equal(delivered.sessionId,original.sessionId);assert.deepEqual(delivered.accepted,fixture('create-receipt').accepted);
 const partial=fixture('partial-import-outcome').items;assert.equal(partial[0].status,'approved');assert.ok(partial[0].accepted);assert.equal(partial[1].status,'cancelled');assert.equal(partial[1].accepted,null);
 const broken=structuredClone(c);broken.race.participants[0].laps[0].driverId='missing';assert.throws(()=>historySemantics(broken));
});
test('proposed schemas reject missing concurrency guards, wrong units, unknown fields and malformed eligibility',()=>{
 for(const change of [x=>delete x.recoveryId,x=>delete x.expected,x=>x.extra=true,x=>x.bundle.payload.participants[0].laps[0].durationMs='10 seconds']){const x=fixture('create');change(x);assert.throws(()=>validate(x,'operation'));}
 const x=fixture('classes-and-eligibility');x.bundle.race.participants[0].laps[0].personalRecordEligible='yes';assert.throws(()=>validate(x,'operation'));
 const chunk=fixture('upload-chunk');chunk.index=256;assert.throws(()=>validate(chunk,'chunk'));
 const create=fixture('create');create.expected=fixture('create-receipt').accepted;assert.throws(()=>validate(create,'operation'));
 const replace=fixture('correction');replace.expected=null;assert.throws(()=>validate(replace,'operation'));
 const imported=fixture('historical-import');imported.items=[];assert.throws(()=>validate(imported,'importRequest'));
 const measuredImport=fixture('historical-import');measuredImport.items[0].bundle=fixture('classes-and-eligibility').bundle;assert.throws(()=>validate(measuredImport,'importRequest'));
 const page=fixture('lap-page');page.format='history-v1';assert.throws(()=>validate(page,'laps'));
});
test('upload fixture bytes, chunk hash and operation hash agree; staging is not acceptance',()=>{
 const start=fixture('upload-start'),chunk=fixture('upload-chunk'),bytes=Buffer.from(chunk.data,'base64'),sha=crypto.createHash('sha256').update(bytes).digest('hex');assert.equal(bytes.length,start.byteLength);assert.equal(sha,chunk.sha256);assert.equal(sha,start.sha256);assert.equal(sha,fixture('upload-commit').sha256);assert.deepEqual(JSON.parse(bytes),fixture('create'));assert.equal(fixture('upload-status').receipt,null);
 // Exercise two fixed-size transport chunks without checking large blobs into Git.
 const large=Buffer.concat([Buffer.alloc(262144,32),bytes]),pieces=[large.subarray(0,262144),large.subarray(262144)];assert.deepEqual(JSON.parse(Buffer.concat(pieces)),fixture('create'));assert.equal(pieces[0].length,262144);assert.notEqual(crypto.createHash('sha256').update(pieces[0]).digest('hex'),crypto.createHash('sha256').update(pieces[1]).digest('hex'));
});
test('published totals distinguish physical distance from eligible pace and exclude manual counters',()=>{
 const p=fixture('create').bundle.payload.participants[0],s=fixture('car-statistics'),valid=p.laps.filter(l=>l.valid&&!l.pit);assert.equal(s.measuredLaps,p.laps.length);assert.equal(s.validLaps,valid.length);assert.equal(s.measuredTimeMs,valid.reduce((n,l)=>n+l.durationMs,0));assert.equal(s.averageLapMs,s.measuredTimeMs/s.validLaps);assert.equal(s.distanceM,p.laps.filter(l=>l.countsForDistance).reduce((n,l)=>n+(l.distanceM||0),0));assert.equal(s.manualIncluded,false);
});
test('existing protected local API supplies complete paginated history to a fresh reader and signals correction/restore',async t=>{
 const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),T=require('../src/timing-integration.cjs'),f=require('./support/timing-fixtures.cjs').fixtures();
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'sf-history-contract-')),store=new Store(path.join(folder,'database.sqlite'));store.replace(f.store.snapshot());const host=new LocalLibrary({store,profile:folder,folder:path.join(folder,'discovery')});t.after(async()=>{host.quiesce();await host.idle();host.close();fs.rmSync(folder,{recursive:true,force:true});});await host.start();assert.equal(host.error,'');
 const get=async route=>{const r=await fetch('http://127.0.0.1:'+host.network.port+route,{headers:{Authorization:'Bearer '+host.token,'X-SlotForge-Instance':host.instanceId,'X-SlotForge-Database':store.data.id,'X-SlotForge-Extensions':'scalable-v1'}});return {status:r.status,body:await r.json()};};
 const payload=structuredClone(f.normal);payload.endedAt='2026-10-31T10:11:00.000Z';payload.heats[0].endedAtMs=600000;payload.participants[0].stints[0].endedAtMs=600000;const template=payload.participants[0].laps[0];payload.participants[0].laps=Array.from({length:501},(_,i)=>({...template,id:'lap-'+i,number:i+1,durationMs:1000,endedAtMs:(i+1)*1000}));T.receive(store,payload);
 const list=await get('/v1/scalable/results?carId=car-a');assert.equal(list.status,200);assert.equal(list.body.results.length,1);const route='/v1/scalable/results/timing-demo/session-normal',head=(await get(route)).body,rebuilt=structuredClone(head.payload);assert.equal(head.payload.participants[0].laps,undefined);
 const laps=[];for(let offset=0;offset!==null;){const page=(await get(route+'/laps/entry-1?token='+head.resultToken+'&offset='+offset)).body;assert.ok(page.laps.length<=250);laps.push(...page.laps);offset=page.nextOffset;}rebuilt.participants[0].laps=laps;assert.deepEqual(rebuilt,payload);
 const backup=store.snapshot(),corrected=structuredClone(payload);corrected.revision=2;corrected.participants[0].laps[0].valid=false;corrected.participants[0].laps[0].recordEligible=false;T.receive(store,corrected);
 assert.equal((await get(route+'/laps/entry-1?token='+head.resultToken)).body.code,'RESULT_CHANGED');assert.equal((await get('/v1/scalable/changes?kind=results&cursor='+list.body.cursor)).body.entries[0].sessionId,payload.sessionId);
 T.receive(store,{...f.withdrawal,revision:3});assert.equal((await get(route)).body.payload.state,'withdrawn');await store.restoreAsync(backup,store.data.revision);
 assert.equal((await get('/v1/scalable/changes?kind=results&cursor='+list.body.cursor)).body.resetRequired,true);
 assert.equal((await get('/v1/status')).body.capabilities.sharedHistory,undefined);assert.equal((await get('/v1/shared-history/status')).body.capability.features.guardedWrites,true);
});
