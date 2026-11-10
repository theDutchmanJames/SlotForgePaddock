'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,network,js,wait,click,qa})=>{
 const size=win.getSize(),saved=store.snapshot(),local=network.localLibrary,enabled=local.enabled,checks=[];
 try{
  store.replace(require('../src/store.cjs').initial());if(!local.enabled)await local.setEnabled(true);
  const id=store.mutate('car.save',{data:{name:'Local library UI car',maker:'Original maker',technical:{motor:'Original motor'}}}).result;
  await js("(async()=>{source='local';page='Connections';carId=null;await loadView();})()");await wait('!viewPendingKey&&!actionBusy');
  assert.equal(await js("document.body.innerText.includes('Local connection ready')"),true);
  await click('[data-action="local-library-access"]');assert.equal(local.enabled,false);assert.equal(fs.existsSync(local.file),false);await click('[data-action="local-library-access"]');assert.equal(local.enabled,true);assert.equal(local.status().available,true);checks.push('Connections toggles protected local access without enabling LAN sharing');
  const input={version:1,databaseId:store.data.id,sourceId:'timing-ui',transferId:'ui-link',export:{format:'slotforge-timing-export',fileVersion:1,items:{slotcars:[{id:'local-car',name:'Timing name',brand:'Other maker'}]}},targets:[{timingCarId:'local-car',paddockCarId:id,expectedRevision:store.data.cars[0].revision}]};
  const response=await fetch('http://127.0.0.1:'+local.network.port+'/v1/local-library/imports',{method:'POST',headers:{Authorization:'Bearer '+local.token,'X-SlotForge-Instance':local.instanceId,'Content-Type':'application/json','X-SlotForge-Database':store.data.id},body:JSON.stringify(input)});assert.equal(response.status,200);const receipt=await response.json();
  await js("(async()=>{page='Review';reviewTab='Incoming cars';reviewId=null;reviewCarId=null;await loadView();})()");await wait("document.body.innerText.includes('Approve link')");
  assert.equal(await js("document.querySelectorAll('[data-review-field]').length"),0);assert.equal(await js("document.body.innerText.includes('without changing Paddock fields')"),true);
  win.setSize(1200,900);await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(qa,'local-library-link-review.png'),(await win.webContents.capturePage()).toPNG());
  await click('[data-action="accept-review"]');await wait('!viewPendingKey&&!actionBusy');assert.equal(store.data.submissions[0].outcomes[id].decision,'accept');assert.equal(store.data.cars[0].name,'Local library UI car');assert.equal(store.data.cars[0].maker,'Original maker');assert.equal(store.data.cars[0].technical.motor,'Original motor');checks.push('native Review approves a Timing identity link without writing car fields');
  const delivered=await fetch('http://127.0.0.1:'+local.network.port+'/v1/local-library/imports/timing-ui/ui-link',{headers:{Authorization:'Bearer '+local.token,'X-SlotForge-Instance':local.instanceId,'X-SlotForge-Database':store.data.id}});const result=await delivered.json();assert.equal(result.submissionId,receipt.submissionId);assert.equal(result.cars[0].timingCarId,'local-car');assert.equal(result.cars[0].decision,'accept');checks.push('native review decisions return as durable Timing transfer receipts');
  return checks;
 }finally{win.setSize(...size);store.replace(saved);if(local.enabled!==enabled)await local.setEnabled(enabled);await js("page='Overview';carId=null;source='local';loadView()");}
};
