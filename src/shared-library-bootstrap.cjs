'use strict';
// Automatic, one-time adoption of pre-existing local Timing data. The reader
// is bundled with both applications and never opens the source for writing.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const E=require('./shared-library-engine.cjs'),R=require('./timing-legacy/index.cjs'),P=require('./timing-legacy/project.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function appData(){return process.platform==='win32'?process.env.APPDATA:process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support'):process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config');}
function discover(options){if(options.legacyProfiles!==undefined)return options.legacyProfiles.map(p=>typeof p==='string'?R.describe(p):p).filter(Boolean);if(options.sharedRoot&&!options.appData)return [];return R.discover({appData:options.appData||appData()});}
function paddockPath(options){if(options.legacyPaddockPath)return options.legacyPaddockPath;if(options.sharedRoot&&!options.appData)return null;const base=options.appData||appData();for(const name of ['slotforge-database','SlotForge Paddock']){const file=path.join(base,name,'database.json');if(fs.existsSync(file)||fs.existsSync(file.replace(/\.json$/,'.sqlite')))return file;}return null;}
async function adopt(file,root,options){
 require('./shared-library-key.cjs').ensure(file);
 const descriptors=discover(options),result=[];
 for(const descriptor of descriptors){
  // Adoption is a one-time cutover, not an automatic re-import after a reset
  // or restore. Old application files must never resurrect deleted records.
  const marker=path.join(root,'adopted-timing-'+descriptor.originKey+'.json');if(fs.existsSync(marker)){const saved=JSON.parse(fs.readFileSync(marker,'utf8'));if(saved.version!==1||typeof saved.sourceId!=='string')throw Object.assign(Error('Invalid local adoption receipt.'),{code:'ADOPTION_RECEIPT_INVALID'});result.push({...saved,originKey:descriptor.originKey});continue;}
  const reader=R.open({profile:descriptor.profile});
  try{
   const sourceId=reader.sourceId||'legacy-'+descriptor.originKey,client={application:'SlotForge Timing',installationId:sourceId};
   const store=()=>new(require('./store.cjs').Store)(file,{deferred:true}),status=await E.call(store(),client,'status'),identity={databaseId:status.databaseId,recoveryId:status.recoveryId};
   const recovery=path.join(root,'recovery'),shortKey=descriptor.originKey.slice(0,32);
   // SQLite still needs space for its journal suffix on Windows. Keep backup
   // names short and check the longest temporary SQLite path before adoption.
   if(process.platform==='win32'&&path.join(recovery,'.slotforge-backup-'+ '0'.repeat(36)+'.tmp-journal').length>=260)throw Object.assign(Error('The shared library path is too long for safe SQLite backups. Use a shorter library folder; the original Timing data has not been changed.'),{code:'LIBRARY_PATH_TOO_LONG'});
   fs.mkdirSync(recovery,{recursive:true});
   const backupFile=path.join(recovery,'t-'+shortKey+(descriptor.backend==='sqlite'?'.sqlite':'.json'));
   if(!fs.existsSync(backupFile)){
    if(descriptor.backend==='json')fs.copyFileSync(descriptor.file,backupFile,fs.constants.COPYFILE_EXCL);
    else {const {DatabaseSync,backup}=require('node:sqlite'),db=new DatabaseSync(descriptor.file,{readOnly:true,timeout:5000});try{await backup(db,backupFile);}finally{db.close();}}
   }
   const canonicalBackup=path.join(recovery,'p-'+shortKey+'.sfpbackup');if(!fs.existsSync(canonicalBackup))require('./portable-backup.cjs').exportBackup(file,canonicalBackup);
   const pageAll=(entity)=>{const rows=[];for(let after=-1;;){const p=reader.page(entity,{after});rows.push(...p.rows.map(r=>r.value));if(p.next===null)break;after=p.next;}return rows;};
   const raceClasses=pageAll('raceclasses'),carIds={},customIds={},serviceCars=[];let cars=0,sessions=0,originalOnly=0;
   const customDefinitions=reader.get('@meta','customFields',{media:false})?.slotcars||[];
   if(!Array.isArray(customDefinitions))throw Object.assign(Error('Invalid legacy custom field definitions; original backup retained.'),{code:'INVALID_FIELD'});
   for(const definition of customDefinitions){
    const fieldId='timing-field-'+hash(JSON.stringify([sourceId,definition.id]));customIds[definition.id]=fieldId;
    if(!store().data.customFields.some(f=>f.id===fieldId))await E.call(store(),client,'customDefinitionWrite',{...identity,operationId:'adopt-field-'+hash(definition.id),fieldId,expectedRevision:0,legacy:{sourceId,fieldId:definition.id},definition:{label:definition.label,type:definition.type==='list'?'choice':definition.type,group:definition.group||'',options:definition.options||[]}});
   }
   for(let after=-1;;){const page=reader.page('slotcars',{after,limit:25});for(const row of page.rows){
    const converted=P.car(row.value,{raceClasses,databaseId:status.databaseId});
    converted.data.custom=Object.fromEntries(Object.entries(row.value.custom||{}).filter(([id])=>customIds[id]).map(([id,v])=>[customIds[id],v===null||v===undefined?'':String(v)]));
    const saved=await E.call(store(),client,'adoptCar',{...identity,sourceId,operationId:'adopt-car-'+hash(row.id),...converted});carIds[row.id]=saved.carId;serviceCars.push({id:row.id,carId:saved.carId,raw:Object.fromEntries(['lapsDriven','lapsSinceService','servicesDone','serviceDate'].map(k=>[k,row.value[k]]))});cars++;
   }if(page.next===null)break;after=page.next;}
   const sessionIds=new Set();
   for(let after=-1;;){const page=reader.page('sessions',{after,limit:10});for(const row of page.rows){
    sessionIds.add(row.id);const laps=[];for(let cursor=-1;;){const p=reader.sessionLaps(row.id,{after:cursor,limit:200});laps.push(...p.rows.map(l=>l.value));if(p.next===null)break;cursor=p.next;}
    const converted=P.session(row.value,laps,{databaseId:status.databaseId,carIds});
    const saved=await E.call(store(),client,'adoptSession',{...identity,sourceId,operationId:'adopt-session-'+hash(row.id),...converted,carIds:[...new Set(laps.filter(l=>!l.virtual&&!l.virtualRival).map(l=>carIds[l.carId]).filter(Boolean))]});if(saved.projectionStatus==='raw-only')originalOnly++;sessions++;
   }if(page.next===null)break;after=page.next;}
   // Retain orphaned laps too. Do not fabricate a measured session around them.
   const orphaned=[];for(let after=-1;;){const p=reader.page('laps',{after,limit:200});for(const row of p.rows)if(!sessionIds.has(row.value.sessionId))orphaned.push(row.value);if(p.next===null)break;after=p.next;}
   if(orphaned.length){const id='orphan-'+hash(sourceId);await E.call(store(),client,'adoptSession',{...identity,sourceId,operationId:id,originalId:id,sessionId:id,bundle:null,projectionReason:'Original laps have no surviving session record.',rawOriginal:{session:null,laps:orphaned},carIds:[...new Set(orphaned.map(l=>carIds[l.carId]).filter(Boolean))]});originalOnly++;}
   for(const item of serviceCars){
    const car=await E.call(store(),client,'serviceRead',{carId:item.carId});if(car.service.revision)continue;
    const raw=item.raw,values={};for(const [old,key]of [['lapsDriven','lapsDriven'],['lapsSinceService','lapsSinceService'],['servicesDone','servicesDone']])if(Number.isSafeInteger(raw[old])&&raw[old]>=0)values[key]=raw[old];
    if(raw.serviceDate&&Number.isFinite(Date.parse(raw.serviceDate)))values.lastServicedAt=new Date(raw.serviceDate).toISOString();
    await E.call(store(),client,'serviceWrite',{...identity,operationId:'adopt-service-'+hash(item.id),action:'initialize',carId:item.carId,expectedCarRevision:car.carRevision,expectedRevision:0,values});
   }
   if(!reader.finish().unchanged)throw Object.assign(Error('The old Timing database changed during adoption. Its originals and imported evidence are retained; complete adoption with the old writer stopped.'),{code:'LEGACY_CHANGED'});
   const saved={version:1,...identity,originKey:descriptor.originKey,sourceId,cars,sessions,originalOnly,originalBackup:backupFile};const temp=marker+'.tmp-'+crypto.randomUUID();fs.writeFileSync(temp,JSON.stringify(saved),{flag:'wx',mode:0o600});fs.renameSync(temp,marker);result.push(saved);
  }finally{reader.close();}
 }
 return result;
}
module.exports={discover,paddockPath,adopt,appData};
