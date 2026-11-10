'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),projection=require('../src/timing-projection.cjs'),R=require('../renderer/timing-results-model.js'),P=require('../renderer/pace-model.js');
const cases=[
 ['distance',l=>l.distanceM=35,false,true,true],
 ['unknown distance',l=>l.distanceM=null,false,true,true],
 ['distance eligibility',l=>l.countsForDistance=false,false,true,true],
 ['reason',l=>l.reason='Checked again',false,false,true],
 ['lap ID',l=>l.id='changed-lap',false,false,false],
 ['lap number',l=>l.number=17,false,false,false],
 ['duration',l=>l.durationMs=9000,true,true,false],
 ['completion time',l=>l.endedAtMs=32000,true,false,false],
 ['record eligibility',l=>l.recordEligible=false,false,true,false],
 ['validity',l=>{l.valid=false;l.recordEligible=false;},false,true,false],
 ['pit flag',l=>{l.pit=true;l.recordEligible=false;},false,true,false],
 ['stint',l=>l.stintId='stint-2',false,false,false]
];
for(const [name,edit,overlap,summary,reuse]of cases)test(name+' correction recalculates only dependent figures and retains full calculation parity',t=>{
 const payload=require('./support/timing-fixtures.cjs').fixtures().multi,record={payload},prior=projection.build(record,null).lite,next=structuredClone(record);next.payload.revision++;edit(next.payload.participants[0].laps[name==='completion time'?2:0]);
 let overlapCalls=0,summaryCalls=0,cached;const oldOverlap=R.participantRequiresCorrection,oldSummary=R.participantSummary,oldRuns=P.sessionRuns;
 t.mock.method(R,'participantRequiresCorrection',p=>{overlapCalls++;return oldOverlap(p);});t.mock.method(R,'participantSummary',(...args)=>{summaryCalls++;return oldSummary(...args);});t.mock.method(P,'sessionRuns',(...args)=>{cached=args[4];return oldRuns(...args);});
 const result=projection.build(next,prior).lite;assert.equal(overlapCalls,Number(overlap));assert.equal(summaryCalls,Number(summary));assert.equal(cached.has('entry-1'),reuse);assert.equal(cached.has('entry-2'),true);
 assert.deepEqual(result._query.summaries,R.summaries(next.payload));assert.deepEqual(result._query.runs,oldRuns(next.payload));
});
test('older hint versions safely recompute and upgrade to selective input signatures',()=>{
 const record={payload:require('./support/timing-fixtures.cjs').fixtures().multi},prior=projection.build(record,null).lite;prior._query.calculations.version=1;const next=projection.build(record,prior).lite;assert.equal(next._query.calculations.version,2);assert.deepEqual(next._query.summaries,R.summaries(record.payload));assert.deepEqual(next._query.runs,P.sessionRuns(record.payload));
});
