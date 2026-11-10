'use strict';
// Source-specific effective settings. Original Timing companions remain evidence;
// a merge never rewrites their IDs, compressed bytes or field overrides.
const A=require('./car-merge-archive.cjs'),E=require('./shared-library-evidence.cjs');
const fields=['tyreCompound','damageFactor','failureFactor','serviceInterval'];
const labels={tyreCompound:'Simulated tyre choice',damageFactor:'Damage factor',failureFactor:'Failure factor',serviceInterval:'Service interval (laps)'};
const id=(sourceId,carId)=>'companion-'+A.digest([sourceId,carId]);
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const own=(v,k)=>Object.hasOwn(v,k);
// Native Timing forms historically stored optional numeric blanks as "".
// Project ONLY that known representation as an explicit clear; originals and
// provenance stay untouched. New writes still use strict validateFields.
const pick=v=>Object.fromEntries(fields.filter(k=>own(v,k)).map(k=>[k,k!=='tyreCompound'&&v[k]===''?null:v[k]]));
function valid(key,value){return key==='tyreCompound'?typeof value==='string'&&value.trim().length>0&&value.length<=100:value===null||typeof value==='number'&&Number.isFinite(value)&&(key==='serviceInterval'?Number.isSafeInteger(value)&&value>=1:value>=0);}
function validateFields(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([k,v])=>!fields.includes(k)||!valid(k,v)))fail('INVALID_FIELD','Use a tyre code, nonnegative damage/failure multipliers, and a positive whole service interval. Optional null values explicitly clear the setting.');}
function sources(db,carId){return [...new Set([...(db.libraryOrigins||[]).filter(o=>o.entity==='car'&&o.carId===carId).map(o=>o.sourceId),...(db.mergeCompanions||[]).filter(o=>o.carId===carId).map(o=>o.sourceId)])].sort();}
function states(db,carId,sourceId){
 const overlay=(db.mergeCompanions||[]).find(o=>o.carId===carId&&o.sourceId===sourceId);
 if(overlay)return [{key:'overlay:'+overlay.id,carId,sourceId,revision:overlay.revision,fields:overlay.fields,provenance:overlay.provenance,localCarId:overlay.localCarId}];
 return (db.libraryOrigins||[]).filter(o=>o.entity==='car'&&o.carId===carId&&o.sourceId===sourceId).sort((a,b)=>a.originalId.localeCompare(b.originalId)).map(o=>{
  const e=(db.libraryExtras||[]).find(e=>e.namespace==='timing.carExtras'&&e.sourceId===sourceId&&e.originalId===o.originalId);
  return {key:'origin:'+o.originalId,carId,sourceId,originalId:o.originalId,revision:e?.revision||0,fields:e?pick(E.decode(e)):{},localCarId:o.originalId};
 });
}
function baseline(values,key){
 // Missing on one of several origins is a real ambiguity, not permission to
 // select another origin's value by iteration order.
 const signatures=new Set(values.map(v=>A.digest(own(v.fields,key)?[true,v.fields[key]]:[false])));
 return {ambiguous:signatures.size>1,present:values.length>0&&own(values[0].fields,key),value:values[0]?.fields[key],origins:values.map(v=>({key:v.key,revision:v.revision}))};
}
function rows(db,mainCarId,retiredCarId){
 return [...new Set([...sources(db,mainCarId),...sources(db,retiredCarId)])].sort().flatMap(sourceId=>{
  const main=states(db,mainCarId,sourceId),incoming=states(db,retiredCarId,sourceId);
  return fields.map(field=>({key:JSON.stringify([sourceId,field]),sourceId,field,label:labels[field],main:baseline(main,field),
   candidates:[...main.map(v=>({...v,side:'main'})),...incoming.map(v=>({...v,side:'incoming'}))].filter(v=>v.side==='main'||own(v.fields,field)).map(v=>({key:JSON.stringify([v.side,v.key]),side:v.side,label:(v.side==='main'?'Main':'Duplicate')+' · '+(v.originalId||v.localCarId),present:own(v.fields,field),value:own(v.fields,field)?v.fields[field]:null,valid:!own(v.fields,field)||valid(field,v.fields[field]),provenance:{carId:v.carId,sourceId,key:v.key,revision:v.revision}}))}));
 });
}
function defaults(db,main,old){return Object.fromEntries(rows(db,main,old).map(r=>[r.key,'keep']));}
function validateChoices(db,p,choices,{final=false}={}){
 const available=rows(db,p.mainCarId,p.retiredCarId);
 if(!choices||A.digest(Object.keys(choices).sort())!==A.digest(available.map(r=>r.key).sort()))fail('MERGE_SELECTION_CONFLICT','Refresh the Timing settings choices.');
 for(const r of available){const choice=choices[r.key],candidate=r.candidates.find(c=>c.key===choice);
  if(choice!=='keep'&&(!candidate||!candidate.valid))fail('MERGE_SELECTION_CONFLICT','Choose a valid Timing value.');
  if(final&&choice==='keep'&&(r.main.ambiguous||r.main.present&&!valid(r.field,r.main.value)))fail('MERGE_SELECTION_CONFLICT','Choose the main or duplicate value for '+r.label+' in '+r.sourceId+'.');
 }
}
function apply(db,p){
 validateChoices(db,p,p.choices.settings,{final:true});db.mergeCompanions??=[];
 const entries=rows(db,p.mainCarId,p.retiredCarId),bySource=new Map();
 for(const r of entries){
  if(!bySource.has(r.sourceId)){
   const main=states(db,p.mainCarId,r.sourceId),localIds=[...new Set(main.map(v=>v.localCarId))],old=db.mergeCompanions.find(o=>o.carId===p.mainCarId&&o.sourceId===r.sourceId);
   bySource.set(r.sourceId,{id:id(r.sourceId,p.mainCarId),sourceId:r.sourceId,carId:p.mainCarId,localCarId:localIds.length===1?localIds[0]:p.mainCarId,revision:(old?.revision||0)+1,fields:{},provenance:{},mergeId:p.id});
  }
  const out=bySource.get(r.sourceId),choice=p.choices.settings[r.key],candidate=r.candidates.find(c=>c.key===choice);
  if(choice==='keep'){
   if(r.main.present)out.fields[r.field]=r.main.value;
   out.provenance[r.field]={kind:r.main.present?'main':'default',carId:p.mainCarId,origins:r.main.origins};
  }else{if(candidate.present)out.fields[r.field]=candidate.value;out.provenance[r.field]={kind:candidate.side,...candidate.provenance};}
 }
 for(const entry of bySource.values()){const pos=db.mergeCompanions.findIndex(o=>o.id===entry.id);if(pos<0)db.mergeCompanions.push(entry);else db.mergeCompanions[pos]=entry;}
}
const effective=value=>({tyreCompound:value.tyreCompound??'M',damageFactor:value.damageFactor??1,failureFactor:value.failureFactor??1,serviceInterval:value.serviceInterval??null});
function validate(db){
 const seen=new Set();for(const row of db.mergeCompanions||[]){
  const key=JSON.stringify([row.sourceId,row.carId]);
  if(seen.has(key)||row.id!==id(row.sourceId,row.carId)||!db.cars.some(c=>c.id===row.carId)||typeof row.localCarId!=='string'||!row.localCarId||!Number.isSafeInteger(row.revision)||row.revision<1||!row.provenance||typeof row.provenance!=='object')fail('MERGE_SELECTION_CONFLICT','Invalid effective Timing settings.');
  validateFields(row.fields);seen.add(key);
 }
}
module.exports={fields,labels,id,states,sources,rows,baseline,defaults,validateChoices,apply,effective,validateFields,validate};
