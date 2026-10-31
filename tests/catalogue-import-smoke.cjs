const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initial}=require('../src/store.cjs');
const product=(extra={})=>({kind:'part',name:'King motor',manufacturer:'Example Racing',reference:'M-01',category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'Single motor',sourceUrl:'https://example.com/motor',checkedDate:'2026-10-31',reviewNotes:'',specifications:[{name:'RPM',value:'21500',unit:'rpm'}],...extra});
module.exports=async({win,store,js,wait,click,fill,submit,qa,dialog})=>{
  const checks=[];store.data=initial();store.persist(store.data);const act=(a,p)=>store.mutate(a,{revision:store.data.revision,...p}).result;
  const existing=act('part.save',{data:{name:'My motor',maker:'Example Racing',reference:'M-01',quantity:3,tracking:'quantity',notes:'Keep this personal note'}});
  const pack={format:'slotforge-catalogue',version:1,products:[product({reviewNotes:'Verify RPM before use'}),product({name:'Rear tyres <literal>',reference:'TYRE',category:'Wheels & tyres',partType:'Tyre',packSize:4}),product({kind:'supply',name:'Bearing oil',reference:'OIL',category:'Cleaning & lubrication',partType:'Bearing oil',supplyKind:'Consumable'}),product({name:'Wrong category',reference:'FIX',category:'Unknown'})]};
  const file=path.join(qa,'catalogue-input.json'),kit=path.join(qa,'catalogue-kit.json');fs.writeFileSync(file,JSON.stringify(pack));const open=dialog.showOpenDialog,save=dialog.showSaveDialog;
  try{
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showSaveDialog=async()=>({canceled:false,filePath:kit});
    await js(`(async()=>{const r=await api('read');db=r.data;collectionMeta=r.collection;switchCollection('local');catalogueReview=null;page='Import & Export';render();})()`);
    await click('[data-action="catalogue-kit"]');assert.deepEqual(JSON.parse(fs.readFileSync(kit,'utf8')).products,[]);
    await click('[data-action="catalogue-instructions"]');assert.match(await js(`document.querySelector('.catalogue-prompt').value`),/do not invent/i);await click('[data-action="close-modal"]');
    await click('[data-action="catalogue-pick"]');assert.equal(store.data.parts.length,1);assert.equal(await js('catalogueSelected.size'),0);
    assert.equal(await js('catalogueReview.preview.rows[0].status'),'update');assert.equal(await js('catalogueReview.preview.rows[3].status'),'invalid');
    await js(`document.querySelector('[data-catalogue-select-group="Parts · Wheels & tyres"]').click()`);assert.equal(await js('catalogueSelected.has(1)'),true);
    await js(`document.querySelector('[data-catalogue-select="0"]').click();document.querySelector('[data-catalogue-select="2"]').click()`);
    await click('[data-action="catalogue-product"][data-id="3"]');
    await js(`document.querySelector('#catalogue-category').value='Motors & motor parts';document.querySelector('#catalogue-category').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#catalogue-type').value='Motor';`);await submit();
    assert.equal(await js('catalogueReview.preview.rows[3].status'),'new');assert.equal(await js('catalogueSelected.has(3)'),false);
    checks.push('native import kit and AI instructions; catalogue preview makes no writes and supports category selection and classification corrections');
    win.setSize(1440,1000);await js(`db.settings.theme='dark';render();window.scrollTo(0,0)`);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(qa,'catalogue-review-dark.png'),(await win.webContents.capturePage()).toPNG());
    await click('[data-action="catalogue-confirm"]');await click('[data-action="close-modal"]');assert.equal(store.data.parts.length,1);
    await click('[data-action="catalogue-confirm"]');act('settings.save',{name:'Changed collection'});await js(`document.querySelector('[name=confirmed]').checked=true;document.querySelector('#modal-form').requestSubmit()`);await wait(`!document.querySelector('#form-error').hidden`);assert.equal(store.data.parts.length,1);await click('[data-action="close-modal"]');
    await click('[data-action="catalogue-refresh"]');await click('[data-action="catalogue-confirm"]');await js(`document.querySelector('[name=confirmed]').checked=true`);await submit();
    assert.equal(store.data.parts.length,2);assert.equal(store.data.supplies.length,1);const old=store.data.parts.find(p=>p.id===existing),tyre=store.data.parts.find(p=>p.reference==='TYRE');assert.equal(old.quantity,3);assert.equal(old.name,'My motor');assert.equal(old.notes,'Keep this personal note');assert.equal(tyre.quantity,0);assert.equal(tyre.catalogue.product.packSize,4);assert.equal(store.data.supplies[0].quantity,0);
    assert.equal(store.data.parts.some(p=>p.reference==='FIX'),false);assert.equal(await js('catalogueReview'),null);
    checks.push('cancel and stale imports are atomic; selected updates preserve owned stock and notes; parts and supplies start at zero');
    await js(`page='Parts';partsTab='Stock';partCategory='Wheels & tyres';partId='${tyre.id}';partQuery='';render()`);assert.match(await js(`document.querySelector('#main').innerText`),/Manufacturer catalogue information/);assert.equal(await js(`document.querySelector('#main literal')!==null`),false);
    await js(`page='Workshop';workshopJob=null;toolboxTab='Workshop supplies';render()`);assert.match(await js(`document.querySelector('#main').innerText`),/Manufacturer catalogue information/);
    await js(`page='Import & Export';render()`);await click('[data-action="catalogue-pick"]');assert.equal(await js('catalogueReview.preview.rows[0].status'),'unchanged');assert.equal(await js('catalogueReview.preview.rows[1].status'),'unchanged');assert.equal(await js(`document.querySelector('[data-catalogue-select="1"]').disabled`),true);
    await click('[data-action="catalogue-discard"]');await submit();
    checks.push('catalogue specifications and source information appear in parts and supplies; identical reimports cannot duplicate records');
    // A similar name with another reference requires an explicit create/update decision.
    pack.products=[product({name:'King motor racing',reference:'M-02'})];fs.writeFileSync(file,JSON.stringify(pack));await click('[data-action="catalogue-pick"]');assert.equal(await js('catalogueReview.preview.rows[0].status'),'possible');assert.equal(await js(`document.querySelector('[data-catalogue-select="0"]').disabled`),true);
    await click('[data-action="catalogue-product"][data-id="0"]');await fill({decision:'new'});await submit();assert.equal(await js(`document.querySelector('[data-catalogue-select="0"]').disabled`),false);
    await js(`document.querySelector('[data-catalogue-select="0"]').click()`);await click('[data-action="catalogue-confirm"]');await js(`document.querySelector('[name=confirmed]').checked=true`);await submit();assert.equal(store.data.parts.length,3);
    checks.push('possible name matches stay blocked until the user explicitly chooses a new product or an existing record');
    // Large groups render in bounded batches; selections include hidden rows deliberately.
    pack.products=Array.from({length:120},(_,i)=>product({name:'Tyre '+i,manufacturer:'Another brand',reference:'T'+i,category:'Wheels & tyres',partType:'Tyre'}));fs.writeFileSync(file,JSON.stringify(pack));await click('[data-action="catalogue-pick"]');assert.equal(await js(`document.querySelectorAll('[data-catalogue-select]').length`),50);
    await js(`document.querySelector('[data-catalogue-group]').open=true`);await click('[data-action="catalogue-more"]');assert.equal(await js(`document.querySelectorAll('[data-catalogue-select]').length`),100);
    await js(`document.querySelector('[data-catalogue-select-group]').click()`);assert.equal(await js('catalogueSelected.size'),120);
    win.setSize(960,1000);await js(`db.settings.theme='light';render();window.scrollTo(0,0)`);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(qa,'catalogue-review-960.png'),(await win.webContents.capturePage()).toPNG());
    await click('[data-action="catalogue-discard"]');await submit();assert.equal(store.data.parts.length,3);
    checks.push('large category groups page their rows, category selection includes hidden products, and review fits narrow windows');
    for(const [width,theme]of [[1440,'dark'],[960,'light']]){win.setSize(width,1000);await js(`db.settings.theme='${theme}';page='Parts';partsTab='Build from Scratch';buildContext='';render();window.scrollTo(0,0)`);assert.equal(await js(`getComputedStyle(document.querySelector('.build-diagram-scroll')).backgroundColor===getComputedStyle(document.querySelector('.build-canvas')).backgroundColor`),true);assert.equal(await js(`document.querySelector('.build-diagram').textContent.includes('INLINE')`),false);assert.equal(await js(`getComputedStyle(document.querySelector('.build-diagram-labels')).fill===getComputedStyle(document.body).color`),true);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(qa,'build-themed-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());}
    checks.push('builder diagram has a theme-matched background, readable labels and a universal Motor pod label in dark and light themes');
  }finally{dialog.showOpenDialog=open;dialog.showSaveDialog=save;}
  return checks;
};
