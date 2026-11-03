'use strict';
// Run with Electron, passing a disposable synthetic .sqlite fixture. Copies it
// into a new QA profile; never points the app at a user's installed collection.
const started=performance.now(),fs=require('node:fs'),path=require('node:path'),{app,BrowserWindow}=require('electron');
const root=path.resolve(__dirname,'..','.qa'),source=path.resolve(process.argv[2]||'');
if(!source.startsWith(root+path.sep)||path.extname(source)!=='.sqlite')throw Error('Use a synthetic SQLite fixture beneath .qa.');
fs.mkdirSync(root,{recursive:true});const profile=fs.mkdtempSync(path.join(root,'desktop-startup-'));fs.copyFileSync(source,path.join(profile,'database.sqlite'));
app.setPath('userData',profile);BrowserWindow.prototype.show=function(){};
const stages={};let done=false,openedStore;
const model=require('../src/store.cjs'),BaseStore=model.Store;model.Store=class extends BaseStore{constructor(...args){const t=performance.now();super(...args);stages.storeOpenMs=+(performance.now()-t).toFixed(1);openedStore=this;}};
const deadline=setTimeout(()=>finish(Error('Desktop startup benchmark timed out')),120000);
function finish(error,result){if(done)return;done=true;clearTimeout(deadline);console.log(JSON.stringify(error?{error:error.stack}:result));app.exit(error?1:0);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(_event,win)=>{
 stages.windowCreatedMs=+(performance.now()-started).toFixed(1);win.webContents.setBackgroundThrottling(false);
 win.webContents.once('did-finish-load',async()=>{try{
  stages.domLoadedMs=+(performance.now()-started).toFixed(1);const js=code=>win.webContents.executeJavaScript(code,true);
  for(let n=0;n<400;n++){if(await js("typeof db!=='undefined'&&!!db?._view&&document.querySelector('#main').innerText.includes('On the workbench')"))break;if(n===399)throw Error('Overview not usable');await wait(25);}
  const usableMs=+(performance.now()-started).toFixed(1),startupLoading=openedStore?.deferredState?structuredClone(openedStore.deferredState.stats):null,memory=()=>app.getAppMetrics().map(p=>({type:p.type,workingSetMiB:+(p.memory.workingSetSize/1024).toFixed(1),peakMiB:+(p.memory.peakWorkingSetSize/1024).toFixed(1)})),initial=memory(),ipc=await js("JSON.stringify(db).length"),samples=[];
  for(let n=0;n<120;n++){
   const page=['Cars','Showroom','Parts','Workshop','Overview'][n%5];
   await js(`document.querySelector('[data-action="nav"][data-id="${page}"]').click()`);
   for(let attempt=0;attempt<200;attempt++){if(await js(`db?._view?.request?.page===${JSON.stringify(page)}`))break;if(attempt===199)throw Error('Navigation did not finish: '+page);await wait(10);}
   await wait(30);if(n%20===19){win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');win.webContents.debugger.detach();samples.push({n:n+1,memory:memory(),renderer:await js('({heap:performance.memory?.usedJSHeapSize,dom:document.querySelectorAll("*").length})')});}
  }
  finish(null,{usableMs,stages,startupLoading,overviewJsonChars:ipc,initial,samples,environment:{electron:process.versions.electron,node:process.versions.node},profile,scope:'Warm OS cache; hidden real app from benchmark entry to rendered overview, then 120 page switches. Renderer GC at 20-page checkpoints; working sets include Chromium/worker caches.'});
 }catch(e){finish(e);}});
});
require('../src/main.cjs');
