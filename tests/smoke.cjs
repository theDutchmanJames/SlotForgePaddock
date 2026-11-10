const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {initial,Store,makePackage}=require('../src/store.cjs');
const {dialog}=require('electron');
module.exports=async(win,store,network,media)=>{
  win.webContents.setBackgroundThrottling(false);
  // Electron can reject a capture while the compositor replaces an SVG frame.
  // Retry only that transient capture failure; assertions and persistent
  // capture errors still fail the suite normally.
  const capture=win.webContents.capturePage.bind(win.webContents);
  win.webContents.capturePage=async(...args)=>{for(let attempt=0;;attempt++){try{return await capture(...args);}catch(e){if(attempt>=2||!String(e).includes('UnknownVizError'))throw e;console.log('Retrying transient screenshot capture ('+(attempt+1)+'/2).');await new Promise(resolve=>setTimeout(resolve,200));}}};
  store.data=initial();store.persist(store.data);await win.webContents.executeJavaScript('localStorage.clear()',true);await win.webContents.reload();
  const errors=[];win.webContents.on('console-message',(_e,...args)=>{const message=args.find(x=>typeof x==='string');if(message&&/Uncaught|TypeError|ReferenceError/.test(message))errors.push(message);});
  const js=async code=>{fs.writeFileSync(path.join(__dirname,'..','.qa','smoke-current.txt'),code);try{const executable=code.replace(/new Promise\((\w+)=>requestAnimationFrame\(\(\)=>requestAnimationFrame\(\1\)\)\)/g,'Promise.race([$&,new Promise(resolve=>setTimeout(resolve,500))])');return await win.webContents.executeJavaScript(executable,true);}catch(e){throw Error(e.message+'\nRenderer check: '+code,{cause:e});}};
  const wait=async condition=>{for(let i=0;i<100;i++){if(await js(condition))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI wait failed: '+condition+'; '+await js("document.querySelector('#form-error')?.textContent||document.querySelector('#toast')?.textContent||''"));};
  const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(typeof el.click==='function')el.click();else el.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,90));await wait('!actionBusy&&!viewPendingKey');};
  const fill=async values=>js(`(()=>{const values=${JSON.stringify(values)};for(const [name,value]of Object.entries(values)){const el=document.querySelector('[name="'+name+'"]');if(!el)throw Error('Missing field '+name);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  const submit=async()=>{await js(`document.querySelector('#modal-form').requestSubmit()`);await wait(`!document.querySelector('#dialog').open`);};
  await wait(`document.body.innerText.includes('On the workbench')`);
  // Isolated profiles can retain zoom after an interrupted previous run.
  await js('UiScale.apply(100)');
  if(process.argv.includes('--merge-host-only')){const checks=await require('./car-merge-host-smoke.cjs')({win,store,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','merge-host-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log(checks);return;}
  if(process.argv.includes('--merge-review-only')){const checks=await require('./car-merge-review-smoke.cjs')({win,store,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','merge-review-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log(checks);return;}
  if(process.argv.includes('--routine-build-only')){const checks=await require('./routine-build-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','routine-build-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log(checks);return;}
  if(process.argv.includes('--timing-mapper-only')){const checks=await require('./timing-mapper-smoke.cjs')({win,store,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','timing-mapper-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--shared-pace-only')){const checks=await require('./shared-pace-smoke.cjs')({win,store,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','shared-pace-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--history-view-only')){const checks=await require('./history-view-smoke.cjs')({win,store,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','history-view-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--history-approval-only')){const checks=await require('./historical-approval-smoke.cjs')({win,store,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','historical-approval-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--history-import-only')){const checks=await require('./history-imports-smoke.cjs')({win,store,js,wait,click,submit,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','history-import-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--review-only')){store.mutate('car.save',{data:{name:'Review fixture'}});await js('loadView()');for(let i=0;i<5;i++)await require('./review-smoke.cjs')({win,store,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa'),dialog});assert.deepEqual(errors,[]);return;}
  if(process.argv.includes('--rebuild-only')){console.log(await require('./rebuild-smoke.cjs')({win,store,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')}));assert.deepEqual(errors,[]);return;}
  if(process.argv.includes('--build-only')){console.log(await require('./build-smoke.cjs')({win,store,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')}));assert.deepEqual(errors,[]);return;}
  if(process.argv.includes('--local-library-only')){const checks=await require('./local-library-smoke.cjs')({win,store,network,js,wait,click,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','local-library-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--review-selection-only')){const ctx={win,store,network,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa'),dialog};const checks=[...await require('./review-selection-smoke.cjs')(ctx),...await require('./slotcar-research-smoke.cjs')(ctx),...await require('./catalogue-import-smoke.cjs')(ctx)];assert.deepEqual(errors,[]);fs.writeFileSync(path.join(ctx.qa,'review-selection-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log(checks);return;}
  if(process.argv.includes('--slotcar-research-only')){const checks=await require('./slotcar-research-smoke.cjs')({win,store,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa'),dialog});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','slotcar-research-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--round-three-only')){const checks=await require('./round-three-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','round3-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--round-two-only')){const checks=await require('./round-two-smoke.cjs')({win,store,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','round2-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--round-one-only')){const checks=await require('./round-one-smoke.cjs')({win,store,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','round1-ui-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));return;}
  if(process.argv.includes('--backup-only')){console.log(await require('./backup-smoke.cjs')({win,store,network,js,wait,click,qa:path.join(__dirname,'..','.qa'),dialog}));assert.deepEqual(errors,[]);return;}
  if(process.argv.includes('--context-only')){console.log(await require('./query-context-smoke.cjs')({store,js,wait,click,fill,submit}));assert.deepEqual(errors,[]);return;}
  if(process.argv.includes('--query-only')){console.log(await require('./query-pages-smoke.cjs')({store,js,wait,click,fill,submit}));assert.deepEqual(errors,[]);return;}
  if(process.argv.includes('--club-only')){const checks=await require('./club-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa:path.join(__dirname,'..','.qa')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'..','.qa','club-smoke-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));console.log('PASS focused Dealership workflows: '+checks.length);return;}
  await click('[data-action="nav"][data-id="Cars"]');
  await wait(`document.body.innerText.includes('Your collection starts here')`);
  await click('[data-action="add-car"]');await fill({name:'Smoke test Corvette',maker:'NSR',number:'QA-001',usage:'Home racing, Club racing','technical.motor':'King Evo','technical.weight':'83.5'});await submit();assert.equal(store.data.cars.length,1);assert.equal(store.data.cars[0].technical.motor,'King Evo');
  await click('[data-action="section"][data-id="Setups"]');await click('[data-action="save-setup"]');await fill({name:'Baseline QA'});await submit();assert.equal(store.data.setups.length,1);
  await click('[data-action="nav"][data-id="Parts"]');await click('[data-action="add-part"]');await fill({name:'QA tyres',quantity:'4',category:'Wheels & tyres',partType:'Tyre'});await submit();assert.equal(store.data.parts.length,1);
  await click('[data-action="install-stock"]');await fill({quantity:'2',position:'Rear axle',field:'rearTyres'});await submit();assert.equal(store.data.installations.length,1);
  await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="mode"][data-id="table"]');await wait(`!!document.querySelector('table')`);await click('[data-action="open-car"]');await click('[data-action="add-work"]');await fill({title:'Braid inspection',task:'Braids',nextDue:'2026-11-20'});await submit();assert.ok(store.data.events.some(e=>e.title==='Braid inspection'));
  for(const name of ['Overview','Cars','Parts','Workshop','Connections','Import & Export','Settings']){await click(`[data-action="nav"][data-id="${name}"]`);await wait(`document.querySelector('#main').innerText.length>30`);}
  await click('[data-action="settings-section"][data-id="Database"]');await click('[data-action="preferences"]');await fill({name:'QA collection',theme:'light'});await submit();await wait(`document.documentElement.dataset.theme==='light'`);
  await click('[data-action="preferences"]');await fill({name:'QA collection',theme:'dark'});await submit();
  const qa=path.join(__dirname,'..','.qa');
  fs.mkdirSync(qa,{recursive:true});
  const member=new Store();const memberCar=member.mutate('car.save',{data:{name:'Submitted Porsche',privateNotes:'Do not share',price:'99',technical:{motor:'Test motor'}}}).result;
  const importPath=path.join(qa,'test-package.json');fs.writeFileSync(importPath,JSON.stringify(makePackage(member.data,[memberCar])));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[importPath]});
  await click('[data-action="nav"][data-id="Import & Export"]');await click('[data-action="import"]');await wait(`document.body.innerText.includes('Submitted Porsche')`);assert.equal(store.data.cars.length,1);
  await click('[data-action="accept-review"]');await wait(`document.body.innerText.includes('Your review inbox is clear')`);assert.equal(store.data.cars.length,2);assert.equal(store.data.cars.find(c=>c.id===memberCar).privateNotes,undefined);
  const backupPath=path.join(qa,'test-backup.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:backupPath});
  await click('[data-action="nav"][data-id="Import & Export"]');await click('[data-action="backup"]');assert.equal(JSON.parse(fs.readFileSync(backupPath)).database.cars.length,2);
  await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="open-car"]');await click('[data-action="section"][data-id="Photos & documents"]');
  const imagePath=path.join(qa,'fixture.png');fs.writeFileSync(imagePath,(await win.webContents.capturePage()).toPNG());dialog.showOpenDialog=async()=>({canceled:false,filePaths:[imagePath]});
  await click('[data-action="main-photo"]');await wait(`!!document.querySelector('.photo-grid img')`);assert.ok(store.data.cars.some(c=>c.picture==='data:image/png;base64,'+fs.readFileSync(imagePath).toString('base64')));await wait(`document.querySelector('.photo-grid img').naturalWidth>0`);
  await click('[data-action="section"][data-id="Performance"]');await click('[data-action="add-test"]');await fill({track:'QA track',laps:'12',best:'6.42',notes:'Stable'});await submit();assert.equal(store.data.tests.length,1);
  const originalCar=store.data.cars.find(c=>c.name==='Smoke test Corvette').id;
  // A settings-only setup must return the currently tracked tyres to used spares.
  await click('[data-action="nav"][data-id="Cars"]');await click(`[data-action="open-car"][data-id="${originalCar}"]`);
  await click('[data-action="section"][data-id="Setups"]');await click('[data-action="apply-setup"]');await click('[data-action="preview-setup"]');
  await js(`document.querySelector('[name="confirmed"]').checked=true`);await submit();assert.equal(store.data.installations.filter(i=>!i.removed).length,0);
  await click('[data-action="nav"][data-id="Parts"]');await click('[data-action="add-part"]');await fill({name:'QA motor',quantity:'1',category:'Motors & motor parts',partType:'Motor',tracking:'individual'});await submit();
  const motor=store.data.parts.find(p=>p.name==='QA motor').id,tyres=store.data.parts.find(p=>p.name==='QA tyres'&&p.condition==='New').id;
  await click('[data-action="parts-tab"][data-id="Assemblies"]');await click('[data-action="add-assembly"]');await fill({name:'QA drive unit',component0:tyres,quantity0:'2',field0:'rearTyres',component1:motor,quantity1:'1',field1:'motor',location:'Pit box'});await submit();
  assert.equal(store.data.assemblies.length,1);
  await click('[data-action="install-assembly"]');await fill({carId:memberCar});await js(`document.querySelector('[name="confirmed"]').checked=true`);await submit();
  await click('[data-action="nav"][data-id="Cars"]');await click(`[data-action="open-car"][data-id="${memberCar}"]`);await click('[data-action="section"][data-id="Setups"]');await click('[data-action="save-setup"]');await fill({name:'Assembly baseline'});await submit();
  const assemblySetup=store.data.setups.find(s=>s.name==='Assembly baseline').id;
  await click('[data-action="nav"][data-id="Parts"]');await click('[data-action="remove-assembly"]');await fill({location:'Used pit box'});await js(`document.querySelector('[name="confirmed"]').checked=true`);await submit();assert.equal(store.data.assemblies[0].carId,null);
  await click('[data-action="install-assembly"]');await fill({carId:originalCar});await js(`document.querySelector('[name="confirmed"]').checked=true`);await submit();
  await click('[data-action="nav"][data-id="Cars"]');await click(`[data-action="open-car"][data-id="${memberCar}"]`);await click('[data-action="section"][data-id="Setups"]');await click(`[data-action="apply-setup"][data-id="${assemblySetup}"]`);await click('[data-action="preview-setup"]');
  await wait(`document.querySelector('#dialog').innerText.includes('Transfers from other cars')`);
  await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  fs.writeFileSync(path.join(qa,'setup-review.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[name="confirmed"]').checked=true;document.querySelector('[name="transfers"]').checked=true`);await submit();assert.equal(store.data.assemblies[0].carId,memberCar);
  await click('[data-action="nav"][data-id="Parts"]');fs.writeFileSync(path.join(qa,'assemblies.png'),(await win.webContents.capturePage()).toPNG());
  await click('[data-action="dismantle-assembly"]');await submit();assert.ok(store.data.assemblies[0].dismantled);assert.equal(store.data.installations.filter(i=>!i.removed&&i.assemblyId).length,0);
  await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="mode"][data-id="gallery"]');
  fs.mkdirSync(path.join(__dirname,'..','.qa'),{recursive:true});const shot=await win.webContents.capturePage();fs.writeFileSync(path.join(__dirname,'..','.qa','cars.png'),shot.toPNG());
  await click('[data-action="open-car"]');const profile=await win.webContents.capturePage();fs.writeFileSync(path.join(__dirname,'..','.qa','profile.png'),profile.toPNG());
  const reviewChecks=await require('./review-smoke.cjs')({win,store,js,wait,click,fill,submit,qa,dialog});
  reviewChecks.push(...await require('./collection-smoke.cjs')({win,store,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./jobs-smoke.cjs')({win,store,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./connections-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./full-review-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./toolbox-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./preferences-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./general-jobs-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./showroom-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./timing-import-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./timing-export-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./icons-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./review-hub-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./part-folders-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./overview-panels-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./audit-regressions-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./build-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./performance-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./catalogue-import-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./new-additions-review-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./timing-integration-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./recent-code-review-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./planning-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog,media}));
  reviewChecks.push(...await require('./planning-review-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./workshop-polish-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./sqlite-smoke.cjs')({win,store,js,wait,click,qa,dialog,media}));
  reviewChecks.push(...await require('./query-pages-smoke.cjs')({store,js,wait,click,fill,submit}));
  reviewChecks.push(...await require('./query-context-smoke.cjs')({store,js,wait,click,fill,submit}));
  reviewChecks.push(...await require('./backup-smoke.cjs')({win,store,network,js,wait,click,qa,dialog}));
  reviewChecks.push(...await require('./club-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./connection-review-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./round-one-smoke.cjs')({win,store,js,wait,click,fill,submit,qa}));
  reviewChecks.push(...await require('./round-two-smoke.cjs')({win,store,js,wait,click,fill,submit,qa}));
  reviewChecks.push(...await require('./round-three-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa}));
  reviewChecks.push(...await require('./slotcar-research-smoke.cjs')({win,store,js,wait,click,fill,submit,qa,dialog}));
  reviewChecks.push(...await require('./local-library-smoke.cjs')({win,store,network,js,wait,click,qa}));
  reviewChecks.push(...await require('./rebuild-smoke.cjs')({win,store,js,wait,click,fill,submit,qa}));
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(qa,'smoke-result.json'),JSON.stringify({passed:true,date:new Date().toISOString(),checks:['empty start','create car','reusable fields','setup snapshot','stock','installation','table view','maintenance','all navigation','dark/light themes','import inbox','selective review','backup file','photo import','manual test','settings-only setup application','assembly creation','assembly installation','assembly removal','reviewed assembly transfer through setup','assembly dismantling','screenshots',...reviewChecks],rendererErrors:errors},null,2));console.log('PASS Electron UI workflow checks.');
};
