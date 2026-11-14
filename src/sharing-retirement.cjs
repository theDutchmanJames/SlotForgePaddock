'use strict';
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const M=require('./club-model.cjs'),recovery=require('./submission-recovery.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
class SharingRetirement {
 constructor(network,club,folder){this.network=network;this.club=club;this.file=path.join(folder,'sharing-migration.json');this.busy=false;this.token=Symbol('sharing migration');this.record=null;
  try{if(fs.existsSync(this.file)){const r=require('./files.cjs').readJSON(this.file,8192);check(r?.version===1&&typeof r.id==='string'&&typeof r.databaseId==='string'&&typeof r.acknowledged==='boolean','Invalid sharing migration status. Keep this file and repair it before migrating.');this.record=r;}}catch{this.loadError='The saved migration guidance could not be read. Existing connections remain available. Keep sharing-migration.json for recovery before starting another migration.';}
 }
 assertIdle(token){check(!this.busy||token===this.token,'Sharing migration is in progress. Wait for it to finish.');}
 save(record){M.write(this.file,record);this.record=record;}
 status(){if(this.loadError)return {state:'recovery-error',databaseId:this.club.main.data.id,error:this.loadError};const r=this.record;if(!r||r.acknowledged||r.databaseId!==this.club.main.data.id)return null;return {id:r.id,databaseId:r.databaseId,clubId:this.club.main.data.club?.id||null,state:this.busy?'migrating':this.club.coordinator?'check-clients':'not-completed',backup:r.backup||'',error:r.error||''};}
 async host(p){
  this.assertIdle();check(!this.loadError,this.loadError);check(p?.confirmed===true,'Confirm full Dealership access before migrating.');check(p.databaseId===this.club.main.data.id,'The collection changed. Reopen migration.');check(!this.club.active&&!this.club.main.data.club,'Open the original unshared collection to migrate.');
  this.club.password(p.password);check(typeof p.name==='string'&&p.name.trim()&&p.name.length<=100,'Enter a computer name.');recovery.assertPreserved(this.network);
  this.busy=true;const n=this.network,previousBackup=this.club.backupPath;n.intake.paused=true;
  try{
   // No credential changes until every already admitted handler has finished.
   await n.intake.idle();check(!n.work.closing,'Paddock is closing. Migration was not started.');
   check(p.databaseId===this.club.main.data.id,'The collection changed. Reopen migration.');
   this.save({version:1,id:crypto.randomUUID(),databaseId:p.databaseId,acknowledged:false,backup:'',error:''});
   await this.club.enableAsync(p.name,p.password);
   this.save({...this.record,backup:this.club.backupPath||''});
   await n.stop(this.token);await n.start(this.token);
   return {...this.status(),state:'check-clients'};
  }catch(error){
   // Never roll a live shared file back to the backup after a later failure.
   if(this.club.coordinator)await n.stop(this.token);
   if(this.record)try{this.save({...this.record,backup:this.club.backupPath!==previousBackup?this.club.backupPath||'':'',error:'Migration needs attention. Check hosting and reconnect clients; the collection was not rolled back.'});}catch{/* Existing prepared marker survives a later journal-write failure. */}
   throw error;
  }finally{this.busy=false;n.intake.paused=false;n.notify();}
 }
 async browser(p){
  this.assertIdle();const n=this.network,remote=n.remote;check(p?.confirmed===true,'Confirm joining the full Dealership collection.');check(remote&&remote.id===p.databaseId,'The public connection changed. Reopen migration.');recovery.assertPreserved(n);
  this.busy=true;
  try{await this.club.connect({...p,expectedDatabaseId:remote.id});check(this.club.device.pair?.databaseId===remote.id,'The Dealership identity changed.');return this.club.status();}
  finally{this.busy=false;n.notify();}
 }
 acknowledge(p){this.assertIdle();const s=this.status();check(p?.confirmed===true&&this.record&&s?.state==='check-clients'&&p.id===s.id&&p.databaseId===s.databaseId&&p.clubId===s.clubId&&this.club.coordinator,'Reopen migration guidance for this dealership.');check(this.network.server&&this.network.hostingMode==='dealership','Start the dealership and verify client reconnections first.');recovery.assertPreserved(this.network);this.save({...this.record,acknowledged:true});this.network.notify();return this.network.status();}
}
module.exports={SharingRetirement};
