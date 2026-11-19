'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({store,js,wait,click,fill,submit,qa,dialog})=>{
 const checks=[],act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Detail target',technical:{motor:'Original',weight:'80'}}});
 const other=act('car.save',{data:{name:'Other car'}});act('setup.save',{carId:car,name:'Target setup'});act('setup.save',{carId:other,name:'Other setup'});
 const idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 await js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(car)};section='Overview';await loadView()})()`);
 await click('[data-action="edit-car"]');assert.equal(await js('db.cars.length'),1);await fill({name:'Edited target','technical.weight':'81'});await submit();await idle();await wait("document.querySelector('#main').textContent.includes('Edited target')");assert.equal(store.data.cars.find(c=>c.id===car).technical.weight,'81');
 await click('[data-action="section"][data-id="Performance"]');await click('[data-action="add-test"]');assert.deepEqual(await js("Array.from(document.querySelector('[name=setupId]').options).map(o=>o.text)"),['Actual current car (including unfinished work)','Saved historical snapshot: Target setup · '+await js(`date(${JSON.stringify(store.data.setups.find(s=>s.name==='Target setup').date)})`)]);await fill({track:'Test circuit',lane:'2',best:'6.5',laps:'10'});await submit();await idle();assert.equal(store.data.tests[0].technical.weight,'81');await wait("document.querySelector('#main').textContent.includes('Test circuit')");
 checks.push('focused car editor and manual test selector save and refresh immediately');
 const image=path.join(__dirname,'../assets/icon.png'),oldDialog=dialog.showOpenDialog;
 try{
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[image]});await click('[data-action="section"][data-id="Photos & documents"]');await click('[data-action="main-photo"]');await idle();await wait("document.querySelector('.photo-grid img')?.naturalWidth>0");
  await click('[data-action="add-photo"]');await idle();assert.equal(store.data.cars.find(c=>c.id===car).photos.length,1);await click('[data-action="delete-photo"]');await idle();assert.equal(store.data.cars.find(c=>c.id===car).photos.length,0);assert.ok(store.data.cars.find(c=>c.id===car).picture);
  const pdf=path.join(qa,'phase3-manual.pdf');fs.writeFileSync(pdf,'%PDF-1.4\n%%EOF');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[pdf]});
  await click('[data-action="attach-document"]');await fill({title:'Target manual'});await submit();await idle();assert.equal(store.data.documents.length,1);await wait("document.querySelector('#main').textContent.includes('Target manual')");await click('[data-action="remove-document"]');await submit();await idle();assert.equal(store.data.documents.length,0);
 }finally{dialog.showOpenDialog=oldDialog;}
 checks.push('main/additional photos and private documents persist and disappear immediately on removal');
 await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="add-car"]');await fill({name:'New through focused editor'});await submit();await idle();await wait("document.querySelector('#main').textContent.includes('New through focused editor')");assert.equal(store.data.cars.length,3);
 checks.push('new car editor returns to the created car');return checks;
};
