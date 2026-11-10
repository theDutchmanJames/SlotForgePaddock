'use strict';
// Inserted only into disposable QA packages, never into the shipping allowlist.
const fs=require('node:fs'),path=require('node:path'),{app,BrowserWindow,dialog}=require('electron');
const root=path.resolve(process.env.SLOTFORGE_INSTALLED_QA||''),role=require('./package.json').installedQaRole;
if(!['paddock','timing'].includes(role)||!root.includes(path.join('.qa','installed-history'))||!path.resolve(process.execPath).startsWith(root+path.sep)||!app.isPackaged)throw Error('Disposable packaged QA installation required.');
const config=JSON.parse(fs.readFileSync(path.join(root,'run.json'))),profile=path.join(root,'profiles',role),control=path.join(root,'control',role);
for(const key of ['appData','localAppData'])if(typeof config[key]!=='string'||!path.resolve(config[key]).startsWith(root+path.sep))throw Error('QA profile must stay inside the disposable package directory.');
for(const dir of [profile,control,config.appData,config.localAppData])fs.mkdirSync(dir,{recursive:true});
app.setPath('appData',config.appData);app.setPath('userData',profile);process.env.APPDATA=config.appData;process.env.LOCALAPPDATA=config.localAppData;
// A disposable packaged app must not replace the user's OS URL association.
// Production main still runs normally; only this QA bootstrap suppresses it.
app.setAsDefaultProtocolClient=()=>false;app.removeAsDefaultProtocolClient=()=>false;
app.disableHardwareAcceleration();let mainWindow,seen='',busy=false,openFile,saveFile,confirmRestore=false;const errors=[];
dialog.showErrorBox=(title,message)=>{fs.appendFileSync(path.join(control,'errors.log'),title+': '+message+'\n');};
const originalOpen=dialog.showOpenDialog,originalSave=dialog.showSaveDialog,originalMessage=dialog.showMessageBox;
dialog.showMessageBox=async(...args)=>{if(confirmRestore&&args.at(-1)?.title==='Replace this database?'){confirmRestore=false;return {response:1,checkboxChecked:false};}return originalMessage(...args);};
dialog.showOpenDialog=async(...args)=>{if(openFile){const file=openFile;openFile=null;return {canceled:false,filePaths:[file]};}return originalOpen(...args);};
dialog.showSaveDialog=async(...args)=>{if(saveFile){const file=saveFile;saveFile=null;return {canceled:false,filePath:file};}return originalSave(...args);};
app.relaunch=()=>{throw Error('Unexpected relaunch during packaged qualification');};
process.on('uncaughtException',e=>{fs.appendFileSync(path.join(control,'errors.log'),e.stack+'\n');app.exit(1);});
app.on('browser-window-created',(_,win)=>{win.show=()=>{};win.showInactive=()=>{};win.webContents.setBackgroundThrottling(false);win.webContents.on('render-process-gone',(_,details)=>errors.push(details));win.webContents.on('did-finish-load',()=>{if(!win.webContents.getURL().endsWith('/renderer/index.html'))return;mainWindow=win;win.setSize(1280,1000);win.setOpacity(0);BrowserWindow.prototype.showInactive.call(win);fs.writeFileSync(path.join(control,'ready.json'),JSON.stringify({pid:process.pid,packaged:app.isPackaged,profile:app.getPath('userData'),exe:process.execPath,role,appPath:app.getAppPath()}));});});
const timer=setInterval(async()=>{if(busy||!mainWindow||mainWindow.isDestroyed())return;const file=path.join(control,'command.json');if(!fs.existsSync(file))return;let cmd;try{cmd=JSON.parse(fs.readFileSync(file));}catch{return;}if(cmd.id===seen)return;seen=cmd.id;busy=true;try{
 let value;
 if(cmd.action==='js')value=await mainWindow.webContents.executeJavaScript('(async()=>{'+cmd.code+'})()',true);
 else if(cmd.action==='capture'){const file=path.resolve(root,cmd.file);if(!file.startsWith(root+path.sep))throw Error('Unsafe screenshot path');fs.writeFileSync(file,(await mainWindow.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());value=file;}
 else if(cmd.action==='dialog'){const file=path.resolve(root,cmd.file);if(!file.startsWith(root+path.sep))throw Error('Unsafe dialog path');if(cmd.kind==='open')openFile=file;else saveFile=file;value=true;}
 else if(cmd.action==='status')value={errors,packaged:app.isPackaged,profile:app.getPath('userData')};
 else if(cmd.action==='confirm-test-restore'){if(role!=='paddock')throw Error('Only the disposable Paddock can restore.');confirmRestore=true;value=true;}
 else if(cmd.action==='quit'){value=true;setTimeout(()=>app.quit(),200);}
 else throw Error('Unknown test command');
 fs.writeFileSync(path.join(control,cmd.id+'.json'),JSON.stringify({ok:true,value:value??null}));
 }catch(e){fs.writeFileSync(path.join(control,cmd.id+'.json'),JSON.stringify({ok:false,error:e.stack}));}finally{busy=false;}},40);timer.unref();
if(role==='paddock'){
 const file=path.join(profile,'database.sqlite');if(!fs.existsSync(file)){const {Store}=require('./src/store.cjs');new Store(file).replace(JSON.parse(fs.readFileSync(path.join(root,'seed.json'))));}
 require('./src/main.cjs');
}else require('./main.js');
