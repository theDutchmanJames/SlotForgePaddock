const {app,BrowserWindow,ipcMain,dialog,nativeImage,shell}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Store,makePackage,migrate}=require('./store.cjs');
const {Network}=require('./network.cjs');
const {readJSON,exportJSON,exportBytes}=require('./files.cjs');
const {timingPackage}=require('./timing-import.cjs');
const {timingExport}=require('./timing-export.cjs');
const catalogueImport=require('./catalogue-import.cjs');
const {TYPES,readDocument,validateDocument}=require('./documents.cjs');
const reports=require('./reports.cjs');
const temporaryDocuments=[];
let pendingCarLink=process.argv.map(reports.parseLink).find(Boolean)||null;
function acceptCarLink(value){const target=reports.parseLink(value);if(!target)return;pendingCarLink=target;if(win&&!win.isDestroyed()&&store&&rendererReady&&!win.webContents.isLoadingMainFrame()){win.webContents.send('sf:open-car',target);pendingCarLink=null;}}
app.on('open-url',(event,url)=>{event.preventDefault();acceptCarLink(url);});
// Keep the established profile path (including a launcher override) when changing the visible app name.
const existingUserData=app.getPath('userData');
app.setName('SlotForge Paddock');
app.setPath('userData',existingUserData);
const smoke=!app.isPackaged&&process.argv.includes('--smoke');
if(smoke)app.setPath('userData',path.join(__dirname,'..','.qa','profile'));
else if(!app.isPackaged&&process.argv.includes('--test-collection')){const profile=path.join(__dirname,'..','.qa','test-collection');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();
let win,store,network,networkTimer,rendererReady=false;
const entry=path.join(__dirname,'..','renderer','index.html');
function reply(fn){return async(event,...args)=>{if(event.sender!==win?.webContents||event.senderFrame?.url!==pathToFileURL(entry).href)return {error:'Unauthorised application frame.'};try{return {ok:true,value:await fn(...args)};}catch(e){return {error:e.message};}};}
async function files(action,p={}){
  if(action==='report.preview'){const r=reports.render(store.snapshot(),p);return {title:r.title,body:r.body};}
  if(action==='report.pdf'){
    const report=reports.render(store.snapshot(),p),result=await dialog.showSaveDialog(win,{title:'Save printable PDF',defaultPath:'SlotForge-'+p.kind+'.pdf',filters:[{name:'PDF document',extensions:['pdf']}]});if(result.canceled)return null;
    const printWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
    printWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    try{await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(report.html));const bytes=await printWindow.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:report.footerTemplate});return exportBytes(result.filePath,bytes,[store.file,store.file+'.previous',store.file+'.tmp']);}finally{printWindow.destroy();}
  }

  if(action==='catalogue.kit'){const r=await dialog.showSaveDialog(win,{title:'Save manufacturer catalogue import kit',defaultPath:'SlotForge-catalogue-kit.json',filters:[{name:'Catalogue JSON kit',extensions:['json']}]});return r.canceled?null:exportJSON(r.filePath,catalogueImport.kit(),[store.file,store.file+'.previous',store.file+'.tmp']);}
  if(action==='catalogue.instructions')return catalogueImport.instructions;
  if(action==='catalogue.pick'){const r=await dialog.showOpenDialog(win,{title:'Review a manufacturer catalogue',properties:['openFile'],filters:[{name:'SlotForge catalogue JSON',extensions:['json']}]});if(r.canceled)return null;const file=r.filePaths[0];if(fs.statSync(file).size>16*1024*1024)throw Error('Catalogue file exceeds 16 MB.');const input=readJSON(file);const preview=catalogueImport.preview(store.data,input);return {name:path.basename(file),input,preview};}
  if(action==='document.pick'){const r=await dialog.showOpenDialog(win,{title:'Attach a private document',properties:['openFile'],filters:[{name:'Supported documents',extensions:Object.keys(TYPES).map(e=>e.slice(1))}]});return r.canceled?null:readDocument(r.filePaths[0]);}
  if(action==='document.open'||action==='document.export'){
    const doc=store.data.documents.find(d=>d.id===p.id);if(!doc)throw Error('Document not found.');const bytes=validateDocument(doc);
    if(action==='document.export'){const r=await dialog.showSaveDialog(win,{title:'Save document copy',defaultPath:doc.name});return r.canceled?null:exportBytes(r.filePath,bytes,[store.file,store.file+'.previous',store.file+'.tmp']);}
    const directory=fs.mkdtempSync(path.join(app.getPath('temp'),'slotforge-document-')),file=path.join(directory,'attachment-'+doc.id+path.extname(doc.name).toLowerCase());temporaryDocuments.push({directory,file});fs.writeFileSync(file,bytes,{flag:'wx'});const error=await shell.openPath(file);if(error)throw Error(error);return {opened:true};
  }
  if(action==='image'){
    const r=await dialog.showOpenDialog(win,{title:'Choose a car photo',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return null;
    const file=r.filePaths[0];if(fs.statSync(file).size>25*1024*1024)throw new Error('Choose an image smaller than 25 MB.');
    const input=nativeImage.createFromPath(file);if(input.isEmpty())throw new Error('This image could not be opened.');const {width,height}=input.getSize();const scaled=width>1600||height>1600?input.resize(width>=height?{width:1600}:{height:1600}):input;return {name:path.basename(file),data:'data:image/jpeg;base64,'+scaled.toJPEG(88).toString('base64')};
  }
  if(action==='export'||action==='export-timing'||action==='backup'){
    const db=store.snapshot();const content=action==='backup'?{format:'slotforge-backup',version:1,created:new Date().toISOString(),database:db}:action==='export-timing'?timingExport(db,p.ids||[],p.options||{}):makePackage(db,p.ids||[],p.options||{});
    const r=await dialog.showSaveDialog(win,{title:action==='backup'?'Save complete backup':action==='export-timing'?'Export cars for SlotForge Timing':'Export selected cars',defaultPath:action==='backup'?'SlotForge-backup.json':action==='export-timing'?'slotforge-timing-export.json':'SlotForge-cars.json',filters:[{name:'SlotForge JSON',extensions:['json']}]});if(r.canceled)return null;
    return exportJSON(r.filePath,content,[store.file,store.file+'.previous',store.file+'.tmp']);
  }
  if(action==='import'){
    const r=await dialog.showOpenDialog(win,{title:'Import cars for review',properties:['openFile'],filters:[{name:'SlotForge Paddock or Timing export',extensions:['json']}]});if(r.canceled)return null;const input=readJSON(r.filePaths[0]),timing=input?.format==='slotforge-timing-export',bundle=timing?timingPackage(input):input;return {...store.mutate('submission.add',{package:bundle}),importKind:timing?'timing':'package',carCount:bundle.cars.length};
  }
  if(action==='restore'){
    const r=await dialog.showOpenDialog(win,{title:'Choose a complete backup',properties:['openFile'],filters:[{name:'SlotForge backup',extensions:['json']}]});if(r.canceled)return null;const revision=store.data.revision;const parsed=readJSON(r.filePaths[0]);if(parsed.format!=='slotforge-backup'||parsed.version!==1)throw new Error('Choose a complete SlotForge backup.');const validated=migrate(parsed.database);
    const confirm=await dialog.showMessageBox(win,{type:'warning',title:'Replace this database?',message:'Restore replaces all cars, parts, setups and review history in this database.',detail:'The previous database is saved as database.json.previous. Export a complete backup first if you need a separately retained copy.',buttons:['Cancel','Replace database'],defaultId:0,cancelId:0});if(confirm.response!==1)return null;if(network.sending)throw Error('Wait for the current submission to finish before restoring.');const restored=store.restore(validated,revision);await network.stop();network.disconnect();network.discardSubmission();return restored;
  }
  throw new Error('Unknown file operation.');
}
app.whenReady().then(async()=>{
  if(!ownsInstance)return;
  try{store=new Store(path.join(app.getPath('userData'),'database.json'));}catch(e){dialog.showErrorBox('SlotForge database could not be opened',e.message+'\nYour existing files have not been replaced.');app.quit();return;}
  if(app.isPackaged)app.setAsDefaultProtocolClient('slotforge-paddock',process.env.PORTABLE_EXECUTABLE_FILE||process.env.APPIMAGE||process.execPath);
  network=new Network(store,change=>win?.webContents.send('sf:changed',change),result=>{if(win&&!win.isDestroyed())win.webContents.send('sf:network-state',result);});
  if(!smoke){networkTimer=setInterval(()=>network.poll().catch(()=>{}),5000);networkTimer.unref();}
  win=new BrowserWindow({width:1440,height:980,minWidth:960,minHeight:700,show:false,backgroundColor:'#171b21',icon:path.join(__dirname,'..','assets','icon.png'),title:'SlotForge Paddock',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.on('did-start-loading',()=>{rendererReady=false;});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='fullscreen'&&wc===win.webContents&&wc.getURL()===pathToFileURL(entry).href));
  ipcMain.handle('sf:read',reply(()=>{rendererReady=true;const openCar=pendingCarLink;pendingCarLink=null;return {openCar,data:store.snapshot(),network:network.status(),remote:network.cached,collection:store.metadata(),version:app.getVersion(),dataPath:store.file};}));
  ipcMain.handle('sf:mutate',reply((action,payload)=>store.mutate(action,payload)));
  ipcMain.handle('sf:plan',reply((action,payload)=>store.plan(action,payload)));
  ipcMain.handle('sf:file',reply(files));
  ipcMain.handle('sf:network',reply(async(action,p={})=>{switch(action){case'discover':return network.discover();case'controls':return network.controls(p);case'auto':return network.autoRefresh(p.enabled);case'retry':return network.retrySubmission();case'discard':return network.discardSubmission();case'start':return network.start();case'stop':return network.stop();case'connect':return network.connect(p.address,p.code);case'refresh':return network.refresh();case'disconnect':return network.disconnect();case'submit':return network.submit(p.ids,p.options);default:throw new Error('Unknown network operation.');}}));
  await win.loadFile(entry);
  if(smoke){try{await require('../tests/smoke.cjs')(win,store,network);app.exit(0);}catch(e){const ui=await win.webContents.executeJavaScript('document.body.innerText').catch(()=>null);fs.writeFileSync(path.join(__dirname,'..','.qa','smoke-result.json'),JSON.stringify({passed:false,error:e.stack,ui},null,2));console.error(e.stack);app.exit(1);}}
  else win.show();
});
app.on('window-all-closed',()=>app.quit());
app.on('second-instance',(_event,argv)=>{for(const arg of argv)acceptCarLink(arg);if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.on('before-quit',()=>{clearInterval(networkTimer);network?.close();});
app.on('will-quit',()=>{for(const {file,directory}of temporaryDocuments){try{fs.unlinkSync(file);fs.rmdirSync(directory);}catch{/* An external viewer may still hold its temporary copy open. */}}});
