'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Table columns and Choose fields after docs/ui-reference/field-arranger-2026-11 option B: chips in order,
// the real table or panel as a preview, and a tray of fields to add (click or drag).
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const shoot=async name=>{{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);}const was=await js('db.settings.theme');await js("db.settings.theme='light';applyTheme()");await capture(name+'-light.png');await js(`db.settings.theme=${JSON.stringify(was)};applyTheme()`);await capture(name+'.png');};
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result,idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 const chips=()=>js('[...document.querySelectorAll("#fa-chips .fa-chip")].map(c=>c.dataset.key)'),heads=()=>js('[...document.querySelectorAll("#fa-preview th")].map(t=>t.dataset.key)');
 const car=act('car.save',{data:{name:'Arranger QA Porsche 962',maker:'Slot.it',scale:'1:32',location:'Shelf 1',reference:'CA09',technical:{motor:'V12/6 21.5K',rearTyres:'Slot.it F22'}}});
 act('car.save',{data:{name:'Arranger QA BMW M1',maker:'Fly',scale:'1:32',location:'Box 2',technical:{motor:'Flat-6'}}});
 await js(`(async()=>{source='local';page='Cars';carId='';section='Overview';collectionMeta=(await api('read')).collection;await loadView()})()`);await idle();
 // Table columns: the chips and the preview follow the same order.
 await click('[data-action="configure-columns"]');await wait('!!document.querySelector(\'[data-arranger="columns"]\')');
 const start=await chips();assert.deepEqual(await heads(),start);assert.match(await js('document.querySelector("#fa-summary").textContent'),new RegExp(start.length+' of 16 columns'));
 await click('[data-action="fa-add"][data-id="tech_motor"]');assert.deepEqual(await chips(),[...start,'tech_motor']);assert.deepEqual(await heads(),[...start,'tech_motor']);
 assert.equal(await js('!!document.querySelector(\'.fa-tray [data-id="tech_motor"]\')'),false);
 assert.match(await js('document.querySelector("#fa-preview").textContent'),/V12\/6 21\.5K/);
 // Search narrows the tray.
 await js(`(()=>{const e=document.querySelector('#fa-search');e.value='tyre';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 assert.ok(await js('[...document.querySelectorAll(".fa-tray .fa-add:not([hidden])")].every(b=>/tyre/i.test(b.textContent))'));
 assert.ok(await js('document.querySelectorAll(".fa-tray .fa-add:not([hidden])").length>0'));
 // Drag Motor in front of the second chip.
 const dragTo=(key,index)=>js(`(()=>{const from=document.querySelector('#fa-chips [data-key="${key}"]'),to=document.querySelectorAll('#fa-chips .fa-chip')[${index}],r=to.getBoundingClientRect(),dt=new DataTransfer(),o={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+2,clientY:r.top+r.height/2};from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('dragover',o));to.dispatchEvent(new DragEvent('drop',o));document.dispatchEvent(new DragEvent('dragend',{bubbles:true}))})()`);
 await dragTo('tech_motor',1);assert.deepEqual(await chips(),[start[0],'tech_motor',...start.slice(1)]);assert.deepEqual(await heads(),await chips());
 // A field from the tray can be dragged straight into place too.
 await js(`(()=>{const e=document.querySelector('#fa-search');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await js(`(()=>{const from=document.querySelector('.fa-tray [data-id="reference"]'),to=document.querySelectorAll('#fa-chips .fa-chip')[2],r=to.getBoundingClientRect(),dt=new DataTransfer(),o={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+2,clientY:r.top+r.height/2};from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('dragover',o));to.dispatchEvent(new DragEvent('drop',o));document.dispatchEvent(new DragEvent('dragend',{bubbles:true}))})()`);
 assert.equal((await chips())[2],'reference');
 // The arrows still work, and Name cannot be removed.
 await click('[data-action="column-down"][data-id="1"]');assert.equal((await chips())[2],'tech_motor');
 assert.equal(await js('!!document.querySelector(\'#fa-chips [data-key="name"] [data-action="column-remove"]\')'),false);
 await shoot('field-arranger-table');
 win.setSize(860,720);await capture('field-arranger-table-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 const order=await chips();await submit();await idle();assert.deepEqual(store.data.settings.columns,order);
 // Restore defaults brings back the standard columns.
 await click('[data-action="configure-columns"]');await click('[data-action="fa-defaults"]');assert.deepEqual(await chips(),['name','maker','scale','usage','location','availability']);await click('[data-action="close-modal"]');
 // Choose fields on a car's overview panel.
 await js(`(async()=>{carId=${JSON.stringify(car)};section='Overview';await loadView()})()`);await idle();
 await click('[data-action="overview-fields"][data-id="details"]');await wait('!!document.querySelector(\'[data-arranger="overview"]\')');
 assert.match(await js('document.querySelector("#fa-preview").textContent'),/Arranger QA Porsche 962/);
 await click('[data-action="fa-add"][data-id="maker"]');assert.match(await js('document.querySelector(\'#fa-preview [data-key="maker"]\').textContent'),/Slot\.it/);
 await click('[data-action="fa-add"][data-id="reference"]');await dragTo('reference',0);
 const panel=await chips();assert.equal(panel[0],'reference');
 await shoot('field-arranger-panel');
 await submit();await idle();assert.deepEqual(store.data.settings.overviewLayout.details,panel);
 return ['Table columns: chips and preview follow the same order','Fields are added from the tray by click or drag, and search narrows the tray','Chips reorder by drag and by the arrows; Name stays','Columns save in the chosen order; Restore defaults','Choose fields previews the current car and saves the order'];
};
