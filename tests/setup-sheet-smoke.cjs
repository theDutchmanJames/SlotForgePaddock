'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Add setup after docs/ui-reference/add-setup-2026-11 option D: specifications you can type over, positions you
// can add, part links from a search popover, and a setup sheet that shows exactly what will be saved.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result,idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 const car=act('car.save',{data:{name:'Sheet QA racer',maker:'NSR',scale:'1:32',factory:{motor:'King Evo',rearTyres:'Supergrip',pinion:'12',weight:'78'}}});
 act('part.save',{data:{name:'King Evo',maker:'NSR',reference:'M21',partType:'Motor',quantity:0,tracking:'quantity'}});
 const guide=act('part.save',{data:{name:'Sheet QA wood guide',maker:'Slot.it',reference:'G9',partType:'Guide',quantity:1,tracking:'quantity'}});
 await js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(car)};section='Setups';await loadView()})()`);await idle();
 await click('[data-action="save-setup"]');await wait(`!document.querySelector('#dialog [type=submit]').disabled&&!!document.querySelector('.ss-row')`);
 assert.equal(await js('document.querySelector(\'[data-action="ss-source"].on\').dataset.id'),'factory');
 assert.equal(await js('document.querySelectorAll("#setup-suggestions .ss-row:not([hidden])").length'),2);
 assert.match(await js('document.querySelector("#ss-sheet").textContent'),/Also kept from the source[\s\S]*12[\s\S]*78/);
 // Type over a specification: it is marked as your own and the sheet says so.
 await fill({name:'Sheet QA plan','spec-motor':'Shark 25K EVO'});assert.equal(await js('document.querySelector(\'.ss-row[data-slot="motor"]\').classList.contains("own")'),true);
 assert.match(await js('document.querySelector("#ss-sheet").textContent'),/Shark 25K EVO\s*own/);assert.match(await js('document.querySelector("#ss-summary").textContent'),/1 your own/);
 // Add a position that the source left empty and give it a value.
 await click('[data-action="ss-show"][data-id="guide"]');assert.equal(await js('document.querySelector(\'.ss-row[data-slot="guide"]\').hidden'),false);await fill({'spec-guide':'Wood-track guide'});
 // Link a part from the search popover.
 await click('[data-action="ss-link"][data-id="guide"]');await wait('!!document.querySelector("#ss-pop")');
 await js(`(()=>{const e=document.querySelector('#ss-search');e.value='Sheet QA wood';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await wait(`!!document.querySelector('#ss-pop [data-id="guide|${guide}"]')`);{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);await js('setupPlacePop()');await capture('setup-sheet-pop.png');}
 await click(`#ss-pop [data-id="guide|${guide}"]`);assert.equal(await js('!!document.querySelector("#ss-pop")'),false);
 assert.equal(await js('document.querySelector("[name=suggest-part-guide]").value'),guide);assert.match(await js('document.querySelector(\'.ss-row[data-slot="guide"] .ss-link\').textContent'),/Sheet QA wood guide/);
 // Escape closes the popover without changing anything.
 await click('[data-action="ss-link"][data-id="motor"]');await wait('!!document.querySelector("#ss-pop")');await js('document.querySelector("#ss-search").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');assert.equal(await js('!!document.querySelector("#ss-pop")'),false);
 await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);await capture('setup-sheet-light.png');await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);await capture('setup-sheet.png');
 win.setSize(860,720);await capture('setup-sheet-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await submit();await idle();
 const setup=store.data.setups.find(s=>s.name==='Sheet QA plan');assert.ok(setup);assert.equal(setup.technical.motor,'Shark 25K EVO');assert.equal(setup.technical.pinion,'12');assert.equal(setup.technical.weight,'78');assert.equal(setup.technical.guide,'Sheet QA wood guide');
 assert.equal(setup.installations.length,1);assert.equal(setup.installations[0].partId,guide);assert.equal(setup.plan.source,'factory');
 // The snapshot keeps working and shows its own explanation instead of positions.
 await click('[data-action="save-setup"]');await wait('!!document.querySelector(".ss-row")');await click('[data-action="ss-source"][data-id="snapshot"]');assert.equal(await js('document.querySelector("#ss-snapshot").hidden'),false);assert.equal(await js('document.querySelector("#setup-suggestions").textContent'),'');await click('[data-action="close-modal"]');
 return ['Specifications can be typed over and are marked as your own','Empty positions can be added','Parts found by search link to a position; Escape closes the search','The sheet lists what will be saved, including values kept from the source','Saving keeps typed values, kept values and the linked part'];
};
