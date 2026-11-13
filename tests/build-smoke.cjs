const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initial}=require('../src/store.cjs');
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
  const debug=win.webContents.debugger;debug.attach('1.3');await debug.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const move=async p=>debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
  const checks=[];store.data=initial();store.persist(store.data);
  const act=(a,p)=>store.mutate(a,{revision:store.data.revision,...p}).result;
  const motor=act('part.save',{data:{name:'King Evo 21.5k <literal>',tracking:'quantity',quantity:2,category:'Motors & motor parts',partType:'Motor',location:'Drawer A'}});
  const tyres=act('part.save',{data:{name:'Supergrip tyres',tracking:'quantity',quantity:4,category:'Wheels & tyres',partType:'Tyre'}});
  const axle=act('part.save',{data:{name:'Hollow rear axle',tracking:'individual',quantity:1,category:'Axles & bearings',partType:'Axle'}});
  const assembly=act('assembly.create',{name:'Ready rear axle',components:[{partId:axle,quantity:1,field:'rearAxle',position:'Rear axle'}]});
  await js(`(async()=>{const r=await api('read');db=r.data;collectionMeta=r.collection;switchCollection('local');page='Parts';partsTab='Stock';buildContext='';render();})()`);
  await click('[data-action="nav"][data-id="Build from Scratch"]');
  assert.equal(await js(`document.querySelectorAll('.build-hotspot').length`),18);
  // The interactive drawing must retain every original geometry node exactly once.
  assert.equal(await js(`(()=>{const t=document.createElement('template');t.innerHTML='<svg>'+BuildDiagramArt+'</svg>';t.content.querySelector('#assembly-guides').remove();const geometry='path,rect,circle,ellipse,line,polyline,polygon';const canonical=nodes=>[...nodes].map(n=>n.outerHTML).sort().join('');return canonical(t.content.querySelectorAll(geometry))===canonical(document.querySelectorAll('.build-part-art :is('+geometry+')'));})()`),true);
  assert.equal(await js(`document.querySelectorAll('.build-hotspot > rect,.build-hotspot[style]').length`),0);
  assert.match(await js(`getComputedStyle(document.querySelector('.build-hotspot.selected .build-part-art')).filter`),/build-outline-motor/);
  win.setSize(1440,1500);await js('window.scrollTo(0,0)');await new Promise(r=>setTimeout(r,120));
  const point=async(x,y)=>js(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('.build-diagram').getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)};})()`);
  // Actual pointer targeting follows the artwork: cavities and surrounding whitespace are inert.
  assert.deepEqual(await js(`(()=>{const svg=document.querySelector('.build-diagram');return [[350,775],[800,800],[225,750],[220,310],[1380,310],[370,310],[800,310]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM());return document.elementFromPoint(p.x,p.y)?.closest('.build-hotspot')?.dataset.id||null;});})()`),[null,null,null,'frontTyres','frontTyres','frontWheels','frontAxle']);
  for(const theme of ['dark','light']){
    await js(`db.settings.theme='${theme}';render();window.scrollTo(0,0)`);
    await wait('!viewPendingKey');win.setSize(theme==='dark'?1440:1439,1500);await win.webContents.capturePage();win.webContents.focus();const p=await point(300,640);await move({x:0,y:0});await move(p);await new Promise(r=>setTimeout(r,120));
    assert.equal(await js(`document.querySelector('.build-hotspot[data-id="pod"]').matches(':hover')`),true);
    assert.match(await js(`getComputedStyle(document.querySelector('.build-hotspot[data-id="pod"] .build-part-art')).filter`),/build-outline-pod/);
    assert.equal(await js(`getComputedStyle(document.querySelector('.build-hotspot[data-id="chassis"] .build-part-art')).filter`),'none');
    fs.writeFileSync(path.join(qa,'build-contours-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  const pointer=await point(370,310);await move(pointer);await debug.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pointer});await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pointer});await wait('buildSlot==="frontWheels"');
  await js(`document.querySelector('.build-hotspot[data-id="pod"]').focus();document.querySelector('.build-hotspot[data-id="pod"]').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))`);await wait('buildSlot==="pod"');
  await click('[data-action="build-slot"][data-id="motor"]');await move({x:5,y:5});await js(`db.settings.theme='dark';render()`);win.setSize(1440,1000);
  checks.push('original SVG geometry is preserved once; mouse contours, empty cutouts, paired targets, keyboard focus and dark/light highlights work without rectangular overlays');
  await click('[data-action="build-review"]');assert.equal(store.data.cars.length,0);
  await click(`[data-action="build-pick"][data-id="${motor}"]`);assert.equal(store.data.installations.length,0);
  await fill({'build-name':'Club special','build-maker':'Scratch-built','build-scale':'1:32'});assert.equal(await js('buildState.name'),'Club special','name input updates build state');
  for(const [pinion,gear,ratio] of [['8','27','3.375:1'],['13','31','2.385:1'],['9','27','3.00:1']]){
    await js(`for(const [key,value] of Object.entries(${JSON.stringify({pinion,gear})})){const el=document.querySelector('[data-build-tooth="'+key+'"]');el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    assert.equal(await js(`document.querySelector('#build-gear-ratio').textContent`),ratio);
  }
  await click('[data-action="build-slot"][data-id="rearTyres"]');await click(`[data-action="build-pick"][data-id="${tyres}"]`);
  assert.equal(await js('buildState.parts.find(r=>r.slot==="rearTyres").quantity'),2);
  await js(`document.querySelector('#build-quantity').value='1';document.querySelector('#build-quantity').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await js('buildState.parts.find(r=>r.slot==="rearTyres").quantity'),1);
  await click('[data-action="build-assemblies"]');await click(`[data-action="build-use-assembly"][data-id="${assembly}"]`);
  assert.equal(store.data.assemblies[0].carId,null);assert.equal(await js(`!!document.querySelector('.build-hotspot.assigned[data-id="rearAxle"]')`),true);
  assert.equal(await js('buildState.name'),'Club special','name survives part selection');await click('[data-action="build-save-draft"]');await wait('!actionBusy&&!viewPendingKey');const draft=store.data.buildDrafts[0];assert.ok(draft);assert.equal(store.data.cars.length,0);
  await fill({'build-name':'Unsaved idea'});await click('[data-action="build-new"]');await click('[data-action="close-modal"]');assert.equal(await js('buildState.name'),'Unsaved idea');
  await click('[data-action="build-drafts"]');await click(`[data-action="build-load-draft"][data-id="${draft.id}"]`);await submit();assert.equal(await js('buildState.name'),'Club special');
  checks.push('diagram positions assign filtered inventory, editable pair quantities and complete stored assemblies without moving stock');
  for(const [width,theme]of [[1440,'dark'],[960,'light']]){
    win.setSize(width,1000);await js(`db.settings.theme='${theme}';render();window.scrollTo(0,0)`);await new Promise(r=>setTimeout(r,220));
    assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
    fs.writeFileSync(path.join(qa,`build-from-scratch-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.reload();await wait('typeof db!=="undefined"&&!!db');
  await js(`page='Build from Scratch';render()`);await click('[data-action="build-drafts"]');await click(`[data-action="build-load-draft"][data-id="${draft.id}"]`);
  assert.equal(await js('buildState.name'),'Club special');assert.equal(await js('buildState.parts.length'),2);assert.equal(await js('buildState.assemblies.length'),1);
  assert.equal(await js(`document.querySelector('#build-gear-ratio').textContent`),'3.00:1');
  checks.push('drafts survive renderer restart and reopen with selections intact; dark and light layouts fit 1440 and 960 px');
  await click('[data-action="build-review"]');await click('[data-action="close-modal"]');assert.equal(store.data.cars.length,0);
  await click('[data-action="build-review"]');act('settings.save',{name:'Updated club collection'});
  await js(`document.querySelector('[name=confirmed]').checked=true;document.querySelector('#modal-form').requestSubmit()`);await wait(`!document.querySelector('#form-error').hidden`);
  assert.equal(store.data.cars.length,0);assert.equal(store.data.buildDrafts.length,1);await click('[data-action="close-modal"]');
  await click('[data-action="build-review"]');await js(`document.querySelector('[name=confirmed]').checked=true`);await submit();
  assert.equal(store.data.cars.length,1);assert.equal(store.data.installations.filter(i=>!i.removed).length,3);assert.equal(store.data.parts.find(p=>p.id===motor).quantity,2);
  assert.equal(store.data.assemblies[0].carId,store.data.cars[0].id);assert.equal(store.data.buildDrafts.length,0);assert.equal(store.data.setups[0].name,'As built');
  assert.equal(await js('page'),'Cars');assert.equal(store.data.cars[0].technical.chassis,undefined);
  assert.equal(store.data.cars[0].technical.pinion,'9');assert.equal(store.data.cars[0].technical.gear,'27');assert.equal(store.data.setups[0].technical.gear,'27');
  checks.push('live gearing ratios update correctly and tooth counts survive draft reload, car creation and As built setup');
  checks.push('cancel and stale review preserve draft and inventory; confirmed save creates a partial car and its initial setup atomically');
  await js(`page='Build from Scratch';render()`);
  await js(`const target=document.querySelector('.build-hotspot[data-id="frontTyres"]');target.focus();target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  await wait('buildSlot==="frontTyres"');assert.match(await js(`document.querySelector('.build-picker').innerText`),/Front tyres/);
  await click('[data-action="build-slot"][data-id="body"]');assert.match(await js(`document.querySelector('#build-stock-list').innerText`),/No suggested/);
  await js(`document.querySelector('#build-all').click()`);await click(`[data-action="build-pick"][data-id="${motor}"]`);
  await fill({'build-name':'Unusual custom body'});await js(`document.querySelector('#build-setup').click()`);
  await click('[data-action="build-review"]');await js(`document.querySelector('[name=confirmed]').checked=true`);await submit();
  assert.equal(store.data.cars.length,2);assert.equal(store.data.setups.length,1);assert.equal(store.data.cars[1].technical.body,'King Evo 21.5k <literal>');
  checks.push('keyboard diagram operation, extra positions, show-all override and a one-part car without a setup');
  await debug.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false});debug.detach();return checks;
};
