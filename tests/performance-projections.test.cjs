'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store.cjs'),{fixtures}=require('./support/timing-fixtures.cjs'),T=require('../src/timing-integration.cjs'),Q=require('../src/sqlite-query.cjs'),QT=require('../src/query-timing.cjs'),R=require('../renderer/timing-results-model.js'),P=require('../renderer/pace-model.js');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-performance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const f=fixtures(),s=new Store(path.join(dir,'db.sqlite'));s.replace(f.store.snapshot());return {...f,s};}
function page(s,id='car-a'){return Q.read(s,null,r=>QT.page(r,id)).value;}
function compare(s){for(const id of ['car-a','car-b','missing']){const actual=page(s,id);assert.deepEqual(actual.aggregate,R.aggregate(s.data.timing.sessions,id));assert.deepEqual(actual.lanes.sort((a,b)=>a.id.localeCompare(b.id)),P.laneRecords(s.data,id).sort((a,b)=>a.id.localeCompare(b.id)));assert.equal(actual.total,s.data.timing.sessions.filter(r=>r.carIds.includes(id)).length);}}
function trace(reader){
 const prepare=reader.db.prepare.bind(reader.db),calls=[];
 reader.db.prepare=sql=>{const q=prepare(sql);return new Proxy(q,{get(target,key){if(['all','get'].includes(key))return (...args)=>{const result=target[key](...args);calls.push({sql,args,rows:key==='all'?result.length:result?1:0});return result;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});};
 return {calls,prepare};
}
test('stored receipts equal the legacy contract without reading authoritative records or laps',t=>{
 const f=fixture(t);
 for(const input of [f.normal,f.multi,f.endurance,f.correction,f.withdrawal]){
  T.receive(f.s,input);const record=f.s.data.timing.sessions.find(r=>r.payload.sessionId===input.sessionId);
  const expected=T.receipt(f.s.data,record);
  Q.read(f.s,null,r=>{const {calls,prepare}=trace(r);r.record=()=>{throw Error('Authoritative body read');};assert.deepEqual(QT.receipt(r,input.source.id,input.sessionId),expected);
   assert.equal(calls.length,1);assert.equal(calls[0].rows,1);assert.doesNotMatch(calls[0].sql,/\b(?:records|record_fields|query_laps)\b/);
   const plan=prepare('EXPLAIN QUERY PLAN '+calls[0].sql).all(...calls[0].args).map(x=>x.detail).join('\n');assert.match(plan,/query_session_identity/);
  });
 }
 assert.throws(()=>Q.read(f.s,null,r=>QT.receipt(r,'missing','missing')),e=>e.apiCode==='SESSION_NOT_FOUND'&&e.httpStatus===404);
});
test('performance reads one saved total and at most ten session bodies, including deep pages',t=>{
 const f=fixture(t);for(let i=0;i<24;i++){const p=structuredClone(f.normal);p.sessionId='session-'+i;T.receive(f.s,p);}compare(f.s);
 for(const offset of [0,10,20,30])Q.read(f.s,null,r=>{const {calls,prepare}=trace(r);r.record=()=>{throw Error('Authoritative body read');};const value=QT.page(r,'car-a',offset);assert.equal(value.aggregate.sessions,24);
  assert.equal(calls.length,2);assert.match(calls[0].sql,/FROM query_performance WHERE car_id=\?/);assert.equal(calls[0].rows,1);assert.equal(calls[1].rows,Math.max(0,Math.min(10,24-offset)));assert.match(calls[1].sql,/LIMIT 10 OFFSET/);
  assert.doesNotMatch(calls.map(c=>c.sql).join('\n'),/SELECT json,lanes|query_laps|record_fields/);
  assert.match(prepare('EXPLAIN QUERY PLAN '+calls[0].sql).all('car-a').map(x=>x.detail).join('\n'),/SEARCH query_performance/);
 });
});
test('lap SQL returns only requested bodies with ordered indexes and no temporary sorting',t=>{
 const f=fixture(t),p=structuredClone(f.normal);p.participants[0].laps=Array.from({length:1207},(_,i)=>({...p.participants[0].laps[0],id:'lap-'+i,number:i+1,durationMs:20,endedAtMs:(i+1)*20}));T.receive(f.s,p);
 for(const offset of [0,100,1200,1300])Q.read(f.s,null,r=>{const {calls,prepare}=trace(r);const value=QT.session(r,p.source.id,p.sessionId,'car-a',offset);assert.equal(value.total,1207);
  const laps=calls.filter(c=>c.sql.startsWith('SELECT json FROM query_laps'));assert.equal(laps.length,1);assert.equal(laps[0].rows,Math.max(0,Math.min(100,1207-offset)));
  const plan=prepare('EXPLAIN QUERY PLAN '+laps[0].sql).all(...laps[0].args).map(x=>x.detail).join('\n');assert.match(plan,/query_lap_order/);assert.doesNotMatch(plan,/TEMP B-TREE/);
 });
 const A=require('../src/scalable-api.cjs'),head=A.handle(f.s,'GET',new URL('http://localhost/v1/scalable/results/timing-demo/session-normal'),{timingResults:true},f.s.data.id);
 const read=Q.read;let inspected=false;
 Q.read=(store,token,fn)=>read(store,token,r=>{const {calls,prepare}=trace(r),value=fn(r),lap=calls.find(c=>c.sql.startsWith('SELECT json FROM query_laps'));assert.ok(lap);assert.equal(lap.rows,207);const plan=prepare('EXPLAIN QUERY PLAN '+lap.sql).all(...lap.args).map(x=>x.detail).join('\n');assert.match(plan,/SEARCH query_laps/);assert.doesNotMatch(plan,/TEMP B-TREE/);inspected=true;return value;});
 try{const result=A.handle(f.s,'GET',new URL('http://localhost/v1/scalable/results/timing-demo/session-normal/laps/entry-1?token='+head.resultToken+'&offset=1000'),{timingResults:true},f.s.data.id);assert.equal(result.laps.length,207);assert.ok(inspected);}finally{Q.read=read;}
 Q.read(f.s,null,r=>{const {calls}=trace(r);assert.deepEqual(QT.receipt(r,p.source.id,p.sessionId),T.receipt(f.s.data,f.s.data.timing.sessions[0]));assert.equal(calls.length,1);assert.doesNotMatch(calls[0].sql,/query_laps|record_fields/);});
});
test('car edits leave raced configurations and stored performance untouched; only affected cars are rebuilt',t=>{
 const f=fixture(t),p=structuredClone(f.multi);T.receive(f.s,p);const before=page(f.s),receipt=Q.read(f.s,null,r=>QT.receipt(r,p.source.id,p.sessionId)).value;
 const db=new DatabaseSync(f.s.file);db.exec("CREATE TRIGGER forbid_other_car_summary BEFORE UPDATE ON query_performance WHEN NEW.car_id='car-b' BEGIN SELECT RAISE(ABORT,'Unrelated car rebuilt'); END");db.close();
 f.s.mutate('car.save',{id:'car-a',revision:f.s.data.cars[0].revision,data:{name:'Renamed',technical:{motor:'Different motor',pinion:'13'}}});f.s.mutate('car.archive',{id:'car-a',revision:f.s.data.cars[0].revision});
 assert.deepEqual(page(f.s),before);assert.deepEqual(Q.read(f.s,null,r=>QT.receipt(r,p.source.id,p.sessionId)).value,receipt);assert.equal(page(f.s).records[0].payload.participants[0].configuration.technical.pinion,'9');
 T.receive(f.s,f.normal);compare(f.s);const check=new DatabaseSync(f.s.file);assert.equal(check.prepare('SELECT count(*) n FROM query_performance_dirty').get().n,0);check.close();
});
test('correction, withdrawal, missing distances, car reassignment, deletion and restore preserve totals',t=>{
 const f=fixture(t),original=f.s.snapshot();T.receive(f.s,f.normal);T.receive(f.s,f.multi);T.receive(f.s,f.endurance);compare(f.s);
 const changed=structuredClone(f.correction);changed.participants[0].laps[1].distanceM=null;T.receive(f.s,changed);compare(f.s);assert.equal(page(f.s).aggregate.distanceComplete,false);
 const reassigned=structuredClone(changed);reassigned.revision=3;reassigned.participants[0].carId='car-b';reassigned.participants[0].configuration=structuredClone(f.profiles[1].configuration);T.receive(f.s,reassigned);compare(f.s);assert.equal(page(f.s).aggregate.distanceComplete,true);
 const backup=f.s.snapshot();T.receive(f.s,{...f.withdrawal,revision:4});compare(f.s);assert.equal(page(f.s,'car-b').aggregate.distanceComplete,true);
 f.s.transact(db=>{db.timing.sessions=db.timing.sessions.filter(r=>r.payload.sessionId!=='session-multi');});compare(f.s);assert.equal(page(f.s,'car-b').aggregate.sessions,0);
 f.s.restore(backup,f.s.data.revision);compare(f.s);compare(new Store(f.s.file));
 f.s.replace(original);compare(f.s);assert.equal(page(f.s).total,0);
});
test('quarantined overlaps and virtual participants never enter saved physical totals or records',t=>{
 const f=fixture(t),p=structuredClone(f.multi),virtual=structuredClone(p.participants[0]);virtual.id='virtual';virtual.carId=null;virtual.configuration=null;virtual.kind='virtual';virtual.laps.forEach(l=>l.id='v-'+l.id);p.participants.push(virtual);T.receive(f.s,p);compare(f.s);
 // Older accepted cross-heat overlaps remain readable but quarantined.
 f.s.transact(db=>{const r=db.timing.sessions[0];r.payload.heats[1].startedAtMs=0;r.payload.participants[0].laps.at(-1).durationMs=50000;r.contentHash=T.digest(r.payload);});compare(f.s);assert.equal(page(f.s).aggregate.sessions,0);
 const expected=T.receipt(f.s.data,f.s.data.timing.sessions[0]);assert.equal(expected.warnings.filter(w=>w.code==='SESSION_REQUIRES_CORRECTION').length,2);
 assert.deepEqual(Q.read(f.s,null,r=>QT.receipt(r,p.source.id,p.sessionId)).value,expected);
});
test('summary failure rolls back session, receipt, projections and change cursor together',t=>{
 const f=fixture(t);T.receive(f.s,f.normal);const before=f.s.snapshot(),beforePage=page(f.s),sqlite=require('../src/sqlite-storage.cjs'),cursor=sqlite.syncState(f.s.file);
 const db=new DatabaseSync(f.s.file);db.exec("CREATE TRIGGER fail_performance BEFORE UPDATE ON query_performance BEGIN SELECT RAISE(ABORT,'summary write failure'); END");db.close();
 assert.throws(()=>T.receive(f.s,f.correction),e=>e.apiCode==='STORAGE_FAILED');assert.deepEqual(f.s.snapshot(),before);assert.deepEqual(page(f.s),beforePage);assert.deepEqual(sqlite.syncState(f.s.file),cursor);
 const reopened=new Store(f.s.file);assert.deepEqual(reopened.snapshot(),before);compare(reopened);
 const check=new DatabaseSync(f.s.file);assert.equal(check.prepare('SELECT count(*) n FROM query_performance_dirty').get().n,0);check.exec('DROP TRIGGER fail_performance');check.close();T.receive(f.s,f.correction);compare(f.s);
});
test('v7 upgrade stays deferred, preserves source and builds from summaries without rewriting laps',t=>{
 const f=fixture(t);T.receive(f.s,f.multi);const before=f.s.snapshot(),db=new DatabaseSync(f.s.file);
 db.exec("DROP TABLE query_performance; UPDATE state SET value='7' WHERE key='query_index_version'; CREATE TRIGGER no_lap_rebuild BEFORE INSERT ON query_laps BEGIN SELECT RAISE(ABORT,'lap rebuild'); END; CREATE TRIGGER no_record_rebuild BEFORE INSERT ON query_records BEGIN SELECT RAISE(ABORT,'record rebuild'); END;");db.close();
 const reopened=new Store(f.s.file,{deferred:true});assert.ok(reopened.deferredState);assert.ok(!reopened.deferredState.stats.loadedSections.includes('timing.sessions'));assert.deepEqual(page(reopened).aggregate,R.aggregate(before.timing.sessions,'car-a'));assert.deepEqual(reopened.snapshot(),before);
});
test('interrupted summary upgrade rolls back and a stale older-writer index rebuilds safely',t=>{
 const f=fixture(t);T.receive(f.s,f.multi);const before=f.s.snapshot(),db=new DatabaseSync(f.s.file);
 db.exec("UPDATE state SET value='7' WHERE key='query_index_version'; CREATE TRIGGER fail_summary_build BEFORE INSERT ON query_performance BEGIN SELECT RAISE(ABORT,'interrupted summary build'); END");db.close();
 assert.throws(()=>new Store(f.s.file,{deferred:true}),/interrupted summary build/);
 const check=new DatabaseSync(f.s.file);assert.equal(check.prepare("SELECT value FROM state WHERE key='query_index_version'").get().value,'7');check.exec("DROP TRIGGER fail_summary_build; UPDATE state SET value='stale' WHERE key='query_index_identity'");check.close();
 const reopened=new Store(f.s.file);compare(reopened);assert.deepEqual(reopened.snapshot(),before);
});
