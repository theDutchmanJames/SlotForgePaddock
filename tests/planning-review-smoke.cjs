const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {initial,makePackage}=require('../src/store.cjs');
module.exports=async({win,store,js,wait,click,submit,qa,dialog})=>{
  const checks=[],act=(action,p={})=>store.mutate(action,{revision:store.data.revision,...p}).result;
  store.data=initial();
  const carId=act('car.save',{data:{name:'Review car'}}),partId=act('part.save',{data:{name:'Original motor',quantity:3,tracking:'quantity'}});
  act('part.install',{carId,partId,quantity:1,position:'Motor mount'});act('setup.save',{carId,name:'Historical setup'});const setupId=store.data.setups[0].id;
  act('part.save',{id:partId,data:{...store.data.parts[0],name:'Corrected motor'}});
  const jobId=act('job.start',{kind:'general',carId,name:'Checklist review'});
  act('planning.job.save',{jobId,priority:'Normal',targetDate:'',waiting:false,checklist:[{text:'First step'},{text:'Second step'}]});
  await js(`(async()=>{db=(await api('read')).data;source='local';await openJob(${JSON.stringify(jobId)});})()`);
  await js(`{const steps=[...document.querySelectorAll('[data-job-step]')];steps[0].click();steps[1].click();}`);
  await wait('db.planning.jobs[0].checklist.every(s=>s.done)');
  assert.ok(store.data.planning.jobs[0].checklist.every(s=>s.done));
  checks.push('rapid checklist clicks persist both steps without revision conflicts');

  await js(`openSetupComparison(${JSON.stringify(setupId)})`);
  const comparison=await js(`document.querySelector('#comparison-result').innerText`);
  assert.match(comparison,/Original motor × 1/);assert.match(comparison,/Corrected motor × 1/);
  await click('[data-action="close-modal"]');
  await js(`openReports([${JSON.stringify(carId)}])`);
  await js(`document.querySelector('#report-kind').value='setup';document.querySelector('#report-kind').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(`document.querySelector('#report-preview').innerText.includes('Corrected motor × 1')`);
  await click('[data-action="close-modal"]');
  checks.push('comparison preserves historical labels and current setup report uses corrected labels');

  const pack=makePackage(store.data,[carId],{setups:true}),subId=act('submission.add',{package:pack});
  act('submission.review',{id:subId,carId,revision:store.data.cars[0].revision,fields:[],decision:'accept',includeSetups:true});
  const imported=store.data.setups.find(s=>s.sourceId);
  await js(`(async()=>{db=(await api('read')).data;openSetupComparison(${JSON.stringify(imported.id)});})()`);
  assert.match(await js(`document.querySelector('#comparison-result').innerText`),/no tracked-inventory record/);
  assert.equal(await js(`document.querySelector('#comparison-result').innerText.includes('Corrected motor × 1')`),false);
  await click('[data-action="close-modal"]');checks.push('shared setups show unknown inventory instead of false removed-part differences');

  const assemblyId=act('assembly.create',{name:'Dedicated motor',components:[{partId,quantity:1,position:'Motor'}]}),dedicated=store.data.assemblies.find(a=>a.id===assemblyId).components[0].partId;
  const individual=act('part.save',{data:{name:'Serialised item',tracking:'individual',quantity:1}}),unowned=act('part.save',{data:{name:'Unowned individual',tracking:'individual',quantity:0}});
  await js(`(async()=>{db=(await api('read')).data;page='Parts';partsTab='Stock';stockScope='catalogue';partCategory=db.parts.find(p=>p.id===${JSON.stringify(dedicated)}).category;partId=${JSON.stringify(dedicated)};render();})()`);
  assert.equal(await js(`!!document.querySelector('[data-action="receive-stock"]')`),false);
  await js(`addShopping()`);
  const options=await js(`[...document.querySelector('[data-shopping-part]').options].map(o=>o.value)`);
  assert.equal(options.includes(dedicated),false);assert.equal(options.includes(individual),false);assert.ok(options.includes(partId));
  await js(`document.querySelector('[data-shopping-part]').value=${JSON.stringify(unowned)};document.querySelector('[data-shopping-part]').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await js(`document.querySelector('#dialog [name=quantity]').max`),'1');
  await click('[data-action="close-modal"]');checks.push('shopping excludes dedicated assembly stock and caps individual identities at one');

  const image='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
  const detail='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  act('car.save',{id:carId,revision:store.data.cars[0].revision,data:{picture:image,photos:[{id:'main',name:'Imported detail',data:detail}]}});
  await js(`(async()=>{db=(await api('read')).data;editPhotoFocus(${JSON.stringify(carId)},1);document.querySelector('#focus-x').value='80';})()`);
  await submit();assert.equal(store.data.planning.focus[0].photoKey,'photo:main');
  await js(`page='Showroom';render();openShowroom(${JSON.stringify(carId)});showroom.viewer.photo=1;renderShowroomViewer()`);
  assert.equal(await js(`document.querySelector('#showroom-viewer img').style.objectPosition`),'80% 50%');
  assert.equal(await js(`document.querySelector('#showroom-viewer img').dataset.focusPhoto`),'photo:main');
  await click('[data-action="showroom-close"]');checks.push('imported extra-photo identity main remains distinct from cover-photo framing');

  const second=act('car.save',{data:{name:'Second report car',maker:'Example',picture:image,technical:{motor:'Example motor',pinion:'9',gear:'27',weight:'85'}}});
  await js(`(async()=>{db=(await api('read')).data;await openJob(${JSON.stringify(jobId)});})()`);
  const size=win.getContentSize();win.setContentSize(960,700);
  assert.ok(await js('document.documentElement.scrollWidth<=window.innerWidth'), 'Workshop should fit the minimum window width');
  fs.writeFileSync(path.join(qa,'planning-review-job.png'),(await win.webContents.capturePage()).toPNG());win.setContentSize(...size);
  const oldSave=dialog.showSaveDialog;
  try{
    for(const kind of ['cards','setup','scrutineering','inventory']){
      const file=path.join(qa,'planning-review-'+kind+'.pdf');dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
      const result=await js(`api('file','report.pdf',{kind:${JSON.stringify(kind)},ids:${JSON.stringify([carId,second])},revision:db.revision})`);
      const bytes=fs.readFileSync(file);assert.equal(result.path,file);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
      // Chromium emits uncompressed page dictionaries; count actual PDF pages to catch orphan footer sheets.
      const pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
      assert.equal(pages,['setup','scrutineering'].includes(kind)?2:1,kind+' must not add a footer-only page');
    }
  }finally{dialog.showSaveDialog=oldSave;}
  checks.push('all four multi-car report types produce PDF files and the workshop fits a 960px window');
  return checks;
};
