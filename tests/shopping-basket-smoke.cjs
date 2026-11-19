'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Add to shopping list after docs/ui-reference/shopping-add-2026-11 option B: results stay open as cards, every
// click adds one to the basket, numbers can be adjusted, one list for all, and everything is added at once.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const ids=[['Basket QA rear tyres','Wheels & tyres','Tyre'],['Basket QA motor','Motors & motor parts','Motor'],['Basket QA guide','Guides & pickups','Guide'],['Basket QA screws','Screws & fixings','Screw']].map(([name,category,partType],i)=>store.mutate('part.save',{data:{name,maker:'NSR',reference:'BQ'+i,category,partType,tracking:'quantity',quantity:i===1?2:0}}).result);
 const before=store.data.planning.shopping.length;
 await js('loadView()');await js("page='Shopping List';render()");await wait('!viewPendingKey');
 await click('[data-action="shop-add"]');await wait('!!document.querySelector(".sb-win")');
 assert.match(await js('document.querySelector("#sb-title").textContent'),/Empty basket/);
 await js(`(()=>{const e=document.querySelector('#dialog [name=finderQuery]');e.value='Basket QA';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await wait(`!!document.querySelector('#dialog [data-pick-stock="${ids[3]}"]')`);
 // Every click adds one; the results stay open and mark what is in the basket.
 await click(`#dialog [data-pick-stock="${ids[0]}"]`);await click(`#dialog [data-pick-stock="${ids[0]}"]`);await click(`#dialog [data-pick-stock="${ids[1]}"]`);await click(`#dialog [data-pick-stock="${ids[2]}"]`);await click(`#dialog [data-pick-stock="${ids[3]}"]`);
 assert.equal(await js('document.querySelector("#dialog .shopping-matches").hidden'),false);
 assert.equal(await js('document.querySelectorAll("#sb-lines .sb-line").length'),4);assert.match(await js(`document.querySelector('#dialog [data-pick-stock="${ids[0]}"] .sb-in').textContent`),/2 in basket/);
 assert.match(await js('document.querySelector("#sb-title").textContent'),/4 items · 5 pieces/);
 // Adjust, remove, choose a list.
 await click('[data-action="sb-qty"][data-id="1|1"]');assert.equal(await js('document.querySelector(\'[data-sb-line="1"]\').value'),'2');
 await click('[data-action="sb-remove"][data-id="3"]');assert.equal(await js('document.querySelectorAll("#sb-lines .sb-line").length'),3);
 await js('[...document.querySelectorAll(".sb-list")].at(-1).click()');assert.ok(await js('document.querySelector(".sb-list.on")===[...document.querySelectorAll(".sb-list")].at(-1)'));const list=await js('document.querySelector("#dialog [name=listId]").value');
 assert.match(await js('document.querySelector("#dialog .dialog-footer [type=submit]").textContent'),/Add 3 items to list/);
 assert.match(await js('document.querySelector("#sb-summary").textContent'),/5 pieces across 3 items/);
 
 await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);await capture('shopping-basket-light.png');await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);await capture('shopping-basket.png');
 win.setSize(860,720);await capture('shopping-basket-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 // Something else keeps the basket and adds your own item with it.
 await click('[data-action="sb-kind"][data-id="free"]');assert.equal(await js('document.querySelector("#dialog [name=kind]").value'),'free');await fill({name:'Basket QA oil',quantity:'1'});
 assert.match(await js('document.querySelector("#dialog .dialog-footer [type=submit]").textContent'),/Add 4 items to list/);
 await fill({supplier:'Club shop'});await submit();await wait('!viewPendingKey');
 const added=store.data.planning.shopping.slice(before);assert.equal(added.length,4);
 const qty=id=>added.find(s=>s.partId===id);assert.ok(qty(ids[0])&&qty(ids[1])&&qty(ids[2]));assert.ok(!added.some(s=>s.partId===ids[3]));
 assert.ok(added.every(s=>s.supplier==='Club shop'));assert.ok(added.every(s=>(s.purchase?.listId||'general')===(list||'general')));assert.ok(added.some(s=>s.purchase?.item?.kind==='free'&&s.purchase.item.name==='Basket QA oil'));
 return ['Results stay open; every click adds one and the cards show what is in the basket','Numbers adjust, lines can be removed and one list applies to all','Your own item is added together with the basket','Every item saves with the shared supplier and list'];
};
