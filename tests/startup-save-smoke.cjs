'use strict';
// Run with Electron. Uses a new disposable profile and the real main/preload/API.
const {app,ipcMain}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-first-save-'));app.setPath('userData',folder);
const handle=ipcMain.handle.bind(ipcMain);let lost=false,started=false;
ipcMain.handle=(channel,fn)=>handle(channel,channel!=='sf:mutate'?fn:async(...args)=>{
 const result=await fn(...args);
 if(!lost&&result.ok){lost=true;return {error:'Lost test reply',code:'WRITE_UNCERTAIN'};}
 return result;
});
app.on('browser-window-created',(_event,win)=>win.webContents.on('did-finish-load',async()=>{
 if(started||!win.webContents.getURL().endsWith('/index.html'))return;started=true;
 const js=code=>win.webContents.executeJavaScript(code);
 const ready=async()=>{for(let i=0;i<100;i++){if(await js("typeof db!=='undefined'&&!!db?._view?.token?.epoch"))return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Initial collection generation was not exposed.');};
 try{
  await ready();const epoch=await js('db._view.token.epoch');
  const save="api('mutate','car.save',{data:{name:'First car'}})";
  assert.equal(await js(save+".then(()=>null,e=>e.message)"),'Lost test reply');
  assert.equal(await js("Object.keys(localStorage).filter(k=>k.startsWith('paddock-save-')).length"),1);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await ready();
  assert.equal(await js('db._view.token.epoch'),epoch);
  const result=await js(save);assert.equal(result.duplicate,true);
  assert.equal(await js("Object.keys(localStorage).filter(k=>k.startsWith('paddock-save-')).length"),0);
  const {Store}=require('../src/store.cjs');assert.equal(new Store(path.join(folder,'database.json')).data.cars.filter(c=>c.name==='First car').length,1);
  console.log('PASS first save: stable generation, lost IPC reply, renderer reload, exact retry and one car');app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
}));
require('../src/main.cjs');
