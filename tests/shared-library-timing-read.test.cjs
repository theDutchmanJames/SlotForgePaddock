'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {open}=require('../packages/shared-library/index.cjs');
async function fixture(t){const root=require('./support/temp-dir.cjs')('timing-read-'),h=await open({application:'Timing',installationId:'Timing',sharedRoot:root});t.after(async()=>{await h.close();fs.rmSync(root,{recursive:true,force:true});});const s=await h.status(),identity={databaseId:s.databaseId,recoveryId:s.recoveryId},car=(await h.carWrite({...identity,operationId:'car',action:'create',set:{name:'Current car'}})).car;
 const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/classes-and-eligibility.json'))).bundle;bundle.context.scoringSnapshot=null;
 for(let i=0;i<bundle.race.participants.length;i++){const c=i? (await h.carWrite({...identity,operationId:'car-'+i,action:'create',set:{name:'Other car'}})).car:car;bundle.race.participants[i].carId=c.id;bundle.race.participants[i].configuration=(await h.profile({carId:c.id})).configuration;}
 const operation={version:1,...identity,operationId:'history',sourceId:'source',sessionId:'race',editor:{installationId:'Timing',application:'SlotForge Timing',name:'Owner'},reason:'Recorded evidence',action:'create',expected:null,bundle};
 const receipt=await h.historyWrite(operation);return {h,identity,car,bundle,operation,receipt};}
test('bounded Timing projections separate eligibility, retain source identity and exclude original-only evidence',async t=>{
 const {h,identity,car}=await fixture(t),before=await h.timingRead({kind:'home',carId:car.id,weekStart:'2026-10-26T00:00:00Z'}),expected=await h.historyRead({kind:'statistics',carId:car.id});
 for(const key of ['acceptedSessions','historicalSessions','measuredLaps','validLaps','measuredTimeMs','bestPersonalLapMs','bestTrackLapMs','personalRecordLaps','trackRecordLaps','distanceM','unknownDistanceLaps','overallWins','classWins'])assert.equal(before.summary[key],expected[key],key);
 assert.equal(before.summary.lastDrivenAt,'2026-10-31T10:01:00.000Z');assert.equal(before.fastestThisWeek.durationMs,10000);assert.equal(before.fastestThisWeek.driverName,'Alex Example');assert.equal(before.topDistanceCars[0].carName,'Current car');
 assert.equal(before.topWinners.length,1);assert.equal(before.topWinners[0].wins,1);assert.equal(before.topWinners[0].driverId,'driver-1');assert.equal(before.summary.distanceLaps,4); // Pit distance remains physical mileage, not a pace record.
 assert.equal((await h.timingRead({kind:'records',carId:car.id,scope:'personal'})).rows[0].durationMs,10000);assert.equal((await h.timingRead({kind:'records',carId:car.id,scope:'track'})).rows[0].durationMs,11000);
 await h.originalHistoryWrite({...identity,sourceId:'source',originalId:'token',sessionId:'token',operationId:'token',reason:'Original token evidence',action:'create',expectedRevision:0,carIds:[car.id],projectionReason:'Token evidence',rawOriginal:{session:{id:'token'},laps:[{carId:car.id,time:1}]}});
 assert.deepEqual((await h.timingRead({kind:'home',carId:car.id,weekStart:'2026-10-26T00:00:00Z'})).summary,before.summary);
 const stats=await h.timingRead({kind:'carStatistics',carId:car.id});assert.equal(stats.tracks.rows[0].sourceId,'source');assert.equal(stats.tracks.rows[0].trackId,'track-1');
 assert.equal((await h.timingRead({kind:'carStatistics',carId:car.id,from:'2026-11-11T00:00:00Z'})).summary.recordedLaps,0);
});
test('Timing projection pages detect changes and reject ambiguous filters; withdrawal removes all contributions',async t=>{
 const {h,car,operation,receipt}=await fixture(t),first=await h.timingRead({kind:'records',limit:1});
 await assert.rejects(h.timingRead({kind:'records',trackId:'track-1'}),e=>e.code==='INVALID_QUERY');await assert.rejects(h.timingRead({kind:'records',driverId:'driver-1'}),e=>e.code==='INVALID_QUERY');
 await assert.rejects(h.timingRead({kind:'records',offset:1}),e=>e.code==='INVALID_QUERY');await assert.rejects(h.timingRead({kind:'home',weekStart:'2026-02-30T00:00:00Z'}),e=>e.code==='INVALID_QUERY');
 await assert.rejects(h.timingRead({kind:'home',from:'2026-02-01T00:00:00.000Z',to:'2026-02-01T00:00:00Z'}),e=>e.code==='INVALID_QUERY');
 const withdraw={...operation,action:'withdraw',expected:receipt.accepted,operationId:'withdraw',withdrawalReason:'Withdraw evidence'};delete withdraw.bundle;await h.historyWrite(withdraw);
 await assert.rejects(h.timingRead({kind:'records',offset:1,token:first.token}),e=>e.code==='QUERY_CHANGED');
 assert.equal((await h.timingRead({kind:'home'})).summary.recordedLaps,0);assert.equal((await h.timingRead({kind:'records'})).total,0);assert.equal((await h.timingRead({kind:'carStatistics',carId:car.id})).summary.lastDrivenAt,null);
});

test('canonical class labels paginate and reject ignored filters',async t=>{
 const {h,identity,car}=await fixture(t);await h.carWrite({...identity,operationId:'class',action:'patch',carId:car.id,expectedRevision:car.revision,set:{raceClass:'GT3'}});await h.carWrite({...identity,operationId:'class-2',action:'create',set:{name:'GT car',raceClass:'GT1'}});
 const first=await h.timingRead({kind:'classes',limit:1});assert.equal(first.total,2);assert.equal(first.rows[0].label,'GT1');assert.equal((await h.timingRead({kind:'classes',limit:1,offset:first.nextOffset,token:first.token})).rows[0].label,'GT3');
 await assert.rejects(h.timingRead({kind:'classes',carId:car.id}),e=>e.code==='INVALID_QUERY');
});

test('legacy timing-v1 joins driver stints and agrees with established statistics alongside rich history',async t=>{
 const {h,identity,car,operation}=await fixture(t),payload=require('./support/timing-fixtures.cjs').fixtures().normal;
 payload.databaseId=identity.databaseId;payload.participants[0].carId=car.id;payload.participants[0].configuration=(await h.profile({carId:car.id})).configuration;
 await h.historyWrite({...operation,operationId:'legacy',sourceId:payload.source.id,sessionId:payload.sessionId,bundle:{format:'timing-v1',payload}});
 const actual=(await h.timingRead({kind:'home',carId:car.id})).summary,expected=await h.historyRead({kind:'statistics',carId:car.id});
 for(const key of ['acceptedSessions','validLaps','distanceM','overallWins','classWins','personalRecordLaps','trackRecordLaps'])assert.equal(actual[key],expected[key],key);
 const records=await h.timingRead({kind:'records',sourceId:payload.source.id,trackId:'track-1'});assert.equal(records.total,1);assert.equal(records.rows[0].lane,1);assert.equal(records.rows[0].driverId,'driver-1');assert.equal(records.rows[0].driverName,'Alex Example');
});
