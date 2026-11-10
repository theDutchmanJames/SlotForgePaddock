'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(win,store,root)=>{
 win.webContents.setBackgroundThrottling(false);const errors=[];
 win.webContents.on('console-message',(_e,...args)=>{for(const a of args)if(typeof a==='string'&&/Uncaught|ReferenceError|TypeError/.test(a))errors.push(a);});
 const js=code=>win.webContents.executeJavaScript(code,true),wait=async expression=>{for(let i=0;i<200;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Dealership UI wait failed: '+expression+'\n'+await js('document.body.innerText'));};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait('!actionBusy&&!viewPendingKey');};
 await wait("document.body.innerText.includes('On the workbench')");
 await click('[data-action="nav"][data-id="Connections"]');
 await wait("document.body.innerText.includes('Dealership offline')");
 const timing=await require('../packages/shared-library/index.cjs').open({application:'SlotForge Timing',installationId:'disable-test',sharedRoot:path.join(root,'shared')});
 try{
  const before=await timing.status();await click('[data-action="club-disable"]');
  await wait("document.querySelector('#dialog').open");await js("document.querySelector('#modal-form').requestSubmit()");
  await wait("!document.querySelector('#dialog').open&&!db.club");
  assert.equal(store.data.club,null);assert.equal(await js("!!document.querySelector('[data-action=\"club-disable\"]')"),false);
  assert.equal(await js("!!document.querySelector('.club-banner')"),false);
  const after=await timing.status();assert.equal(after.databaseId,before.databaseId);assert.equal(after.recoveryId,before.recoveryId);assert.equal((await timing.catalogue()).total,1);
  assert(fs.readdirSync(path.join(root,'paddock-profile','club-backups')).some(v=>v.startsWith('before-disabling-dealership-')));
  assert.deepEqual(errors,[]);await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const image=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'native-paddock.png'),image.toPNG());
  fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,checks:['Offline host without password exposes exit','Confirmation saves and closes','Dealership banner removed','Cars preserved','Shared library identity and recovery unchanged','Recovery backup saved'],rendererErrors:errors},null,2));
 }finally{await timing.close();}
};
