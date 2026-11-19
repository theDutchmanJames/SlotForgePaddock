'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// New workshop job after docs/ui-reference/new-job-2026-11 option A: car photo cards, kind tiles, plan cards and
// quick-pick names that set the same hidden form controls as before.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const val=sel=>js(`document.querySelector(${JSON.stringify(sel)}).value`);
 const ids=['Job QA Alpha','Job QA Bravo','Job QA Charlie'].map(name=>store.mutate('car.save',{data:{name,maker:'NSR',scale:'1:32'}}).result);
 store.mutate('job.start',{revision:store.data.revision,carId:ids[2],category:'general',kind:'general',name:'Busy already'});
 store.mutate('setup.save',{carId:ids[1],name:'Club night gearing'});
 await js('loadView()');await js("page='Workshop';toolboxTab='Jobs';workshopJob=null;render()");
 await click('[data-action="new-job"]');await wait('!!document.querySelector(".new-job")');
 // The busy car is shown but cannot be chosen; the first free car is selected.
 assert.equal(await js(`document.querySelector('.nj-car[data-id="${ids[2]}"]').disabled`),true);assert.match(await js(`document.querySelector('.nj-car[data-id="${ids[2]}"]').textContent`),/Active job/);
 await click(`.nj-car[data-id="${ids[0]}"]`);assert.equal(await val('#job-car'),ids[0]);assert.equal(await js('document.querySelectorAll(".nj-car.on").length'),1);
 // Search narrows the cards.
 await js(`(()=>{const e=document.querySelector('#nj-car-search');e.value='bravo';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);assert.equal(await js('[...document.querySelectorAll(".nj-car")].filter(b=>!b.hidden).length'),1);
 await js(`(()=>{const e=document.querySelector('#nj-car-search');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 // Kind tiles and quick picks.
 await click('[data-action="nj-category"][data-id="maintenance"]');assert.equal(await val('#dialog [name=category]'),'maintenance');assert.match(await js('document.querySelector("#nj-ideas-label").textContent'),/Maintenance/);
 await click('[data-action="nj-name"][data-id="Replace braids"]');assert.equal(await val('#dialog [name=name]'),'Replace braids');assert.equal(await js('document.querySelector(".nj-ideas .on").textContent'),'Replace braids');
 assert.match(await js('document.querySelector("#nj-summary").textContent'),/Job QA Alpha · Maintenance · Free-form work/);
 // Plan cards: the setup card names the car's setups; Rebuild switches the kind; leaving it goes back to General Work.
 await click(`.nj-car[data-id="${ids[1]}"]`);await click('[data-action="nj-kind"][data-id="setup"]');assert.equal(await val('#job-kind'),'setup');assert.match(await js('document.querySelector("#nj-setup-note").textContent'),/1 saved setup/);assert.equal(await js('document.querySelector("#setup-job-fields").hidden'),false);
 await click('[data-action="nj-kind"][data-id="rebuild"]');assert.equal(await val('#dialog [name=category]'),'rebuild');assert.ok(await js('!!document.querySelector("#job-rebuild-warning")'));
 await click('[data-action="nj-kind"][data-id="general"]');assert.equal(await val('#dialog [name=category]'),'general');
 await click('[data-action="nj-category"][data-id="tyres"]');await click('[data-action="nj-name"][data-id="True and glue tyres"]');
 await capture('job-window.png');
 await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);await capture('job-window-light.png');await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);
 win.setSize(860,720);await capture('job-window-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await fill({notes:'Both rears'});await submit();
 const job=store.data.jobs.find(j=>j.name==='True and glue tyres');assert.ok(job);assert.equal(job.carId,ids[1]);assert.equal(job.category,'tyres');assert.equal(job.notes,'Both rears');
 return ['Car photo cards with busy cars shown but locked, and search','Kind tiles, quick-pick names and the summary line','Plan cards for saved setups and rebuilds keep the category in step','The job saves with the chosen car, kind, name and notes'];
};
