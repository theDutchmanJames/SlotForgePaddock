'use strict';
const crypto=require('node:crypto'),Q=require('./sqlite-query.cjs'),S=require('./scoped-write.cjs'),C=require('./shared-car-library.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function fields(store){return store.data.customFields;}
function schema(store){return Q.read(store,null,r=>({databaseId:r.id,recoveryId:r.epoch,revision:r.revision,definitions:store.data.customFields})).value;}
function definition(store,input){
 const d=input.definition;if(!object(d)||Object.keys(d).some(k=>!['label','type','group','options'].includes(k))||typeof d.label!=='string'||!d.label.trim()||d.label.length>160||!['text','number','date','choice','yesno','notes'].includes(d.type)||d.group!==undefined&&(typeof d.group!=='string'||d.group.length>160)||d.options!==undefined&&(!Array.isArray(d.options)||d.options.length>100||d.options.some(v=>typeof v!=='string'||v.length>160)))fail('INVALID_FIELD','Invalid custom field definition.');
 if(input.fieldId!==undefined&&(typeof input.fieldId!=='string'||!/^[\w-]{1,100}$/.test(input.fieldId)))fail('INVALID_FIELD','Invalid custom field identity.');
 const before=S.context(store,'@history-import').data,old=before.customFields.find(f=>f.id===input.fieldId);
 if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==(old?.revision|| (old?1:0)))fail('REVISION_CONFLICT','Custom field definition changed.');
 if(old&&old.type!==d.type)fail('FIELD_TYPE_CONFLICT','Existing custom field types cannot change while cars retain their values.');
 if(!old&&before.customFields.length>=100)fail('FIELD_LIMIT','This library already has 100 custom fields.');
 if(input.legacy!==undefined&&(!object(input.legacy)||typeof input.legacy.sourceId!=='string'||!/^[\w-]{1,100}$/.test(input.legacy.sourceId)||typeof input.legacy.fieldId!=='string'||!input.legacy.fieldId||input.legacy.fieldId.length>200))fail('INVALID_FIELD','Invalid legacy custom identity.');
 const next={...old,id:old?.id||input.fieldId||crypto.randomUUID(),revision:(old?.revision|| (old?1:0))+1,label:d.label.trim(),type:d.type,group:d.group??old?.group??'',options:d.options??old?.options??[],...(input.legacy?{legacy:input.legacy}:{})};
 const after={...before,revision:before.revision+1,customFields:old?before.customFields.map(f=>f.id===old.id?next:f):[...before.customFields,next]};
 return S.prepare(store,before,after,{field:next});
}
function values(store,input){
 if(!object(input)||Object.keys(input).some(k=>!['set','clear'].includes(k))||input.set!==undefined&&!object(input.set)||input.clear!==undefined&&(!Array.isArray(input.clear)||input.clear.some(k=>typeof k!=='string')))fail('INVALID_FIELD','Supply custom set and clear values.');
 const defs=fields(store),set=input.set||{},clear=input.clear||[],out={};if(Object.keys(set).length+clear.length>100||new Set(clear).size!==clear.length)fail('INVALID_FIELD','Too many or repeated custom values.');
 for(const [id,value]of Object.entries(set)){
  const d=defs.find(f=>f.id===id);if(!d||['__proto__','constructor','prototype'].includes(id)||!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))fail('INVALID_FIELD','Unknown field or invalid custom value.');
  const text=String(value);if(text.length>4000||d.type==='number'&&text!==''&&!Number.isFinite(Number(text))||d.type==='date'&&text!==''&&(!/^\d{4}-\d\d-\d\d$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text).toISOString().slice(0,10)!==text))fail('INVALID_FIELD','Invalid custom value for '+d.label);out[id]=text;
 }
 for(const id of clear){if(Object.hasOwn(set,id)||!defs.some(f=>f.id===id)||['__proto__','constructor','prototype'].includes(id))fail('INVALID_FIELD','Unknown or overlapping custom clear.');out[id]='';}return out;
}
function attach(store,prepared,operation,input){
 const custom=values(store,input);if(!Object.keys(custom).length)return prepared;
 if(prepared.noop){const next=S.command(store,'car.save',{id:operation.carId,revision:operation.expectedRevision,data:{custom}});next.result={...prepared.result,car:C.project(next.scope.after.cars.find(c=>c.id===operation.carId))};return next;}
 const {before,after}=prepared.scope,car=after.cars.find(c=>c.id===prepared.result.car.id);car.custom={...car.custom,...custom};if(Object.keys(car.custom).length>100)fail('FIELD_LIMIT','Maximum 100 custom values per car.');return S.prepare(store,before,after,prepared.result);
}
function read(store,input){return Q.read(store,null,r=>{const car=r.one('cars',input.carId);if(!car)fail('CAR_NOT_FOUND','Car no longer exists.');return {databaseId:r.id,recoveryId:r.epoch,carId:car.id,revision:car.revision,values:car.custom||{},definitions:store.data.customFields};}).value;}
module.exports={schema,definition,attach,read};
