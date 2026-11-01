const test=require('node:test'),assert=require('node:assert/strict');
const pace=require('../renderer/pace-model.js'),timing=require('../src/timing-integration.cjs');
const {fixtures}=require('./support/timing-fixtures.cjs');
test('lane records follow accepted corrections and withdrawals, never pit or invalid laps',()=>{
 const f=fixtures();timing.receive(f.store,f.normal);
 let rows=pace.laneRecords(f.store.data,'car-a');assert.equal(rows.length,1);assert.equal(rows[0].best,10000);assert.equal(rows[0].bestLap.number,1);assert.equal(rows[0].recordedAt,'2026-10-31T10:01:10.000Z');
 timing.receive(f.store,f.correction);rows=pace.laneRecords(f.store.data,'car-a');assert.equal(rows[0].best,11000);assert.equal(rows[0].bestLap.number,2);
 timing.receive(f.store,f.withdrawal);assert.deepEqual(pace.laneRecords(f.store.data,'car-a'),[]);
});
test('lane records retain the driver, lane and historical configuration across heats and endurance stints',()=>{
 const f=fixtures();timing.receive(f.store,f.multi);let rows=pace.laneRecords(f.store.data,'car-a');assert.deepEqual(rows.map(r=>r.lane),['1','2']);assert.equal(rows[1].heat,'Heat 2');
 const s=structuredClone(f.endurance),lap=s.participants[0].laps[2];Object.assign(lap,{pit:false,recordEligible:true,durationMs:7000});timing.receive(f.store,s);
 f.store.mutate('car.save',{id:'car-a',revision:f.store.data.cars[0].revision,data:{name:'Renamed',technical:{motor:'Replacement'}}});
 rows=pace.laneRecords(f.store.data,'car-a');assert.equal(rows[0].best,7000);assert.equal(rows[0].driver,'Sam Example');assert.equal(rows[0].technical.motor,'21.5k');assert.equal(rows[0].session,'Endurance driver change');
});
test('same-named tracks from different Timing sources and manual tests stay separate; missing lanes have no record',()=>{
 const f=fixtures();timing.receive(f.store,f.normal);const s=structuredClone(f.normal);s.source.id='other-timing';timing.receive(f.store,s);
 f.store.data.tests=[{id:'manual-1',carId:'car-a',track:'Club circuit',lane:'1',best:'8',date:'2026-11-01',driver:'Manual driver',technical:{motor:'Manual snapshot'}},{id:'manual-2',carId:'car-a',track:'club CIRCUIT',lane:'1',best:'9',date:'2026-11-02',technical:{}},{id:'no-lane',carId:'car-a',track:'Club circuit',lane:'',best:'1',date:'2026-11-01'}];
 const rows=pace.laneRecords(f.store.data,'car-a');assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.kind==='timing').length,2);assert.equal(rows.find(r=>r.kind==='manual').best,8000);assert.equal(rows.find(r=>r.kind==='manual').technical.motor,'Manual snapshot');assert.deepEqual(pace.laneRecords(f.store.data,'missing'),[]);
});
test('virtual, noneligible and overlapping measurements cannot set lane records; ties are deterministic',()=>{
 const f=fixtures();timing.receive(f.store,f.normal);const db=f.store.snapshot(),p=db.timing.sessions[0].payload.participants[0];p.kind='virtual';assert.equal(pace.laneRecords(db,'car-a').length,0);p.kind='physical';p.laps.forEach(l=>l.recordEligible=false);assert.equal(pace.laneRecords(db,'car-a').length,0);p.laps[0].recordEligible=true;p.laps[1].endedAtMs=15000;assert.equal(pace.laneRecords(db,'car-a').length,0);
 const s=structuredClone(f.normal);s.sessionId='earlier';s.startedAt='2026-10-30T10:01:00.000Z';s.endedAt='2026-10-30T10:02:00.000Z';timing.receive(f.store,s);assert.equal(pace.laneRecords(f.store.data,'car-a')[0].sessionId,'earlier');f.store.data.timing.sessions.reverse();assert.equal(pace.laneRecords(f.store.data,'car-a')[0].sessionId,'earlier');
});
