'use strict';
const assert=require('node:assert/strict');
module.exports=async({store,js,wait,click})=>{
 const checks=[],saved=store.snapshot();
 try{
  const id=store.mutate('car.save',{data:{name:'Selection review car',maker:'Example',reference:'GT-1'}}).result;
  await js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(id)};section='Overview';await loadView();})()`);await wait('!viewPendingKey&&!actionBusy');
  // The actual historical research renderer may offer competing webpage values.
  await js(`reviewHistoryResearch(researchContext(${JSON.stringify(id)}),{sources:[],proposals:[{field:'team',value:'Team A',sourceUrls:[],uncertainty:''},{field:'team',value:'Team B',sourceUrls:[],uncertainty:''},{field:'event',value:'Le Mans',sourceUrls:[],uncertainty:''}]})`);
  await click('[data-review-bulk="all"]');
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-review-choice]')).map(e=>e.checked)`),[false,false,true]);
  await js(`document.querySelector('[name="research-0"]').click()`);await click('[data-review-bulk="all"]');
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-review-choice]')).map(e=>e.checked)`),[true,false,true]);
  await js(`document.querySelector('[name="research-1"]').click()`);
  assert.deepEqual(await js(`Array.from(document.querySelectorAll('[data-review-choice]')).map(e=>e.checked)`),[false,true,true]);
  await click('[data-review-bulk="none"]');assert.equal(await js(`document.querySelector('[data-review-count]').textContent`),'0 of 3 selected');
  await click('[data-action="close-modal"]');checks.push('Historical research bulk selection skips competing values, preserves a chosen alternative and allows clearing');

  // Exercise the same scoped component with the Dealership field markers and a
  // required conflict confirmation. Disabled choices must not become selected.
  await js(`modal('Review selective changes','<fieldset data-review-selection><legend>Independent fields</legend>'+ReviewSelection.toolbar()+'<input type="checkbox" data-review-choice data-club-accept-field="name" checked><input type="checkbox" data-review-choice data-club-accept-field="raceClass"><fieldset disabled><input type="checkbox" data-review-choice></fieldset><input type="checkbox" required name="confirmConflict"></fieldset><input type="checkbox" name="outside">',null)`);
  await click('[data-review-bulk="all"]');
  assert.equal(await js(`document.querySelectorAll('[data-club-accept-field]:checked').length`),2);
  assert.equal(await js(`document.querySelector('[name=confirmConflict]').checked||document.querySelector('[name=outside]').checked||document.querySelector('fieldset[disabled] input').checked`),false);
  await click('[data-review-bulk="none"]');assert.equal(await js(`document.querySelectorAll('[data-club-accept-field]:checked').length`),0);
  await click('[data-action="close-modal"]');checks.push('Bulk selection stays within its review and never selects disabled fields or confirmations');

  // Render an actual incoming-car review with a fitted motor conflict.
  const part=store.mutate('part.save',{data:{name:'Fitted motor',quantity:1,tracking:'individual'}}).result;
  store.mutate('part.install',{carId:id,partId:part,quantity:1,field:'motor'});
  const {makePackage}=require('../src/store.cjs'),pack=makePackage(store.data,[id]);pack.cars[0].raceClass='GT3';pack.cars[0].technical.motor='Incoming motor';
  store.mutate('submission.add',{package:pack});
  await js(`(async()=>{page='Review';reviewTab='Incoming cars';await loadView();})()`);await wait('!viewPendingKey&&!actionBusy');
  await click('[data-review-bulk="none"]');await click('[data-review-bulk="all"]');
  assert.equal(await js(`document.querySelector('[data-review-field="raceClass"]').checked`),true);
  assert.equal(await js(`document.querySelector('[data-stock-override="motor"]').checked`),false);
  await js(`document.querySelector('[data-review-field="raceClass"]').click();render();undefined`);
  assert.equal(await js(`document.querySelector('[data-review-field="raceClass"]').checked`),false);
  assert.match(await js(`document.querySelector('[data-review-count]').textContent`),/^0 of /);
  checks.push('Incoming reviews preserve individual unticks across redraws and leave stock returns manual');
  return checks;
 }finally{store.replace(saved);await js("document.querySelector('#dialog').close();page='Overview';carId=null;source='local';loadView()");}
};
