'use strict';
const Q=require('./sqlite-query.cjs'),S=require('./scoped-write.cjs'),C=require('./shared-car-library.cjs'),counts=require('./shared-library-timing-read.cjs').serviceCount;
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function project(r,car){const s=car.service||{},total=counts(r,car.id),since=s.lastServicedAt?counts(r,car.id,s.lastServicedAt):total;return {revision:s.revision||0,lastServicedAt:s.lastServicedAt||null,servicesDone:s.servicesDone||0,lapsDriven:Math.max(0,(s.lifetimeBaseline??total)+total-(s.observedLifetime??total)),lapsSinceService:Math.max(0,(s.sinceBaseline??since)+since-(s.observedSince??since)),recordedLaps:total,includesOriginalOnly:true};}
function read(store,input){return Q.read(store,null,r=>{const car=r.one('cars',input.carId);if(!car)fail('CAR_NOT_FOUND','Car no longer exists.');return {databaseId:r.id,recoveryId:r.epoch,carId:car.id,carRevision:car.revision,service:project(r,car)};}).value;}
function prepare(store,options,input){
 if(!['initialize','set','reset'].includes(input.action)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('INVALID_OPERATION','Choose a service action and expected service revision.');
 C.prepare(store,{payload:{version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,sourceId:options.installationId,operationId:input.operationId,action:'patch',carId:input.carId,expectedRevision:input.expectedCarRevision}},{allowCompanionOnly:true});
 const current=Q.read(store,null,r=>{const car=r.one('cars',input.carId);return {car,total:counts(r,car.id),view:project(r,car)};}).value;
 if(current.view.revision!==input.expectedRevision)fail('REVISION_CONFLICT','Service counters changed. Reopen the car before saving.');
 if(input.action==='initialize'&&current.view.revision)fail('REVISION_CONFLICT','Service counters already exist.');
 const v=input.values||{};if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['lastServicedAt','servicesDone','lapsDriven','lapsSinceService'].includes(k)))fail('INVALID_FIELD','Unknown service field.');
 for(const k of ['servicesDone','lapsDriven','lapsSinceService'])if(v[k]!==undefined&&(!Number.isSafeInteger(v[k])||v[k]<0))fail('INVALID_FIELD','Service counters must be nonnegative whole numbers.');
 if(v.lastServicedAt!==undefined&&v.lastServicedAt!==null){const date=v.lastServicedAt;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString()!==date.replace(/(?<=:\d{2})Z$/,'.000Z'))fail('INVALID_FIELD','Use an ISO 8601 UTC service timestamp.');}
 const old=current.car.service||{},lastServicedAt=input.action==='reset'?new Date().toISOString():v.lastServicedAt===undefined?old.lastServicedAt||null:v.lastServicedAt===null?null:new Date(v.lastServicedAt).toISOString();
 const since=Q.read(store,null,r=>counts(r,input.carId,lastServicedAt)).value;
 const next={...old,revision:current.view.revision+1,lastServicedAt,servicesDone:input.action==='reset'?current.view.servicesDone+1:v.servicesDone??current.view.servicesDone,lifetimeBaseline:v.lapsDriven??current.view.lapsDriven,observedLifetime:current.total,sinceBaseline:input.action==='reset'?0:v.lapsSinceService??(lastServicedAt!==old.lastServicedAt&&v.lastServicedAt!==undefined?since:current.view.lapsSinceService),observedSince:since};
 const before=S.context(store,'work.add',{carId:input.carId}).data,after={...before,revision:before.revision+1,cars:before.cars.map(c=>({...c,service:next,revision:c.revision+1,updated:new Date().toISOString()}))};
 if(input.action==='reset')after.events=[{id:require('node:crypto').randomUUID(),carId:input.carId,type:'maintenance',title:'Service counters reset',notes:'Service recorded from '+options.application,date:new Date().toISOString()}];
 return S.prepare(store,before,after,{carId:input.carId,carRevision:current.car.revision+1,service:{revision:next.revision,lastServicedAt,servicesDone:next.servicesDone,lapsDriven:next.lifetimeBaseline,lapsSinceService:next.sinceBaseline,recordedLaps:current.total,includesOriginalOnly:true}});
}
module.exports={read,prepare,project};
