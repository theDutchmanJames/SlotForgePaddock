const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initial}=require('../src/store.cjs');
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
  const checks=[];store.data=initial();store.persist(store.data);
  const id=store.mutate('part.save',{revision:store.data.revision,data:{name:'Performance test motor',tracking:'quantity',quantity:1}}).result;
  await js(`(async()=>{const r=await api('read');db=r.data;collectionMeta=r.collection;switchCollection('local');page='Parts';partsTab='Build from Scratch';buildState=null;render();})()`);
  assert.equal(await js(`document.querySelectorAll('.performance-curve').length`),0);
  const input=async(selector,value)=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
  await click('[data-action="build-slot"][data-id="motor"]');await js(`document.querySelector('#build-all').click()`);await click(`[data-action="build-pick"][data-id="${id}"]`);
  await fill({'build-name':'Torque test car'});
  await input('[data-build-tooth="pinion"]','9');await input('[data-build-tooth="gear"]','27');
  const values={ratedRpm:'21500',ratedVoltage:'12',motorTorque:'285',torqueVoltage:'12',rearDiameter:'20',motorType:'Brushed DC',torqueType:'Stall'};
  for(const [key,value]of Object.entries(values))await input(`[data-build-performance="${key}"]`,value);
  assert.match(await js(`document.querySelector('[data-performance-result="peakPowerW"]').textContent`),/15\.73/);
  assert.match(await js(`document.querySelector('[data-performance-result="forceN"]').textContent`),/8\.38/);
  assert.equal(await js(`document.querySelectorAll('.performance-curve').length`),2);
  await input('#build-curve-speed','100');assert.match(await js(`document.querySelector('#build-curve-readout').textContent`),/21,500 motor RPM · 0 gf·cm · 0 W/);
  await input('#build-curve-speed','50');assert.match(await js(`document.querySelector('#build-curve-readout').textContent`),/10,750 motor RPM · 142.5 gf·cm · 15.73 W/);
  await click('[data-action="build-performance-reference"]');await input('[data-build-performance="rearDiameter"]','19');
  assert.match(await js(`document.querySelector('.performance-comparison').textContent`),/-5%/);assert.equal(await js('buildState.performanceBaseline.rearDiameter'),'20');
  await input('[data-build-tooth="pinion"]','8');assert.match(await js(`document.querySelector('[data-performance-result="ratio"]').textContent`),/3.375/);await input('[data-build-tooth="pinion"]','9');
  checks.push('live performance figures, curve endpoints and reference comparisons match analytical examples');
  for(const [key,value]of [['torqueVoltage','14'],['motorType','Brushless'],['torqueType','Unknown']]){
    await input(`[data-build-performance="${key}"]`,value);assert.equal(await js(`document.querySelectorAll('.performance-curve').length`),0);assert.match(await js(`document.querySelector('[data-performance-result="peakPowerW"]').textContent`),/—/);await input(`[data-build-performance="${key}"]`,values[key]);
  }
  checks.push('voltage mismatch, brushless motor and unknown torque suppress power estimates and curves');
  await click('[data-action="build-save-draft"]');const draft=store.data.buildDrafts[0];assert.equal(draft.data.performance.motorTorque,'285');
  await win.webContents.reload();await wait('typeof db!=="undefined"&&!!db');await js(`page='Parts';partsTab='Build from Scratch';render()`);
  await click('[data-action="build-drafts"]');await click(`[data-action="build-load-draft"][data-id="${draft.id}"]`);
  assert.equal(await js(`document.querySelector('[data-build-performance="motorTorque"]').value`),'285');assert.equal(await js('buildState.performanceBaseline.rearDiameter'),'20');
  for(const [width,theme]of [[1440,'dark'],[960,'light']]){
    win.setSize(width,1100);await js(`db.settings.theme='${theme}';render();document.querySelector('.build-performance').scrollIntoView({block:'start'})`);await new Promise(r=>setTimeout(r,150));
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await js(`document.querySelectorAll('.performance-curve').length`),2);
    fs.writeFileSync(path.join(qa,`performance-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
  checks.push('draft and reference survive reload; dark/light performance layouts fit 1440 and 960 pixels');
  await click('[data-action="build-review"]');assert.match(await js(`document.querySelector('#dialog').textContent`),/285/);
  await js(`document.querySelector('[name="confirmed"]').checked=true`);await submit();
  assert.equal(store.data.cars[0].technical.motorTorque,'285');assert.equal(store.data.setups[0].technical.torqueType,'Stall');
  await click('[data-action="section"][data-id="Technical & parts"]');assert.match(await js(`document.querySelector('#main').textContent`),/Theoretical performance/);
  await click('[data-action="edit-car"]');assert.equal(await js(`document.querySelector('[name="technical.motorType"]').value`),'Brushed DC');assert.equal(await js(`document.querySelector('[name="technical.torqueType"]').value`),'Stall');
  await fill({'technical.motorTorque':'430'});await submit();assert.equal(store.data.cars[0].technical.motorTorque,'430');assert.equal(store.data.setups[0].technical.motorTorque,'285');
  checks.push('review, saved car, technical editor and immutable As built setup retain performance inputs');
  return checks;
};
