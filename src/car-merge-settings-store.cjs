'use strict';
const Q=require('./sqlite-query.cjs'),S=require('./scoped-write.cjs'),M=require('./car-merge-settings.cjs'),A=require('./car-merge-archive.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function identifiers(input){if(!input||!['sourceId','carId'].every(k=>typeof input[k]==='string'&&/^[\w-]{1,100}$/.test(input[k])))fail('INVALID_QUERY','Choose a source installation and car.');}
function load(r,input){
 identifiers(input);require('./car-merge-query.cjs').assertWritable(r,input.carId);
 const bindingId=M.id(input.sourceId,input.carId),stored=r.record(JSON.stringify(['mergeCompanions','id:'+bindingId]));
 let fields={},provenance={},localCarId=input.carId;
 if(stored){fields=stored.fields;provenance=stored.provenance;localCarId=stored.localCarId;}
 else{
  const keys=r.db.prepare(`SELECT o.key FROM records o JOIN record_fields s ON s.record=o.key AND s.path='["sourceId"]' AND s.json=? JOIN record_fields c ON c.record=o.key AND c.path='["carId"]' AND c.json=? WHERE o.bucket='["libraryOrigins"]'`).all(JSON.stringify(input.sourceId),JSON.stringify(input.carId));
  const origins=keys.map(k=>r.record(k.key)).filter(o=>o.entity==='car');
  const extras=origins.map(o=>r.record(JSON.stringify(['libraryExtras','id:extra-'+require('./timing-integration.cjs').digest(['timing.carExtras',o.sourceId,o.originalId])]))).filter(Boolean);
  const states=M.states({libraryOrigins:origins,libraryExtras:extras},input.carId,input.sourceId);
  const ids=[...new Set(states.map(s=>s.localCarId))];if(ids.length===1)localCarId=ids[0];
  for(const key of M.fields){const b=M.baseline(states,key);if(b.ambiguous)fail('SETTINGS_CONFLICT','Several original Timing records disagree on '+M.labels[key]+'. Resolve their values in merge Review.');if(b.present)fields[key]=b.value;provenance[key]={kind:b.present?'main':'default',carId:input.carId,origins:b.origins};}
 }
 M.validateFields(fields);
 const revision=stored?.revision||0,bindingToken=A.digest({bindingId,localCarId,revision,fields,provenance});
 return {stored,value:{version:1,databaseId:r.id,recoveryId:r.epoch,mergeRevision:r.merges.revision,carId:input.carId,sourceId:input.sourceId,bindingId,localCarId,revision,bindingToken,fields,effective:M.effective(fields),provenance}};
}
function read(store,input){identifiers(input);if(Object.keys(input).some(k=>!['carId','sourceId'].includes(k)))fail('INVALID_QUERY','Unknown Timing settings query option.');return Q.read(store,null,r=>load(r,input).value).value;}
function prepare(store,options,input){
 identifiers(input);
 if(input.sourceId!==options.installationId)fail('SOURCE_MISMATCH','Timing settings belong to this installation only.');
 if(Object.keys(input).some(k=>!['databaseId','recoveryId','operationId','sourceId','carId','action','expectedRevision','expectedBindingToken','set'].includes(k))||!['bind','patch'].includes(input.action))fail('INVALID_OPERATION','Choose bind or patch for Timing settings.');
 const set=input.set===undefined?{}:input.set;M.validateFields(set);if(input.action==='bind'&&Object.keys(set).length)fail('INVALID_OPERATION','Binding does not change settings.');
 const {stored,value}=Q.read(store,null,r=>load(r,input)).value;
 if(input.expectedRevision!==value.revision||input.expectedBindingToken!==value.bindingToken)fail('REVISION_CONFLICT','Timing settings changed. Reopen the editor before saving.');
 if(input.action==='bind'&&stored)return {noop:true,result:value};
 const fields={...value.fields,...set},provenance={...value.provenance};for(const k of Object.keys(set))provenance[k]={kind:'edit',carId:input.carId,sourceId:input.sourceId};
 const row={id:value.bindingId,carId:input.carId,sourceId:input.sourceId,localCarId:value.localCarId,revision:value.revision+1,fields,provenance,...(stored?.mergeId?{mergeId:stored.mergeId}:{})};
 const before=S.context(store,'@history-import').data;before.mergeCompanions=stored?[stored]:[];
 const after={...before,revision:before.revision+1,mergeCompanions:[row]};
 const result={...value,revision:row.revision,fields,effective:M.effective(fields),provenance,bindingToken:A.digest({bindingId:row.id,localCarId:row.localCarId,revision:row.revision,fields,provenance})};
 return S.prepare(store,before,after,result);
}
module.exports={read,prepare};
