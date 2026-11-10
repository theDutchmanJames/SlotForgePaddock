'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(win,store,root)=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'joint.json'),'utf8'));assert.equal(store.data.id,config.databaseId);
 const revision=store.data.revision,errors=[],checks=[];win.webContents.setBackgroundThrottling(false);
 win.webContents.on('console-message',(_e,...args)=>{for(const a of args)if(typeof a==='string'&&/Uncaught|ReferenceError|TypeError/.test(a))errors.push(a);});
 const js=code=>win.webContents.executeJavaScript(code,true),wait=async expression=>{for(let i=0;i<180;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Joint app wait failed: '+expression+'\n'+await js('document.body.innerText'));};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait('!actionBusy&&!viewPendingKey');};
 await wait("document.body.innerText.includes('On the workbench')");
 const cars=store.data.cars,records=store.data.timing.sessions;assert.ok(cars.length);assert.ok(records.length);
 await click('[data-action="nav"][data-id="Cars"]');
 for(const car of cars)await wait('document.body.innerText.includes('+JSON.stringify(car.name)+')');checks.push('Timing normal editor cars visible in Paddock Cars');
 let measured=0,originals=0;
 for(const car of cars){
  await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="open-car"][data-id="'+car.id+'"]');await click('[data-action="section"][data-id="Performance"]');
  await wait('!!historyCarState?.result');assert.equal(await js('historyCarState.error'),'');
  const sessions=await js('historyCarState.result.entries');
  for(let i=0;i<sessions.length;i++){
   const session=sessions[i];if(session.accepted.state!=='active')continue;
   await click('[data-action="history-view-open"][data-id="'+i+'"]');await wait('!!historySessionState?.head');
   await js("historySessionState.tab='Laps';loadHistoryLaps()");await wait('!!historySessionState?.laps||!!historySessionState?.error');assert.equal(await js('historySessionState.error'),'');measured++;
   await click('#dialog [data-action="close-modal"]');
  }
  if(await js('!!document.querySelector(\'[data-action="original-history-list"]\')')){
   await click('[data-action="original-history-list"]');await wait('!!document.querySelector(\'[data-action="original-history-open"]\')');
   await click('[data-action="original-history-open"]');await wait('!!originalHistoryState?.result?.laps');assert.ok((await js('originalHistoryState.result.laps')).length);originals++;
   await click('#dialog [data-action="close-modal"]');
  }
 }
 assert.ok(measured>0);assert.ok(originals>0);checks.push('Timing finalized measured laps open in Paddock Performance','Timing finalized token laps visible as original evidence');
 assert.equal(store.data.revision,revision);assert.equal(store.pendingClubReviews(),0);assert.deepEqual(errors,[]);checks.push('Viewing shared results creates no Review or database edits');
 if(config.live){
  const exchange=config.exchange,pause=()=>new Promise(r=>setTimeout(r,100)),receive=async name=>{for(let n=0;n<1000;n++){if(fs.existsSync(path.join(exchange,'failure.json')))throw Error(fs.readFileSync(path.join(exchange,'failure.json'),'utf8'));if(fs.existsSync(path.join(exchange,name)))return JSON.parse(fs.readFileSync(path.join(exchange,name),'utf8'));await pause();}throw Error('Timing handshake timeout: '+name);},publish=(name,value)=>{const file=path.join(exchange,name);fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);};
  const ready=await receive('ready.json'),car=cars[0];assert.equal(ready.status.databaseId,config.databaseId);
  await click('[data-action="nav"][data-id="Cars"]');publish('go.json',{databaseId:config.databaseId,carId:car.id,name:'Timing native joint edit'});
  const written=await receive('written.json');await wait("document.body.innerText.includes('Timing native joint edit')");checks.push('Timing normal editor save refreshes Paddock Cars automatically');
  await click('[data-action="open-car"][data-id="'+car.id+'"]');await click('[data-action="section"][data-id="Performance"]');await wait('!!historyCarState?.result');
  await wait('historyCarState.result.entries.some(e=>e.sessionId==='+JSON.stringify(written.sessionId)+')');checks.push('Timing normal race finalization appears in Paddock Performance');
  await click('[data-action="edit-car"]');await wait('!!document.querySelector(\'[name="name"]\')');await js("document.querySelector('[name=name]').value='Paddock native joint edit';document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#dialog').open&&!modalSaving");
  publish('finish.json',{carId:car.id,name:'Paddock native joint edit'});assert.equal((await receive('result.json')).passed,true);checks.push('Paddock normal editor save refreshes Timing normal Slotcars automatically');assert.equal(store.pendingClubReviews(),0);assert.deepEqual(errors,[]);
 }
 if(config.restore){
  const peer=await require('../packages/shared-library/index.cjs').open({application:'Timing QA',installationId:'native-joint-restore',sharedRoot:path.join(root,'shared')});
  try{
   const status=await peer.status(),car=cars[0],destination=path.join(root,'before-peer-restore.sfpbackup');
   await peer.backup({databaseId:status.databaseId,recoveryId:status.recoveryId,revision:status.revision,destination});
   await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="open-car"][data-id="'+car.id+'"]');await click('[data-action="edit-car"]');
   await wait('!!document.querySelector(\'[name="name"]\')');await js("document.querySelector('[name=name]').value='Unsaved old-generation editor'");
   const restored=await peer.restore({databaseId:status.databaseId,recoveryId:status.recoveryId,revision:status.revision,operationId:'native-restore',source:destination});
   await js("document.querySelector('#modal-form').requestSubmit()");await wait("!modalSaving&&!document.querySelector('#form-error').hidden");
   assert.match(await js("document.querySelector('#form-error').innerText"),/restor|generation|reopen|replaced/i);assert.equal((await peer.car(car.id)).fields.name,car.name);
   assert.equal(await js("document.querySelector('[name=name]').value"),'Unsaved old-generation editor');checks.push('Peer restore rejects open stale editor and preserves typed values');
   await click('#dialog [data-action="close-modal"]');await wait('db._view.token.epoch==='+JSON.stringify(restored.recoveryId));
   await click('[data-action="edit-car"]');await wait('!!document.querySelector(\'[name="name"]\')');await js("document.querySelector('[name=name]').value='Paddock after shared restore';document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#dialog').open&&!modalSaving");
   assert.equal((await peer.car(car.id)).fields.name,'Paddock after shared restore');assert.equal(store.pendingClubReviews(),0);checks.push('Reopened editor writes restored shared file without Review');
  }finally{await peer.close();}
 }
 fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,file:store.file,databaseId:store.data.id,checks,measured,originals,rendererErrors:errors},null,2));
 fs.writeFileSync(path.join(root,'native-paddock.png'),(await win.webContents.capturePage()).toPNG());
};
