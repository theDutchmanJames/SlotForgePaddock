'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result;
 const car=act('car.save',{data:{name:'Factory suggestion test',maker:'NSR',factory:{motor:'King Evo',rearTyres:'Supergrip',pinion:'9',gear:'27',weight:'80'},technical:{motor:'Track motor',weight:'75'}}});
 const motor=act('part.save',{data:{name:'King Evo',maker:'NSR',reference:'M21',partType:'Motor',quantity:0,tracking:'quantity'}});
 const tyre=act('part.save',{data:{name:'Supergrip',maker:'NSR',reference:'T1',partType:'Tyre',quantity:0,tracking:'quantity'}});
 const before=store.snapshot(),idle=()=>wait('!actionBusy&&!viewPendingKey&&!modalSaving');
 await js(`(async()=>{source='local';page='Cars';carId=${JSON.stringify(car)};section='Setups';await loadView()})()`);await idle();
 await click('[data-action="save-setup"]');await wait(`!document.querySelector('#dialog [type=submit]').disabled`);
 assert.equal(await js(`document.querySelector('#setup-source').value`),'factory');assert.equal(await js(`!!document.querySelector('[name=track]')`),false);
 assert.equal(await js(`document.querySelector('[name=suggest-part-motor]').value`),'');
 await fill({name:'Verified factory plan','suggest-part-motor':motor,'suggest-part-rearTyres':tyre});
 await js(`document.querySelector('[name=suggest-part-motor]').dispatchEvent(new Event('change'))`);
 assert.match(await js(`document.querySelector('#suggest-reason-motor').textContent`),/Exact saved/);
 win.setSize(1280,950);await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(qa,'suggested-setup-phase4.png'),(await win.webContents.capturePage()).toPNG());
 await submit();await idle();assert.equal(store.data.setups[0].plan.source,'factory');assert.equal(store.data.setups[0].installations.length,2);assert.equal(store.data.setups[0].technical.weight,'80');assert.match(await js(`document.querySelector('#main').innerText`),/Setup plan/i);
 for(const key of ['cars','parts','installations','planning','jobs'])assert.deepEqual(store.snapshot()[key],before[key],key);
 await click('[data-action="save-setup"]');await fill({setupSource:'current'});await js(`document.querySelector('#setup-source').dispatchEvent(new Event('change'))`);await wait(`!document.querySelector('#dialog [type=submit]').disabled`);assert.equal(await js(`document.querySelector('#setup-suggestions [name="spec-motor"]').value`),'Track motor');await fill({name:'Current plan'});await submit();await idle();assert.equal(store.data.setups[0].plan.source,'current');assert.equal(store.data.setups[0].technical.weight,'75');
 await click('[data-action="save-setup"]');await fill({setupSource:'snapshot'});await js(`document.querySelector('#setup-source').dispatchEvent(new Event('change'))`);await fill({name:'Actual snapshot'});await submit();await idle();assert.equal(store.data.setups[0].plan,undefined);
 // A late response from a previous source must not overwrite the selected mode.
 await click('[data-action="save-setup"]');await js(`(()=>{const el=document.querySelector('#setup-source');el.value='current';el.dispatchEvent(new Event('change'));el.value='snapshot';el.dispatchEvent(new Event('change'))})()`);await new Promise(r=>setTimeout(r,200));assert.equal(await js(`document.querySelector('#setup-suggestions').textContent`),'');await click('[data-action="close-modal"]');
 return ['Factory default, explicit candidate selection and quantities, Current option, snapshot compatibility, clear plan labels, mode-race protection, unchanged car and inventory'];
};
