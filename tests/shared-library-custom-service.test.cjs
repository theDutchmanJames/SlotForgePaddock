'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{open}=require('../packages/shared-library/index.cjs');
async function setup(t,legacy){const root=require('./support/temp-dir.cjs')('custom-service-'),profiles=path.join(root,'profiles'),profile=path.join(profiles,'slotforge-timing');fs.mkdirSync(profile,{recursive:true});if(legacy)fs.writeFileSync(path.join(profile,'slotforge-timing.json'),JSON.stringify(legacy));const h=await open({application:'SlotForge Timing',installationId:'Timing',sharedRoot:path.join(root,'shared'),appData:profiles});t.after(async()=>{await h.close();fs.rmSync(root,{recursive:true,force:true});});const s=await h.status();return {h,identity:{databaseId:s.databaseId,recoveryId:s.recoveryId}};}
test('custom definitions and typed values use canonical car data and atomic car/extras receipts',async t=>{
 const {h,identity}=await setup(t),field=(await h.customDefinitionWrite({...identity,operationId:'field',expectedRevision:0,definition:{label:'Measured width',type:'number',group:'Chassis'}})).field;
 const input={...identity,operationId:'create',action:'create',set:{name:'Custom car'},customValues:{set:{[field.id]:22.4}},timingExtras:{sourceId:'Timing',originalId:'local',expectedRevision:0,patch:{damageFactor:1}}},car=(await h.carWrite(input)).car;
 assert.equal((await h.customRead({carId:car.id})).values[field.id],'22.4');assert.equal((await h.customSchema()).definitions[0].group,'Chassis');
 await assert.rejects(h.carWrite({...identity,operationId:'rollback',action:'patch',carId:car.id,expectedRevision:car.revision,customValues:{set:{[field.id]:25}},timingExtras:{...input.timingExtras,expectedRevision:0}}),e=>e.code==='REVISION_CONFLICT');assert.equal((await h.customRead({carId:car.id})).values[field.id],'22.4');
 const saved=await h.carWrite({...identity,operationId:'custom-only',action:'patch',carId:car.id,expectedRevision:car.revision,customValues:{set:{[field.id]:24}}});assert.equal(saved.car.revision,car.revision+1);
 assert.equal((await h.customRead({carId:car.id})).values[field.id],'24');assert.equal((await h.carWrite(input)).duplicate,true);
 await assert.rejects(h.customDefinitionWrite({...identity,operationId:'bad-type',fieldId:field.id,expectedRevision:field.revision,definition:{label:field.label,type:'text'}}),e=>e.code==='FIELD_TYPE_CONFLICT');
});
test('Timing-first custom fields and service counters are adopted without adding old laps twice',async t=>{
 const legacy={version:1,paddock:{sourceId:'old'},customFields:{slotcars:[{id:'width',label:'Width',type:'number',group:'chassis',options:[]}]},slotcars:[{id:'car',name:'Old car',custom:{width:22},lapsDriven:100,lapsSinceService:12,servicesDone:2,serviceDate:'2026-01-01T00:00:00.000Z'}],sessions:[{id:'token',sessionType:'tokens',setupName:'Old tokens'}],laps:[{id:'lap',sessionId:'token',carId:'car',time:50}],tracks:[],drivers:[],teams:[],raceclasses:[]};
 const {h,identity}=await setup(t,legacy),car=(await h.catalogue()).cars[0],fields=await h.customRead({carId:car.id});assert.equal(fields.definitions[0].label,'Width');assert.equal(fields.values[fields.definitions[0].id],'22');
 let service=await h.serviceRead({carId:car.id});assert.equal(service.service.lapsDriven,100);assert.equal(service.service.lapsSinceService,12);assert.equal(service.service.recordedLaps,1);
 const newRaw={session:{id:'new',date:new Date().toISOString()},laps:[{carId:'car',time:100}]};await h.originalHistoryWrite({...identity,sourceId:'old',originalId:'new',sessionId:'new',operationId:'new-token',action:'create',expectedRevision:0,reason:'Saved',projectionReason:'Token',carIds:[car.id],rawOriginal:newRaw});
 service=await h.serviceRead({carId:car.id});assert.equal(service.service.lapsDriven,101);assert.equal(service.service.lapsSinceService,13);
 const reset={...identity,operationId:'reset',action:'reset',carId:car.id,expectedCarRevision:service.carRevision,expectedRevision:service.service.revision};const result=await h.serviceWrite(reset);assert.equal(result.service.lapsSinceService,0);assert.equal(result.service.servicesDone,3);assert.deepEqual(await h.serviceWrite(reset),{...result,duplicate:true});
 const later=await h.serviceRead({carId:car.id});assert.equal(later.service.lapsSinceService,0);assert.equal(later.service.lapsDriven,101);
 await assert.rejects(h.serviceWrite({...reset,operationId:'stale'}),e=>e.code==='REVISION_CONFLICT');
});

test('service dates, original corrections and withdrawals change counters exactly once',async t=>{
 const {h,identity}=await setup(t),car=(await h.carWrite({...identity,operationId:'car',action:'create',set:{name:'Counter car'}})).car;
 const make=(id,date)=>({...identity,sourceId:'Timing',originalId:id,sessionId:id,operationId:id,action:'create',expectedRevision:0,reason:'Token evidence',projectionReason:'Tokens',carIds:[car.id],rawOriginal:{session:{id,date},laps:[{carId:car.id,time:2},{carId:car.id,time:2,virtual:true},{time:2}]}});
 const early=make('early',Date.parse('2026-01-01T00:00:00Z')),late=make('late','2026-03-01T00:00:00Z');await h.originalHistoryWrite(early);await h.originalHistoryWrite(late);
 const service={...identity,operationId:'initialize',action:'initialize',expectedRevision:0,expectedCarRevision:car.revision,carId:car.id,values:{lastServicedAt:'2026-02-01T00:00:00Z'}};
 for(const date of ['2026-02-30T00:00:00Z','2026-02-01','yesterday'])await assert.rejects(h.serviceWrite({...service,operationId:'invalid-'+date.replace(/[^a-z0-9]/gi,''),values:{lastServicedAt:date}}),e=>e.code==='INVALID_FIELD');
 await h.serviceWrite(service);let state=(await h.serviceRead({carId:car.id})).service;assert.equal(state.recordedLaps,2);assert.equal(state.lapsDriven,2);assert.equal(state.lapsSinceService,1);
 const corrected={...late,action:'replace',operationId:'correct',expectedRevision:1,rawOriginal:{...late.rawOriginal,laps:[...late.rawOriginal.laps,{carId:car.id,time:3}]}};await h.originalHistoryWrite(corrected);await h.originalHistoryWrite(corrected);
 state=(await h.serviceRead({carId:car.id})).service;assert.equal(state.lapsDriven,3);assert.equal(state.lapsSinceService,2);
 const withdrawal={...late,action:'withdraw',operationId:'withdraw',expectedRevision:2};delete withdrawal.rawOriginal;await h.originalHistoryWrite(withdrawal);state=(await h.serviceRead({carId:car.id})).service;assert.equal(state.lapsDriven,1);assert.equal(state.lapsSinceService,0);
 await h.originalHistoryWrite({...withdrawal,action:'restore',operationId:'restore',expectedRevision:3});state=(await h.serviceRead({carId:car.id})).service;assert.equal(state.lapsDriven,3);assert.equal(state.lapsSinceService,2);
});
