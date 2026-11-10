'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{app,dialog,BrowserWindow}=require('electron');
const base=path.resolve(__dirname,'../..'),root=path.resolve(process.env.SF_PADDOCK_ORDINARY_QA||'');
assert(root.startsWith(path.join(base,'.qa')+path.sep));const permission=JSON.parse(fs.readFileSync(path.join(root,'permission.json')));assert.equal(permission.disposable,true);assert.equal(require('../../src/shared-library-activation.json').enabled,true);
const profiles=path.join(root,'profiles');app.setPath('appData',profiles);app.setPath('userData',path.join(profiles,'slotforge-database'));process.env.APPDATA=profiles;process.env.LOCALAPPDATA=path.join(root,'local');app.disableHardwareAcceleration();
dialog.showErrorBox=(title,message)=>{fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({title,message}));app.exit(1);};
const timer=setTimeout(()=>app.exit(2),80000);let started=false;
app.on('browser-window-created',(_,win)=>{win.show=()=>{};win.showInactive=()=>{};win.webContents.setBackgroundThrottling(false);win.webContents.on('did-finish-load',async()=>{
 if(started||!win.webContents.getURL().endsWith('/renderer/index.html'))return;started=true;win.setOpacity(0);BrowserWindow.prototype.showInactive.call(win);let peer;
 const js=code=>win.webContents.executeJavaScript(code),wait=async code=>{for(let n=0;n<200;n++){if(await js(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('Normal app wait failed: '+code+'\n'+await js('document.body.innerText'));};
 try{
  await wait("document.body.innerText.includes('On the workbench')");const sharedRoot=require('../../src/shared-library-location.cjs').directory(),registration=require('../../src/shared-library-location.cjs').read(sharedRoot);assert(registration);
  assert.equal(await js('db.id'),registration.databaseId);await js("document.querySelector('[data-action=nav][data-id=Cars]').click()");await wait('!actionBusy&&!viewPendingKey');await wait('document.body.innerText.includes('+JSON.stringify(permission.first==='timing'?'Ordinary Timing car':'Ordinary Paddock car')+')');
  peer=await require('../../packages/shared-library/index.cjs').open({application:'SlotForge Timing',installationId:'ordinary-peer',sharedRoot,appData:profiles});const status=await peer.status(),car=(await peer.catalogue()).cars[0];assert.equal(status.file,registration.file);
  if(permission.first==='timing')assert.equal((await peer.historyRead({kind:'statistics',carId:car.id})).historicalSessions,1);
  await peer.carWrite({databaseId:status.databaseId,recoveryId:status.recoveryId,operationId:'ordinary-change',action:'patch',carId:car.id,expectedRevision:car.revision,set:{name:'Ordinary shared refresh'}});await wait("document.body.innerText.includes('Ordinary shared refresh')");
  fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,first:permission.first,root,file:status.file,databaseId:status.databaseId,ordinaryGate:true,originalPreserved:true},null,2));await peer.close();clearTimeout(timer);app.exit(0);
 }catch(error){await peer?.close().catch(()=>{});fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({message:error.message,stack:error.stack}));console.error(error);clearTimeout(timer);app.exit(1);}
});});
require('../../src/main.cjs');
