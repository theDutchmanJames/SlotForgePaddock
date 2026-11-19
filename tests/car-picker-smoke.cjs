'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// The shared car picker after docs/ui-reference/car-picker-2026-11: Compare cars (A and B on photo cards) and
// New / Edit showroom group (cards with order badges and a drag-and-drop order list).
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const shoot=async name=>{{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);}const was=await js('db.settings.theme');await js("db.settings.theme='light';applyTheme()");await capture(name+'-light.png');await js(`db.settings.theme=${JSON.stringify(was)};applyTheme()`);await capture(name+'.png');};
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result,idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 const ids=['Picker QA Porsche 917','Picker QA Ford GT40','Picker QA Lancia LC2','Picker QA Mazda 787B'].map((name,i)=>act('car.save',{data:{name,maker:['Slot.it','NSR','Racer','Scaleauto'][i],scale:'1:32'}}));
 await js(`(async()=>{source='local';page='Cars';carId='';section='Overview';await loadView()})()`);await idle();
 // Compare cars: the first click sets A, the next B, a chosen car clears on a second click.
 await click('[data-action="car-compare"]');await wait(`!!document.querySelector('[data-picker="compare"]')`);
 const pressEnter=async sel=>{await js('document.querySelector('+JSON.stringify(sel)+').focus()');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'char',keyCode:String.fromCharCode(13)});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await new Promise(r=>setTimeout(r,250));};
 await pressEnter("#cp-search");assert.equal(await js('document.querySelector("[data-picker=compare]")!==null&&document.querySelector("#dialog").open'),true);
 await js(`document.querySelector('[name="compare-0"]').value='';document.querySelector('[name="compare-1"]').value='';compareSync()`);
 assert.equal(await js('document.querySelector("#cp-summary").textContent'),'Pick two cars');
 await click(`[data-action="cp-compare"][data-id="${ids[1]}"]`);await click(`[data-action="cp-compare"][data-id="${ids[2]}"]`);
 assert.deepEqual(await js('[0,1].map(i=>document.querySelector(`[name="compare-${i}"]`).value)'),[ids[1],ids[2]]);
 assert.equal(await js(`document.querySelector('[data-action="cp-compare"][data-id="${ids[2]}"] .cp-badge').textContent`),'B');
 await click(`[data-action="cp-compare"][data-id="${ids[1]}"]`);assert.equal(await js('document.querySelector(\'[name="compare-0"]\').value'),'');
 await click(`[data-action="cp-compare"][data-id="${ids[0]}"]`);assert.equal(await js('document.querySelector(\'[name="compare-0"]\').value'),ids[0]);
 await click('[data-action="cp-compare-swap"]');assert.deepEqual(await js('[0,1].map(i=>document.querySelector(`[name="compare-${i}"]`).value)'),[ids[2],ids[0]]);
 // Search narrows the cards.
 await js(`(()=>{const e=document.querySelector('#cp-search');e.value='lancia';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 assert.equal(await js('[...document.querySelectorAll(".cp-grid .cp-card")].filter(b=>!b.hidden).length'),1);
 await js(`(()=>{const e=document.querySelector('#cp-search');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 assert.match(await js('document.querySelector("#cp-summary").textContent'),/Lancia LC2 vs Picker QA Porsche 917/);
 await shoot('car-picker-compare');
 win.setSize(860,720);await capture('car-picker-compare-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await js("document.querySelector('#modal-form').requestSubmit()");await wait('!!document.querySelector(".car-comparison-table")');assert.deepEqual(await js('carComparison.ids'),[ids[2],ids[0]]);await click('[data-action="close-modal"]');
 // Showroom group: clicking adds in order, numbers on the cards, drag to reorder, a second click removes.
 await click('[data-action="nav"][data-id="Showroom"]');await idle();await click('[data-action="shelf-new"]');await wait('!!document.querySelector(\'[data-picker="shelf"]\')');
 for(const id of [ids[3],ids[0],ids[1]])await click(`[data-action="cp-shelf"][data-id="${id}"]`);
 assert.deepEqual(await js('editingShelfIds'),[ids[3],ids[0],ids[1]]);
 assert.equal(await js(`document.querySelector('[data-action="cp-shelf"][data-id="${ids[1]}"] .cp-badge').textContent`),'3');
 await js(`(()=>{const rows=[...document.querySelectorAll('[data-shelf-car]')],dt=new DataTransfer();rows[2].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));rows[0].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));rows[0].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));document.dispatchEvent(new DragEvent('dragend',{bubbles:true}))})()`);
 assert.deepEqual(await js('editingShelfIds'),[ids[1],ids[3],ids[0]]);
 await click(`[data-action="shelf-down"][data-id="${ids[1]}"]`);assert.deepEqual(await js('editingShelfIds'),[ids[3],ids[1],ids[0]]);
 await click('[data-action="cp-filter"][data-id="picked"]');assert.equal(await js('[...document.querySelectorAll(".cp-grid .cp-card")].filter(b=>!b.hidden).length'),3);
 await click(`[data-action="cp-shelf"][data-id="${ids[0]}"]`);assert.deepEqual(await js('editingShelfIds'),[ids[3],ids[1]]);
 assert.equal(await js('[...document.querySelectorAll(".cp-grid .cp-card")].filter(b=>!b.hidden).length'),2);
 await click('[data-action="cp-filter"][data-id="all"]');
 await fill({name:'Picker QA endurance'});assert.equal(await js('document.querySelector("#cp-shelf-title").textContent'),'Picker QA endurance');
 await shoot('car-picker-group');
 await submit();await idle();
 const shelf=store.data.planning.shelves.find(s=>s.name==='Picker QA endurance');assert.ok(shelf);assert.deepEqual(shelf.carIds,[ids[3],ids[1]]);
 return ['Compare cars: first click A, next B, again clears; swap; search narrows','Compare cars still opens the comparison','Showroom group: clicks add in order with numbered cards','Showroom group: drag and arrows reorder, Picked filter, second click removes','Showroom group saves the name and order'];
};
