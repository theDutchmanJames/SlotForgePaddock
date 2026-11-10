'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({win,store,js,wait,click,qa})=>{
 const {Store}=require('../src/store.cjs'),H=require('../src/shared-history.cjs'),R=require('../src/rich-history.cjs'),I=require('../src/history-imports.cjs'),T=require('../src/timing-integration.cjs');
 store.replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());const writer=new Store(store.file,{deferred:true});
 const f=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/timing-production-mapper/heats-finals.json')));
 const op={version:1,databaseId:'paddock-demo',recoveryId:H.status(writer).recoveryId,operationId:'native-mapper',editor:{installationId:'timing-mapper',application:'SlotForge Timing',name:'Synthetic native test'},sourceId:'timing-mapper',sessionId:f.evidence.session.id,action:'create',expected:null,reason:'Qualification only',bundle:f.bundle};R.receiveQualified(writer,op);
 // A separately identified synthetic historical variant exercises the same display
 // while remaining pending. This is not a migration of the measured session.
 const b=structuredClone(f.bundle);b.provenance.kind='historical';for(const p of b.race.participants)for(const l of p.laps){l.personalRecordEligible=false;l.trackRecordEligible=false;}
 b.context.classification[0].effects=[{kind:'other',amount:0,reason:'<img src=x onerror="globalThis.mapperInjected=true">'}];
 b.context.classification[0].gap={value:1250,unit:'ms'};b.context.classification[0].incomplete=true;b.context.classification[0].estimated=false;
 const batch={version:1,databaseId:op.databaseId,recoveryId:op.recoveryId,operationId:'native-history',editor:op.editor,items:[{itemId:'native-evidence',sourceId:'historical-mapper',sessionId:op.sessionId,originHash:T.digest(f.evidence),bundle:b}]};I.receive(writer,batch);
 await require('../src/domain-tasks.cjs').run(store,{kind:'refresh',databaseId:store.data.id});
 await js("page='Cars';carId='car-a';section='Performance';loadView()");await wait("!!document.querySelector('[data-action=history-view-open]')");
 await click('[data-action="history-view-open"]');await wait('!!historySessionState?.head');await click('[data-action="history-view-tab"][data-id="Classification"]');
 assert.deepEqual(await js("Array.from(document.querySelectorAll('#shared-history-session tbody tr')).map(r=>[r.cells[7].textContent,r.cells[8].textContent])"),[['30','20 points'],['10','Unknown'],['10','Unknown'],['10','Unknown']]);
 assert.equal(await js("document.querySelector('#shared-history-session tbody tr').cells[10].textContent.includes('Heat 1 [2] / Heat 1 [1]')"),true);
 assert.equal(await js('historySessionState.head.statistics.overallWins'),1);assert.equal(await js('historySessionState.head.statistics.distanceM'),120);
 await click('[data-action="close-modal"]');await js("openReview('Historical imports')");await wait("!!document.querySelector('[data-action=history-import-inspect]')");await click('[data-action="history-import-inspect"]');await wait("!!document.querySelector('#historical-evidence')");await click('[data-action="history-evidence-tab"][data-id="Classification"]');
 assert.equal(await js("document.querySelector('#historical-evidence tbody tr').cells[9].textContent"),'1.250 s');assert.match(await js("document.querySelector('#historical-evidence tbody tr').cells[11].textContent"),/Incomplete: Yes.*Estimated: No/);
 assert.equal(await js('!!globalThis.mapperInjected'),false);assert.equal(await js("document.querySelector('#historical-evidence button[disabled]').textContent"),'Approve (not yet available)');
 for(const theme of ['dark','light']){
  win.setContentSize(1050,800);await js(`db.settings.theme=${JSON.stringify(theme)};applyTheme()`);await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await js('document.documentElement.scrollWidth<=window.innerWidth'),true);
  assert.equal(await js("(()=>{const wrap=document.querySelector('#historical-evidence .table-wrap');return wrap.scrollWidth>wrap.clientWidth&&getComputedStyle(wrap).overflowX==='auto';})()"),true);
  fs.writeFileSync(path.join(qa,'mapper-classification-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 assert.equal(store.data.timing.imports[0].status,'pending');assert.equal(store.data.timing.sessions.length,1);
 await click('[data-action="close-modal"]');
 return ['production awarded points and score remain separate','counted and dropped heat names','final awards do not inflate overall wins or distance','historical gap and incomplete/estimated evidence','escaped adjustment text','approval remains disabled and evidence pending','dark/light narrow table scroll without page overflow'];
};
