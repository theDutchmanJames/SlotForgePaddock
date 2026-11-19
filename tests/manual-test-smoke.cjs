'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Record a manual test after docs/ui-reference/manual-test-2026-11 option A: scoreboard, chips, switches,
// the configuration list, and the comparison with earlier tests on the same track and lane.
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const shoot=async name=>{{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);}const was=await js('db.settings.theme');await js("db.settings.theme='light';applyTheme()");await capture(name+'-light.png');await js(`db.settings.theme=${JSON.stringify(was)};applyTheme()`);await capture(name+'.png');};
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result,idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 const car=act('car.save',{data:{name:'Manual QA Porsche 952',maker:'Slot.it',scale:'1:32',technical:{motor:'V12/6 21.5K',pinion:'11',gear:'32',weight:'74'}}});
 act('setup.save',{carId:car,name:'Club race setup',technical:{motor:'V12/6 21.5K'}});
 act('test.add',{carId:car,track:'Manual QA circuit',lane:'2',driver:'Manual QA driver',best:'5.402',laps:'20'});
 act('test.add',{carId:car,track:'Manual QA circuit',lane:'3',best:'5.300',laps:'10'});
 await js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(car)};section='Performance';await loadView()})()`);await idle();
 await click('[data-action="add-test"]');await wait('!!document.querySelector(".mt-win")');
 assert.equal(await js('document.querySelectorAll(".mt-cf").length'),2);
 // Chips fill track, lane and driver; the earlier test on that track and lane is listed.
 await click('[data-action="mt-pick"][data-id="track|Manual QA circuit"]');await click('[data-action="mt-pick"][data-id="lane|2"]');await click('[data-action="mt-pick"][data-id="driver|Manual QA driver"]');
 assert.equal(await js('document.querySelector("[name=track]").value'),'Manual QA circuit');assert.equal(await js('document.querySelector("[data-action=mt-pick][data-id=\'lane|2\']").classList.contains("on")'),true);
 assert.match(await js('document.querySelector("#mt-hist").textContent'),/5\.402/);assert.doesNotMatch(await js('document.querySelector("#mt-hist").textContent'),/5\.300/);
 // The result compares with the best on this track and lane (a comma works as decimal point).
 await fill({best:'5,351',average:'5.488',laps:'20'});
 assert.equal(await js('document.querySelector("#mt-delta").textContent'),'−0.051 s vs your best here');assert.equal(await js('document.querySelector(\'[data-score="best"]\').classList.contains("faster")'),true);
 assert.match(await js('document.querySelector("#mt-summary").textContent'),/5\.351 s best · 20 laps · Manual QA circuit, lane 2/);
 // Switches and the configuration list set the form values.
 await click('[data-action="mt-seg"][data-id="direction|Clockwise"]');await click('[data-action="mt-seg"][data-id="magnetStatus|Without magnets"]');
 const setup=store.data.setups.find(s=>s.name==='Club race setup').id;await click(`[data-action="mt-setup"][data-id="${setup}"]`);assert.equal(await js('document.querySelector("[name=setupId]").value'),setup);
 await fill({voltage:'12.5',notes:'Rear stepped out in the hairpin.'});
 await shoot('manual-test');
 win.setSize(860,720);await capture('manual-test-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 await submit();await idle();
 const t=store.data.tests.find(x=>x.carId===car&&x.best==='5.351');assert.ok(t);
 assert.deepEqual([t.average,t.laps,t.lane,t.driver,t.voltage,t.direction,t.magnetStatus,t.setupId,t.configurationSource],['5.488','20','2','Manual QA driver','12.5','Clockwise','Without magnets',setup,'saved']);
 await store.whenIdle();
 return ['Chips fill track, lane and driver; earlier tests on the same track and lane are listed','Best lap compares with your best there; comma decimals are accepted','Direction and magnet switches and the configuration list set the saved values','The test saves every field as before'];
};
