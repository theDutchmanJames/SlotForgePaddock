'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{dialog,app}=require('electron');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),{SharingRetirement}=require('../src/sharing-retirement.cjs');
module.exports=async({store,root,network,localLibrary,js,wait,click,fill,submit,photo})=>{
 const checks=[],remoteStore=new Store(path.join(root,'remote-host','database.json')),remote=new Network(remoteStore),club=new Club(remoteStore,remote,path.join(root,'remote-host')),migration=remote.retirement=new SharingRetirement(remote,club,path.join(root,'remote-host'));
 const saveDialog=dialog.showSaveDialog,openDialog=dialog.showOpenDialog,messageDialog=dialog.showMessageBox,request=network.request.bind(network),file=path.join(root,'pending-recovery.json');
 try{
  remoteStore.mutate('car.save',{data:{name:'Original remote car'}});await remote.start();await network.connect('127.0.0.1:'+remote.port,remote.code);
  network.request=async(...args)=>{const r=await request(...args);if(args[2]==='/v1/submissions')throw Error('Lost acknowledgement');return r;};await assert.rejects(network.submit([store.data.cars[0].id],{}));network.request=request;
  await js('openConnectionSettings();render();');await wait('!!document.querySelector("[data-action=recovery-export]")');
  let asked=false,prevented=false;dialog.showMessageBox=async()=>{asked=true;return {response:0};};app.emit('before-quit',{preventDefault(){prevented=true;}});await wait('true');assert(asked&&prevented);assert(!network.work.closing);checks.push('quitting with an unsaved pending submission offers recovery and cancellation keeps the app running');
  dialog.showSaveDialog=async()=>({canceled:true});await click('[data-action="recovery-export"]');assert(!network.status().pending.recoverySaved);
  dialog.showSaveDialog=async()=>({canceled:false,filePath:store.file});await click('[data-action="recovery-export"]');assert(!network.status().pending.recoverySaved);assert(store.data.cars.length>0);
  dialog.showSaveDialog=async()=>({canceled:false,filePath:file});await click('[data-action="recovery-export"]');assert(network.status().pending.recoverySaved);assert(fs.existsSync(file));const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.hostId,remoteStore.data.id);
  await photo('pending-recovery-saved');await click('[data-action="discard-submission"]');await submit();assert.equal(network.pending,null);
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});await click('[data-action="recovery-import"]');assert.equal(network.pending.bundle.packageId,saved.bundle.packageId);
  await click('[data-action="retry-submission"]');assert.equal(network.pending,null);assert.equal(remoteStore.data.submissions.length,1);checks.push('recovery save cancellation, file export/import and lost-acknowledgement retry through native UI');
  await migration.host({confirmed:true,databaseId:remoteStore.data.id,name:'Remote dealership',password:'remote dealership'});
  await click('[data-action="migrate-browser"]');await click('[data-action="close-modal"]');assert.equal(network.remote.id,remoteStore.data.id);
  await click('[data-action="migrate-browser"]');await fill({address:'127.0.0.1:'+remote.port,name:'Local PC',code:'remote dealership'});await js('document.querySelector("#modal-form [name=confirmed]").checked=true');await submit();await wait('clubState.active');
  assert.equal(await js('db.id'),remoteStore.data.id);assert.equal(network.cached.id,remoteStore.data.id);await click('[data-action="club-personal"]');assert.equal(await js('db.id'),store.data.id);checks.push('native browser migration keeps original public view and personal library separate from dealership copy');
  // Host migration cancels cleanly, then shows actual address and durable guidance.
  await js('openConnectionSettings();render();');await wait('!!document.querySelector("[data-action=start-sharing]")');await click('[data-action="start-sharing"]');const oldPort=network.port,oldCode=network.code,localPort=localLibrary.network.port,token=localLibrary.token;
  await click('[data-action="migrate-host"]');await photo('migration-confirmation');await click('[data-action="close-modal"]');assert.equal(network.port,oldPort);assert.equal(network.code,oldCode);
  const startHost=network.startHost.bind(network);network.startHost=async()=>{throw Error('Test listener unavailable');};
  try{await click('[data-action="migrate-host"]');await fill({name:'Local dealership',password:'local dealership',confirm:'local dealership'});await js('document.querySelector("#modal-form [name=confirmed]").checked=true');await submit();assert.equal(network.server,null);await wait('!!document.querySelector("[data-action=club-start]")');}finally{network.startHost=startHost;}
  await click('[data-action="club-start"]');await wait('net.hostingMode==="dealership"');await wait('!!document.querySelector("[data-action=migration-ack]")');
  assert.equal(localLibrary.network.port,localPort);assert.equal(localLibrary.token,token);assert.equal(await js('net.sharedFile.databaseId'),store.data.id);await js('document.querySelector("[data-action=migration-ack]").scrollIntoView({block:"center"})');await photo('migration-complete');
  await click('[data-action="migration-ack"]');await js('document.querySelector("#modal-form [name=confirmed]").checked=true');await submit();assert.equal(network.retirement.status(),null);checks.push('native host migration cancellation, listener failure/retry, unchanged local service and explicit client-check completion');
 }finally{dialog.showSaveDialog=saveDialog;dialog.showOpenDialog=openDialog;dialog.showMessageBox=messageDialog;network.request=request;club.close();await remote.stop();remote.close();network.discardSubmission();}
 return checks;
};
