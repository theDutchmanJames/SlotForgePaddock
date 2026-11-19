'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Real Car History editor after docs/ui-reference/real-history-2026-11 option A: classification cards, driver
// chips, quick result buttons, source cards and the live overview card.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const shoot=async name=>{{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);}const was=await js('db.settings.theme');await js("db.settings.theme='light';applyTheme()");await capture(name+'-light.png');await js(`db.settings.theme=${JSON.stringify(was)};applyTheme()`);await capture(name+'.png');};
 const idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 const car=store.mutate('car.save',{revision:store.data.revision,data:{name:'History QA Porsche 962',maker:'Slot.it',scale:'1:32',realHistory:{classification:'Unverified',team:'',drivers:'A. Rossi',sources:[{title:'Old results',url:'https://example.com/results'}]}}}).result;
 await js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(car)};section='Real Car History';await loadView()})()`);await idle();
 await click('[data-action="history-edit"]');await wait('!!document.querySelector(".rh-win")');
 assert.equal(await js('document.querySelectorAll(".rh-chip").length'),1);assert.equal(await js('document.querySelectorAll(".history-source-editor").length'),1);
 // Classification cards set the hidden field; the preview badge follows.
 await click('[data-action="history-class"][data-id="Real Racing Car"]');assert.equal(await js('document.querySelector("[name=classification]").value'),'Real Racing Car');
 assert.match(await js('document.querySelector(".rh-badge").textContent'),/Real Racing Car/);
 // Typing updates the live card.
 await fill({team:'Valkyrie Racing',raceNumber:'17',year:'1986',event:'1000 km of Spa',qualifying:'4th',history:'Ran second for most of the race.'});
 assert.equal(await js('document.querySelector(".rh-card-title b").textContent'),'Valkyrie Racing');assert.equal(await js('document.querySelector(".rh-num").textContent'),'17');
 // Quick buttons, and driver chips by Enter or comma.
 await click('[data-action="history-quick"][data-id="finish|DNF"]');assert.equal(await js('document.querySelector("[name=finish]").value'),'DNF');
 await js(`(()=>{const e=document.querySelector('#rh-driver-input');e.focus();e.value='J. Meyer';e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
 await js(`(()=>{const e=document.querySelector('#rh-driver-input');e.value='K. Novak,';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 assert.equal(await js('document.querySelector("[name=drivers]").value'),'A. Rossi, J. Meyer, K. Novak');
 await click('[data-action="history-driver-remove"][data-id="2"]');assert.equal(await js('document.querySelector("[name=drivers]").value'),'A. Rossi, J. Meyer');
 // Sources: add one, type it, the badge shows its site.
 await click('[data-action="history-source-add"]');
 await js(`(()=>{const r=[...document.querySelectorAll('.history-source-editor')].at(-1);r.querySelector('[data-history-title]').value='Race results 1986';const u=r.querySelector('[data-history-url]');u.value='https://www.racingsportscars.com/results/spa-1986';u.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 assert.equal(await js(`[...document.querySelectorAll('.rh-fav')].at(-1).textContent`),'RA');
 assert.match(await js('document.querySelector("#rh-complete").textContent'),/8 of 8 facts filled in · 2 sources/);
 // A name typed but not added yet is kept when saving.
 await js(`document.querySelector('#rh-driver-input').value='L. Berg'`);
 await js("document.querySelector('.rh-main').scrollTop=0");await shoot('real-history-editor');
 win.setSize(860,720);await capture('real-history-editor-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await js(`document.querySelector('#rh-driver-input').value='L. Berg'`);
 await submit();await idle();await store.whenIdle();
 const h=store.data.cars.find(c=>c.id===car).realHistory;
 assert.deepEqual([h.classification,h.team,h.raceNumber,h.year,h.event,h.qualifying,h.finish,h.drivers],['Real Racing Car','Valkyrie Racing','17','1986','1000 km of Spa','4th','DNF','A. Rossi, J. Meyer, L. Berg']);
 assert.deepEqual(h.sources,[{title:'Old results',url:'https://example.com/results'},{title:'Race results 1986',url:'https://www.racingsportscars.com/results/spa-1986'}]);
 return ['Classification cards and the live overview card','Quick result buttons and driver chips (Enter, comma, remove)','Source cards with their site badge; completeness count','A driver typed but not added is kept; every field saves'];
};
