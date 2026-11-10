'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Desktop preference, not collection data: never replicated or exported.
class BackgroundMode {
 constructor({profile,app,Tray,Menu,icon,getWindow,getLibrary,onChange=()=>{}}){
  Object.assign(this,{app,Tray,Menu,icon,getWindow,getLibrary,onChange});this.file=path.join(profile,'desktop-settings.json');this.enabled=false;this.error='';this.quitting=false;
  try{if(fs.existsSync(this.file)){const s=fs.lstatSync(this.file);if(!s.isFile()||s.size>8192)throw Error();const p=JSON.parse(fs.readFileSync(this.file,'utf8'));if(p.version!==1||typeof p.background!=='boolean')throw Error();this.enabled=p.background;}}
  catch{this.error='Background settings could not be read. Choose the setting again to reset them.';}
 }
 status(){return {enabled:this.enabled||!!this.sessionOnly,ready:!!this.tray&&!this.tray.isDestroyed(),hidden:!!this.hidden,error:this.error};}
 changed(){try{this.onChange();}catch{}}
 attach(win){
  win.on('close',event=>{if(!this.quitting&&(this.enabled||this.sessionOnly)&&this.status().ready){event.preventDefault();win.hide();this.hidden=true;this.changed();}});
  win.on('show',()=>{this.hidden=false;this.changed();});
  // Windows session end must not be mistaken for the ordinary close button.
  win.on('query-session-end',event=>{event.preventDefault();this.quit();});
  if(this.enabled)try{this.createTray();}catch{this.error='The tray icon could not be created. Closing the window will quit Paddock.';this.destroyTray();}
 }
 createTray(){
  if(this.status().ready)return;
  try{this.tray=new this.Tray(this.icon);this.tray.setToolTip('SlotForge Paddock');this.tray.on('click',()=>this.open());this.tray.on('double-click',()=>this.open());this.refresh();}
  catch(error){this.destroyTray();throw error;}
 }
 refresh(){
  if(!this.status().ready)return;
  const s=this.getLibrary?.(),label=s?.available?'Local library ready':s?.enabled?'Local library unavailable':'Local access disabled';
  this.tray.setContextMenu(this.Menu.buildFromTemplate([{label:'Open Paddock',click:()=>this.open()},{label:s?.name||'SlotForge Paddock',enabled:false},{label,enabled:false},{type:'separator'},{label:'Quit Paddock completely',click:()=>this.quit()}]));
 }
 setEnabled(enabled){
  if(typeof enabled!=='boolean')throw Error('Choose whether background mode is enabled.');if(this.quitting)throw Error('Paddock is closing.');
  const hadTray=this.status().ready;
  if(enabled)this.createTray();
  const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify({version:1,background:enabled}),{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);}
  catch(error){if(!hadTray)this.destroyTray();throw error;}
  finally{try{fs.unlinkSync(temporary);}catch{}}
  this.enabled=enabled;this.sessionOnly=false;this.error='';if(!enabled){if(this.hidden)this.open();this.destroyTray();}this.changed();return this.status();
 }
 startHidden(){try{this.createTray();this.sessionOnly=true;const win=this.getWindow();win.hide();this.hidden=true;this.changed();return true;}catch{this.error='Background startup could not create a tray icon. Paddock opened visibly so you can control it.';this.sessionOnly=false;this.open();return false;}}
 // Windows can consume the first ShowWindow request using the launcher's SW_HIDE.
 // Retry only when it left the window hidden, including the tray-failure fallback.
 open(){if(this.quitting)return;const win=this.getWindow();if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();if(process.platform==='win32'&&!win.isVisible())win.show();win.focus();this.hidden=false;this.changed();}}
 quit(){this.quitting=true;this.app.quit();}
 beginQuit(){this.quitting=true;}
 destroyTray(){if(this.tray&&!this.tray.isDestroyed())this.tray.destroy();this.tray=null;}
 close(){this.beginQuit();this.destroyTray();}
}
module.exports={BackgroundMode};
