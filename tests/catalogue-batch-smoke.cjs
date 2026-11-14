'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({win,store,js,wait,click,fill,submit,qa,dialog})=>{
 const checks=[],open=dialog.showOpenDialog;
 const p=(reference,extra={})=>({kind:'part',name:'Batch motor '+reference,manufacturer:'Batch fixture',reference,category:'Motors & motor parts',partType:'Motor',specifications:[],...extra});
 const file=(name,products)=>{const dest=path.join(qa,name);fs.writeFileSync(dest,JSON.stringify({format:'slotforge-catalogue',version:1,products}));return dest;};
 const a=file('batch-a.json',[p('UNIQUE'),p('CONFLICT'),p('DUP')]),b=file('batch-b.json',[p('DUP'),p('CONFLICT',{specifications:[{name:'RPM',value:'30000',unit:'rpm'}]})]);
 const count=store.data.parts.length;
 try{
  await js(`page='Import & Export';catalogueReview=null;render()`);
  dialog.showOpenDialog=async(_w,options)=>{assert.ok(options.properties.includes('openDirectory'));return {canceled:false,filePaths:[qa]};};
  const before=new Set(fs.readdirSync(qa));await click('[data-action="catalogue-kit"]');await fill({scope:'groups',currency:'GBP'});await js(`document.querySelector('#catalogue-kit-scope').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[name="group-part-tyres"]').checked=true;document.querySelector('[name="group-part-motors-motor-parts"]').checked=true;`);await submit();
  const folder=fs.readdirSync(qa).find(n=>n.startsWith('SlotForge-catalogue-kits-')&&!before.has(n));assert.ok(folder);for(const name of fs.readdirSync(path.join(qa,folder)))assert.equal(JSON.parse(fs.readFileSync(path.join(qa,folder,name),'utf8')).reference.pricing.currency,'GBP');assert.equal(fs.readdirSync(path.join(qa,folder)).length,2);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(qa,folder,'part-tyres.json'),'utf8')).reference.parts,{'Wheels & tyres':['Tyre']});
  checks.push('native folder picker exports separate scoped tyre and motor templates without overwriting existing files');
  dialog.showOpenDialog=async(_w,options)=>{assert.ok(options.properties.includes('multiSelections'));return {canceled:false,filePaths:[a,b]};};
  await click('[data-action="catalogue-pick"]');assert.equal(await js('catalogueReview.preview.rows.length'),3);assert.equal(await js('catalogueReview.collapsed'),1);assert.equal(await js('catalogueReview.preview.rows[1].status'),'conflict');assert.match(await js(`document.querySelector('#main').innerText`),/batch-b.json/);assert.equal(store.data.parts.length,count);
  await click('[data-action="catalogue-select-all"]');assert.equal(await js('catalogueSelected.has(1)'),false);
  await click('[data-action="catalogue-product"][data-id="1"]');await click('[data-action="close-modal"]');assert.equal(await js('catalogueReview.input.products[1]'),null);
  await click('[data-action="catalogue-product"][data-id="1"]');await fill({version:'1'});await js(`document.querySelector('#catalogue-version-choice').dispatchEvent(new Event('change',{bubbles:true}))`);assert.match(await js(`document.querySelector('#catalogue-version-preview').textContent`),/30000/);await submit();assert.equal(await js('catalogueSelected.has(1)'),false);assert.equal(await js('catalogueReview.input.products[1].specifications[0].value'),'30000');
  await click('[data-action="catalogue-select-all"]');assert.equal(await js('catalogueSelected.size'),3);
  win.setSize(1200,1000);await js(`db.settings.theme='dark';render();window.scrollTo(0,0)`);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(qa,'catalogue-combined-dark.png'),(await win.webContents.capturePage()).toPNG());
  await click('[data-action="catalogue-confirm"]');await js(`document.querySelector('[name=confirmed]').checked=true`);await submit();assert.equal(await js('catalogueReview'),null);assert.equal(store.data.parts.length,count+3);assert.equal(store.data.parts.find(p=>p.reference==='CONFLICT').catalogue.product.specifications[0].value,'30000');
  checks.push('multi-file review collapses identical products, exposes sources, blocks conflicts, saves chosen variant once and closes after confirmation');
  // Invalid files and cancelled replacement must leave the existing review intact.
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[a]});await click('[data-action="catalogue-pick"]');const original=await js('catalogueReview.name');await click('[data-action="catalogue-back"]');
  dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});await click('[data-action="catalogue-pick"]');await submit();assert.equal(await js('catalogueReview.name'),original);
  const bad=path.join(qa,'bad-catalogue.json');fs.writeFileSync(bad,'invalid JSON');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[a,bad]});await click('[data-action="catalogue-pick"]');await js(`document.querySelector('#modal-form').requestSubmit()`);await wait(`!document.querySelector('#form-error').hidden`);assert.match(await js(`document.querySelector('#form-error').textContent`),/bad-catalogue.json/);assert.equal(await js('catalogueReview.name'),original);assert.equal(store.data.parts.length,count+3);await click('[data-action="close-modal"]');await click('[data-action="catalogue-resume"]');await click('[data-action="catalogue-discard"]');await submit();
  checks.push('bad JSON names its source and keeps the prior review and database intact; cancelled file selection preserves review');
  // A confirmed Dealership submission must leave the import screen too, not invite another submission.
  await js(`(async()=>{await api('club','enable',{name:'Catalogue QA host',password:'catalogue qa password'});await reloadClub();page='Import & Export';render();})()`);
  const queued=file('queued-catalogue.json',[p('QUEUED',{manufacturer:'Queued fixture',price:{amount:15,currency:'GBP',status:'estimate',basis:'item',explanation:'Comparable motor estimate',sourceUrl:'',checkedDate:''}})]);dialog.showOpenDialog=async()=>({canceled:false,filePaths:[queued]});await click('[data-action="catalogue-pick"]');await click('[data-action="catalogue-select-all"]');await click('[data-action="catalogue-confirm"]');await js(`document.querySelector('[name=confirmed]').checked=true`);await submit();assert.equal(await js('catalogueReview'),null);assert.equal(store.data.parts.length,count+3);assert.equal(store.data.club.proposals.length,1);
  await click('[data-action="club-compare"]');await submit();assert.equal(store.data.parts.length,count+4);assert.equal(store.data.parts.find(p=>p.reference==='QUEUED').quantity,0);assert.equal(store.data.parts.find(p=>p.reference==='QUEUED').catalogue.product.price.amount,15);
  checks.push('Dealership submission closes the catalogue review once queued; host approval creates exactly one zero-stock product');
 }finally{dialog.showOpenDialog=open;}

 return checks;
};
