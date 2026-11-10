'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),Q=require('../src/sqlite-query.cjs'),QT=require('../src/query-timing.cjs'),R=require('../renderer/timing-results-model.js'),P=require('../renderer/pace-model.js'),{fixtures}=require('./support/timing-fixtures.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-selective-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=fixtures(),s=new Store(path.join(dir,'db.sqlite'));s.replace(f.store.snapshot());T.receive(s,f.multi);
 const db=new DatabaseSync(s.file);db.exec('CREATE TABLE projection_audit(kind TEXT,id TEXT,position INTEGER)');
 for(const op of ['INSERT','UPDATE','DELETE']){const row=op==='DELETE'?'OLD':'NEW';db.exec(`CREATE TRIGGER audit_lap_${op} AFTER ${op} ON query_laps BEGIN INSERT INTO projection_audit VALUES('lap-${op}',${row}.participant,${row}.position); END; CREATE TRIGGER audit_car_${op} AFTER ${op} ON query_car_results BEGIN INSERT INTO projection_audit VALUES('car-${op}',${row}.car_id,NULL); END;`);}
 db.close();return {...f,s};
}
function audit(s){const db=new DatabaseSync(s.file);try{const rows=db.prepare('SELECT * FROM projection_audit').all().map(r=>({...r}));db.exec('DELETE FROM projection_audit');return rows;}finally{db.close();}}
function compare(s){for(const id of ['car-a','car-b']){const actual=Q.read(s,null,r=>QT.page(r,id)).value;assert.deepEqual(actual.aggregate,R.aggregate(s.data.timing.sessions,id));assert.deepEqual(actual.lanes.sort((a,b)=>a.id.localeCompare(b.id)),P.laneRecords(s.data,id).sort((a,b)=>a.id.localeCompare(b.id)));}
 for(const record of s.data.timing.sessions){assert.deepEqual(Q.read(s,null,r=>QT.full(r,record.payload.source.id,record.payload.sessionId)).value.payload,record.payload);assert.deepEqual(Q.read(s,null,r=>QT.receipt(r,record.payload.source.id,record.payload.sessionId)).value,T.receipt(s.data,record));}}
function counters(t){const seen={overlaps:[],summaries:[],cached:[]},overlap=R.participantRequiresCorrection,summary=R.participantSummary,runs=P.sessionRuns;
 t.mock.method(R,'participantRequiresCorrection',p=>{seen.overlaps.push(p.id);return overlap(p);});t.mock.method(R,'participantSummary',(s,p,safe)=>{seen.summaries.push(p.id);return summary(s,p,safe);});t.mock.method(P,'sessionRuns',(...args)=>{seen.cached.push([...(args[4]?.keys()||[])]);return runs(...args);});return seen;}
test('session labels refresh while laps and numerical calculations are reused, including after restart',t=>{
 const f=fixture(t),s=new Store(f.s.file),seen=counters(t),p=structuredClone(f.multi);p.revision=2;p.name='Renamed event';p.track.name='Renamed circuit';p.heats[0].name='New heat label';p.participants[0].drivers[0].name='Corrected driver';
 T.receive(s,p);assert.deepEqual(seen.overlaps,[]);assert.deepEqual(seen.summaries,[]);assert.deepEqual(seen.cached,[['entry-1','entry-2']]);assert.equal(audit(s).filter(r=>r.kind.startsWith('lap-')).length,0);compare(s);
 const runs=Q.read(s,null,r=>QT.page(r,'car-a')).value.records[0]._query.runs;assert.equal(runs[0].session,p.name);assert.equal(runs[0].track,p.track.name);assert.equal(runs[0].driver,'Corrected driver');
});
test('one lap correction writes one row and only recalculates its participant',t=>{
 const f=fixture(t),seen=counters(t),p=structuredClone(f.multi);p.revision=2;p.participants[0].laps[0].valid=false;p.participants[0].laps[0].recordEligible=false;
 T.receive(f.s,p);assert.deepEqual(seen.overlaps,[]);assert.deepEqual(seen.summaries,['entry-1']);assert.deepEqual(seen.cached,[['entry-2']]);
 const changed=audit(f.s);assert.deepEqual(changed.filter(r=>r.kind.startsWith('lap-')),[{kind:'lap-UPDATE',id:'entry-1',position:0}]);assert.deepEqual(changed.filter(r=>r.kind.startsWith('car-')).map(r=>r.id),['car-a']);compare(f.s);
});
test('classification changes update wins without lap writes; note-only revisions leave all contributions unchanged',t=>{
 const f=fixture(t),seen=counters(t),p=structuredClone(f.multi);p.revision=2;p.standings[0].position=2;p.standings[1].position=1;
 T.receive(f.s,p);assert.deepEqual(seen.overlaps,[]);assert.deepEqual(seen.summaries,['entry-1','entry-2']);assert.deepEqual(seen.cached,[['entry-1','entry-2']]);assert.equal(audit(f.s).filter(r=>r.kind.startsWith('lap-')).length,0);compare(f.s);
 p.revision=3;p.notes='Reviewed again';T.receive(f.s,p);assert.deepEqual(audit(f.s),[]);compare(f.s);
});
test('tail removal, reordered laps, changed participant identities and withdrawal retain exact public order',t=>{
 const f=fixture(t),p=structuredClone(f.multi);p.revision=2;p.participants[0].laps.pop();T.receive(f.s,p);assert.deepEqual(audit(f.s).filter(r=>r.kind.startsWith('lap-')),[{kind:'lap-DELETE',id:'entry-1',position:3}]);compare(f.s);
 p.revision=3;p.participants[1].laps.reverse();T.receive(f.s,p);assert.equal(audit(f.s).filter(r=>r.kind.startsWith('lap-')).length,4);compare(f.s);
 p.revision=4;p.participants[0].id='renamed-entry';p.standings[0].participantId='renamed-entry';T.receive(f.s,p);const rows=audit(f.s).filter(r=>r.kind.startsWith('lap-'));assert.equal(rows.length,6);assert.ok(rows.every(r=>['entry-1','renamed-entry'].includes(r.id)));compare(f.s);
 T.receive(f.s,{...f.withdrawal,sessionId:p.sessionId,revision:5});assert.equal(audit(f.s).filter(r=>r.kind==='lap-DELETE').length,7);compare(f.s);
 p.revision=6;T.receive(f.s,p);assert.equal(audit(f.s).filter(r=>r.kind==='lap-INSERT').length,7);compare(f.s);
});
test('global quarantine transitions invalidate all contributions even if one participant changed',t=>{
 const f=fixture(t);f.s.transact(db=>{const r=db.timing.sessions[0];r.payload.heats[1].startedAtMs=0;r.payload.participants[0].laps.at(-1).durationMs=50000;r.contentHash=T.digest(r.payload);});
 const changes=audit(f.s);assert.equal(changes.filter(r=>r.kind.startsWith('lap-')).length,1);assert.equal(changes.filter(r=>r.kind==='car-UPDATE').length,2);compare(f.s);assert.equal(Q.read(f.s,null,r=>QT.page(r,'car-b')).value.aggregate.sessions,0);
 const p=structuredClone(f.multi);p.revision=2;T.receive(f.s,p);const restored=audit(f.s);assert.equal(restored.filter(r=>r.kind.startsWith('lap-')).length,1);assert.equal(restored.filter(r=>r.kind==='car-UPDATE').length,2);compare(f.s);
});
test('failure of a selective lap update rolls back authoritative state, cache, summaries and cursor',t=>{
 const f=fixture(t),before=f.s.snapshot(),S=require('../src/sqlite-storage.cjs'),cursor=S.syncState(f.s.file),db=new DatabaseSync(f.s.file);
 const projection=db.prepare('SELECT json FROM query_sessions').get().json;db.exec("CREATE TRIGGER fail_lap_update BEFORE UPDATE ON query_laps BEGIN SELECT RAISE(ABORT,'selective write failure'); END");db.close();
 const p=structuredClone(f.multi);p.revision=2;p.participants[0].laps[0].valid=false;p.participants[0].laps[0].recordEligible=false;assert.throws(()=>T.receive(f.s,p),e=>e.apiCode==='STORAGE_FAILED');
 assert.deepEqual(f.s.snapshot(),before);assert.deepEqual(S.syncState(f.s.file),cursor);assert.deepEqual(audit(f.s),[]);const check=new DatabaseSync(f.s.file);assert.equal(check.prepare('SELECT json FROM query_sessions').get().json,projection);check.exec('DROP TRIGGER fail_lap_update');check.close();T.receive(f.s,p);compare(new Store(f.s.file));
});
test('older projections without calculation hints recalculate safely without rewriting matching lap rows',t=>{
 const f=fixture(t),db=new DatabaseSync(f.s.file);db.exec("UPDATE query_sessions SET json=json_remove(json,'$._query.calculations')");db.close();const p=structuredClone(f.multi);p.revision=2;p.notes='Old projection';T.receive(f.s,p);assert.deepEqual(audit(f.s),[]);compare(f.s);
 const scalable=require('../src/scalable-api.cjs'),response=scalable.handle(f.s,'GET',new URL('http://localhost/v1/scalable/results/timing-demo/session-multi'),{timingResults:true},f.s.data.id);assert.doesNotMatch(JSON.stringify(response),/calculations|lapHash|statisticsHash/);
});
test('lane, driver, date and car reassignment rebuild current labels around unchanged measured runs',t=>{
 const f=fixture(t),p=structuredClone(f.multi),seen=counters(t);p.revision=2;
 p.startedAt='2026-10-31T11:01:00.000Z';p.endedAt='2026-10-31T11:03:00.000Z';p.participants[0].stints[0].lane=2;
 p.participants[0].drivers[0].name='New label';[p.participants[0].carId,p.participants[1].carId]=['car-b','car-a'];[p.participants[0].configuration,p.participants[1].configuration]=[structuredClone(f.profiles[1].configuration),structuredClone(f.profiles[0].configuration)];
 T.receive(f.s,p);assert.deepEqual(seen.overlaps,[]);assert.deepEqual(seen.cached,[['entry-1','entry-2']]);assert.equal(audit(f.s).filter(r=>r.kind.startsWith('lap-')).length,0);compare(f.s);
 const lanes=Q.read(f.s,null,r=>QT.page(r,'car-b')).value.lanes;assert.equal(lanes[0].carId,'car-b');assert.equal(lanes[0].lane,'2');assert.equal(lanes[0].driver,'New label');assert.match(lanes[0].recordedAt,/T11:/);
});
test('empty laps, virtual conversion and participant removal clear only their former contributions',t=>{
 const f=fixture(t),p=structuredClone(f.multi);p.revision=2;p.participants[0].laps=[];T.receive(f.s,p);assert.equal(audit(f.s).filter(r=>r.kind==='lap-DELETE').length,4);compare(f.s);
 p.revision=3;p.participants[1].kind='virtual';p.participants[1].carId=null;p.participants[1].configuration=null;T.receive(f.s,p);assert.equal(audit(f.s).filter(r=>r.kind.startsWith('lap-')).length,0);compare(f.s);
 p.revision=4;p.participants.pop();p.standings.pop();T.receive(f.s,p);assert.equal(audit(f.s).filter(r=>r.kind==='lap-DELETE').length,4);compare(f.s);
});
