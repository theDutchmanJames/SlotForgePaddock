'use strict';
const {hash}=require('./json-encoding.cjs');
const storage=require('./sqlite-storage.cjs');
const check=(condition,message)=>{if(!condition)throw Error(message);};
function fields(action,payload){
 if(action!=='car.save'||typeof payload?.id!=='string'||!payload.data||Array.isArray(payload.data))return null;
 const keys=Object.keys(payload.data),allowed=require('./store.cjs').TEXT_FIELDS;
 return keys.length&&keys.every(key=>allowed.includes(key))?keys:null;
}
function values(car,keys){return keys.map(field=>Object.hasOwn(car,field)?{field,present:true,value:car[field]}:{field,present:false});}
function capture(db,action,payload,epoch){
 const keys=fields(action,payload);if(!keys||!epoch)return null;
 const car=db.cars.find(c=>c.id===payload?.id);if(!car)return null;
 return {version:1,epoch,revision:db.revision,carId:car.id,fields:values(car,keys)};
}
function carAt(store,id){return store.deferredState?store.deferredState.read(r=>r.record(JSON.stringify(['cars','id:'+id]),{assetHandle:true})):store.data.cars.find(c=>c.id===id);}
function captureStore(store,action,payload,epoch){
 if(!fields(action,payload)||!epoch)return null;
 const car=carAt(store,payload.id);return car?capture({revision:store.data.revision,cars:[car]},action,payload,epoch):null;
}
function validate(proposal){
 const c=proposal.conditions;if(c===undefined)return;
 const keys=fields(proposal.action,proposal.payload);
 check(c&&c.version===1&&typeof c.epoch==='string'&&/^[a-f0-9-]{36}$/.test(c.epoch)&&Number.isSafeInteger(c.revision)&&c.revision>=0&&c.carId===proposal.payload.id&&keys,'Invalid field review conditions.');
 check(Array.isArray(c.fields)&&c.fields.length===keys.length&&c.fields.every((v,i)=>v&&v.field===keys[i]&&typeof v.present==='boolean'&&(v.present?typeof v.value==='string'&&v.value.length<=20000:!Object.hasOwn(v,'value'))),'Field conditions must cover exactly the proposed fields.');
 check(proposal.base===hash(c),'Field review conditions do not match their digest.');
}
function state(store,carId,keys=[]){
 if(!store.file||!store.expectedIdentity)return null;
 return storage.fieldState(store.file,store.expectedIdentity,JSON.stringify(['cars','id:'+carId]),keys.map(key=>JSON.stringify([key])));
}
function capability(store){const s=state(store,'');return s?{version:1,epoch:s.epoch}:null;}
function inspect(store,proposal){
 validate(proposal);const c=proposal.conditions,keys=c.fields.map(v=>v.field),car=carAt(store,c.carId),s=state(store,c.carId,[...keys,'archived']);
 const current=car?values(car,keys):null;
 const conflict=!s||!car||s.epoch!==c.epoch||c.revision<s.floor||c.revision>store.data.revision||Object.values(s.versions).some(v=>v>c.revision)||hash(current)!==hash(c.fields);
 // Unrelated revisions do not invalidate a review. A same-field ABA change
 // does: durable field versions change even when its value changes back.
 const base=hash({databaseId:store.data.id,carId:c.carId,current,epoch:s?.epoch,floor:s?.floor,versions:s?.versions});
 return {base,conflict};
}
module.exports={fields,capture,captureStore,validate,inspect,capability};
