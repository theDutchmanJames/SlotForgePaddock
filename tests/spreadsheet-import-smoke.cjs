'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{dialog}=require('electron');
// The import window after docs/ui-reference/spreadsheet-import-2026-11 option A: a column list with a live
// car preview, then a car list with the selected car in a side panel; one window size throughout.
module.exports=async({win,store,js,wait,click,qa,service})=>{
 win.showInactive();win.setSize(1440,950);
 const originalCar=store.mutate('car.save',{data:{name:'Keep original',maker:'Fly',reference:'00090',owner:'Owner stays',technical:{motor:'Keep motor'}}}).result;
 const file=path.join(qa,'spreadsheet-smoke-'+Date.now()+'.csv');fs.writeFileSync(file,'Name,Manufacturer,Reference,Owner,Factory motor,Current motor,Private notes\nBMW M1,Sideways,00085,James,Factory motor,Replacement motor,Private note\nAudi R8,NSR,00120,James,King,King,Second car\nUpdated name,Fly,00090,Overwrite owner,Factory,Changed,Changed note');
 const original=dialog.showOpenDialog;let chosenFile=file;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosenFile]});
 const settle=()=>wait('!sheetChanging&&!actionBusy');
 const search=async text=>js(`(()=>{const e=document.querySelector('#sheet-field-search');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const assign=async(col,field,query)=>{await click(`.sx-pick[data-id="${col}"]`);await wait('!!document.querySelector("#sheet-field-pop")');if(query)await search(query);await click(`[data-action=sheet-field-pick][data-id="${field}"]`);};
 const capture=async name=>{await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage()).toPNG());};
 const panelReady=row=>wait(`!!document.querySelector('#sheet-side .sx-choice')&&sheetDetail?.row===${row}&&!sheetChanging`);
 const height=()=>js(`Math.round(document.querySelector('#dialog').getBoundingClientRect().height)`);
 try{
  // Choosing a file goes straight to the column list; the file settings live in the side panel.
  await click('[data-action="nav"][data-id="Import & Export"]');await click('[data-action="sheet-pick"]');await wait('!!document.querySelector("#sheet-map-1")');
  assert.equal(await js('!!document.querySelector(".sx-colrow")'),true);assert.equal(await js('document.querySelectorAll(".sx-colrow").length'),7);
  assert.equal(await js('document.querySelector("#sheet-map-1").value'),'maker');assert.equal(await js('document.querySelector("#sheet-map-2").value'),'reference');
  assert.match(await js('document.querySelector(".sx-settings").textContent'),/Headings in row 1/);
  const columnsHeight=await height();
  await click('[data-action="sheet-settings"]');await wait('!!document.querySelector("#sheet-tab")');await click('[data-action="sheet-settings"]');assert.equal(await js('!!document.querySelector("#sheet-tab")'),false);
  // The live preview shows the first car and steps through the rows.
  assert.equal(await js('document.querySelector(".sx-car h4").textContent'),'BMW M1');
  await click('[data-action="sheet-row"][data-id="1"]');assert.equal(await js('document.querySelector(".sx-car h4").textContent'),'Audi R8');await click('[data-action="sheet-row"][data-id="-1"]');
  await assign(6,'description','description');await click('[data-action="sheet-later"]');await js("openReview('Spreadsheet imports')");await wait('!!document.querySelector("[data-action=sheet-saved]")');await click('[data-action="sheet-saved"]');await click('[data-action="sheet-open"]');
  assert.equal(await js('document.querySelector("#sheet-map-6").value'),'description');await assign(6,'privateNotes','private');
  // The picker groups its results and puts the best matches for the heading first.
  await click('.sx-pick[data-id="4"]');await wait('!!document.querySelector("#sheet-field-pop")');assert.match(await js('document.querySelector(".sx-pop-group").textContent'),/Best matches for “Factory motor”/);
  await search('motor');assert.ok(await js('[...document.querySelectorAll(".sx-pop-group")].some(g=>g.textContent==="Factory specifications")'));assert.ok(await js('document.querySelectorAll(".sheet-field-option").length<25'));
  await click('[data-action=sheet-field-pick][data-id="factory.motor"]');assert.equal(await js('!!document.querySelector("#sheet-field-pop")'),false);
  // Duplicate field: the panel names both columns, the list marks them, and "Choose cars" points at the panel instead of advancing.
  await assign(1,'name','display name');assert.equal(await js('document.querySelector("[data-action=sheet-preview]").getAttribute("aria-disabled")'),'true');
  assert.equal(await js('document.querySelector("#sheet-blockers").hidden'),false);assert.match(await js('document.querySelector("#sheet-blockers").innerText'),/Display name is used by 2 columns[\s\S]*column A “Name” and column B “Manufacturer”/i);
  assert.deepEqual(await js('[...document.querySelectorAll(".sx-colrow.sx-bad")].map(e=>e.dataset.sheetColumn)'),['0','1']);assert.equal(await js('document.querySelector(\'.sx-colrow[data-sheet-column="0"] .sx-head small\').textContent'),'Same field as column B');
  assert.match(await js('document.querySelector("#sheet-footer-blocked").textContent'),/Fix 1 thing/);
  await click('[data-action="sheet-colfilter"][data-id="check"]');assert.equal(await js('document.querySelectorAll(".sx-colrow").length'),2);await click('[data-action="sheet-colfilter"][data-id="all"]');
  await click('[data-action="sheet-preview"]');assert.equal(await js('!!document.querySelector(".sheet-review")'),false);assert.equal(await js('document.querySelector("#sheet-blockers").classList.contains("sheet-blockers-flash")'),true);
  await capture('spreadsheet-mapping-blocked-duplicate.png');
  await click('[data-action=sheet-blocker-column][data-id="1"]');await wait('!!document.querySelector("#sheet-field-pop")');await search('manufacturer');await click('[data-action=sheet-field-pick][data-id="maker"]');
  assert.equal(await js('document.querySelector("#sheet-blockers").hidden'),true);assert.equal(await js('document.querySelector("[data-action=sheet-preview]").getAttribute("aria-disabled")'),'false');assert.equal(await js('document.querySelectorAll(".sx-colrow.sx-bad").length'),0);
  // Missing Display name: the panel offers a column chooser that assigns it in one step.
  await click('.sx-pick[data-id="0"]');await click('[data-action=sheet-field-ignore]');assert.match(await js('document.querySelector("#sheet-blockers").innerText'),/Choose the column with your car names/i);
  await capture('spreadsheet-mapping-blocked-name.png');
  await click('[data-action=sheet-name-column]');await wait('!!document.querySelector("[data-action=sheet-name-pick]")');await click('[data-action=sheet-name-pick][data-id="0"]');
  assert.equal(await js('document.querySelector("#sheet-map-0").value'),'name');assert.equal(await js('document.querySelector("#sheet-blockers").hidden'),true);
  await click('.sx-pick[data-id="6"]');await click('[data-action=sheet-field-ignore]');assert.equal(await js(`document.querySelector('.sx-colrow[data-sheet-column="6"]').classList.contains('sx-off')`),true);await assign(6,'privateNotes','private');
  assert.match(await js('document.querySelector(".sx-car").textContent'),/Private note/);
  await capture('spreadsheet-mapping-verified.png');
  await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);
  await click('.sx-pick[data-id="4"]');await search('motor');await capture('spreadsheet-field-picker-light.png');await click('[data-action=sheet-picker-close]');
  await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);
  win.setSize(900,700);await capture('spreadsheet-mapping-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,950);
  // Choose cars: the same window size, the list beside the first car that needs a decision.
  await click('[data-action="sheet-preview"]');await wait('!!document.querySelector(".sheet-review")');assert.equal(store.snapshot().cars.length,1);assert.equal(await height(),columnsHeight);
  assert.equal(await js('spreadsheetView.ready'),2);await panelReady(4);
  await js(`document.querySelector('[data-sheet-include="2"]').click()`);await settle();assert.equal(await js('spreadsheetView.ready'),1);
  await click('[data-action=sheet-select]');assert.equal(await js('spreadsheetView.ready'),2);
  await click('[data-action="sheet-detail"][data-id="2"]');await panelReady(2);await click('[data-action="sheet-fields-none"]');await settle();
  assert.deepEqual(await js('spreadsheetView.rows.find(r=>r.row===2).fields'),['name']);await click('[data-action="sheet-fields-all"]');await settle();assert.ok(await js('spreadsheetView.rows.find(r=>r.row===2).fields.length>5'));
  await click('[data-action=sheet-filter][data-id=matches]');assert.equal(await js('document.querySelectorAll(".sheet-review tbody tr").length'),1);
  await panelReady(4);await click(`[data-action=sheet-choice][data-id="${originalCar}"]`);await settle();await panelReady(4);
  assert.equal(await js('document.querySelector("#sheet-detail-fields").textContent.includes("Owner stays")'),true);assert.equal(await js('spreadsheetView.rows[0].choice'),originalCar);
  await js('(()=>{for(const e of document.querySelectorAll("[data-sheet-field]"))e.checked=e.dataset.sheetField==="name";document.querySelector("[data-sheet-field]").dispatchEvent(new Event("change",{bubbles:true}));})()');await settle();
  assert.deepEqual(await js('spreadsheetView.rows[0].fields'),['name']);assert.equal(await js('spreadsheetView.counts.update'),1);
  await click('[data-action=sheet-filter][data-id=all]');await panelReady(4);await capture('spreadsheet-review-verified.png');
  await click('[data-action=sheet-back]');assert.equal(await js('document.querySelector("#dialog").textContent.includes("resets")'),true);assert.equal(await height(),columnsHeight);await click('[data-action=sheet-return]');
  await click('[data-action="close-modal"]');await js("openReview('Spreadsheet imports')");await wait('!!document.querySelector("[data-action=sheet-saved]")');await click('[data-action="sheet-saved"]');await click('[data-action="sheet-open"]');
  await click('[data-action="sheet-confirm"]');assert.equal(store.snapshot().cars.length,1);assert.equal(await js('document.querySelector(".sheet-confirm-counts").textContent.includes("Update existing cars")'),true);
  await click('[data-action="sheet-start"]');await service.work?.promise;await wait('!!document.querySelector("[data-action=sheet-done]")');assert.equal(store.snapshot().cars.length,3);
  await click('[data-action="sheet-done"]');assert.equal(await js('document.querySelector("#dialog").open'),false);
  const cars=store.snapshot().cars,car=cars.find(c=>c.reference==='00085'),updated=cars.find(c=>c.id===originalCar);assert.equal(car.owner,'James');assert.equal(car.privateNotes,'Private note');assert.equal(car.factory.motor,'Factory motor');assert.equal(car.technical.motor,'Replacement motor');assert.equal(updated.name,'Updated name');assert.equal(updated.owner,'Owner stays');assert.equal(updated.technical.motor,'Keep motor');
  await click('[data-action="nav"][data-id="Cars"]');await wait('document.body.textContent.includes("BMW M1")');
  // A second real XLSX exercises cross-page selection without saving test cars.
  const X=require('xlsx'),book=X.utils.book_new();X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['Name','Reference'],...Array.from({length:50},(_,i)=>['Paged '+i,'PAGE-'+i])]),'Cars');chosenFile=path.join(qa,'spreadsheet-pages-'+Date.now()+'.xlsx');fs.writeFileSync(chosenFile,X.write(book,{type:'buffer',bookType:'xlsx'}));
  await click('[data-action="nav"][data-id="Import & Export"]');await click('[data-action=sheet-pick]');await wait('!!document.querySelector("#sheet-map-1")');
  await click('[data-action=sheet-preview]');await wait('!!document.querySelector(".sheet-review")');assert.equal(await js('spreadsheetView.ready'),50);
  await click('[data-action=sheet-page][data-id="40"]');assert.equal(await js('spreadsheetView.rows.length'),10);await js(`document.querySelector('[data-sheet-include="42"]').click()`);await settle();assert.equal(await js('spreadsheetView.ready'),49);
  await click('[data-action=sheet-filter][data-id=matches]');assert.equal(await js('spreadsheetView.filteredTotal'),0);assert.equal(await js('spreadsheetView.ready'),49);await click('[data-action=sheet-filter][data-id=all]');
  await click('[data-action=sheet-later]');assert.equal(store.snapshot().cars.length,3);
  // 500 rows: the preview fetches rows on demand and reaches the last one.
  chosenFile=path.join(qa,'spreadsheet-scroll-'+Date.now()+'.csv');fs.writeFileSync(chosenFile,'Name,Reference\n'+Array.from({length:500},(_,i)=>`Scroll ${i+1},${String(i+1).padStart(5,'0')}`).join('\n'));
  await click('[data-action=sheet-pick]');await wait('!!document.querySelector("#sheet-map-1")');await assign(1,'number','collection number');
  await js('sheetStepRow(10000)');await wait(`document.querySelector('.sx-car h4')?.textContent==='Scroll 500'`);
  assert.match(await js(`document.querySelector(".sx-rownav").textContent`),/Car 500 of 500 · row 501/);assert.equal(await js(`document.querySelector('#sheet-map-1').value`),'number');
  await capture('spreadsheet-scroll-last-row.png');
  await click('[data-action="sheet-row"][data-id="-1"]');assert.equal(await js(`document.querySelector('.sx-car h4').textContent`),'Scroll 499');
  await click('[data-action=sheet-later]');assert.equal(store.snapshot().cars.length,3);
  return ['Column list, live preview and file settings in one window','Grouped field search with best matches first','Duplicate mapping validation and left-out columns','Mapping and row selections resume from Review','Car choices and ticked details save from the side panel','Updates preserve unticked ownership and technical fields','Real CSV import and 50-row XLSX pagination','Global counts across filters and pages','Same window height in both steps, 500-row preview and narrow layout'];
 }finally{dialog.showOpenDialog=original;}
};
