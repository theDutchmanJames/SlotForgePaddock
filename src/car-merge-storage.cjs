'use strict';
// Shared approval transaction for the normal host and isolated qualification.
// Activation is checked by the trusted dispatcher and again by its worker.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('./sqlite-storage.cjs'),M=require('./car-merge-model.cjs'),A=require('./car-merge-archive.cjs'),R=require('./command-receipts.cjs'),B=require('./portable-backup.cjs');
const {cloneJSON:clone}=require('./json-data.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const enabled=()=>require('./car-merge-activation.json').enabled===true;
function execute(){fail('MERGE_COMPATIBILITY_REQUIRED','Merging is not activated. Complete Review and client compatibility qualification first.');}
function validate(data,before,qualification=true){
 // Schema 12 is reserved for these disposable qualification files. Old engines
 // reject it rather than silently dropping new identity/archive invariants.
 if(data.schema!==(qualification?12:11))fail('MERGE_COMPATIBILITY_REQUIRED','Unsupported merge collection version.');
 require('./store.cjs').validateDatabase({...data,schema:11});if(data.mergeMeta)M.validate(data,before);
}
function openQualification(directory){
 const root=fs.realpathSync(directory),tmp=fs.realpathSync(os.tmpdir()),relative=path.relative(tmp,root);
 if(!process.env.NODE_TEST_CONTEXT||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(root).startsWith('slotforge-merge-qualification-'))execute();
 const file=path.join(root,'qualification.sqlite');
 return repository(file,root,true);
}
function openHost(file){
 // The path comes from the already-open Store, never renderer arguments.
 const actual=fs.realpathSync(file);
 return repository(actual,path.join(path.dirname(actual),'merge-recovery'),false);
}
function repository(file,root,qualification){
 const check=(data,before)=>validate(data,before,qualification);
 function read(){const data=S.read(file,false,true);check(data);return data;}
 function state(){
  // Pair metadata and recovery generation across independent SQLite reads.
  // A restore can preserve the visible revision while replacing its epoch.
  for(let attempt=0;attempt<3;attempt++){
   const first=S.syncState(file),data=read(),last=S.syncState(file);
   if(first.epoch===last.epoch&&first.after===last.after&&JSON.stringify(first.identity)===JSON.stringify(last.identity)&&JSON.stringify(last.identity)===JSON.stringify([data.id,data.revision]))return {data,recoveryId:last.epoch};
  }
  fail('MERGE_REVIEW_STALE','The collection changed while reading. Reopen the review.');
 }
 return {
  file,
  initialize(data){if(!qualification)execute();if(fs.existsSync(file))throw Error('Qualification file already exists.');const next=clone(data);next.schema=12;M.init(next);check(next);S.write(file,S.pack(next),null);},
  read,state,
  command(command,{afterBackup,beforeCommit}={}){
   if(!qualification&&state().data.club?.replica)fail('MERGE_AUTHORITY_REQUIRED','Open merge Review on the dealership computer. This downloaded copy cannot approve or edit merges.');
   const receiptCommand={id:'merge-op-'+A.digest([command.sourceId,command.operationId]),action:'car.merge.'+command.action,databaseId:command.databaseId,epoch:command.recoveryId,payload:command};
   let existing;
   try{existing=R.lookupFile(file,receiptCommand);}
   catch(e){
    if(e.code!=='COMMAND_EPOCH_CHANGED')throw e;
    const current=state();
    fail(current.data.id!==command.databaseId?'DATABASE_MISMATCH':'RECOVERY_CHANGED','The collection was replaced. Reopen merge Review before saving again.');
   }
   if(existing)return existing;
   const {data:before,recoveryId}=state(),identity=JSON.stringify([before.id,before.revision]);let backup;
   if(command.action==='approve'){
    // Preflight before creating an expensive recovery copy. The actual commit
    // repeats validation after backup against fresh state and generation.
    const p=M.preflight(before,command.payload,recoveryId);
    const dependencyToken=M.token(before,p.mainCarId,p.retiredCarId);
    const destination=path.join(root,'before-'+require('node:crypto').randomUUID().slice(0,18)+'.sfpbackup');
    fs.mkdirSync(root,{recursive:true});
    try{B.exportBackup(file,destination,{exclusive:true,expectedIdentity:identity,expectedEpoch:recoveryId});const verified=B.verify(destination);backup={verified:true,path:destination,digest:verified.digest,databaseId:before.id,recoveryId,dependencyToken};}
    catch(e){fail('MERGE_BACKUP_FAILED','No merge applied: '+e.message);}
    afterBackup?.();
   }
   const current=state();if(current.recoveryId!==command.recoveryId)fail('RECOVERY_CHANGED','The collection was restored during this operation.');
   if(backup){try{if(B.verify(backup.path).digest!==backup.digest)throw Error('Recovery copy changed.');}catch(e){fail('MERGE_BACKUP_FAILED','No merge applied: '+e.message);}}
   if(!qualification&&current.data.club?.replica)fail('MERGE_AUTHORITY_REQUIRED','This collection is now a dealership copy. Reopen the review on its host.');
   const prepared=M.prepare(current.data,command,{recoveryId:current.recoveryId,backup});check(prepared.data,current.data);
   const packed=S.packChanges(current.data,prepared.data);packed.commandReceipt=R.receipt(receiptCommand,prepared.result);
   beforeCommit?.(packed);
   S.write(file,packed,JSON.stringify([current.data.id,current.data.revision]));
   return {result:prepared.result,duplicate:false};
  },
  // Tests exercise arrivals, ordinary edits, and restore epochs without touching
  // an installed app, discovery file, shared-library registry or user profile.
  change(fn,{restore=false}={}){if(!qualification)execute();const before=read(),next=clone(before);fn(next);next.revision++;check(next,restore?undefined:before);const p=S.packChanges(before,next);if(restore)p.resetEpoch=true;S.write(file,p,JSON.stringify([before.id,before.revision]));}
 };
}
module.exports={enabled,execute,openQualification,openHost};
