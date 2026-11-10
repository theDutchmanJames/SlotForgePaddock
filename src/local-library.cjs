'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Network}=require('./network.cjs');
// This directory is per operating-system user, never in a shared collection,
// backup, install folder or LAN advertisement. The location is independent
// of either application name or installation path.
function directory({platform=process.platform,env=process.env,home=require('node:os').homedir()}={}){
 if(platform==='win32'){if(!env.LOCALAPPDATA)throw Error('Windows local application data directory is unavailable.');return path.join(env.LOCALAPPDATA,'SlotForge','local-libraries','v1');}
 if(platform==='darwin')return path.join(home,'Library','Application Support','SlotForge','local-libraries','v1');
 return env.XDG_RUNTIME_DIR?path.join(env.XDG_RUNTIME_DIR,'slotforge','local-libraries','v1'):path.join(env.XDG_STATE_HOME||path.join(home,'.local','state'),'slotforge','local-libraries','v1');
}
class LocalLibrary {
 constructor({store,folder,profile,launcher=null,available=()=>true,unavailableReason=()=>'The local library is temporarily unavailable.',onStatus=()=>{},onChange=()=>{}}){
  this.launcher=launcher?new (require('./local-library-launcher.cjs').Launcher)({folder,profile,command:launcher}):null;this.onStatus=onStatus;this.unavailableReason=unavailableReason;this.store=store;this.folder=folder;this.onChange=onChange;this.available=available;this.settingsFile=path.join(profile,'local-library-settings.json');this.enabled=true;this.instanceId=crypto.randomUUID();this.token=crypto.randomBytes(32).toString('base64url');this.closed=false;this.error='';
  this.file=path.join(folder,crypto.createHash('sha256').update(path.resolve(profile)).digest('hex')+'.json');
  try{if(fs.existsSync(this.settingsFile)){const stat=fs.lstatSync(this.settingsFile);if(!stat.isFile()||stat.size>8192)throw Error('Invalid local access settings.');const config=JSON.parse(fs.readFileSync(this.settingsFile,'utf8'));if(config.version!==1||typeof config.enabled!=='boolean')throw Error('Invalid local access settings.');this.enabled=config.enabled;}}catch{this.enabled=false;this.error='Local access settings could not be read. Re-enable local access to reset them.';}
  this.makeNetwork();
 }
 // The network gate rejects new requests during shutdown while admitted writes
 // drain. Do not revoke their authorization merely because close has started.
 makeNetwork(){this.network=new Network(this.store,this.onChange,()=>{},{token:this.token,instanceId:this.instanceId,available:()=>!this.sleeping&&!this.error&&this.available(),handle:require('./local-library-api.cjs').handle});}
 status(){const available=!this.closed&&!this.sleeping&&!this.error&&!!this.network.server?.listening&&this.network.local.available();return {version:1,enabled:this.enabled,available,state:this.terminating?'closing':!this.enabled?'disabled':this.sleeping?'sleeping':this.starting?'starting':available?'ready':'unavailable',databaseId:this.store.data.id,name:this.store.data.settings.name,startupRegistered:!!this.launcher?.ready&&this.enabled,error:this.error,reason:!this.available()?this.unavailableReason():''};}
 notify(){try{this.onStatus(this.status());}catch{}}
 suspend(){this.sleeping=true;this.notify();}
 async recover(){if(this.recovering)return this.recovering;this.recovering=this.recoverOnce();try{return await this.recovering;}finally{this.recovering=null;}}
 async recoverOnce(){
  if(this.terminating||!this.enabled)return this.status();
  if(this.changing)throw Error('Wait for the local connection to finish changing.');
  this.changing=true;this.sleeping=false;
  try{
   if(this.starting)await this.starting;
   if(this.terminating)return this.status();
   if(this.network.server?.listening){await require('./local-library-security.cjs').secureDirectory(this.folder);if(!this.terminating)this.publish();}
   else {this.quiesce(false);await this.network.idle();this.network.close();if(!this.terminating){this.closed=false;this.instanceId=crypto.randomUUID();this.token=crypto.randomBytes(32).toString('base64url');this.makeNetwork();await this.start();}}
  }catch{this.error='Local discovery could not be refreshed. Check access to your user profile and try again.';this.quiesce(false);await this.network.idle();this.network.close();}
  finally{this.changing=false;this.notify();}
  return this.status();
 }
 publish(){
  if(this.closed||!this.network.port)return;
  const entry={format:'slotforge-local-library',version:1,instanceId:this.instanceId,pid:process.pid,address:'http://127.0.0.1:'+this.network.port,token:this.token,databaseId:this.store.data.id,name:this.store.data.settings.name};
  const temporary=this.file+'.'+this.instanceId+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(entry),{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);this.error='';this.launcher?.publish(this.store);}
  finally{try{fs.unlinkSync(temporary);}catch{}}
 }
 async start(){if(this.starting)return this.starting;if(this.network.port)return this.status();this.starting=this.startOnce();this.notify();try{return await this.starting;}finally{this.starting=null;this.notify();}}
 async startOnce(){
  if(!this.enabled||this.closed){if(!this.enabled)this.launcher?.remove();return this.status();}
  try{
   await require('./local-library-security.cjs').secureDirectory(this.folder);if(this.closed)return this.status();
   if(this.launcher){await this.launcher.prepare();if(this.closed)return this.status();}await this.network.start();if(this.closed)return this.status();this.publish();
   // Only identity/name changes rewrite discovery. Ordinary saves use the
   // existing small SSE invalidations, not discovery polling or full exports.
   let key=JSON.stringify([this.store.data.id,this.store.data.settings.name]);
   this.unsubscribe=this.store.subscribe(()=>{const next=JSON.stringify([this.store.data.id,this.store.data.settings.name]);if(next===key)return;key=next;try{this.publish();this.notify();}catch{this.error='Local connection discovery could not be updated. Use Retry local connection.';this.notify();}});
  }catch(error){this.error='Local connection unavailable: '+error.message;await this.network.stop();this.remove();}
  return this.status();
 }
 async setEnabled(enabled){
  if(typeof enabled!=='boolean')throw Error('Choose whether local access is enabled.');
  if(this.terminating)throw Error('Paddock is closing.');
  if(this.changing)throw Error('Wait for the local connection to finish changing.');this.changing=true;
  try{
   const temporary=this.settingsFile+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify({version:1,enabled}),{flag:'wx',mode:0o600});fs.renameSync(temporary,this.settingsFile);}finally{try{fs.unlinkSync(temporary);}catch{}}
   this.enabled=enabled;this.quiesce(false);await this.idle();this.network.close();if(!enabled)this.launcher?.remove();
   if(enabled&&!this.terminating){this.closed=false;this.error='';this.instanceId=crypto.randomUUID();this.token=crypto.randomBytes(32).toString('base64url');this.makeNetwork();await this.start();}
   return this.status();
  }finally{this.changing=false;this.notify();}
 }
 remove(){try{const info=fs.lstatSync(this.file);if(info.isFile()&&info.size<8192&&JSON.parse(fs.readFileSync(this.file,'utf8')).instanceId===this.instanceId)fs.unlinkSync(this.file);}catch{}}
 quiesce(permanent=true){if(permanent)this.terminating=true;this.closed=true;this.unsubscribe?.();this.unsubscribe=null;this.remove();this.network.quiesce();}
 async idle(){await this.recovering;await this.starting;await this.network.idle();}
 close(){this.quiesce();this.network.close();}
}
module.exports={LocalLibrary,directory};
