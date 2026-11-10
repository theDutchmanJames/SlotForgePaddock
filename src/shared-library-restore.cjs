'use strict';
// Explicit whole-library restore, never a background synchronization operation.
// The marker is committed with the restored records, so a lost reply can be
// resolved without applying an old backup a second time.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Q=require('./sqlite-query.cjs'),B=require('./portable-backup.cjs'),L=require('./shared-library-location.cjs'),T=require('./timing-integration.cjs');
const fault=(code,message)=>Object.assign(Error(message),{code});
function state(store){return Q.read(store,null,r=>({databaseId:r.id,recoveryId:r.epoch,revision:r.revision,restore:r.scalar('libraryRestore')})).value;}
function check(s,input){
 if(s.databaseId!==input.databaseId)throw fault('DATABASE_MISMATCH','This restore was prepared for another shared library.');
 if(s.recoveryId!==input.recoveryId)throw fault('RECOVERY_CHANGED','The library was restored. Do not retarget the old restore request.');
 if(s.revision!==input.revision)throw fault('REVISION_CONFLICT','The library changed. Review the restore again before replacing it.');
}
function receipt(s,marker,duplicate){return {status:'restored',operationId:marker.operationId,databaseId:s.databaseId,recoveryId:s.recoveryId,revision:marker.restoredRevision,sourceDigest:marker.sourceDigest,recoveryBackup:marker.recoveryBackup,duplicate,reopenRequired:true};}
async function restore(file,options,input){
 if(!input||!/^[\w-]{1,100}$/.test(input.operationId||'')||typeof input.source!=='string'||!path.isAbsolute(input.source)||!Number.isSafeInteger(input.revision)||input.revision<0)throw fault('INVALID_RESTORE','Restore requires an operation ID, captured library identity/revision and an absolute backup path.');
 const {Store}=require('./store.cjs'),store=new Store(file,{deferred:true}),current=state(store),requestHash=T.digest(input),key=T.digest([options.installationId,input.operationId]);
 if(current.restore?.key===key){
  if(current.restore.requestHash!==requestHash)throw fault('OPERATION_CONFLICT','This restore ID was already used with different inputs.');
  // Finish a registration update if the previous worker stopped after commit.
  const pending=path.join(options.sharedRoot,'replacement.json');
  if(fs.existsSync(pending)){const ticket=JSON.parse(fs.readFileSync(pending,'utf8'));if(ticket.previousId===input.databaseId&&path.resolve(ticket.file)===path.resolve(file))await L.finishReplacement(options.sharedRoot,ticket);}
  return receipt(current,current.restore,true);
 }
 if(input.databaseId!==options.openedDatabaseId)throw fault('DATABASE_MISMATCH','Reopen the shared library before preparing another restore.');
 check(current,input);
 if(require('./files.cjs').sameFile(file,input.source))throw fault('INVALID_RESTORE','Choose a portable backup, not the active database.');
 const folder=path.join(options.sharedRoot,'recovery');
 if(process.platform==='win32'&&path.join(folder,'.slotforge-backup-'+ '0'.repeat(36)+'.tmp-journal').length>=260)throw fault('LIBRARY_PATH_TOO_LONG','The library recovery folder is too long for safe SQLite staging.');
 fs.mkdirSync(folder,{recursive:true});const token=crypto.randomUUID(),stage=path.join(folder,'s-'+token+'.sqlite'),recoveryBackup=path.join(folder,'r-'+token+'.sfpbackup');let ticket,committed=false;
 try{
  const staged=B.stageBackup(input.source,stage);require('./shared-library-key.cjs').ensure(stage);const validated=new Store(stage).data;
  check(state(store),input);
  const result=await L.withReplacement(options.sharedRoot,file,input.databaseId,async active=>{
   ticket=active;check(state(store),input);
   B.exportBackup(file,recoveryBackup,{expectedIdentity:JSON.stringify([input.databaseId,input.revision]),expectedEpoch:input.recoveryId,exclusive:true});
   const marker={version:1,key,operationId:input.operationId,installationId:options.installationId,requestHash,sourceDigest:staged.sourceDigest,recoveryBackup,restoredRevision:input.revision+1,previous:{databaseId:input.databaseId,recoveryId:input.recoveryId,revision:input.revision}};
   validated.libraryRestore=marker;
   await store.restoreAsync(validated,input.revision,()=>check(state(store),input));committed=true;
   const after=state(store);if(after.restore?.key!==key||after.recoveryId===input.recoveryId)throw fault('RESTORE_UNCERTAIN','Restore committed but its acknowledgement could not be verified. Retain the operation ID.');
   return receipt(after,marker,false);
  });ticket=null;return result;
 }catch(error){
  if(committed){const uncertain=fault('RESTORE_UNCERTAIN','The restore committed but its registration acknowledgement failed. Retry only this identical restore operation.');uncertain.details={operationId:input.operationId,recoveryBackup};throw uncertain;}
  throw error;
 }finally{
  // After a committed uncertain restore retain the registration ticket. A
  // retry/open can finish it; never discard proof that this replacement was intended.
  if(ticket&&!committed)await L.finishReplacement(options.sharedRoot,ticket);
  for(const suffix of ['','-journal','-wal','-shm'])if(fs.existsSync(stage+suffix))fs.unlinkSync(stage+suffix);
 }
}
module.exports={restore};
