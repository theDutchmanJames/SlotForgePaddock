'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// The car's More menu after docs/ui-reference/more-menu-2026-11 option A: a drop-down under the button with
// grouped actions and Permanently delete set apart; it closes on a pick, a click elsewhere or Escape.
module.exports=async({win,store,js,wait,click,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const id=store.mutate('car.save',{data:{name:'More QA car',maker:'NSR',scale:'1:32'}}).result;
 await js('loadView()');await js(`page='Cars';carId=${JSON.stringify(id)};section='Overview';render()`);await wait('!!document.querySelector(\'[data-action="car-more"]\')');
 const open=()=>js('!!document.querySelector("#car-more-menu")');
 await click('[data-action="car-more"]');assert.equal(await open(),true);assert.equal(await js('document.querySelector(\'[data-action="car-more"]\').getAttribute("aria-expanded")'),'true');
 // Groups, explanations and the delete item set apart at the end.
 const groups=await js('[...document.querySelectorAll(".car-more-group")].map(g=>g.textContent)');assert.deepEqual(groups.slice(0,2),['Rebuild & life','Copies']);assert.ok(groups.includes('Share & print')&&groups.includes('Photos & research'));
 assert.equal(await js('document.querySelector("#car-more-menu .car-more-item:last-child").dataset.action'),'car-delete');assert.equal(await js('document.querySelector(\'#car-more-menu [data-action="archive-car"] small\').textContent'),'Hide it from your collection; nothing is deleted');
 // The menu sits under the button and inside the window.
 assert.ok(await js('(()=>{const m=document.querySelector("#car-more-menu").getBoundingClientRect(),b=document.querySelector(\'[data-action="car-more"]\').getBoundingClientRect();return m.top>=b.bottom&&m.right<=innerWidth&&m.left>=0;})()'));

 await js(`document.documentElement.dataset.theme='light';document.documentElement.dataset.tone='light'`);await capture('car-more-light.png');await js(`document.documentElement.dataset.theme='dark';document.documentElement.dataset.tone='dark'`);await capture('car-more.png');
 // Escape, a second click on More and a click elsewhere close it.
 await js('(document.activeElement||document.body).dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');assert.equal(await open(),false);
 await click('[data-action="car-more"]');await click('[data-action="car-more"]');assert.equal(await open(),false);
 await click('[data-action="car-more"]');await js('document.querySelector("#main h1, #main h2").click()');assert.equal(await open(),false);
 // Picking an item runs it and closes the menu.
 await click('[data-action="car-more"]');await click('#car-more-menu [data-action="reports"]');await wait('document.querySelector("#dialog").open');assert.equal(await open(),false);await click('[data-action="close-modal"]');
 await click('[data-action="car-more"]');await click('#car-more-menu [data-action="archive-car"]');for(let i=0;i<60&&!store.data.cars.find(c=>c.id===id).archived;i++)await new Promise(r=>setTimeout(r,100));assert.equal(store.data.cars.find(c=>c.id===id).archived,true);
 return ['More opens a grouped drop-down under the button with explanations','Permanently delete is set apart at the end','Escape, a second click and a click elsewhere close it','Picking an item runs the action and closes the menu'];
};
