'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Edit selected cars after docs/ui-reference/bulk-edit-2026-11 option A: today's values per field, Keep / Set to… /
// Clear and label actions, a live preview of the changes and one confirm and Apply in the same window.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const ids=[['Bulk QA one','Shelf A','Original box',['Home racing']],['Bulk QA two','Shelf A','',['Club racing']],['Bulk QA three','Box 3','Original box',[]]].map(([name,location,packaging,usage])=>store.mutate('car.save',{data:{name,location,packaging,usage,owner:'James'}}).result);
 await js('loadView()');await js("page='Cars';render()");await wait('!!document.querySelector("[data-select-car]")');
 await js(`selected=new Set(${JSON.stringify(ids)});render()`);await click('[data-action="bulk-edit"]');await wait('!!document.querySelector(".bulk-sheet")');
 // Today's values per field.
 assert.match(await js('document.querySelector(\'[data-bulk-field="location"] .bk-dist\').textContent'),/Shelf A2/);assert.match(await js('document.querySelector(\'[data-bulk-field="packaging"] .bk-dist\').textContent'),/empty1/);
 assert.match(await js('document.querySelector("#bulk-preview").textContent'),/Choose/);
 // Set, clear and add a label; the preview follows.
 await click('[data-action="bk-act"][data-id="location|set"]');assert.equal(await js('document.querySelector("[name=use_location]").checked'),true);await fill({value_location:'Display cabinet 2'});
 await click('[data-action="bk-act"][data-id="packaging|clear"]');assert.equal(await js('document.querySelector(\'[data-bulk-field="packaging"]\').classList.contains("clearing")'),true);
 await click('[data-action="bk-mode"][data-id="usage|add"]');await click('[data-action="bk-label"][data-id="usage|Club racing"]').catch(async()=>{await fill({labels_usage:'Club racing'});});
 await wait('!!document.querySelector("#bulk-preview .bk-chg")&&document.querySelectorAll("#bulk-preview .bk-chg").length===3');
 assert.match(await js('document.querySelector("#bulk-preview .bk-big").textContent'),/3cars change/);
 assert.match(await js('document.querySelector("#bulk-preview").textContent'),/Location → Display cabinet 2[\s\S]*Packaging cleared[\s\S]*Usage labels \+ Club racing/);
 assert.match(await js('document.querySelector("#dialog .dialog-footer [type=submit]").textContent'),/Apply to 3 cars/);
 assert.equal(store.data.cars.find(c=>c.id===ids[0]).location,'Shelf A');
 // Keep undoes a change.
 await click('[data-action="bk-act"][data-id="packaging|keep"]');await wait('document.querySelectorAll("#bulk-preview .bk-chg").length===2');await click('[data-action="bk-act"][data-id="packaging|clear"]');await wait('document.querySelectorAll("#bulk-preview .bk-chg").length===3');

 await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);await capture('bulk-edit-light.png');await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);await capture('bulk-edit.png');
 win.setSize(860,720);await capture('bulk-edit-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await js('document.querySelector("[name=confirmed]").checked=true');await submit();
 const cars=store.data.cars.filter(c=>ids.includes(c.id));assert.ok(cars.every(c=>c.location==='Display cabinet 2'&&!c.packaging&&c.usage.includes('Club racing')));assert.ok(cars.find(c=>c.id===ids[0]).usage.includes('Home racing'));assert.ok(cars.every(c=>c.owner==='James'));
 return ['Each field shows its current values across the selection','Set to…, Clear and label actions drive a live preview of what will change','Keep undoes a change before applying','One confirm and Apply saves exactly the chosen changes'];
};
