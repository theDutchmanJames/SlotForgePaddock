'use strict';
// Actual renderer -> existing IPC -> normal domain worker, disposable smoke profile.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,js,wait,click,qa})=>{
 win.webContents.setBackgroundThrottling(false);
 const gate=require('../src/car-merge-activation.json'),initialActivation=gate.enabled;assert.equal(await js('mergeReviewAvailable'),initialActivation);
 const f=require('./support/timing-fixtures.cjs').fixtures();store.data=f.store.data;store.persist(store.data);
 await store.whenIdle();
 const threads=require('node:worker_threads'),Worker=threads.Worker;
 threads.Worker=class extends Worker{constructor(file,options){super(path.basename(String(file))==='domain-worker.cjs'?path.join(__dirname,'support/merge-host-worker.cjs'):file,options);}};
 delete require.cache[require.resolve('../src/domain-tasks.cjs')];const tasks=require('../src/domain-tasks.cjs');threads.Worker=Worker;gate.enabled=true;
 const ready=()=>wait(`!!document.querySelector('.merge-dialog')&&document.querySelector('.merge-dialog').getAttribute('aria-busy')!=='true'`);
 const mc=async(a,key)=>{await click(`.merge-dialog [data-merge="${a}"]${key!==undefined?'[data-key='+JSON.stringify(key)+']':''}`);await ready();};
 try{
  await js("loadView().then(()=>initMergeReview()).then(()=>openReview('Car merges'))");await wait(`!!document.querySelector('[data-action="merge-hub"]')`);
  await click('[data-action="merge-hub"]');await ready();await mc('new');await mc('main','car-b');await mc('create','car-a');
  assert.equal(store.data.mergeProposals[0].status,'pending');assert.equal(!!store.data.cars.find(c=>c.id==='car-a').archived,false);
  await mc('close');await js('loadView()');assert.ok(await js("document.querySelector('#review-button').getAttribute('aria-label').includes('1 merge or late-history reviews')"));
  await click('[data-action="merge-hub"]');await ready();await mc('inspect',store.data.mergeProposals[0].id);await mc('confirm');await mc('approve');
  assert.equal(store.data.mergeMappings.length,1);assert.equal(store.data.cars.find(c=>c.id==='car-a').archived,true);assert.equal(store.data.mergeArchives.length,2);
  await mc('close');
  await tasks.run(store,{kind:'timing',bytes:Buffer.from(JSON.stringify(f.normal))});assert.equal(store.data.mergeInclusions.length,1);assert.equal(store.data.mergeInclusions[0].status,'pending');
  await js('loadView()');assert.ok(await js("document.querySelector('#review-button').getAttribute('aria-label').includes('1 merge or late-history reviews')"));
  await click('[data-action="merge-hub"]');await ready();await mc('hub','late');await mc('late',store.data.mergeInclusions[0].id);
  assert.ok(await js("document.querySelector('.merge-dialog h2').textContent.includes('Review late old-car history')"));
  await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await new Promise(r=>setTimeout(r,500));fs.writeFileSync(path.join(qa,'merge-host-late-review.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await mc('include');assert.equal(store.data.mergeInclusions[0].status,'included');
  await mc('close');await js('loadView()');assert.ok(await js("document.querySelector('#review-button').getAttribute('aria-label').includes('0 merge or late-history reviews')"));
  assert.equal(require('../src/sqlite-storage.cjs').read(store.file).schema,11);
  return 'Host merge UI: closed gate, real IPC/background approval, archive, durable pending review, automatic intake, Review badge and late inclusion passed.';
 }finally{gate.enabled=initialActivation;}
};
