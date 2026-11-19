'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// The part window after docs/ui-reference/part-window-2026-11 option A: a live part card, category tiles,
// part type chips, tracking as two choices, and switches that write the same form values as before.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const val=name=>js(`document.querySelector('#modal-form [name="${name}"]').value`);
 const before=store.data.parts.length;
 await js("page='Parts';partsTab='Stock';stockScope='owned';partCategory='Motors & motor parts';partQuery='';partTypeFilter='';render()");
 await click('[data-action="add-part"]');await wait('!!document.querySelector(".part-sheet")');
 assert.equal(await val('category'),'Motors & motor parts');assert.equal(await js('document.querySelector(".ps-cats .on").textContent.trim()'),'Motors & motor parts');
 assert.match(await js('document.querySelector(".dialog-footer").textContent'),/Only the name is required/);
 // The card follows what you type; tiles, chips and switches set the hidden values.
 await fill({name:'Sheet QA motor',maker:'NSR',reference:'3021'});assert.equal(await js('document.querySelector("#ps-title").textContent'),'Sheet QA motor');assert.match(await js('document.querySelector("#ps-sub").textContent'),/NSR · 3021/);
 await click('[data-action="ps-type"][data-id="Motor"]');assert.equal(await val('partType'),'Motor');assert.equal(await js('document.querySelector(".ps-types .on").textContent'),'Motor');
 await click('[data-action="ps-pick"][data-id="tracking|individual"]');assert.equal(await val('tracking'),'individual');assert.equal(await js('document.querySelector("#ps-qty-unit").textContent'),'tracked piece');
 await click('[data-action="ps-pick"][data-id="condition|Used"]');assert.equal(await val('condition'),'Used');
 await click('[data-action="ps-pick"][data-id="scale|1:32"]');assert.equal(await val('scale'),'1:32');await click('[data-action="ps-pick"][data-id="scale|1:32"]');assert.equal(await val('scale'),'');await click('[data-action="ps-pick"][data-id="scale|1:32"]');
 await click('[data-action="ps-qty"][data-id="1"]');assert.equal(await val('quantity'),'2');await click('[data-action="ps-qty"][data-id="-1"]');await click('[data-action="ps-qty"][data-id="-1"]');await click('[data-action="ps-qty"][data-id="-1"]');assert.equal(await val('quantity'),'0');await click('[data-action="ps-qty"][data-id="1"]');
 // Changing the category swaps the part type chips and keeps the typed type.
 await click('[data-action="ps-pick"][data-id="category|Wheels & tyres"]');assert.equal(await val('category'),'Wheels & tyres');assert.ok(await js('[...document.querySelectorAll(".ps-types button")].some(b=>/tyre/i.test(b.textContent))'));assert.equal(await val('partType'),'Motor');
 await click('[data-action="ps-pick"][data-id="category|Motors & motor parts"]');
 await capture('part-sheet-add.png');
 // "Save & add another" saves and opens a fresh window with the same category and manufacturer.
 await js('document.querySelector("#ps-again").click()');
 await wait(`!!document.querySelector('.part-sheet')&&document.querySelector('#modal-form [name=name]').value===''`);
 const saved=store.data.parts.find(p=>p.name==='Sheet QA motor');assert.ok(saved);assert.equal(saved.tracking,'individual');assert.equal(saved.condition,'Used');assert.equal(saved.scale,'1:32');assert.equal(saved.partType,'Motor');assert.equal(saved.quantity,1);assert.equal(saved.maker,'NSR');
 assert.equal(await val('maker'),'NSR');assert.equal(await val('category'),'Motors & motor parts');
 await click('[data-action="close-modal"]');
 // Editing shows the saved choices.
 await js(`editPart(${JSON.stringify(saved.id)})`);await wait('!!document.querySelector(".part-sheet")&&document.querySelector("#dialog h2").textContent==="Edit part"');await new Promise(r=>setTimeout(r,400));
 assert.equal(await js('document.querySelector("#dialog h2").textContent'),'Edit part');assert.equal(await js('document.querySelector("[data-ps-for=condition] .on").textContent'),'Used');assert.equal(await js('document.querySelector("[data-ps-for=tracking] .on b").textContent'),'One tracked piece');
 
 await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);await capture('part-sheet-edit-light.png');await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);await capture('part-sheet-edit.png');
 win.setSize(860,720);await capture('part-sheet-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await fill({notes:'Checked'});await submit();assert.equal(store.data.parts.find(p=>p.id===saved.id).notes,'Checked');assert.equal(store.data.parts.find(p=>p.id===saved.id).condition,'Used');
 return ['Part card follows the typed name, maker and reference','Category tiles, part type chips, tracking choices and switches write the form values','Save & add another keeps category and manufacturer','Editing restores the saved choices'];
};
