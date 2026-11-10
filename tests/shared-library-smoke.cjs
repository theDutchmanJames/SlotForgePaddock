'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(win,store,root)=>{
 if(fs.existsSync(path.join(root,'native-history.json')))return require('./native-history-smoke.cjs')(win,store,root);
 if(fs.existsSync(path.join(root,'disable-dealership.json')))return require('./dealership-disable-smoke.cjs')(win,store,root);
 if(fs.existsSync(path.join(root,'joint.json')))return require('./shared-library-joint-smoke.cjs')(win,store,root);
 win.webContents.setBackgroundThrottling(false);const errors=[];win.webContents.on('console-message',(_e,...args)=>{for(const a of args)if(typeof a==='string'&&/Uncaught|ReferenceError|TypeError/.test(a))errors.push(a);});
 const js=code=>win.webContents.executeJavaScript(code,true),wait=async expression=>{for(let i=0;i<150;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Native shared library wait failed: '+expression+'\n'+await js('document.body.innerText'));};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait('!actionBusy&&!viewPendingKey');};
 await wait("document.body.innerText.includes('On the workbench')");const car=store.data.cars.find(c=>c.reference==='old-reference');assert.ok(car,'Timing-first car must be present before any connection or import');
 await click('[data-action="nav"][data-id="Cars"]');await wait("document.body.innerText.includes('Old Timing car')");await click('[data-action="open-car"][data-id="'+car.id+'"]');await click('[data-action="section"][data-id="Performance"]');await wait("document.body.innerText.includes('Old measured race')");
 await click('[data-action="original-history-list"]');await wait("document.body.innerText.includes('Old token session')");await click('[data-action="original-history-open"]');await wait("document.body.innerText.includes('4000')");await click('#dialog [data-action="close-modal"]');
 await click('[data-action="section"][data-id="Overview"]');
 const timing=await require('../packages/shared-library/index.cjs').open({application:'SlotForge Timing',installationId:'native-timing',sharedRoot:path.join(root,'shared')});
 try{
  const status=await timing.status(),before=await timing.car(car.id);await timing.carWrite({databaseId:status.databaseId,recoveryId:status.recoveryId,operationId:'live-timing-edit',action:'patch',carId:car.id,expectedRevision:before.revision,set:{name:'Changed while both open'}});
  await wait("document.body.innerText.includes('Changed while both open')");await click('[data-action="edit-car"]');await wait("!!document.querySelector('[name=\"name\"]')");await js("document.querySelector('[name=\"name\"]').value='Saved from Paddock';document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#dialog').open&&document.body.innerText.includes('Saved from Paddock')");assert.equal((await timing.car(car.id)).fields.name,'Saved from Paddock');
  assert.equal(store.pendingClubReviews(),0);assert.equal(store.data.submissions.length,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,file:store.file,databaseId:status.databaseId,checks:['Timing-first automatic adoption','Cars normal screen','Historical laps visible','Unsupported original laps visible','External live edit visible','Paddock editor writes same file','No Review generated'],rendererErrors:errors},null,2));
  const image=await win.webContents.capturePage();fs.writeFileSync(path.join(root,'native-paddock.png'),image.toPNG());
 }finally{await timing.close();}
};
