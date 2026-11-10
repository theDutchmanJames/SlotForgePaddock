'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async(win,store,root)=>{
 win.webContents.setBackgroundThrottling(false);const errors=[];win.webContents.on('console-message',(_e,...args)=>{for(const a of args)if(typeof a==='string'&&/Uncaught|ReferenceError|TypeError/.test(a))errors.push(a);});
 const js=code=>win.webContents.executeJavaScript(code,true),wait=async expression=>{for(let i=0;i<200;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error(expression+'\n'+await js('document.body.innerText'));};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait('!actionBusy&&!viewPendingKey');};
 const capture=async name=>{await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(root,name),(await win.webContents.capturePage()).toPNG());};
 const car=JSON.parse(fs.readFileSync(path.join(root,'native-history.json'))).carId;
 await wait("document.body.innerText.includes('On the workbench')");await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="open-car"][data-id="'+car+'"]');await click('[data-action="section"][data-id="Performance"]');
 await wait("document.body.innerText.includes('7.500 s')&&document.body.innerText.includes('Saved 5 Apr 2020')");
 assert.equal(await js("document.body.innerText.includes('Lanes 2')"),true);assert.equal(await js("document.body.innerText.includes('7.000 s')"),true);await capture('performance.png');
 await click('[data-action="history-view-open"]');await wait("document.querySelector('#dialog').innerText.includes('7.500 s')");assert.equal(await js("document.querySelector('#dialog').innerText.includes('Pending historical evidence')"),false);assert.equal(await js("document.querySelector('#dialog').innerText.includes('Saved 5 Apr 2020')"),true);await capture('session.png');
 await click('[data-action="history-view-tab"][data-id="Laps"]');await wait("document.querySelector('#dialog').innerText.includes('Eligible')");assert.equal(await js("document.querySelector('#dialog').innerText.includes('Invalid')"),true);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,checks:['Old accepted native session repaired on launch','Average and best laps visible','Lane 2 card and record','Labelled saved date on card and detail','No pending message on accepted detail','Invalid lap remains excluded'],rendererErrors:errors},null,2));
};
