const {app,BrowserWindow,ipcMain,dialog,nativeImage,shell,protocol,Tray,Menu,powerMonitor}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Store,makePackage,migrate}=require('./store.cjs');
const {Network}=require('./network.cjs');
const {Club}=require('./club.cjs');
const transfer=new (require('./snapshot-transfer.cjs').SnapshotTransfer)();
const media=new (require('./renderer-media.cjs').RendererMedia)();
protocol.registerSchemesAsPrivileged([{scheme:'paddock-media',privileges:{standard:true,secure:true}}]);
const {readJSON,exportJSON,exportBytes}=require('./files.cjs');
const {timingPackage}=require('./timing-import.cjs');
const {timingExport}=require('./timing-export.cjs');
const catalogueImport=require('./catalogue-import.cjs');
const historyResearch=require('../renderer/history-research-model.js');
const historyWeb=require('./history-web.cjs');
let historyWebBusy=false,restoring=false;
const {TYPES,readDocument,validateDocument}=require('./documents.cjs');
const reports=require('./reports.cjs');
const temporaryDocuments=[];
let pendingCarLink=process.argv.map(reports.parseLink).find(Boolean)||null;
function acceptCarLink(value){const target=reports.parseLink(value);if(!target)return;pendingCarLink=target;if(win&&!win.isDestroyed()&&store&&rendererReady&&!win.webContents.isLoadingMainFrame()){backgroundMode?.open();win.webContents.send('sf:open-car',target);pendingCarLink=null;}}
app.on('open-url',(event,url)=>{event.preventDefault();acceptCarLink(url);});
// Keep the established profile path (including a launcher override) when changing the visible app name.
const existingUserData=app.getPath('userData');
app.setName('SlotForge Paddock');
app.setPath('userData',existingUserData);
const sharedSmokeArg=!app.isPackaged&&process.argv.find(v=>v.startsWith('--shared-folder-smoke='));
const sharedSmoke=sharedSmokeArg?path.resolve(sharedSmokeArg.slice('--shared-folder-smoke='.length)):null;
if(sharedSmoke&&!sharedSmoke.startsWith(path.resolve(__dirname,'..','.qa')+path.sep))throw Error('Shared-library tests require an isolated .qa folder.');
const smoke=!app.isPackaged&&(process.argv.includes('--smoke')||!!sharedSmoke);
if(sharedSmoke)app.setPath('userData',path.join(sharedSmoke,'paddock-profile'));
else if(smoke)app.setPath('userData',path.join(__dirname,'..','.qa','profile'));
else if(!app.isPackaged&&process.argv.includes('--test-collection')){const profile=path.join(__dirname,'..','.qa','test-collection');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
const launcherModule=require('./local-library-launcher.cjs');
const launchCommand=launcherModule.command({packaged:app.isPackaged,appPath:path.join(__dirname,'..')});
let libraryStartup=null,libraryStartupError=null;try{libraryStartup=launcherModule.readStart(process.argv,{folder:require('./local-library.cjs').directory(),command:launchCommand});if(libraryStartup)app.setPath('userData',libraryStartup.profile);}catch(e){libraryStartupError=e;}
const ownsInstance=!libraryStartupError&&app.requestSingleInstanceLock();
if(libraryStartupError){console.error('The registered local library could not be started. Open Paddock normally to check its registration.');app.exit(1);}else if(!ownsInstance)app.quit();
let sharedObserver,sharedRoot;
let win,store,network,club,localLibrary,backgroundMode,resultInbox,networkTimer,rendererReady=false,startupFeedback,startupClosing=false;
const ipcWork=new (require('./work-gate.cjs').WorkGate)();
const backupJobs=new (require('./backup-jobs.cjs').BackupJobs)(value=>{if(win&&!win.isDestroyed())win.webContents.send('sf:file-progress',value);});
const entry=path.join(__dirname,'..','renderer','index.html');
const thumbnails=new (require('./thumbnail-cache.cjs').ThumbnailCache)(job=>{if(win&&!win.isDestroyed())win.webContents.send('sf:thumbnail',job);},url=>media.responseAsync(url));
function mediaSweep(){media.retain([store?.data,club?.loadedCache?.data,network?.cached,...transfer.history.map(x=>x.data)]);}
function trustedFrame(event){return win&&!win.isDestroyed()&&!event.sender.isDestroyed()&&event.sender===win.webContents&&event.senderFrame?.url===pathToFileURL(entry).href;}
function reply(fn){return async(event,...args)=>{let value;try{return await ipcWork.run(async()=>{if(!win||win.isDestroyed()||event.sender.isDestroyed()||event.sender!==win.webContents||event.senderFrame?.url!==pathToFileURL(entry).href)return {error:'Unauthorised application frame.'};if(sharedObserver&&!restoring)await sharedObserver.refresh();value=await fn(...media.expand(args));return {ok:true,value:media.project(value)};});}catch(e){return {error:e.message,code:value?.commandId?'WRITE_UNCERTAIN':e.code,definiteRejection:e.definiteRejection===true};}};}
async function files(action,p={}){
  const store=club.store;
  const protectedFiles=[...(sharedRoot?['library.json','replacement.json','coordination.sqlite','coordination.sqlite-journal','coordination.sqlite-wal','coordination.sqlite-shm'].map(name=>path.join(sharedRoot,name)):[]),...(backgroundMode?[backgroundMode.file]:[]),...(resultInbox?[resultInbox.file,resultInbox.file+'-journal',resultInbox.file+'-wal',resultInbox.file+'-shm']:[]),...(localLibrary?[...(localLibrary.launcher?[localLibrary.launcher.file]:[]),localLibrary.file,localLibrary.settingsFile,localLibrary.settingsFile+'.tmp']:[]),...club.main.protectedFiles(),...club.protectedFiles(),club.file,club.file+'.previous',club.file+'.tmp',...Array.from(media.byUrl.values(),e=>e.staged).filter(Boolean)];
  if(action==='database.reset')return require('./collection-reset.cjs').reset({store,club,network,backupJobs,protectedFiles},p);
  if(action==='restore'&&store.data.club)throw Error('Shared club copies cannot restore or replace the official database. Use Connections to update the club copy.');
  if(['slotcar.kit','slotcar.pick'].includes(action)){
    const model=require('../renderer/slotcar-research-model.js'),car=store.data.cars.find(c=>c.id===p.carId);
    const unchanged=()=>{if(club.store!==store||store.data.id!==p.databaseId||!car||store.data.cars.find(c=>c.id===p.carId)?.revision!==p.revision)throw Error('The car or collection changed. Reopen slotcar research.');};unchanged();
    if(action==='slotcar.kit'){
      const content=model.kit(store.data,car),r=await dialog.showSaveDialog(win,{title:'Save slotcar product research template',defaultPath:'SlotForge-slotcar-research.json',filters:[{name:'Slotcar research JSON',extensions:['json']}]});if(r.canceled)return null;unchanged();return exportBytes(r.filePath,JSON.stringify(content,null,2),protectedFiles);
    }
    const r=await dialog.showOpenDialog(win,{title:'Review completed slotcar research',properties:['openFile'],filters:[{name:'Slotcar research JSON',extensions:['json']}]});if(r.canceled)return null;unchanged();
    return {...model.preview(readJSON(r.filePaths[0],1024*1024),p,car),hasInstalledParts:store.data.installations.some(i=>i.carId===p.carId&&!i.removed)};
  }
  if(action==='history.source'){const url=require('./real-history.cjs').url(p.url);if(!url)throw Error('Missing source link.');await shell.openExternal(url);return {opened:true};}
  if(['history.kit','history.pick','history.web'].includes(action)){
    const car=store.data.cars.find(c=>c.id===p.carId);
    const unchanged=()=>{if(club.store!==store||store.data.id!==p.databaseId||!car||store.data.cars.find(c=>c.id===p.carId)?.revision!==p.revision)throw Error('The car or collection changed. Reopen its research tools.');};unchanged();
    if(action==='history.kit'){
      const content=historyResearch.kit(store.data,car),r=await dialog.showSaveDialog(win,{title:'Save car research template for your AI',defaultPath:'SlotForge-car-research.json',filters:[{name:'Research JSON',extensions:['json']}]});
      return r.canceled?null:exportBytes(r.filePath,JSON.stringify(content,null,2),protectedFiles);
    }
    let preview;
    if(action==='history.pick'){
      const r=await dialog.showOpenDialog(win,{title:'Review completed car research',properties:['openFile'],filters:[{name:'Research JSON',extensions:['json']}]});if(r.canceled)return null;unchanged();
      preview=historyResearch.preview(readJSON(r.filePaths[0],1024*1024),p);
    }else{
      if(historyWebBusy)throw Error('A webpage is already being read. Please wait.');historyWebBusy=true;
      try{preview=await historyWeb.read(p.url);}finally{historyWebBusy=false;}unchanged();
    }
    return preview;
  }
  if(action==='report.preview'){const r=reports.render(store.snapshot(),p);return {title:r.title,body:r.body};}
  if(action==='report.pdf'){
    const report=reports.render(store.snapshot(),p),result=await dialog.showSaveDialog(win,{title:'Save printable PDF',defaultPath:'SlotForge-'+p.kind+'.pdf',filters:[{name:'PDF document',extensions:['pdf']}]});if(result.canceled)return null;
    const printWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
    printWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    try{await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(report.html));const bytes=await printWindow.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:report.footerTemplate});return exportBytes(result.filePath,bytes,protectedFiles);}finally{printWindow.destroy();}
  }

  if(action==='catalogue.kit'){const r=await dialog.showSaveDialog(win,{title:'Save manufacturer catalogue import kit',defaultPath:'SlotForge-catalogue-kit.json',filters:[{name:'Catalogue JSON kit',extensions:['json']}]});return r.canceled?null:exportJSON(r.filePath,catalogueImport.kit(),protectedFiles);}
  if(action==='catalogue.instructions')return catalogueImport.instructions;
  if(action==='catalogue.pick'){const r=await dialog.showOpenDialog(win,{title:'Review a manufacturer catalogue',properties:['openFile'],filters:[{name:'SlotForge catalogue JSON',extensions:['json']}]});if(r.canceled)return null;const file=r.filePaths[0];if(fs.statSync(file).size>16*1024*1024)throw Error('Catalogue file exceeds 16 MB.');const input=readJSON(file,16*1024*1024);const preview=catalogueImport.preview(store.data,input);return {name:path.basename(file),input,preview};}
  if(action==='guide.pick'){
    const r=await dialog.showOpenDialog(win,{title:'Add a manual or part guide',properties:['openFile'],filters:[{name:'PDF or image',extensions:['pdf','png','jpg','jpeg','webp']}]});if(r.canceled)return null;
    const document=readDocument(r.filePaths[0]);if(!require('./guides.cjs').allowed.has(document.mime))throw Error('Choose a PDF or supported image.');let picture='';
    if(document.mime.startsWith('image/')){const image=nativeImage.createFromBuffer(Buffer.from(document.data,'base64'));if(image.isEmpty())throw Error('This image could not be opened.');const {width,height}=image.getSize(),small=image.resize(width>=height?{width:Math.min(480,width)}:{height:Math.min(480,height)});picture='data:image/jpeg;base64,'+small.toJPEG(75).toString('base64');}
    return {document,picture};
  }
  if(action==='document.pick'){const r=await dialog.showOpenDialog(win,{title:'Attach a private document',properties:['openFile'],filters:[{name:'Supported documents',extensions:Object.keys(TYPES).map(e=>e.slice(1))}]});return r.canceled?null:readDocument(r.filePaths[0]);}
  if(action==='document.open'||action==='document.export'){
    const doc=store.data.documents.find(d=>d.id===p.id);if(!doc)throw Error('Document not found.');const bytes=validateDocument(doc);
    if(action==='document.export'){const r=await dialog.showSaveDialog(win,{title:'Save document copy',defaultPath:doc.name});return r.canceled?null:exportBytes(r.filePath,bytes,protectedFiles);}
    const directory=fs.mkdtempSync(path.join(app.getPath('temp'),'slotforge-document-')),file=path.join(directory,'attachment-'+doc.id+path.extname(doc.name).toLowerCase());temporaryDocuments.push({directory,file});fs.writeFileSync(file,bytes,{flag:'wx'});const error=await shell.openPath(file);if(error)throw Error(error);return {opened:true};
  }
  if(action==='image'){
    const r=await dialog.showOpenDialog(win,{title:'Choose a car photo',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});if(r.canceled)return null;
    const file=r.filePaths[0];if(fs.statSync(file).size>25*1024*1024)throw new Error('Choose an image smaller than 25 MB.');
    const bytes=fs.readFileSync(file),input=nativeImage.createFromBuffer(bytes);if(input.isEmpty())throw new Error('This image could not be opened.');
    try{return {name:path.basename(file),data:require('./photo-import.cjs').originalPhoto(bytes)};}
    catch(error){if(error.code!=='PHOTO_TOO_LARGE')throw error;const choice=await dialog.showMessageBox(win,{type:'question',title:'Keep the original or use a smaller copy?',message:error.message,detail:'Choose another file to preserve its original bytes, or explicitly import a JPEG copy up to 1,600 pixels. Your source file will not be changed.',buttons:['Cancel','Import smaller copy'],defaultId:0,cancelId:0});if(choice.response!==1)return null;const {width,height}=input.getSize(),scaled=Math.max(width,height)>1600?input.resize(width>=height?{width:1600}:{height:1600}):input;return {name:path.basename(file),data:require('./photo-import.cjs').originalPhoto(scaled.toJPEG(88))};}
  }
  if(action==='backup'||action==='backup-previous'){
    const previous=action==='backup-previous',r=await dialog.showSaveDialog(win,{title:previous?'Save previous revision':'Save complete backup',defaultPath:previous?'SlotForge-previous-revision.sfpbackup':'SlotForge-backup.sfpbackup',filters:[{name:'SlotForge portable backup',extensions:['sfpbackup']},{name:'Legacy JSON backup',extensions:['json']}]});if(r.canceled)return null;
    if(path.extname(r.filePath).toLowerCase()==='.json'){const db=previous?store.previousSnapshot():store.snapshot();if(!db)throw Error('There is no preceding saved revision yet.');return exportJSON(r.filePath,{format:'slotforge-backup',version:1,created:new Date().toISOString(),database:db},protectedFiles);}
    try{return await store.exclusiveFileOperation(()=>{if(!store.expectedIdentity)store.persist(store.data);return backupJobs.run('export',store.file,r.filePath,{previous,expectedIdentity:store.expectedIdentity,protectedFiles});});}catch(e){if(e.code==='CANCELLED')return null;throw e;}
  }
  if(action==='export'||action==='export-timing'){
    const db=store.snapshot();
    const content=action==='export-timing'?timingExport(db,p.ids||[],p.options||{}):makePackage(db,p.ids||[],p.options||{});
    const r=await dialog.showSaveDialog(win,{title:action==='export-timing'?'Export cars for SlotForge Timing':'Export selected cars',defaultPath:action==='export-timing'?'slotforge-timing-export.json':'SlotForge-cars.json',filters:[{name:'SlotForge JSON',extensions:['json']}]});if(r.canceled)return null;
    return exportJSON(r.filePath,content,protectedFiles);
  }
  if(action==='import'){
    const r=await dialog.showOpenDialog(win,{title:'Import cars for review',properties:['openFile'],filters:[{name:'SlotForge Paddock or Timing export',extensions:['json']}]});if(r.canceled)return null;const input=readJSON(r.filePaths[0]),timing=input?.format==='slotforge-timing-export',bundle=timing?timingPackage(input):input;return {...await club.mutate('submission.add',{package:bundle}),importKind:timing?'timing':'package',carCount:bundle.cars.length};
  }
  if(action==='restore'){
    const r=await dialog.showOpenDialog(win,{title:'Choose a complete backup',properties:['openFile'],filters:[{name:'SlotForge backup',extensions:['sfpbackup','json']}]});if(r.canceled)return null;const revision=store.data.revision;
    const stageFolder=path.join(path.dirname(store.file),'backup-staging');fs.mkdirSync(stageFolder,{recursive:true});const staging=path.join(stageFolder,'stage-'+require('node:crypto').randomUUID()+'.sqlite');
    const unchanged=()=>{if(club.store!==store||store.data.club||store.data.revision!==revision)throw Error('The collection changed while restoring. Reopen the restore dialog.');if(network.sending)throw Error('Wait for the current submission to finish before restoring.');};
    try{let validated;
      if(path.extname(r.filePaths[0]).toLowerCase()==='.json'){const parsed=readJSON(r.filePaths[0]);if(parsed.format!=='slotforge-backup'||parsed.version!==1)throw Error('Choose a complete SlotForge backup.');validated=migrate(parsed.database);}
      else{await backupJobs.run('stage',r.filePaths[0],staging);validated=new Store(staging).data;}
      unchanged();store.assertIdle();const confirm=await dialog.showMessageBox(win,{type:'warning',title:'Replace this database?',message:'Restore '+validated.settings.name+' ('+validated.cars.length+' cars)?',detail:'This replaces cars, stock, setups, jobs, history and settings. A verified portable recovery backup will be kept in recovery-backups beside the database before replacement.',buttons:['Cancel','Replace database'],defaultId:0,cancelId:0});if(confirm.response!==1)return null;unchanged();
      const recoveryFolder=path.join(path.dirname(store.file),'recovery-backups');fs.mkdirSync(recoveryFolder,{recursive:true});const recovery=path.join(recoveryFolder,'before-restore-'+Date.now()+'-'+require('node:crypto').randomUUID()+'.sfpbackup');
      require('./portable-backup.cjs').space(path.dirname(store.file),(fs.existsSync(staging)?fs.statSync(staging).size:256*1024*1024)*3+(fs.existsSync(store.file)?fs.statSync(store.file).size:0)*2+64*1024*1024);
      await store.exclusiveFileOperation(()=>{unchanged();if(!store.expectedIdentity)store.persist(store.data);return backupJobs.run('export',store.file,recovery,{expectedIdentity:store.expectedIdentity,protectedFiles});});unchanged();
      await network.stop();unchanged();
      backupJobs.notify({id:'commit',phase:'Committing restored collection',done:0,total:1,cancelable:false});
      const restored=await store.restoreAsync(validated,revision,unchanged);network.disconnect();network.discardSubmission();return restored;
    }catch(e){if(e.code==='CANCELLED')return null;throw e;}finally{backupJobs.notify(null);for(const file of [staging,staging+'-journal'])if(fs.existsSync(file))try{fs.unlinkSync(file);}catch{/* Reserved staging files are reclaimed at the next start. */}}
  }
  throw new Error('Unknown file operation.');
}
const startupTask=app.whenReady().then(async()=>{
  if(!ownsInstance)return;
  const backupStaging=path.join(app.getPath('userData'),'backup-staging');
  if(fs.existsSync(backupStaging))for(const name of fs.readdirSync(backupStaging))if(/^stage-[a-f0-9-]{36}\.sqlite(?:-journal)?$/.test(name)){const file=path.resolve(backupStaging,name);if(path.dirname(file)===path.resolve(backupStaging))try{if(fs.lstatSync(file).isFile())fs.unlinkSync(file);}catch{}}
  media.folder=path.join(app.getPath('userData'),'media-staging');fs.mkdirSync(media.folder,{recursive:true});
  // The single-instance lock owns this reserved staging directory. Reclaim
  // only our UUID-named temporary files; never enumerate or remove user photos.
  for(const name of fs.readdirSync(media.folder))if(/^[a-f0-9-]{36}\.media$/.test(name)){const file=path.resolve(media.folder,name);if(path.dirname(file)===path.resolve(media.folder))try{if(fs.statSync(file).isFile())fs.unlinkSync(file);}catch{}}
  protocol.handle('paddock-media',async request=>{
    if(request.method!=='GET')return new Response(null,{status:405});
    try{const found=media.lookup(request.url);if(!found)return new Response(null,{status:404});
     const image=found.thumbnail?await thumbnails.get(found.entry.meta.hash,request.url.replace('?thumbnail=1','')):await media.responseAsync(request.url);if(!image)return new Response(null,{status:503});
     return new Response(image.bytes,{headers:{'Content-Type':image.mime,'Cache-Control':'private, max-age=3600'}});
    }catch{return new Response(null,{status:500});}
  });
  startupFeedback=require('./startup-feedback.cjs').create({BrowserWindow,visible:!smoke&&!libraryStartup,quit:()=>{startupClosing=true;app.quit();}});
  try{let collectionFile=path.join(app.getPath('userData'),'database.json');
   if((!smoke&&require('./shared-library-activation.json').enabled)||sharedSmoke){const isolated=process.argv.includes('--test-collection');sharedRoot=sharedSmoke?path.join(sharedSmoke,'shared'):isolated?path.join(app.getPath('userData'),'shared-library'):require('./shared-library-location.cjs').directory();const library=await require('../packages/shared-library/index.cjs').open({application:'SlotForge Paddock',installationId:'paddock-desktop',legacyPaddockPath:collectionFile,sharedRoot,...(isolated?{legacyProfiles:[]}:{}),appData:sharedSmoke?path.join(sharedSmoke,'profiles'):app.getPath('appData')});try{collectionFile=(await library.status()).file;}finally{await library.close();}}
   store=await Store.open(collectionFile);
   // The very first editor also needs a durable generation for retry identity.
   if(store.expectedIdentity===null)await store.exclusiveFileOperation(()=>store.persistAsync(store.data));
  }catch(e){if(!startupClosing)dialog.showErrorBox('SlotForge database could not be opened',e.message+'\nYour existing files have not been replaced.');app.quit();return;}
  if(startupClosing||waitingToQuit){app.quit();return;}
  if(app.isPackaged)app.setAsDefaultProtocolClient('slotforge-paddock',process.env.PORTABLE_EXECUTABLE_FILE||process.env.APPIMAGE||process.execPath);
  network=new Network(store,change=>{if(win&&!win.isDestroyed())win.webContents.send('sf:changed',change);},result=>{if(win&&!win.isDestroyed())win.webContents.send('sf:network-state',media.project(result));});
  try{club=new Club(store,network,app.getPath('userData'),change=>{if(win&&!win.isDestroyed())win.webContents.send('sf:changed',change);});}catch(e){dialog.showErrorBox('Club copy could not be opened',e.message+'\nYour personal database and club files have not been replaced.');app.quit();return;}
  club.backupJobs=backupJobs;
  try{resultInbox=new (require('./result-inbox.cjs').ResultInbox)(app.getPath('userData'));}catch{resultInbox={file:path.join(app.getPath('userData'),'result-review.sqlite'),read:()=>({total:0,error:'Race-result notices could not be opened. Saved results remain available in each car’s Performance section. Check the profile storage and restart Paddock.'}),seen:()=>{throw Error('Race-result notices are unavailable.');},close:()=>{}};}store.resultInbox=resultInbox;
  const localModule=require('./local-library.cjs');
  localLibrary=new localModule.LocalLibrary({store,profile:app.getPath('userData'),launcher:launchCommand,folder:smoke||process.argv.includes('--test-collection')?path.join(app.getPath('userData'),'local-library-v1'):localModule.directory(),available:()=>!restoring&&(!store.data.club||club.coordinator),unavailableReason:()=>restoring?'A database replacement is in progress.':'This copy belongs to another dealership. Connect Timing to its original host.',onStatus:()=>{backgroundMode?.refresh();network.notify();},onChange:change=>{if(win&&!win.isDestroyed())win.webContents.send('sf:changed',change);}});
  network.localLibrary=localLibrary;
  if(sharedRoot)sharedObserver=require('./shared-library-observer.cjs').observe(store,()=>{network.notify();if(win&&!win.isDestroyed())win.webContents.send('sf:changed',{kind:'shared-library'});},error=>{if(win&&!win.isDestroyed())win.webContents.send('sf:changed',{kind:'shared-library-error',message:error.message});});
  backgroundMode=new (require('./background-mode.cjs').BackgroundMode)({profile:app.getPath('userData'),app,Tray,Menu,icon:nativeImage.createFromPath(path.join(__dirname,'..','assets','icon.png')).resize({width:20,height:20}),getWindow:()=>win,getLibrary:()=>localLibrary.status(),onChange:()=>network.notify()});
  network.backgroundMode=backgroundMode;
  powerMonitor.on('suspend',()=>localLibrary.suspend());
  powerMonitor.on('resume',()=>{void localLibrary.recover().catch(()=>network.notify());});
  powerMonitor.on('shutdown',event=>{event.preventDefault();backgroundMode.quit();});
  // Securing discovery must not delay the first screen. Shutdown still drains
  // LocalLibrary.starting before releasing the profile.
  void localLibrary.start().then(()=>network.notify()).catch(()=>network.notify());
  if(!smoke){networkTimer=setInterval(()=>network.poll().catch(()=>{}),5000);networkTimer.unref();}
  win=new BrowserWindow({width:1440,height:980,minWidth:960,minHeight:700,show:false,backgroundColor:'#171b21',icon:path.join(__dirname,'..','assets','icon.png'),title:'SlotForge Paddock',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  backgroundMode.attach(win);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.on('did-start-loading',()=>{rendererReady=false;transfer.clear();media.clear();thumbnails.clear();});
  win.webContents.session.setPermissionRequestHandler((wc,permission,callback)=>callback(permission==='fullscreen'&&wc===win.webContents&&wc.getURL()===pathToFileURL(entry).href));
  ipcMain.on('sf:media-lease',(event,active)=>{if(trustedFrame(event)&&typeof active==='boolean'){media.leaseOpen(active);mediaSweep();}});
  ipcMain.on('sf:thumbnail-result',(event,id,result)=>{if(trustedFrame(event)&&typeof id==='string')thumbnails.receive(id,result);});
  const mediaTimer=setInterval(()=>{try{mediaSweep();}catch{}},30000);mediaTimer.unref();win.on('closed',()=>{clearInterval(mediaTimer);thumbnails.clear();media.clear();});
  ipcMain.handle('sf:read',reply(known=>club.store.withIdle(()=>{rendererReady=true;const openCar=pendingCarLink;pendingCarLink=null;const current=club.store,unchanged=known?.databaseId===current.data.id&&known?.revision===current.data.revision&&known?.dataPath===current.file;const result={openCar,data:unchanged?null:known?.queryView?require('./view-query.cjs').view(current,known.queryView):current.snapshot(),club:club.status(),network:network.status(),remote:known?.databaseId?undefined:network.cached,collection:current.metadata(),version:app.getVersion(),dataPath:current.file};return known?.queryView?result:transfer.encode(result,known,current.file);})));
  ipcMain.handle('sf:mutate',reply(async(action,payload,known)=>{
   if(restoring)throw Error('Wait for the database replacement to finish.');
   const current=club.store;if(known?.databaseId&&known.databaseId!==current.data.id||known?.dataPath&&known.dataPath!==current.file)throw Error('The selected collection changed. Reopen the editor.');
   const result=await club.mutate(action,payload,{snapshot:!known?.queryView,commandId:known?.commandId,databaseId:known?.databaseId,epoch:known?.epoch});
   try{if(known?.queryView){try{return {...result,data:require('./view-query.cjs').view(current,known.queryView)};}catch{return {...result,data:require('./view-query.cjs').view(current,{page:'Overview'})};}}return transfer.encode(result,known,current.file);}
   catch(error){if(result.commandId)error.code='WRITE_UNCERTAIN';throw error;}
  }));
  ipcMain.handle('sf:plan',reply((action,payload)=>club.store.plan(action,payload)));
  ipcMain.handle('sf:history-view',reply(async payload=>{
   const current=club.store;
   const guard=()=>{if(restoring||club.store!==current||payload?.databaseId!==current.data.id)throw Error('The collection changed. Reopen its history.');};
   guard();return require('./domain-tasks.cjs').run(current,{kind:'history-view',input:payload},guard);
  }));
  ipcMain.handle('sf:timing-collection-review',reply(async payload=>{
   const current=club.store;
   const guard=()=>{if(restoring||club.store!==current||current!==store||current.data.club?.replica)throw Error('Review the Timing collection on its original library computer.');};
   guard();const revision=current.data.revision;
   try{return await require('./domain-tasks.cjs').run(current,{kind:'timing-collection-review',input:payload},guard);}
   finally{if(club.store===current&&current.data.revision!==revision&&win&&!win.isDestroyed())win.webContents.send('sf:changed',{kind:'local-import'});}
  }));
  ipcMain.handle('sf:car-merge',reply(payload=>{
   const current=club.store;
   if(payload?.action==='status'&&(restoring||current!==store))return {enabled:false};
   const guard=()=>{if(restoring||club.store!==current||current!==store)throw Object.assign(Error('Open the original collection on its authority computer to review car merges.'),{code:'MERGE_AUTHORITY_REQUIRED'});};
   return require('./car-merge-review-service.cjs').dispatch(payload,current,guard);
  }));
  ipcMain.handle('sf:history-import',reply(async payload=>{
   const current=club.store;
   const guard=()=>{if(restoring||club.store!==current||current!==store||current.data.club?.replica)throw Error('Open the original local library to review historical imports.');};
   guard();const revision=current.data.revision;
   try{return await require('./domain-tasks.cjs').run(current,{kind:'history-import',action:'review',input:payload},guard);}
   finally{
    // The worker can recover a durable commit even when its acknowledgement
    // fails. Refresh the owner UI as well as clients observing the change feed.
    if(club.store===current&&current.data.revision!==revision&&win&&!win.isDestroyed())win.webContents.send('sf:changed',{kind:'history-import'});
   }
  }));
  ipcMain.handle('sf:query',reply((operation,payload={})=>club.store.withIdle(()=>{
   if(operation==='result-seen'){
    if(club.store!==store||payload.databaseId!==store.data.id)throw Error('Open the original local library to acknowledge these results.');
    resultInbox.seen(store.data.id,payload);return {ok:true};
   }
   if(operation==='session')return require('./sqlite-query.cjs').read(club.store,payload.token,r=>require('./query-timing.cjs').session(r,payload.sourceId,payload.sessionId,payload.carId,payload.offset)).value;
   throw Error('Unknown page query.');
  })));
  ipcMain.handle('sf:file-cancel',reply(id=>backupJobs.cancel(id)));
  ipcMain.handle('sf:file',reply(async(action,p,known)=>{if(restoring)throw Error('Wait for the restore to finish.');let result;if(['restore','database.reset'].includes(action))restoring=true;let replacement;try{if(sharedRoot&&['restore','database.reset'].includes(action))replacement=await require('./shared-library-location.cjs').beginReplacement(sharedRoot,store.file,store.data.id);result=await files(action,p);}finally{try{if(replacement)await require('./shared-library-location.cjs').finishReplacement(sharedRoot,replacement);}finally{if(['restore','database.reset'].includes(action))restoring=false;}}if(!result||!known?.queryView)return result;return club.store.withIdle(()=>{if(action==='restore')return require('./view-query.cjs').view(club.store,{page:'Overview'});if(result.data?.schema)return {...result,data:require('./view-query.cjs').view(club.store,action==='database.reset'?{page:'Overview'}:known.queryView)};return result;});}));
  ipcMain.handle('sf:club',reply((action,p={})=>{if(restoring)throw Error('Wait for the restore to finish.');const current=club.store;return current.withIdle(async()=>{if(club.store!==current)throw Error('The collection changed. Reopen this action.');switch(action){case 'enable':await club.enableAsync(p.name,p.password);await network.stop();await network.start();return club.status();case 'disable':return club.disableAsync(p);case 'password':return club.setPassword(p.password);case 'start':if(!club.coordinator)throw Error('Enable Dealership Mode first.');return network.start();case 'stop':if(!club.coordinator)throw Error('This is not the dealership computer.');return network.stop();case 'join':return club.connect(p);case 'switch':return club.switchAsync(p.active);case 'update':return club.update(p.revision);case 'preview':return club.preview(p.id);case 'review':return club.reviewAsync(p);case 'retry':return club.sendOutbox();case 'discard':return club.discardOutbox();case 'leave':return club.leaveAsync();default:throw Error('Unknown club operation.');}});}));
  ipcMain.handle('sf:network',reply(async(action,p={})=>{if(restoring)throw Error('Wait for the restore to finish.');if(club.active&&['submit','retry'].includes(action))throw Error('Open your personal collection before sending a public car package. Club edits use Review.');switch(action){case'background-mode':backgroundMode.setEnabled(p.enabled);return network.status();case'local-retry':await localLibrary.recover();return network.status();case'local-access':await localLibrary.setEnabled(p.enabled);return network.status();case'discover':return network.discover();case'controls':return network.controls(p);case'auto':return network.autoRefresh(p.enabled);case'retry':return network.retrySubmission();case'discard':return network.discardSubmission();case'start':return network.start();case'stop':return network.stop();case'connect':return network.connect(p.address,p.code);case'refresh':return network.refresh();case'disconnect':return network.disconnect();case'submit':return network.submit(p.ids,p.options);default:throw new Error('Unknown network operation.');}}));
  try{await win.loadFile(entry);}catch(e){if(!startupClosing)dialog.showErrorBox('SlotForge could not be displayed',e.message);app.quit();return;}
  if(startupClosing||win.isDestroyed())return;startupFeedback?.dispose();startupFeedback=null;
  if(smoke){try{await localLibrary.start();if(sharedSmoke)await require('../tests/shared-library-smoke.cjs')(win,store,sharedSmoke);else await require('../tests/smoke.cjs')(win,store,network,media);localLibrary?.close();app.exit(0);}catch(e){const ui=await win.webContents.executeJavaScript('document.body.innerText').catch(()=>null);fs.writeFileSync(path.join(__dirname,'..','.qa','smoke-result.json'),JSON.stringify({passed:false,error:e.stack,ui},null,2));console.error(e.stack);localLibrary?.close();app.exit(1);}}
  else if(libraryStartup){await localLibrary.start();backgroundMode.startHidden();}else backgroundMode.open();
}).catch(error=>{if(!startupClosing)dialog.showErrorBox('Paddock could not finish opening',error.message);app.quit();});
app.on('activate',()=>backgroundMode?.open());
app.on('window-all-closed',()=>app.quit());
app.on('second-instance',(_event,argv)=>{if(argv.some(a=>a.startsWith(launcherModule.PREFIX)))return;for(const arg of argv)acceptCarLink(arg);if(win&&!win.isDestroyed())backgroundMode?.open();else startupFeedback?.focus();});
let waitingToQuit=false,quitReady=false;
app.on('before-quit',event=>{
 if(quitReady)return;
 event.preventDefault();backgroundMode?.beginQuit();startupClosing=true;ipcWork.stop();clearInterval(networkTimer);network?.quiesce();club?.quiesce();localLibrary?.quiesce();
 if(waitingToQuit)return;waitingToQuit=true;
 void (async()=>{
  // Startup may still be creating the first store. Wait for the whole bootstrap,
  // then recheck producers before draining every accepted IPC/HTTP operation.
  await Promise.allSettled([startupTask]);network?.quiesce();club?.quiesce();localLibrary?.quiesce();
  await Promise.all([ipcWork.idle(),network?.idle(),club?.idle(),localLibrary?.idle()]);
  await sharedObserver?.close();
  await Promise.all([store?.whenIdle(),club?.loadedCache?.whenIdle(),require('./collection-open.cjs').whenIdle()]);
  startupFeedback?.dispose();startupFeedback=null;club?.close();network?.close();localLibrary?.close();backgroundMode?.close();resultInbox?.close();
  quitReady=true;app.quit();
 })().catch(error=>{waitingToQuit=false;dialog.showErrorBox('Paddock could not finish closing',error.message+'\nPending work has not been forcibly stopped. Try closing again.');});
});
app.on('will-quit',()=>{for(const {file,directory}of temporaryDocuments){try{fs.unlinkSync(file);fs.rmdirSync(directory);}catch{/* An external viewer may still hold its temporary copy open. */}}});
