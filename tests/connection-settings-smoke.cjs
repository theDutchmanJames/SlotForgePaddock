'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(win,store,root,{network,localLibrary})=>{
 win.webContents.setBackgroundThrottling(false);const errors=[],checks=[];win.webContents.on('console-message',(event,...args)=>{for(const a of [event.message,...args])if(typeof a==='string'&&/Uncaught|ReferenceError|TypeError/.test(a))errors.push(a);});
 const js=code=>win.webContents.executeJavaScript(code,true),wait=async expression=>{for(let i=0;i<300;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,40));}throw Error('Settings UI wait: '+expression+'\n'+await js('document.body.innerText'));};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait('!actionBusy&&!viewPendingKey');};
 const fill=async values=>{for(const [key,value]of Object.entries(values))await js(`(()=>{const el=document.querySelector('#modal-form [name='+${JSON.stringify(key)}+']');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
 const submit=async()=>{await js('document.querySelector("#modal-form").requestSubmit()');await wait('!document.querySelector("#dialog").open&&!modalSaving&&!viewPendingKey');};
 const photo=async name=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(root,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 await wait('!!db&&!viewPendingKey');store.mutate('car.save',{data:{name:'Settings test car'}});
 await click('[data-action="nav"][data-id="Connections"]');assert.equal(await js('!!document.querySelector("[data-action=start-sharing]")'),false);assert.equal(await js('!!document.querySelector("[data-action=local-library-access]")'),false);
 const order=await js('document.querySelector("#main").innerText');assert(order.indexOf('Dealership Mode')<order.indexOf('Paddock Portal'));await photo('connections-dark');checks.push('Connections contains Dealership then Portal; no legacy host or local-service controls');
 await click('[data-action="nav"][data-id="Settings"]');await click('[data-action="settings-section"][data-id="Database"]');assert.equal(await js('document.querySelector("[data-connection-panel=advanced]").open'),false);
 assert.equal(await js('net.sharedFile.file'),store.file);assert.equal(await js('net.sharedFile.databaseId'),store.data.id);assert.equal(await js('db.cars.length'),0);await photo('database-collapsed');
 checks.push('Database settings show canonical file and identity without loading car records; advanced services start collapsed');
 await click('[data-connection-panel="advanced"]>summary');await wait('net.localLibrary.available');const token=localLibrary.token,id=store.data.id;
 await click('[data-action="local-library-access"]');assert(!localLibrary.enabled);assert.equal(await js('net.sharedFile.shared'),true);assert.equal(store.data.id,id);await click('[data-action="local-library-access"]');assert(localLibrary.enabled);assert.notEqual(localLibrary.token,token);
 assert.equal(await js('document.querySelector("[data-connection-panel=advanced]").open'),true);checks.push('local HTTP enable/disable preserves shared-file identity and expanded settings');
 await click('[data-connection-panel="recovery"]>summary');await click('[data-action="legacy-recover"]');await click('[data-action="close-modal"]');assert.equal(await js('legacyRecoveryEnabled'),false);assert.equal(network.server,null);
 await click('[data-action="legacy-recover"]');await js('document.querySelector("#modal-form [name=confirmed]").checked=true');await submit();assert.equal(await js('legacyRecoveryEnabled'),true);assert.equal(network.server,null);await photo('legacy-recovery');checks.push('older-connection recovery requires acknowledgement and starts no listener');
 checks.push(...await require('./connections-smoke.cjs')({win,store,network,js,wait,click,fill,submit,qa:root}));
 // The same local settings remain reachable while a remote view is selected.
 await click('[data-action="nav"][data-id="Connections"]');await click('[data-action="connection-settings"]');await wait('!viewPendingKey');
 network.hostingMode='legacy';await network.start();const before=network.code;network.notify();await wait('net.sharing');await wait('document.querySelector("#main").innerText.includes("Sharing enabled")');network.controls({rotate:true});network.notify();await wait(`document.querySelector('#main').innerText.includes(${JSON.stringify(network.code)})`);assert.notEqual(before,network.code);await network.stop();network.notify();await wait('!net.sharing');checks.push('background hosting and credential changes refresh relocated controls');
 await js("db.settings.theme='light';render()");win.setSize(960,800);await photo('database-light-960');assert.equal(await js('document.documentElement.scrollWidth<=window.innerWidth'),true);
 if(JSON.parse(fs.readFileSync(path.join(root,'connection-settings.json'),'utf8')).migration)checks.push(...await require('./sharing-retirement-smoke.cjs')({store,root,network,localLibrary,js,wait,click,fill,submit,photo}));
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,checks,errors},null,2));
};
