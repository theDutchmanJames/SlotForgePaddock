const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initial}=require('../src/store.cjs');
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
  const checks=[],act=(action,p={})=>store.mutate(action,{revision:store.data.revision,...p}).result;
  store.data=initial();
  const carId=act('car.save',{data:{name:'NSR Corvette C7.R'}}),partId=act('part.save',{data:{name:'King Evo 21.5k motor',tracking:'quantity',quantity:1,category:'Motors & motor parts',partType:'Motor'}}),jobId=act('job.start',{kind:'general',carId,name:'Prepare for club night',notes:'Clean the running gear and check the new motor before testing.'});
  await js(`(async()=>{db=(await api('read')).data;source='local';workshopJob=null;page='Parts';partsTab='Stock';stockScope='shopping';partCategory='';render();})()`);
  // Click the real no-ID button: calling addShopping() directly misses the dispatcher regression.
  assert.equal(await js(`document.querySelector('[data-action="shop-add"]').hasAttribute('data-id')`),false);
  await click('[data-action="shop-add"]');await wait(`document.querySelector('#dialog').open`);
  await fill({quantity:'2'});await submit();assert.equal(store.data.planning.shopping[0].jobId,'');
  checks.push('general shopping button with no part ID opens and saves an unlinked shopping item');

  await js(`openJob(${JSON.stringify(jobId)})`);
  await js('window.scrollTo(0,0)');
  assert.equal(await js(`document.querySelectorAll('.job-plan-summary>div').length`),4);
  fs.writeFileSync(path.join(qa,'workshop-polish-empty.png'),(await win.webContents.capturePage()).toPNG());
  await click('.job-plan-panel [data-action="shop-add"]');await wait(`document.querySelector('#dialog').open`);
  assert.equal(await js(`document.querySelector('[name=jobId]').value`),jobId);
  await fill({quantity:'1',supplier:'Club shop'});await submit();assert.equal(store.data.planning.shopping.find(s=>s.jobId===jobId).partId,partId);
  checks.push('job purchasing button keeps the correct workshop job selected');

  act('planning.job.save',{jobId,priority:'High',targetDate:'2026-12-01',waiting:true,checklist:[{text:'Clean and oil the rear bearings',done:true},{text:'Fit the new motor and check gear mesh'},{text:'Run a short shakedown test'}]});
  await js(`(async()=>{db=(await api('read')).data;await openJob(${JSON.stringify(jobId)});})()`);
  fs.writeFileSync(path.join(qa,'workshop-polish-job.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(await js(`document.querySelector('.plan-progress').value`),1);
  const oldSize=win.getContentSize();win.setContentSize(944,700);
  assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth`));
  fs.writeFileSync(path.join(qa,'workshop-polish-narrow.png'),(await win.webContents.capturePage()).toPNG());win.setContentSize(...oldSize);
  await js(`(async()=>{await change('settings.save',{revision:db.revision,theme:'light'});await refreshJob();render();window.scrollTo(0,0);})()`);
  assert.equal(await js(`!!document.querySelector('.job-plan-columns')`),true);
  fs.writeFileSync(path.join(qa,'workshop-polish-light.png'),(await win.webContents.capturePage()).toPNG());
  checks.push('job summary, progress and purchases fit narrow windows and both dark and light themes');

  await js(`page='Parts';partsTab='Stock';stockScope='owned';partId=null;partCategory='';partQuery='';render()`);
  const stockColour=await js(`getComputedStyle(document.querySelector('.part-group-card:not(.is-empty)')).borderTopColor`);
  await click('[data-action="stock-scope"][data-id="catalogue"]');
  const catalogueColour=await js(`getComputedStyle(document.querySelector('.part-group-card:not(.is-empty)')).borderTopColor`);
  assert.notEqual(catalogueColour,stockColour);assert.equal(await js(`document.querySelectorAll('.catalogue-groups .part-group-card').length>0`),true);
  await js(`(async()=>{await change('settings.save',{revision:db.revision,theme:'dark'});render();})()`);
  fs.writeFileSync(path.join(qa,'workshop-polish-catalogue.png'),(await win.webContents.capturePage()).toPNG());
  checks.push('catalogue group accents differ from owned stock and follow theme colours');
  return checks;
};
