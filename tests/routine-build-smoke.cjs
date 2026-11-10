'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,network,js,wait,click,fill,submit,qa})=>{
 const act=(a,p)=>store.mutate(a,{revision:store.data.revision,...p}).result,checks=[];
 const car=act('car.save',{data:{name:'Original club car'}}),part=act('part.save',{data:{name:'Planned catalogue motor',quantity:0,tracking:'quantity',category:'Motors & motor parts',partType:'Motor'}});
 network.club.enable('Workshop desktop','test password');
 await js("page='Settings';settingsSection='Appearance';loadView()");await wait("!!document.querySelector('[data-action=choose-theme]')");
 await click('[data-action="choose-theme"][data-id="light"]');assert.equal(store.data.settings.theme,'light');assert.equal(store.data.club.proposals.length,0);
 await click('[data-action="choose-theme"][data-id="dark"]');checks.push('Theme changes save immediately in Dealership Mode');
 await click('[data-action="nav"][data-id="Build from Scratch"]');await click('[data-action="build-slot"][data-id="motor"]');
 await click(`[data-action="build-pick"][data-id="${part}"]`);await fill({'build-name':'Future GT3 racer'});await click('[data-action="build-save-draft"]');
 assert.equal(store.data.buildDrafts.length,1);assert.equal(store.data.planning.shopping.length,1);assert.equal(store.data.parts[0].quantity,0);assert.equal(store.data.club.proposals.length,0);
 const draft=store.data.buildDrafts[0].id;
 await js("page='Parts';partsTab='Stock';stockScope='owned';buildDirty=false;loadView()");
 // Use the actual stock submenu action so its persisted view state is exercised.
 await click('[data-action="stock-scope"][data-id="shopping"]');
 await wait("document.body.innerText.includes('Future GT3 racer')");await click(`[data-action="build-load-draft"][data-id="${draft}"]`);
 await wait("page==='Build from Scratch'&&buildState.name==='Future GT3 racer'");assert.equal(await js('buildState.parts.length'),1);
 checks.push('Zero-stock catalogue selection creates linked shopping and reopens the same plan');
 await js(`buildDirty=false;page='Cars';carId=${JSON.stringify(car)};section='Overview';loadView()`);
 await click('[data-action="car-more"]');await click('[data-action="rebuild-start"]');await submit();await wait("page==='Build from Scratch'&&!!buildState.rebuild");
 const rebuildId=await js('buildDraftId'),job=store.data.jobs[0].id;
 for(let i=0;i<2;i++){
  await click('[data-action="open-job"]');await click(`[data-action="rebuild-resume"][data-id="${car}"]`);await wait("page==='Build from Scratch'&&!!buildState.rebuild");assert.equal(await js('buildDraftId'),rebuildId);
 }
 assert.equal(store.data.jobs[0].id,job);assert.equal(store.data.buildDrafts.length,2);assert.equal(store.data.club.proposals.length,0);
 await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,350));await win.webContents.capturePage();await new Promise(r=>setTimeout(r,200));
 fs.writeFileSync(path.join(qa,'routine-rebuild-editor.png'),(await win.webContents.capturePage()).toPNG());checks.push('Workshop Build Editor repeatedly opens the existing rebuild without reviews or duplicate drafts');
 return checks;
};
