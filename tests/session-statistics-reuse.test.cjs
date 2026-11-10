'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const Q=require('../src/query-timing.cjs'),R=require('../renderer/timing-results-model.js'),P=require('../renderer/pace-model.js'),{fixtures}=require('./support/timing-fixtures.cjs');
function database(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE records(key TEXT PRIMARY KEY); INSERT INTO records VALUES('session')");Q.schema(db);return db;}
function record(payload,carIds){return {payload,carIds:carIds||payload.participants?.map(p=>p.carId).filter(Boolean)||['car-a'],contentHash:'test',receivedAt:'2026-11-03T10:00:00Z',warnings:[],history:[]};}
function compare(db,r){
 Q.update(db,'session','["timing","sessions"]',r);
 const saved=JSON.parse(db.prepare('SELECT json FROM query_sessions').get().json);
 assert.equal(saved._query.requiresCorrection,R.requiresCorrection(r.payload));assert.deepEqual(saved._query.summaries,R.summaries(r.payload));
 assert.deepEqual(saved._query.runs,P.runs({timing:{sessions:[r]},tests:[]}));
 for(const id of new Set(r.carIds)){
  const row=db.prepare('SELECT json,lanes FROM query_car_results WHERE car_id=?').get(id);
  assert.deepEqual(JSON.parse(row.json),R.aggregate([r],id));
  assert.deepEqual(JSON.parse(row.lanes),P.laneRecords({cars:[{id}],timing:{sessions:[r]},tests:[]},id));
 }
 return saved;
}
test('one projection analysis and one pace pass serve every car, with linear lap traversals',t=>{
 const db=database(t),s=fixtures().normal,seed=s.participants[0];s.participants=Array.from({length:24},(_,i)=>({...structuredClone(seed),id:'entry-'+i,carId:'car-'+i}));
 const value=record(s),originalAnalyze=R.analyze,originalRuns=P.sessionRuns;let analyses=0,runPasses=0,traversals=0;
 for(const p of s.participants)p.laps=new Proxy(p.laps,{get(target,key,receiver){if(key===Symbol.iterator)traversals++;return Reflect.get(target,key,receiver);}});
 t.mock.method(R,'analyze',session=>{analyses++;return originalAnalyze(session);});
 t.mock.method(P,'sessionRuns',(...args)=>{runPasses++;return originalRuns(...args);});
 t.mock.method(R,'requiresCorrection',()=>{throw Error('Redundant pace eligibility scan');});
 t.mock.method(R,'aggregate',()=>{throw Error('Redundant per-car session analysis');});
 t.mock.method(P,'laneRecords',()=>{throw Error('Redundant per-car lap measurement');});
 Q.update(db,'session','["timing","sessions"]',value);
 assert.equal(analyses,1);assert.equal(runPasses,1);assert.equal(traversals,48,'one eligibility traversal and one stint-grouping traversal per participant');
 assert.equal(db.prepare('SELECT count(*) n FROM query_car_results').get().n,24);
 for(const row of db.prepare('SELECT json,lanes FROM query_car_results').all()){
  const aggregate=JSON.parse(row.json),lanes=JSON.parse(row.lanes);assert.equal(aggregate.validLaps,2);assert.equal(aggregate.bestLapMs,10000);assert.equal(aggregate.averageLapMs,10500);assert.equal(aggregate.distanceM,60);
  assert.equal(lanes[0].best,10000);assert.equal(lanes[0].median,null);assert.equal(lanes[0].sustained5,null);assert.equal(lanes[0].sustained10,null);
 }
});
test('reused summaries preserve normal, endurance, multi-heat, corrections and withdrawals',t=>{
 const db=database(t),f=fixtures();for(const p of [f.normal,f.multi,f.endurance,f.correction,f.withdrawal])compare(db,record(p,['car-a','car-b','previous-car']));
 const p=structuredClone(f.multi);p.participants[0].laps.reverse();p.participants[0].laps[0].distanceM=null;
 const v=structuredClone(p.participants[0]);v.kind='virtual';v.carId=null;v.configuration=null;v.id='rival';p.participants.push(v);compare(db,record(p));
 p.heats[1].startedAtMs=0;p.participants[1].laps.at(-1).durationMs=50000;
 const quarantined=compare(db,record(p));assert.equal(quarantined._query.requiresCorrection,true);assert.deepEqual(quarantined._query.runs,[]);
 for(const row of db.prepare('SELECT json,lanes FROM query_car_results').all()){assert.equal(JSON.parse(row.json).sessions,0);assert.deepEqual(JSON.parse(row.lanes),[]);}
});
test('equal best laps retain original tie identity and full pace metrics stay separate from lane records',t=>{
 const db=database(t),s=fixtures().normal,p=s.participants[0],lap=p.laps[0];
 p.laps=Array.from({length:12},(_,i)=>({...lap,id:'lap-'+i,number:i+1,durationMs:1000,endedAtMs:(i+1)*1000})).reverse();
 const saved=compare(db,record(s)),run=saved._query.runs[0];assert.equal(run.bestLap.id,'lap-0');assert.equal(run.median,1000);assert.equal(run.sustained5,1000);assert.equal(run.sustained10,1000);
 const lane=JSON.parse(db.prepare('SELECT lanes FROM query_car_results').get().lanes)[0];assert.equal(lane.bestLap.id,run.bestLap.id);assert.equal(lane.median,null);
});
test('car-filtered pace skips other sessions and manual lane records retain their behavior',t=>{
 const f=fixtures(),s=f.normal;Object.defineProperty(s.participants[0],'laps',{get(){throw Error('Unrelated laps loaded');}});
 assert.deepEqual(P.runs({timing:{sessions:[record(s)]},tests:[]},'other-car'),[]);
 const db={cars:[{id:'manual-car'}],tests:[{id:'test',carId:'manual-car',track:'Home',lane:'2',best:'4.5',date:'2026-11-03',technical:{motor:'Recorded motor'},laps:'10'}]};
 const lane=P.laneRecords(db,'manual-car')[0];assert.equal(lane.best,4500);assert.equal(lane.kind,'manual');assert.equal(lane.recordedAt,'2026-11-03');assert.equal(lane.technical.motor,'Recorded motor');assert.equal(lane.totalLaps,10);
});
