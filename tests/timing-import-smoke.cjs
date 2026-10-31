const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({win,store,js,wait,click,fill,submit,qa,dialog})=>{
  const input={format:'slotforge-timing-export',fileVersion:1,exported:'2026-10-30T00:00:00Z',items:{slotcars:[{id:'desktop-timing-test',brand:'NSR',manufacturer:'Timing',model:'QA car',gearing:'13/31',weight:'63gr',motor:'Imported motor'}]}};
  const file=path.join(qa,'timing-import-fixture.json');fs.writeFileSync(file,JSON.stringify(input));const old=dialog.showOpenDialog,count=store.data.cars.length;let imported;
  try{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
    await js("source='local';carId=null;page='Import & Export';render();");
    await click('[data-action="nav"][data-id="Import & Export"]');
    await click('[data-action="import"]');assert.equal(store.data.cars.length,count);
    const sub=store.data.submissions.find(s=>s.package.sender==='SlotForge Timing');assert.ok(sub);imported=sub.package.cars[0];
    await js(`reviewId=${JSON.stringify(sub.id)};reviewCarId=${JSON.stringify(imported.id)};render();`);
    await wait("document.body.innerText.includes('Timing QA car')");await click('[data-action="accept-review"]');assert.equal(store.data.cars.length,count+1);
    const repeated=await js("api('file','import')");assert.equal(repeated.result,'duplicate');assert.equal(store.data.cars.length,count+1);
  }finally{dialog.showOpenDialog=old;}
  await js(`carId=${JSON.stringify(imported.id)};page='Cars';section='Overview';render();`);
  assert.ok(await js("document.querySelector('#main').innerText.includes('2.385:1')"));
  await click('[data-action="edit-car"]');await click('[data-action="form-tab"][data-id="Technical"]');
  await fill({'technical.pinion':'9','technical.gear':'27'});assert.equal(await js("document.querySelector('[data-gear-ratio=technical]').textContent"),'3.00:1');
  await fill({'technical.pinion':'0'});assert.ok(await js("document.querySelector('[data-gear-ratio=technical]').textContent.includes('positive whole')"));
  await fill({'technical.pinion':'8'});assert.equal(await js("document.querySelector('[data-gear-ratio=technical]').textContent"),'3.375:1');
  await click('[data-action="form-tab"][data-id="Factory"]');await fill({'factory.pinion':'9','factory.gear':'27'});assert.equal(await js("document.querySelector('[data-gear-ratio=factory]').textContent"),'3.00:1');
  await submit();const car=store.data.cars.find(c=>c.id===imported.id);assert.equal(car.technical.pinion,'8');assert.equal(car.technical.ratio,undefined);
  await click('[data-action="section"][data-id="Technical & parts"]');assert.ok(await js("document.querySelector('#main').innerText.includes('3.375:1')&&document.querySelector('#main').innerText.includes('3.00:1')"));
  await js(`(async()=>{await change('setup.save',{carId:${JSON.stringify(imported.id)},name:'Ratio snapshot'});section='Setups';render();})()`);assert.ok(await js("document.querySelector('#main').innerText.includes('3.375:1')"));
  return ['Timing JSON native file import enters review','Timing acceptance creates car','Repeated Timing file is recognised','Live ratio for valid and invalid tooth counts','Independent factory ratio and derived-only storage','Saved setup ratio'];
};
