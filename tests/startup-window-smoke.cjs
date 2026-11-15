'use strict';
// Run with Electron, optionally --app-root=<packaged resources/app.asar>.
// Every library/profile path is isolated; no personal collections are opened.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {app,dialog}=require('electron');
process.on('uncaughtException',error=>{console.error(error.stack);app.exit(1);});
process.on('unhandledRejection',error=>{console.error(error);app.exit(1);});
const root=path.resolve(process.argv.find(a=>a.startsWith('--app-root='))?.slice(11)||path.join(__dirname,'..'));
const mode=process.argv.find(a=>a.startsWith('--scenario='))?.slice(11)||'normal';
const isolated=fs.mkdtempSync(path.resolve(__dirname,'../.qa/startup-window-'));
for(const name of ['appData','userData']){const folder=path.join(isolated,name);fs.mkdirSync(folder);app.setPath(name,folder);}
process.env.LOCALAPPDATA=path.join(isolated,'local');process.env.APPDATA=app.getPath('appData');process.env.XDG_DATA_HOME=path.join(isolated,'xdg');
// Also isolate macOS's home-derived library location.
require('node:os').homedir=()=>isolated;
app.setAppPath(root);
if(mode==='large'){
 const {Store}=require(root+'/src/store.cjs'),store=new Store(path.join(app.getPath('userData'),'database.sqlite'));
 store.mutate('car.save',{data:{name:'Startup fixture',maker:'Test'}});
 const data=store.snapshot(),car=data.cars[0];data.events=[];data.cars=Array.from({length:1000},(_,i)=>({...structuredClone(car),id:'startup-car-'+i,name:'Startup car '+i}));store.replace(data);
}
let splash,main,shown=false,finished=false;const errors=[];
dialog.showErrorBox=(title,message)=>{errors.push({title,message});};
const guard=setTimeout(()=>{console.error('Startup window qualification timed out',mode,errors);app.exit(1);},60000);
if(mode==='background'){
 const launcher=require(root+'/src/local-library-launcher.cjs');launcher.readStart=()=>({profile:app.getPath('userData')});
}
if(mode==='database-error'){
 const {Store}=require(root+'/src/store.cjs');Store.open=async()=>{throw Error('Isolated simulated database-open failure');};
}
app.on('browser-window-created',(_event,win)=>{
 if(!splash){
  splash=win;win.on('show',()=>{shown=true;if(mode==='cancel')win.close();});
  if(mode==='normal')win.webContents.once('did-finish-load',async()=>{try{const image=await win.webContents.capturePage();fs.writeFileSync(path.join(isolated,'loading.png'),image.toPNG());}catch{}});
 }else if(!main){
  main=win;
  win.on('show',()=>{try{assert.notEqual(mode,'background');assert.equal(shown,true);assert.ok(!splash.isDestroyed(),'Loading window stays until main is shown');}catch(e){console.error(e);app.exit(1);}});
  win.webContents.on('did-finish-load',async()=>{
   if(mode==='cancel'||mode==='database-error')return;
   try{
    for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript('typeof startupAnnounced!=="undefined"&&startupAnnounced')&&splash.isDestroyed())break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(await win.webContents.executeJavaScript('!!db?.id&&document.querySelector("#main").textContent.length>20'),true);
    if(mode==='large')assert.equal(await win.webContents.executeJavaScript('db._view.stats.cars'),1000);
    assert.equal(splash.isDestroyed(),true);assert.equal(main.isVisible(),mode!=='background');assert.equal(errors.length,0);
    if(mode==='background')assert.equal(shown,false);
    finished=true;console.log(JSON.stringify({passed:true,mode,root,isolated,checks:['loading visibility','populated first screen','handoff','isolated library']}));clearTimeout(guard);app.quit();
   }catch(e){console.error(e);app.exit(1);}
  });
 }
});
app.on('will-quit',()=>{
 if(mode==='cancel'||mode==='database-error'){
  try{assert.equal(shown,true);assert.ok(!main||main.isDestroyed());assert.equal(errors.length,mode==='database-error'?1:0);finished=true;console.log(JSON.stringify({passed:true,mode,isolated,checks:['safe early quit','no surviving main window']}));clearTimeout(guard);}catch(e){console.error(e);app.exit(1);}
 }
 if(!finished){console.error('Unexpected early quit',mode,errors);app.exit(1);}
});
require(root+'/src/main.cjs');
