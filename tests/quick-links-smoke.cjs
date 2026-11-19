'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{shell}=require('electron');
module.exports=async({win,store,js,wait,click,qa})=>{
 const checks=[],opened=[],original=shell.openExternal; shell.openExternal=async url=>{opened.push(url);};
 const save=async()=>{await js(`document.querySelector('.quick-links-manager form').requestSubmit()`);await wait(`!document.querySelector('.quick-links-manager')`);};
 const edit=async(name,url)=>js(`(()=>{const r=document.querySelector('.quick-links-manager [data-quick-row]');r.querySelector('[data-quick-field=name]').value=${JSON.stringify(name)};r.querySelector('[data-quick-field=url]').value=${JSON.stringify(url)};})()`);
 try{
  await js(`(async()=>{const r=await window.slotforge.quickLinks('read');await window.slotforge.quickLinks('save',{revision:r.value.revision,links:r.value.defaults});})()`);
  const baseline=store.data.revision;
  for(const target of ['Parts','Build from Scratch','Workshop','Shopping List','Library']){
   await js(`(async()=>{page=${JSON.stringify(target)};libraryTab='parts';await loadView();})()`);await wait(`!viewPendingKey&&!!document.querySelector('[data-quick-toggle]')`);
   assert.equal(await js(`document.querySelectorAll('[data-quick-toggle]').length`),1);
   assert.equal(await js(`document.querySelector('.page-head .actions').lastElementChild.hasAttribute('data-quick-toggle')`),true);
  }
  checks.push('last header action on all five requested pages');
  for(const [tab,scope] of [['Stock','owned'],['Stock','catalogue'],['Assemblies','owned']]){
   await js(`(async()=>{page='Parts';partsTab=${JSON.stringify(tab)};stockScope=${JSON.stringify(scope)};await loadView()})()`);await wait('!viewPendingKey');
   const selector='.page-head [data-action="nav"][data-id="Import & Export"]';
   assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).textContent`),'Import Parts List');
   assert.equal(await js(`document.querySelector(${JSON.stringify(selector)}).previousElementSibling.dataset.action`),tab==='Stock'?'add-part':'add-assembly');
   await click(selector);await wait('page==="Import & Export"&&!viewPendingKey');
  }
  await js(`(async()=>{page='Library';libraryTab='parts';await loadView()})()`);await wait('!viewPendingKey');
  checks.push('Parts stock, catalogue and assemblies import shortcuts navigate to Import & Export');
  await click('[data-quick-toggle]');await wait(`!!document.querySelector('.quick-links-menu')`);
  assert.equal(await js(`document.querySelectorAll('[data-quick-open]').length`),25);
  await js(`document.querySelector('[data-quick-search]').value='NSR';document.querySelector('[data-quick-search]').dispatchEvent(new Event('input'));`);assert.equal(await js(`document.querySelectorAll('[data-quick-open]').length`),1);
  await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);assert.equal(await js(`document.activeElement.dataset.quickOpen`),'default-nsr');
  await click('[data-quick-open]');assert.deepEqual(opened,['https://nsrslot.com/en/ricambi-2/']);assert.equal(await js(`!!document.querySelector('.quick-links-menu')`),false);
  await click('[data-quick-toggle]');await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await js(`document.activeElement.hasAttribute('data-quick-toggle')`),true);
  await click('[data-quick-toggle]');await js(`document.querySelector('h1').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);assert.equal(await js(`!!document.querySelector('.quick-links-menu')`),false);checks.push('search, keyboard navigation, Escape, outside click and default-browser dispatch');
  await click('[data-quick-toggle]');await click('[data-quick-manage]');await click('[data-quick-add]');await edit('My <local> shop','https://example.com/parts?brand=Slot.it');await save();
  await click('[data-quick-toggle]');assert.equal(await js(`document.querySelectorAll('[data-quick-open]').length`),26);await click('[data-quick-manage]');
  await js(`document.querySelector('[data-quick-filter]').value='on';document.querySelector('[data-quick-filter]').dispatchEvent(new Event('input'))`);
  assert.ok(await js(`document.querySelectorAll('[data-quick-row]:not([hidden])').length<10`));
  await js(`document.querySelector('[data-quick-filter]').value='';document.querySelector('[data-quick-filter]').dispatchEvent(new Event('input'));const check=document.querySelector('[data-quick-row="default-slot-it"] [data-quick-field="visible"]');check.checked=false;check.dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.match(await js(`document.querySelector('[data-quick-row="default-slot-it"] summary').innerText`),/Hidden/i);await save();
  await click('[data-quick-toggle]');assert.equal(await js(`!!document.querySelector('[data-quick-open="default-slot-it"]')`),false);await click('[data-quick-manage]');await click('[data-quick-reset]');await save();
  await click('[data-quick-toggle]');assert.equal(await js(`document.querySelectorAll('[data-quick-open]').length`),26);await click('[data-quick-manage]');await click('[data-quick-add]');await edit('Invalid','file:///C:/bad');await js(`document.querySelector('.quick-links-manager form').requestSubmit()`);assert.equal(await js(`document.querySelector('[data-quick-error]').hidden`),false);await click('[data-quick-cancel]');
  assert.equal(store.data.revision,baseline);checks.push('personal links, escaping, hiding, restoring defaults and validation; no collection revision or Review changes');
  // Quick Links must not render away a half-written scratch build.
  await js(`(async()=>{page='Build from Scratch';await loadView()})()`);await wait(`!viewPendingKey&&!!document.querySelector('[data-quick-toggle]')`);
  await js(`document.querySelector('[data-build-value="name"]').value='Unfinished build';document.querySelector('[data-build-value="name"]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await click('[data-quick-toggle]');await wait(`!!document.querySelector('.quick-links-menu')`);await new Promise(r=>setTimeout(r,700));fs.writeFileSync(path.join(qa,'quick-links-dark.png'),(await win.webContents.capturePage()).toPNG());await click('[data-quick-open="default-slot-it"]');
  assert.equal(await js(`document.querySelector('[data-build-value="name"]').value`),'Unfinished build');assert.equal(await js('buildState.name'),'Unfinished build');
  win.setSize(1000,800);await js(`applyTheme({...db.settings,theme:'light'})`);await click('[data-quick-toggle]');await new Promise(r=>setTimeout(r,700));
  assert.ok(await js(`(()=>{const r=document.querySelector('.quick-links-menu').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()`));fs.writeFileSync(path.join(qa,'quick-links-light.png'),(await win.webContents.capturePage()).toPNG());await click('[data-quick-manage]');await new Promise(r=>setTimeout(r,700));fs.writeFileSync(path.join(qa,'quick-links-manage.png'),(await win.webContents.capturePage()).toPNG());await click('[data-quick-cancel]');checks.push('dark/light narrow layouts and scratch build remains intact');
  await win.webContents.reload();await wait(`!!document.querySelector('[data-action="nav"]')&&!!db`);
  assert.equal(await js(`(async()=>{const r=await window.slotforge.quickLinks('read');return r.value.links.filter(x=>x.id.startsWith('personal-')).length})()`),1);checks.push('preferences survive renderer reload');
  assert.equal(store.data.revision,baseline);return checks;
 }finally{shell.openExternal=original;}
};
