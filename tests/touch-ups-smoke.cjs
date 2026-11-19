'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// The six touch-ups after docs/ui-reference/touch-ups-2026-11: Record work, Print & PDF, Cover options,
// AI instructions, Start a rebuild and Plan & checklist.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);}win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result,idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 const image='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
 const car=act('car.save',{data:{name:'Touch QA BMW Z4',maker:'NSR',scale:'1:32',picture:image}});act('car.save',{data:{name:'Touch QA Porsche 962',maker:'Slot.it',scale:'1:32'}});
 const open=()=>js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(car)};section='Overview';await loadView()})()`);
 await open();await idle();
 // Record work: tiles set the category; quick dates and intervals; the reminder only saves when switched on.
 await click('[data-action="add-work"]');await wait('!!document.querySelector(".tu-work")');
 await click('[data-action="rw-category"][data-id="tyres"]');assert.equal(await js('document.querySelector("#record-work-category").value'),'tyres');
 await click('[data-action="rw-date"]:not(.on)');assert.notEqual(await js('document.querySelector("[name=performedDate]").value'),await js('slotforgeDomain.today()'));
 assert.equal(await js('document.querySelector("#rw-reminder").hidden'),true);
 await click('[data-action="rw-months"][data-id="3"]');assert.equal(await js('document.querySelector("#rw-remind").checked'),true);assert.equal(await js('document.querySelector("#rw-reminder").hidden'),false);
 await click('[data-action="rw-laps"][data-id="500"]');await fill({title:'Trued rear tyres',task:'Tyre check'});
 await capture('touch-record-work.png');
 await js(`(()=>{const e=document.querySelector('#rw-remind');e.checked=false;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await submit();await idle();const e=store.data.events.find(x=>x.title==='Trued rear tyres');assert.ok(e);assert.equal(e.workCategory,'tyres');assert.equal(e.nextDue||'','');assert.equal(e.nextDueLaps||'','');
 // Print & PDF: report cards drive the preview.
 await js(`openReports([${JSON.stringify(car)}])`);await wait('!!document.querySelector(".tu-print .report-preview *")');
 await click('[data-action="report-pick"][data-id="inventory"]');await wait(`document.querySelector('#report-preview').textContent.includes('Collection inventory')`);
 assert.equal(await js('document.querySelector("#report-kind").value'),'inventory');assert.equal(await js('document.querySelector("#report-purchase").closest("label").hidden'),false);
 await click('[data-action="report-pick"][data-id="cards"]');await wait(`!!document.querySelector('.report-qr')`);
 await capture('touch-print.png');await click('[data-action="close-modal"]');
 // Start a rebuild from the car shows that car; Change car… opens the picker.
 await click('[data-action="rebuild-start"]');await wait('!!document.querySelector(".tu-rebuild")');
 assert.match(await js('document.querySelector("#tu-rebuild-car").textContent'),/Touch QA BMW Z4/);assert.equal(await js('document.querySelector("#tu-rebuild-pick").hidden'),true);
 await capture('touch-rebuild.png');
 await click('[data-action="tu-rebuild-change"]');assert.equal(await js('document.querySelector("#tu-rebuild-pick").hidden'),false);await click('[data-action="close-modal"]');
 // Plan & checklist: priority switch, quick date, progress and Enter adds a step.
 const job=act('job.start',{carId:car,kind:'general',name:'Touch QA service'});
 await js(`openJob(${JSON.stringify(job)})`);await idle();await click('[data-action="job-plan"]');await wait('!!document.querySelector(".tu-plan")');
 await click('[data-tu-priority="High"]');assert.equal(await js('document.querySelector("[name=priority]").value'),'High');
 await click('[data-tu-days="14"]');assert.notEqual(await js('document.querySelector("[name=targetDate]").value'),'');
 for(const step of ['Strip the chassis','Fit the new motor','Test on the club track']){await js(`(()=>{const e=document.querySelector('#tu-new-step');e.value=${JSON.stringify(step)};e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);await new Promise(r=>setTimeout(r,60));}
 await js(`(()=>{const e=document.querySelector('[data-step-done]');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 assert.equal(await js('document.querySelector("#tu-plan-count").textContent'),'1 of 3 steps done');
 await capture('touch-plan.png');
 // A step typed but not added with Enter is kept when saving.
 await js("document.querySelector('#tu-new-step').value='Typed, not added'");
 await submit();await idle();const plan=store.data.planning.jobs.find(j=>j.jobId===job);assert.equal(plan.priority,'High');assert.deepEqual(plan.checklist.map(s=>[s.text,s.done]),[['Strip the chassis',true],['Fit the new motor',false],['Test on the club track',false],['Typed, not added',false]]);
 // AI instructions: large box and a Copy button.
 await js("(async()=>{page='Import & Export';acceptSnapshot((await api('read',{queryView:{page}})).data);render()})()");await idle();
 await click('[data-action="catalogue-instructions"]');await wait('!!document.querySelector(".tu-prompt")');
 assert.ok(await js('document.querySelector(".tu-prompt").value.length>200'));
 await click('[data-action="tu-copy-ai"]');await wait(`document.querySelector('#tu-copied')?.textContent.includes('Copied')`);
 await capture('touch-ai.png');await click('[data-action="close-modal"]');
 // Cover options: mode cards and the photo car picker set the original fields.
 await js(`(async()=>{page='Showroom';showroom.context='';await loadView()})()`);await wait('!!document.querySelector(".showroom-hero")&&!viewPendingKey');
 await click('[data-action="showroom-cover-options"]');await wait('!!document.querySelector("[data-tu-mode]")');
 await click('[data-tu-mode="fixed"]');assert.equal(await js('document.querySelector("[name=mode]").value'),'fixed');
 await click(`[data-action="tu-cover-car"][data-id="${car}"]`);assert.equal(await js('document.querySelector("[name=carId]").value'),car);
 await capture('touch-cover.png');
 await submit();await idle();assert.equal(await js('showroom.preferences.cover.mode'),'fixed');assert.equal(await js('showroom.preferences.cover.carId'),car);
 // The Cover options width does not stay on later windows.
 await js("modal('Plain window','<p>Check</p>',null)");assert.equal(await js('document.querySelector("#dialog").classList.contains("tu-showroom")'),false);await click('[data-action="close-modal"]');
 // Start a rebuild opened without a car asks for one instead of doing nothing.
 await js('startRebuildDialog()');await js("document.querySelector('#modal-form').requestSubmit()");await wait("!document.querySelector('#form-error').hidden");assert.match(await js("document.querySelector('#form-error').textContent"),/Choose the car/);await click('[data-action="close-modal"]');
 await store.whenIdle();
 return ['Record work: type tiles, quick dates and intervals; the reminder saves only when switched on','Print & PDF: report cards drive the preview and options','Start a rebuild shows the car it was opened from; Change car opens the picker','Plan & checklist: priority, quick date, Enter adds steps, progress','AI instructions: large box with Copy','Cover options: mode cards and photo car picker'];
};
