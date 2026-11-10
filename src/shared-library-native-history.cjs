'use strict';
// Only the same-account engine calls this path. Public historical imports do
// not acquire native Timing semantics from a payload flag or application name.
const Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs'),P=require('./timing-legacy/project.cjs');
const VERSION=2;
function project(store,sourceId,raw){
 if(!raw?.session||!Array.isArray(raw.laps))return null;
 const carIds=Q.read(store,null,r=>Object.fromEntries(r.db.prepare(`SELECT json_extract(o.json,'$') originalId,json_extract(c.json,'$') carId FROM records x JOIN record_fields s ON s.record=x.key AND s.path='["sourceId"]' JOIN record_fields e ON e.record=x.key AND e.path='["entity"]' JOIN record_fields o ON o.record=x.key AND o.path='["originalId"]' JOIN record_fields c ON c.record=x.key AND c.path='["carId"]' WHERE x.bucket='["libraryOrigins"]' AND s.json=? AND e.json='"car"'`).all(JSON.stringify(sourceId)).map(x=>[x.originalId,x.carId]))).value;
 return P.session(raw.session,raw.laps,{databaseId:store.data.id,carIds}).bundle;
}
function verified(store,input,{adoption=false}={}){
 if(input.bundle?.format!=='history-v1'||!input.rawOriginal)return false;
 if(input.rawOriginal.session?.id!==input.sessionId)return false;
 if(!adoption){
  const originalId=input.rawOriginal.session?.id,origin=Q.read(store,null,r=>r.record(JSON.stringify(['libraryOrigins','id:origin-'+T.digest([input.sourceId,'session',originalId])]))).value;
  if(!origin||origin.existing||origin.sessionId!==input.sessionId)return false;
 }
 const bundle=project(store,input.sourceId,input.rawOriginal);
 return !!bundle&&T.digest(bundle)===T.digest(input.bundle);
}
async function repair(file,root){
 const {Store}=require('./store.cjs'),fs=require('node:fs'),path=require('node:path'),E=require('./shared-library-engine.cjs');
 const initial=new Store(file,{deferred:true}),identity=require('./shared-history.cjs').status(initial);
 const keys=Q.read(initial,null,r=>r.db.prepare(`SELECT x.key FROM records x JOIN record_fields e ON e.record=x.key AND e.path='["entity"]' WHERE x.bucket='["libraryOrigins"]' AND e.json='"session"' AND NOT EXISTS(SELECT 1 FROM record_fields v WHERE v.record=x.key AND v.path='["projectionVersion"]' AND v.json=?) ORDER BY x.key`).all(String(VERSION)).map(x=>x.key)).value;
 let repaired=0,skipped=0,backup=null;
 for(const key of keys){
  const store=new Store(file,{deferred:true}),state=require('./shared-history.cjs').status(store);
  if(state.databaseId!==identity.databaseId||state.recoveryId!==identity.recoveryId)throw Object.assign(Error('Library recovery changed during native history repair.'),{code:'RECOVERY_CHANGED'});
  const origin=Q.read(store,null,r=>r.record(key)).value;
  if(!origin||origin.existing||origin.recoveryId!==state.recoveryId||origin.databaseId!==state.databaseId||origin.accepted?.revision!==1||origin.accepted.state!=='active'){skipped++;continue;}
  const evidence=Q.read(store,null,r=>({current:r.record(JSON.stringify(['timing','sessions','session:'+JSON.stringify([origin.sourceId,origin.sessionId])])),raw:r.record(JSON.stringify(['libraryExtras','id:extra-'+T.digest(['timing.historyOriginals',origin.sourceId,origin.originalId])]))})).value;
  const current=evidence.current;
  if(!current||current.format!=='history-v1'||current.nativeTiming||current.payload.revision!==1||current.payload.state!=='active'||current.contentHash!==origin.accepted.contentHash||!evidence.raw||evidence.raw.hash!==origin.sourceHash){skipped++;continue;}
  const raw=require('./shared-library-evidence.cjs').decode(evidence.raw),bundle=project(store,origin.sourceId,raw);
  if(!bundle||T.digest(raw)!==origin.sourceHash){skipped++;continue;}
  const missing=Q.read(store,null,r=>bundle.race.participants.some(p=>p.carId&&!r.one('cars',p.carId))).value;
  if(missing){skipped++;continue;}
  if(!backup){const folder=path.join(root,'recovery');fs.mkdirSync(folder,{recursive:true});backup=path.join(folder,'native-history-'+Date.now()+'.sfpbackup');require('./portable-backup.cjs').exportBackup(file,backup,{expectedIdentity:store.expectedIdentity,expectedEpoch:state.recoveryId,exclusive:true});}
  try{await E.call(store,{application:'SlotForge Paddock',installationId:'native-history-repair'},'repairNativeHistory',{databaseId:state.databaseId,recoveryId:state.recoveryId,operationId:'native-v2-'+T.digest([origin.id,origin.sourceHash]),originId:origin.id,sourceHash:origin.sourceHash,expected:origin.accepted});repaired++;}
  catch(e){if(['REVISION_CONFLICT','QUERY_CHANGED'].includes(e.code||e.apiCode)){skipped++;continue;}throw e;}
 }
 return {version:VERSION,repaired,skipped,backup};
}
module.exports={VERSION,project,verified,repair};
