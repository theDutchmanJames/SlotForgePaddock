'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),H=require('../src/shared-history.cjs'),R=require('../src/rich-history.cjs'),V=require('../src/history-view.cjs'),P=require('../src/history-pace.cjs'),M=require('../renderer/shared-pace-model.js');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/'+name+'.json')));
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-pace-')),file=path.join(root,'test.sqlite'),f=require('./support/timing-fixtures.cjs').fixtures(),seed=new Store(file,{deferred:true});seed.replace(f.store.snapshot());const store=new Store(file,{deferred:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const op=read('qualified/create');op.recoveryId=H.status(store).recoveryId;const call=input=>V.read(store,{databaseId:store.data.id,recoveryId:H.status(store).recoveryId,...input});return {store,file,op,f,call};}
const selected=op=>({carId:op.bundle.race.participants[0].carId,sourceId:op.sourceId,sessionId:op.sessionId,participantId:op.bundle.race.participants[0].id});
test('shared pace compares mixed formats and independent eligibility with captured setups',t=>{
 const {store,op,f,call}=setup(t);R.receiveQualified(store,op);H.receive(store,{...op,operationId:'legacy-pace',sessionId:f.normal.sessionId,bundle:{format:'timing-v1',payload:f.normal}});
 const list=call({operation:'pace-cars'});assert.ok(list.rows.some(c=>c.id==='car-a'));const sessions=call({operation:'pace-sessions',carId:'car-a',snapshot:list.snapshot});assert.equal(sessions.rows.length,2);assert.ok(sessions.rows.every(r=>!r.laps&&!r.configuration));
 assert.equal(call({operation:'pace-sessions',carId:'car-a',query:'CLUB',snapshot:list.snapshot}).total,2);assert.equal(call({operation:'pace-sessions',carId:'car-a',query:'missing track',snapshot:list.snapshot}).total,0);
 const result=call({operation:'pace-compare',snapshot:list.snapshot,left:selected(op),right:{carId:'car-a',sourceId:f.normal.source.id,sessionId:f.normal.sessionId,participantId:f.normal.participants[0].id}});
 assert.equal(result.left.metrics.validLaps,3);assert.equal(result.left.metrics.bestPersonalMs,10000);assert.equal(result.left.metrics.bestTrackMs,11000);assert.equal(result.left.metrics.medianMs,10000);assert.equal(result.left.metrics.averageMs,31000/3);assert.equal(result.left.configuration.revision,op.bundle.race.participants[0].configuration.revision);assert.ok(result.right.metrics.validLaps>0);assert.ok(store.deferredState);
});
test('independent lane and driver filters never equate names with identities',t=>{
 const {store,op,call}=setup(t);R.receiveQualified(store,op);const snapshot=call({operation:'pace-cars'}).snapshot,s=selected(op);
 const x=call({operation:'pace-compare',snapshot,left:{...s,lane:1,driverId:'driver-1'},right:{...s,lane:2}});assert.equal(x.left.metrics.validLaps,2);assert.equal(x.right.metrics.validLaps,1);assert.equal(x.right.metrics.bestTrackMs,null);assert.ok(M.warnings(x.left,x.right).some(w=>w.includes('Different lanes')));assert.ok(M.warnings(x.left,x.right).some(w=>w.includes('overlap')));
 assert.throws(()=>call({operation:'pace-compare',snapshot,left:{...s,driverId:'unknown'},right:s}),e=>e.apiCode==='INVALID_QUERY');assert.throws(()=>call({operation:'pace-compare',snapshot,left:{...s,lane:64},right:s}),e=>e.apiCode==='INVALID_QUERY');
});
test('historical null configuration and lap evidence stay unknown',t=>{
 const {store,op,call}=setup(t);op.bundle=read('fixtures/historical-import').items[0].bundle;for(const l of op.bundle.race.participants[0].laps){l.durationMs=null;l.valid=null;l.pit=null;l.lane=null;l.driverId=null;}R.receiveQualified(store,op);
 const x=call({operation:'pace-compare',snapshot:call({operation:'pace-cars'}).snapshot,left:selected(op),right:selected(op)}).left;assert.equal(x.configuration,null);assert.equal(x.metrics.averageMs,null);assert.equal(x.metrics.medianMs,null);assert.equal(x.metrics.bestPersonalMs,null);assert.equal(x.metrics.standardDeviationMs,null);assert.equal(x.metrics.sustained5Ms,null);assert.equal(x.metrics.unknownLaneLaps,3);assert.ok(M.warnings(x,x).some(w=>w.includes('no timed')));
});
test('correction and withdrawal invalidate selections and remove obsolete contributions',t=>{
 const {store,op,call}=setup(t),saved=R.receiveQualified(store,op),snapshot=call({operation:'pace-cars'}).snapshot;const correction=structuredClone(op);correction.operationId='pace-correction';correction.action='replace';correction.expected=saved.accepted;correction.bundle.race.participants[0].laps[0].durationMs=9000;const corrected=R.receiveQualified(store,correction);
 assert.throws(()=>call({operation:'pace-compare',snapshot,left:selected(op),right:selected(op)}),e=>e.apiCode==='SNAPSHOT_CHANGED');const now=call({operation:'pace-cars'}).snapshot;assert.equal(call({operation:'pace-compare',snapshot:now,left:selected(op),right:selected(op)}).left.metrics.bestPersonalMs,9000);
 const withdrawal={...op,operationId:'pace-withdraw',action:'withdraw',expected:corrected.accepted,withdrawalReason:'Duplicate'};delete withdrawal.bundle;R.receiveQualified(store,withdrawal);const latest=call({operation:'pace-cars'});assert.equal(latest.total,0);assert.throws(()=>call({operation:'pace-compare',snapshot:latest.snapshot,left:selected(op),right:selected(op)}),e=>e.apiCode==='RESULT_UNAVAILABLE');
});
test('renames do not replace historical configuration and archived owners remain inspectable',t=>{
 const {store,op,call}=setup(t);R.receiveQualified(store,op);const data=JSON.parse(JSON.stringify(store.data)),c=data.cars.find(c=>c.id==='car-a');c.name='Renamed car';c.archived=true;c.technical.motor='New current motor';store.replace(data);
 const list=call({operation:'pace-cars'}),x=call({operation:'pace-compare',snapshot:list.snapshot,left:selected(op),right:selected(op)});assert.equal(x.left.car.name,'Renamed car');assert.equal(x.left.car.archived,1);assert.notEqual(x.left.configuration.technical.motor,'New current motor');
});
test('restoring the same database rejects prior recovery identities',async t=>{
 const {store,op,call}=setup(t);R.receiveQualified(store,op);const first=call({operation:'pace-cars'}),backup=JSON.parse(JSON.stringify(store.data));await store.restoreAsync(backup,store.data.revision);
 assert.throws(()=>V.read(store,{operation:'pace-cars',databaseId:first.databaseId,recoveryId:first.recoveryId}),e=>e.apiCode==='RECOVERY_CHANGED');
});
test('invalid requests fail before querying, and comparisons require a selection snapshot',t=>{
 const {op,call}=setup(t);for(const input of [{operation:'pace-cars',offset:-1},{operation:'pace-cars',query:'x'.repeat(201)},{operation:'pace-cars',surprise:1},{operation:'pace-cars',databaseId:'wrong'},{operation:'pace-sessions'},{operation:'pace-compare',left:selected(op),right:selected(op)},{operation:'pace-compare',snapshot:'x',left:{...selected(op),lane:0},right:selected(op)}])assert.throws(()=>call(input));
});
test('session pagination is deterministic and does not hydrate the collection',t=>{
 const {store,op,call}=setup(t);for(let i=0;i<23;i++){const x=structuredClone(op);x.operationId='paging-'+i;x.sessionId='paging-'+i;R.receiveQualified(store,x);}store.snapshot=()=>{throw Error('Full snapshot');};store.ensureLoaded=()=>{throw Error('Full model');};
 const first=call({operation:'pace-sessions',carId:'car-a'}),last=call({operation:'pace-sessions',carId:'car-a',snapshot:first.snapshot,offset:first.nextOffset});assert.equal(first.rows.length,20);assert.equal(last.rows.length,3);assert.equal(new Set([...first.rows,...last.rows].map(x=>x.sessionId)).size,23);assert.equal(last.nextOffset,null);
});
function measured(changes={}){const laps=Array.from({length:10},(_,i)=>({id:'l'+i,number:i+1,stintId:'s',heatId:'h',lane:1,driverId:'d',durationMs:10000,endedAtMs:(i+1)*10000,valid:true,pit:false,personalRecordEligible:true,trackRecordEligible:false}));for(const [i,v] of Object.entries(changes))Object.assign(laps[i],v);return laps;}
const metrics=laps=>P.measurements(laps.map(l=>({json:JSON.stringify(l)})),{stints:[]},true,{});
test('sustained runs require explicit uninterrupted timing and retain separate eligibility',()=>{
 const good=metrics(measured());assert.equal(good.sustained5Ms,10000);assert.equal(good.sustained10Ms,10000);assert.equal(good.bestTrackMs,null);assert.equal(good.standardDeviationMs,0);
 for(const patch of [{valid:false},{pit:true},{endedAtMs:null},{number:null},{lane:null},{driverId:null},{stintId:null},{heatId:null},{stintId:'different'},{driverId:'different'},{lane:2},{heatId:'other'},{endedAtMs:51000}])assert.equal(metrics(measured({4:patch})).sustained10Ms,null);
 const l=measured();for(const x of l)x.endedAtMs=null;assert.equal(metrics(l).sustained5Ms,null);assert.equal(metrics(l).averageMs,10000);
});
test('filtered-out laps break continuity; sample precision and unknowns are preserved',()=>{
 const l=measured({4:{lane:2}}),p=P.measurements(l.map(l=>({json:JSON.stringify(l)})),{stints:[]},true,{lane:1});assert.equal(p.totalLaps,9);assert.equal(p.sustained10Ms,null);
 const long=measured().slice(0,2);long[0].durationMs=80000000;long[1].durationMs=80000000.1;assert.ok(Math.abs(metrics(long).standardDeviationMs-.05)<1e-8);assert.equal(metrics(long.slice(0,1)).standardDeviationMs,null);
});
test('setup comparison marks missing evidence unknown, preserves zero and highlights changed values',()=>{
 const rows=M.differences({technical:{motor:'A',weight:0,custom:{b:2,a:1}},components:[]},{technical:{motor:'B',weight:0,custom:{a:1,b:2}},components:[]});assert.equal(rows.find(r=>r.key==='motor').status,'different');assert.equal(rows.find(r=>r.key==='weight').status,'same');assert.equal(rows.find(r=>r.key==='custom').status,'same');assert.ok(M.differences(null,{technical:{motor:'B'}}).every(r=>r.status==='unknown'));
});
test('large session returns only summary and captured configuration, never lap arrays',t=>{
 const {store,op,call}=setup(t);op.bundle=read('fixtures/historical-import').items[0].bundle;const p=op.bundle.race.participants[0];p.laps=Array.from({length:10000},(_,i)=>({...p.laps[0],id:'large-'+i,number:i+1}));R.receiveQualified(store,op);store.snapshot=()=>{throw Error('Full snapshot');};store.ensureLoaded=()=>{throw Error('Full model');};
 const result=call({operation:'pace-compare',snapshot:call({operation:'pace-cars'}).snapshot,left:selected(op),right:selected(op)});assert.equal(result.left.metrics.validLaps,10000);assert.ok(Buffer.byteLength(JSON.stringify(result))<20000);assert.equal(result.left.laps,undefined);
});
test('virtual replacements remove physical choices; missing cars and wrong participant links fail explicitly',t=>{
 const {store,op,call}=setup(t),saved=R.receiveQualified(store,op),first=call({operation:'pace-cars'});
 assert.throws(()=>call({operation:'pace-compare',snapshot:first.snapshot,left:{...selected(op),carId:'missing'},right:selected(op)}),e=>e.apiCode==='CAR_NOT_FOUND');
 assert.throws(()=>call({operation:'pace-compare',snapshot:first.snapshot,left:{...selected(op),carId:'car-b'},right:selected(op)}),e=>e.apiCode==='PARTICIPANT_NOT_FOUND');
 const edit=structuredClone(op);edit.operationId='virtual-pace';edit.action='replace';edit.expected=saved.accepted;const p=edit.bundle.race.participants[0];p.kind='virtual';p.carId=null;p.configuration=null;for(const l of p.laps){l.personalRecordEligible=false;l.trackRecordEligible=false;l.countsForDistance=false;}R.receiveQualified(store,edit);
 assert.equal(call({operation:'pace-cars'}).rows.some(c=>c.id==='car-a'),false);assert.equal(call({operation:'pace-sessions',carId:'car-a'}).total,0);
});
test('car search and pagination preserve distinct cars with duplicate names',t=>{
 const {store,op,call}=setup(t),seed=JSON.parse(JSON.stringify(store.data)),original=seed.cars[0];for(let i=0;i<21;i++)seed.cars.push({...structuredClone(original),id:'extra-'+i,name:'Duplicate racer'});store.replace(seed);
 // Reopen deferred after fixture replacement; the test never edits a real collection.
 const writer=new Store(store.file,{deferred:true});op.recoveryId=H.status(writer).recoveryId;for(let i=0;i<21;i++){const b=read('fixtures/historical-import').items[0].bundle;b.race.participants[0].carId='extra-'+i;R.receiveQualified(writer,{...op,operationId:'extra-'+i,sessionId:'extra-'+i,bundle:b});}
 const lookup=input=>V.read(writer,{databaseId:writer.data.id,recoveryId:H.status(writer).recoveryId,...input});const first=lookup({operation:'pace-cars',query:'duplicate'}),last=lookup({operation:'pace-cars',query:'duplicate',snapshot:first.snapshot,offset:20});assert.equal(first.total,21);assert.equal(first.rows.length,20);assert.equal(last.rows.length,1);assert.equal(new Set([...first.rows,...last.rows].map(c=>c.id)).size,21);assert.equal(lookup({operation:'pace-cars',query:"' OR 1=1 --"}).total,0);
});
test('comparison warns about source-scoped tracks and changed lane lengths without hiding evidence',()=>{
 const a={sourceId:'one',sessionId:'s1',participantId:'p',track:{id:'track',lanes:[{lane:1,lengthM:20}]},metrics:{lanes:[1],driverIds:['d'],validLaps:10},configuration:{technical:{}},provenance:{kind:'measured'}},b=structuredClone(a);b.sourceId='two';b.sessionId='s2';b.track.lanes[0].lengthM=25;
 const warnings=M.warnings(a,b);assert.ok(warnings.some(x=>x.includes('source-scoped')));assert.ok(warnings.some(x=>x.includes('lane lengths')));assert.ok(warnings.some(x=>x.includes('session-scoped')));
});
