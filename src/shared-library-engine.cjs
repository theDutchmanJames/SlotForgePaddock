'use strict';
// Common, trusted same-account storage operations. No network permission or
// Dealership routing applies here; ordinary domain invariants still apply.
const Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs'),C=require('./shared-car-library.cjs'),S=require('./scoped-write.cjs'),R=require('./command-receipts.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const key=(installationId,operationId)=>'engine-'+T.digest([installationId,operationId]);
const originId=(sourceId,entity,originalId)=>'origin-'+T.digest([sourceId,entity,originalId]);
const extraId=(namespace,sourceId,originalId)=>'extra-'+T.digest([namespace,sourceId,originalId]);
const one=(s,bucket,id)=>Q.read(s,null,r=>r.record(JSON.stringify([bucket,'id:'+id]))).value;
function writableOrigin(store,input){source(input);const origin=one(store,'libraryOrigins',originId(input.sourceId,'car',input.originalId));if(origin)Q.read(store,null,r=>{
 require('./car-merge-query.cjs').assertWritable(r,origin.carId);
 const bindingId=require('./car-merge-settings.cjs').id(input.sourceId,origin.carId);
 if(r.db.prepare('SELECT 1 FROM records WHERE key=?').get(JSON.stringify(['mergeCompanions','id:'+bindingId])))throw Object.assign(Error('Use the effective Timing settings binding; original companions remain preserved.'),{code:'MERGE_SETTINGS_REQUIRED',details:{carId:origin.carId,sourceId:input.sourceId,bindingId}});
 });}
function guard(store,input){const state=require('./shared-history.cjs').status(store);if(input?.databaseId!==state.databaseId)fail('DATABASE_MISMATCH','This operation belongs to another library.');if(input.recoveryId!==state.recoveryId)fail('RECOVERY_CHANGED','The library was restored. Reconcile retained operations before saving again.');return state;}
function source(input){if(!input||typeof input!=='object'||Array.isArray(input)||!/^[\w-]{1,100}$/.test(input.sourceId||'')||typeof input.originalId!=='string'||!input.originalId||input.originalId.length>200)fail('INVALID_ORIGIN','Original data needs a stable source and original ID.');}
function extra(namespace,input,old){
 if(!['timing.carExtras','timing.historyOriginals'].includes(namespace))fail('INVALID_NAMESPACE','Unknown companion namespace.');source(input);
 if(input.patch!==undefined){
  if(namespace!=='timing.carExtras'||input.rawOriginal!==undefined||!input.patch||typeof input.patch!=='object'||Array.isArray(input.patch)||Object.keys(input.patch).some(k=>['__proto__','constructor','prototype','picture','extraPictures'].includes(k))||Buffer.byteLength(JSON.stringify(input.patch))>128*1024)fail('INVALID_PATCH','Use a small Timing field patch without media or a full original, never both.');
  const codec=require('./shared-library-evidence.cjs'),previous=old?codec.decode(old):{};if(!previous||typeof previous!=='object'||Array.isArray(previous))fail('INVALID_PATCH','Timing car companions must be objects.');
  const base=old||{id:extraId(namespace,input.sourceId,input.originalId),namespace,sourceId:input.sourceId,originalId:input.originalId,revision:0,...codec.encode({})};
  // Keep immutable compressed media/evidence chunks intact. Only the changed
  // Timing fields and the revision/hash are written to SQLite.
  return {...base,revision:base.revision+1,baseHash:base.baseHash||base.hash,overrides:{...base.overrides,...input.patch},hash:T.digest({...previous,...input.patch})};
 }
 if(input.rawOriginal===undefined)fail('INVALID_ORIGINAL','Preserve the complete original record.');
 return {id:extraId(namespace,input.sourceId,input.originalId),namespace,sourceId:input.sourceId,originalId:input.originalId,revision:(old?.revision||0)+1,...require('./shared-library-evidence.cjs').encode(input.rawOriginal)};
}
function attach(store,prepared,origin,companion){
 const {before,after}=prepared.scope;
 if(origin){const old=one(store,'libraryOrigins',origin.id);before.libraryOrigins=old?[old]:[];after.libraryOrigins=[origin];}
 if(companion){const old=one(store,'libraryExtras',companion.id);before.libraryExtras=old?[old]:[];after.libraryExtras=[companion];}
 return S.prepare(store,before,after,prepared.result);
}
function emptyChange(store,result){const before=S.context(store,'@history-import').data;return {scope:{before,after:{...before,revision:before.revision+1}},result};}
function execute(store,options,method,input,prepare){
 guard(store,input);if(!/^[\w-]{1,100}$/.test(input.operationId||''))fail('INVALID_OPERATION','Use a persistent operation ID.');
 const command={id:key(options.installationId,input.operationId),action:'@engine-'+method,payload:input,databaseId:input.databaseId,epoch:input.recoveryId};
 const saved=R.execute(store,command,()=>prepare());return {...saved.result,duplicate:!!saved.duplicate};
}
function adoption(store,options,entity,input){
 source(input);const oid=originId(input.sourceId,entity,input.originalId),old=one(store,'libraryOrigins',oid);
 if(entity==='session'&&(!/^[\w-]{1,100}$/.test(input.sessionId||'')||input.carIds!==undefined&&(!Array.isArray(input.carIds)||input.carIds.length>10000||input.carIds.some(id=>typeof id!=='string'||!/^[\w-]{1,100}$/.test(id)))))fail('INVALID_ORIGIN','Invalid original session or car identity.');
 const namespace=entity==='car'?'timing.carExtras':'timing.historyOriginals';
 if(old){guard(store,input);if(old.sourceHash!==T.digest(input.rawOriginal))fail('ORIGIN_CHANGED','This original was already adopted with different evidence. Preserve both versions and reconcile before editing.');return {...old,duplicate:true};}
 return execute(store,options,'adopt-'+entity,input,()=>{
  let prepared,result;
  if(entity==='car'){
   if(input.existingCarId){const car=Q.read(store,null,r=>{require('./car-merge-query.cjs').assertWritable(r,input.existingCarId);return r.one('cars',input.existingCarId);}).value;if(!car)fail('CAR_NOT_FOUND','Established car link no longer exists.');result={carId:car.id};prepared=emptyChange(store,result);}
   else {prepared=S.command(store,'car.save',{data:input.data});result={carId:prepared.result};prepared.result=result;}
  }else{
   const existing=Q.read(store,null,r=>r.record(JSON.stringify(['timing','sessions','session:'+JSON.stringify([input.sourceId,input.sessionId])]))).value;
   if(existing){result={sourceId:input.sourceId,sessionId:input.sessionId,accepted:{revision:existing.payload.revision,contentHash:existing.contentHash,state:existing.payload.state},existing:true};prepared=emptyChange(store,result);}
   else if(input.bundle){
    const operation={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,editor:{installationId:options.installationId,application:options.application,name:options.application},sourceId:input.sourceId,sessionId:input.sessionId,action:'create',expected:null,reason:input.reason||'Existing local racing history',bundle:input.bundle};
    prepared=require('./rich-history.cjs').prepare(store,{payload:operation},{nativeTiming:require('./shared-library-native-history.cjs').verified(store,input,{adoption:true})});result=prepared.result;
   }else {const reason=input.projectionReason||input.unprojectedReason;if(typeof reason!=='string'||!reason.trim())fail('PROJECTION_REQUIRED','Provide historical evidence or an explicit reason why the original cannot yet be projected.');result={sourceId:input.sourceId,sessionId:input.sessionId,projectionStatus:'raw-only',reason};prepared=emptyChange(store,result);}
  }
  const origin={id:oid,sourceId:input.sourceId,originalId:input.originalId,entity,sourceHash:T.digest(input.rawOriginal),...(result.projectionStatus==='raw-only'?{carIds:input.carIds||[],name:String(input.rawOriginal?.session?.setupName||input.rawOriginal?.session?.name||'Preserved original racing history').slice(0,200),lapCount:input.rawOriginal?.laps?.length||0}:{}),...result};prepared.result={...origin,databaseId:input.databaseId,recoveryId:input.recoveryId};
  if(entity==='session'&&prepared.scope.after.timing?.sessions?.some(r=>r.nativeTiming===1))origin.projectionVersion=2;
  if(origin.projectionStatus==='raw-only')Object.assign(origin,require('./shared-library-lap-counts.cjs').rawMeta(store,input.sourceId,input.rawOriginal,input.carIds||[]));
  return attach(store,prepared,origin,extra(namespace,input));
 });
}
function historyRead(store,input){
 const id=value=>{if(!/^[\w-]{1,100}$/.test(value||''))fail('INVALID_QUERY','Invalid history identity.');return value;};
 let route;if(input.kind==='sessions')route='/sessions';else if(input.kind==='statistics')route='/cars/'+id(input.carId)+'/statistics';else if(['detail','laps'].includes(input.kind))route='/sessions/'+id(input.sourceId)+'/'+id(input.sessionId)+(input.kind==='laps'?'/laps/'+id(input.participantId):'');else fail('INVALID_QUERY','Unknown history view.');
 const url=new URL('http://shared.local/v1/shared-history'+route);
 if(['sessions','statistics'].includes(input.kind))url.searchParams.set('dateBasis','available');
 const names=input.kind==='sessions'?['carId','sourceId','trackId','from','to','q','state','limit','page']:input.kind==='laps'?['offset','token']:input.kind==='statistics'?['sourceId','trackId','from','to','lane','driverId','sessionId','participantId','snapshot']:[];
 for(const k of names)if(input[k]!==undefined)url.searchParams.set(k,String(input[k]));return require('./shared-history-read.cjs').read(store,url.href);
}
async function call(store,options,method,input={}){
 if(method==='repairNativeHistory')return execute(store,options,method,input,()=>{
  const origin=one(store,'libraryOrigins',input.originId),native=require('./shared-library-native-history.cjs');
  if(!origin||origin.existing||origin.databaseId!==input.databaseId||origin.recoveryId!==input.recoveryId||origin.sourceHash!==input.sourceHash||origin.accepted?.revision!==1||origin.accepted.state!=='active'||T.canonical(origin.accepted)!==T.canonical(input.expected))fail('REVISION_CONFLICT','Native history adoption changed; retain the current version.');
  const current=Q.read(store,null,r=>r.record(JSON.stringify(['timing','sessions','session:'+JSON.stringify([origin.sourceId,origin.sessionId])]))).value;
  if(!current||current.nativeTiming||current.format!=='history-v1'||current.payload.revision!==1||current.payload.state!=='active'||current.contentHash!==origin.accepted.contentHash)fail('REVISION_CONFLICT','This history has been corrected or withdrawn; automatic repair will not replace it.');
  const companion=one(store,'libraryExtras',extraId('timing.historyOriginals',origin.sourceId,origin.originalId));
  if(!companion||companion.hash!==origin.sourceHash)fail('ORIGIN_CHANGED','Original evidence changed.');
  const raw=require('./shared-library-evidence.cjs').decode(companion),bundle=native.project(store,origin.sourceId,raw);
  if(!bundle||T.digest(raw)!==origin.sourceHash)fail('ORIGIN_CHANGED','Original evidence cannot be projected safely.');
  const operation={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,editor:{installationId:options.installationId,application:options.application,name:'Native Timing history repair'},sourceId:origin.sourceId,sessionId:origin.sessionId,action:'replace',expected:input.expected,reason:'Correct native Timing lap semantics from preserved originals',bundle};
  const prepared=require('./rich-history.cjs').prepare(store,{payload:operation},{nativeTiming:true});
  return attach(store,prepared,{...origin,projectionVersion:native.VERSION},null);
 });
 if(method==='backup'){
  const state=Q.read(store,null,r=>({databaseId:r.id,recoveryId:r.epoch,revision:r.revision})).value,fs=require('node:fs'),path=require('node:path');
  if(input.databaseId!==state.databaseId)fail('DATABASE_MISMATCH','This backup belongs to another library.');
  if(input.recoveryId!==state.recoveryId)fail('RECOVERY_CHANGED','Refresh the restored library before creating its backup.');
  if(!Number.isSafeInteger(input.revision)||input.revision!==state.revision)fail('REVISION_CONFLICT','The library changed. Refresh before creating its backup.');
  if(typeof input.destination!=='string'||!path.isAbsolute(input.destination)||path.extname(input.destination).toLowerCase()!=='.sfpbackup')fail('INVALID_DESTINATION','Choose an absolute .sfpbackup destination.');
  if(fs.existsSync(input.destination))fail('DESTINATION_EXISTS','Choose a new backup file; existing files are preserved.');
  if(process.platform==='win32'&&path.join(path.dirname(input.destination),'.slotforge-backup-'+ '0'.repeat(36)+'.tmp-journal').length>=260)fail('LIBRARY_PATH_TOO_LONG','Choose a shorter backup folder for SQLite staging.');
  const saved=require('./portable-backup.cjs').exportBackup(store.file,input.destination,{expectedIdentity:JSON.stringify([state.databaseId,state.revision]),expectedEpoch:state.recoveryId,exclusive:true});
  return {...saved,databaseId:state.databaseId,recoveryId:state.recoveryId,revision:state.revision};
 }
 if(method==='status')return Q.read(store,null,r=>({engineVersion:'1.0.0',databaseId:r.id,recoveryId:r.epoch,revision:r.revision,file:store.file,changeCursor:Buffer.from(JSON.stringify({databaseId:r.id,epoch:r.epoch,after:Number(r.db.prepare("SELECT value FROM state WHERE key='change_sequence'").get().value)})).toString('base64url'),capabilities:{sharedLocal:true,cars:true,history:true,automaticAdoption:true}})).value;
 if(method==='carSchema')return C.schema(store);
 if(method==='carIdentity')return Q.read(store,null,r=>r.merges.identity(input.carId)).value;
 if(method==='mergeMappings')return Q.read(store,null,r=>r.merges.mappings(input)).value;
 if(method==='mergeContributions')return require('./car-merge-query.cjs').contributions(store,input);
 if(method==='timingSettings')return require('./car-merge-settings-store.cjs').read(store,input);
 if(method==='timingSettingsWrite')return execute(store,options,method,input,()=>require('./car-merge-settings-store.cjs').prepare(store,options,input));
 if(method==='customSchema')return require('./shared-library-custom.cjs').schema(store);
 if(method==='customRead')return require('./shared-library-custom.cjs').read(store,input);
 if(method==='customDefinitionWrite')return execute(store,options,method,input,()=>require('./shared-library-custom.cjs').definition(store,input));
 if(method==='serviceRead')return require('./shared-library-service.cjs').read(store,input);
 if(method==='serviceWrite')return execute(store,options,method,input,()=>require('./shared-library-service.cjs').prepare(store,options,input));
 if(method==='catalogue')return Q.read(store,input.token,r=>{if(input.offset&&!input.token)fail('SNAPSHOT_REQUIRED','Continue with the listing token.');const p=r.list('cars',{offset:input.offset||0,limit:input.limit||50,query:input.search||'',sort:input.sort||'name',archived:input.archived??false});return {...p,cars:p.rows.map(car=>({...C.project(car),hasPicture:!!(require('./lazy-assets.cjs').property(car,'picture')||car.picture),galleryCount:car.photos?.length||0})),rows:undefined};}).value;
 if(method==='car')return Q.read(store,null,r=>{const car=r.one('cars',input.id);if(!car)fail('CAR_NOT_FOUND','Car no longer exists.');return {databaseId:r.id,recoveryId:r.epoch,...C.project(car),...(input.includeMedia?{picture:car.picture||'',photos:car.photos||[]}:{})};}).value;
 if(method==='profile'){Q.read(store,null,r=>require('./car-merge-query.cjs').assertWritable(r,input.carId));return T.profile(store,input.carId,{includePicture:!!input.includePicture});}
 if(method==='carWrite')return execute(store,options,method,input,()=>{
  const {timingExtras,timingSettings,customValues,...operation}=input;
  if(timingExtras!==undefined&&timingSettings!==undefined)fail('INVALID_OPERATION','Choose original or effective Timing settings, not both.');
  let prepared=C.prepare(store,{payload:{version:1,...operation,sourceId:options.installationId}},{allowCompanionOnly:timingExtras!==undefined||timingSettings!==undefined||customValues!==undefined});
  if(customValues!==undefined){if(!['create','patch'].includes(operation.action))fail('INVALID_OPERATION','Custom values require create or patch.');prepared=require('./shared-library-custom.cjs').attach(store,prepared,operation,customValues);}
  if(timingSettings!==undefined){
   if(operation.action!=='patch'||!timingSettings||typeof timingSettings!=='object'||Array.isArray(timingSettings)||Object.keys(timingSettings).some(k=>!['expectedRevision','expectedBindingToken','set'].includes(k)))fail('INVALID_OPERATION','Effective Timing settings require a patch with their current binding revision and token.');
   const settings=require('./car-merge-settings-store.cjs').prepare(store,options,{databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,carId:operation.carId,sourceId:options.installationId,action:'patch',...timingSettings});
   const result={...prepared.result,timingSettings:settings.result};
   if(prepared.noop)return {...settings,result};
   return S.prepare(store,{...prepared.scope.before,mergeCompanions:settings.scope.before.mergeCompanions},{...prepared.scope.after,mergeCompanions:settings.scope.after.mergeCompanions},result);
  }
  if(timingExtras===undefined)return prepared;
  source(timingExtras);writableOrigin(store,timingExtras);const old=one(store,'libraryExtras',extraId('timing.carExtras',timingExtras.sourceId,timingExtras.originalId));if(timingExtras.expectedRevision!==(old?.revision||0))fail('REVISION_CONFLICT','Timing companion fields changed. Reopen this car before saving.');
  const oid=originId(timingExtras.sourceId,'car',timingExtras.originalId),origin=one(store,'libraryOrigins',oid),carId=prepared.result.car.id;if(origin&&origin.carId!==carId)fail('ORIGIN_CONFLICT','This Timing identity already belongs to another shared car.');
  if(prepared.noop)prepared=emptyChange(store,prepared.result);
  const companion=extra('timing.carExtras',timingExtras,old),created=origin?null:{id:oid,sourceId:timingExtras.sourceId,originalId:timingExtras.originalId,entity:'car',carId,sourceHash:companion.hash};
  prepared.result={...prepared.result,timingExtras:{sourceId:companion.sourceId,originalId:companion.originalId,revision:companion.revision,hash:companion.hash}};
  return attach(store,prepared,created,companion);
 });
 if(method==='historyWrite')return execute(store,options,method,input,()=>{
  const {rawOriginal,...operation}=input;const prepared=operation.bundle?.format==='history-v1'||!operation.bundle&&Q.read(store,null,r=>r.record(JSON.stringify(['timing','sessions','session:'+JSON.stringify([input.sourceId,input.sessionId])]))?.format==='history-v1').value?require('./rich-history.cjs').prepare(store,{payload:operation},{nativeTiming:require('./shared-library-native-history.cjs').verified(store,input)}):require('./shared-history.cjs').prepare(store,{payload:operation});
  if(rawOriginal===undefined)return prepared;const raw={sourceId:input.sourceId,originalId:input.sessionId,rawOriginal},old=one(store,'libraryExtras',extraId('timing.historyOriginals',raw.sourceId,raw.originalId));return attach(store,prepared,null,extra('timing.historyOriginals',raw,old));
 });
 if(method==='historyRead')return historyRead(store,input);
 if(method==='timingRead')return ['sessions','session'].includes(input.kind)?historyRead(store,{...input,kind:input.kind==='session'?'detail':'sessions'}):require('./shared-library-timing-read.cjs').read(store,input);
 if(method==='originalHistory')return require('./shared-library-raw-history.cjs').read(store,input);
 if(method==='originalHistoryWrite')return execute(store,options,method,input,()=>require('./shared-library-raw-history.cjs').prepare(store,input));
 if(method==='changes'){const url=new URL('http://shared.local/v1/scalable/changes');url.searchParams.set('kind',input.kind||'cars');url.searchParams.set('cursor',input.after);return require('./scalable-api.cjs').handle(store,'GET',url,{browse:true,timingResults:true},store.data.id);}
 if(method==='receipt'){guard(store,input);return Q.read(store,null,r=>{const row=r.db.prepare('SELECT epoch,result FROM command_receipts WHERE id=?').get(key(options.installationId,input.operationId));if(!row)fail('OPERATION_NOT_FOUND','No durable receipt exists. Retry only the identical operation.');if(row.epoch!==input.recoveryId)fail('RECOVERY_CHANGED','Receipt belongs to an older recovery generation.');return {...R.decodeResult(row.result),duplicate:true};}).value;}
 if(method==='adoptCar')return adoption(store,options,'car',input);
 if(method==='adoptSession')return adoption(store,options,'session',input);
 if(method==='origin'){source(input);return one(store,'libraryOrigins',originId(input.sourceId,input.entity||'car',input.originalId));}
 if(method==='adoptionStatus')return Q.read(store,input.token,r=>{const offset=input.offset??0,limit=input.limit??100;if(!/^[\w-]{1,100}$/.test(input.sourceId||'')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||input.entity!==undefined&&!['car','session'].includes(input.entity))fail('INVALID_QUERY','Invalid adoption page.');if(offset&&!input.token)fail('SNAPSHOT_REQUIRED','Continue with the original adoption-page token.');let where="FROM records r JOIN record_fields f ON f.record=r.key AND f.path='[\"sourceId\"]' WHERE r.bucket='[\"libraryOrigins\"]' AND f.json=?";const args=[JSON.stringify(input.sourceId)];if(input.entity){where+=" AND EXISTS(SELECT 1 FROM record_fields e WHERE e.record=r.key AND e.path='[\"entity\"]' AND e.json=?)";args.push(JSON.stringify(input.entity));}const total=r.db.prepare('SELECT count(*) n '+where).get(...args).n,rows=r.db.prepare('SELECT r.key '+where+' ORDER BY r.key LIMIT ? OFFSET ?').all(...args,limit,offset).map(x=>r.record(x.key));return {rows,total,token:r.token,nextOffset:offset+rows.length<total?offset+rows.length:null};}).value;
 if(method==='extensionRead'){source(input);const row=one(store,'libraryExtras',extraId(input.namespace,input.sourceId,input.originalId));if(!row)return null;let value=require('./shared-library-evidence.cjs').decode(row);const {data,chunks,overrides,baseHash,...meta}=row;let complete=true;if(input.selectedFields!==undefined){if(!Array.isArray(input.selectedFields)||input.selectedFields.length>100||input.selectedFields.some(k=>typeof k!=='string'||k.length>200))fail('INVALID_QUERY','Invalid selected companion fields.');value=Object.fromEntries(input.selectedFields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));complete=false;}if(input.omitMedia){value={...value};delete value.picture;delete value.extraPictures;complete=false;}return {...meta,value,complete};}
 if(method==='extensionWrite')return execute(store,options,method,input,()=>{if(input.namespace==='timing.carExtras')writableOrigin(store,input);const old=one(store,'libraryExtras',extraId(input.namespace,input.sourceId,input.originalId));if(input.expectedRevision!==(old?.revision||0))fail('REVISION_CONFLICT','Companion data changed.');const next=extra(input.namespace,input,old);return attach(store,emptyChange(store,{id:next.id,revision:next.revision,hash:next.hash}),null,next);});
 fail('UNKNOWN_METHOD','Unknown shared library operation.');
}
module.exports={call};
