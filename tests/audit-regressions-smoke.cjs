const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initial,Store,makePackage}=require('../src/store.cjs');
module.exports=async({store,js,wait,click,fill,submit,qa,dialog})=>{
  const failures=[],checks=[];
  store.data=initial();store.persist(store.data);
  const car=store.mutate('car.save',{data:{name:'Audit car'}}).result;
  const other=store.mutate('car.save',{data:{name:'Setup car'}}).result;
  const job=store.mutate('job.start',{revision:store.data.revision,kind:'general',carId:car,name:'Clean braids'}).result;
  store.mutate('setup.save',{carId:other,name:'Baseline'});const setup=store.data.setups[0].id;
  const part=store.mutate('part.save',{data:{name:'Audit tyres',quantity:4,tracking:'quantity'}}).result;
  await js(`(async()=>{const r=await api('read');db=r.data;collectionMeta=r.collection;switchCollection('local');toolboxTab='Workshop supplies';page='Overview';render();})()`);
  await click(`[data-action="open-job"][data-id="${job}"]`);
  await wait(`document.querySelector('#main h1').textContent==='Clean braids'`);
  await click('[data-action="jobs-back"]');
  if(await js(`document.querySelector('#main h1').textContent`)!=='Workshop')failures.push('All workshop jobs returns to Supplies after resuming a job.');
  await js(`toolboxTab='Workshop supplies';workshopJob=null;page='Cars';carId='${other}';section='Setups';render();`);
  await click(`[data-action="start-job"][data-id="${setup}"]`);await submit();await click('[data-action="jobs-back"]');
  if(await js(`document.querySelector('#main h1').textContent`)!=='Workshop')failures.push('All workshop jobs returns to Supplies after starting a setup job.');
  checks.push('resumed and newly started setup jobs return to the job queue after visiting Supplies');

  await js(`page='Parts';partsTab='Stock';editPart('${part}');`);await fill({quantity:''});
  await js(`document.querySelector('#modal-form').requestSubmit()`);await wait('!modalSaving');
  if(store.data.parts.find(p=>p.id===part).quantity!==4)failures.push('Clearing quantity silently removes all available stock.');
  if(await js(`document.querySelector('#dialog').open`)){
    assert.equal(await js(`document.querySelector('[name=quantity]').validity.valueMissing`),true);
    await fill({quantity:'0'});await submit();assert.equal(store.data.parts.find(p=>p.id===part).quantity,0);
  }
  checks.push('blank part quantity is blocked and an explicit zero remains allowed');

  const sender=new Store(),oldCar=sender.mutate('car.save',{data:{name:'Earlier arrival'}}).result;
  const old=store.mutate('submission.add',{package:makePackage(sender.data,[oldCar])}).result;
  const newCar=sender.mutate('car.save',{data:{name:'Newly imported car'}}).result;
  const file=path.join(qa,'audit-import.json');fs.writeFileSync(file,JSON.stringify(makePackage(sender.data,[newCar])));
  const original=dialog.showOpenDialog;
  try{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    await js(`(async()=>{db=(await api('read')).data;page='Import & Export';reviewId='${old}';reviewCarId='${oldCar}';render();})()`);
    await click('[data-action="import"]');await wait(`page==='Review'&&!actionBusy`);
    assert.equal(store.data.cars.length,2);
    const latest=store.data.submissions[0];
    if(await js('reviewId')!==latest.id||await js('reviewCarId')!==newCar)failures.push('Import leaves the previously selected submission open instead of the new package.');
    checks.push('new file import opens its own review without adding cars before approval');
  }finally{dialog.showOpenDialog=original;}
  assert.deepEqual(failures,[]);
  return checks;
};
