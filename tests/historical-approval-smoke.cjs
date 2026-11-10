'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,js,wait,click,qa})=>{
 const H=require('../src/shared-history.cjs'),I=require('../src/history-imports.cjs'),tasks=require('../src/domain-tasks.cjs');
 store.replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());
 const b=structuredClone(require('./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json'));b.recoveryId=H.status(store).recoveryId;
 await tasks.run(store,{kind:'history-import',action:'receive',input:b});await js('loadView()');
 await js("openReview('Historical imports')");await wait("reviewTab==='Historical imports'");await click('[data-action="history-import-inspect"]');
 assert.equal(await js('historicalEvidenceState.result.approvalEnabled'),true);
 assert.equal(await js("document.querySelector('[data-action=history-evidence-approve]').disabled"),false);
 await js("document.querySelector('#history-reject-note').value='Evidence verified in native Review';");
 await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,150))))');fs.writeFileSync(path.join(qa,'historical-approval-ready.png'),(await win.webContents.capturePage()).toPNG());
 // Simulate only a lost renderer acknowledgement after the real IPC/worker
 // commit. Retry must reuse the note and show exactly one accepted session.
 await js("globalThis.approvalOriginalApi=api;api=async(...args)=>{const result=await approvalOriginalApi(...args);if(args[0]==='historyImport'&&args[1].action==='approve'&&!globalThis.approvalLostReply){globalThis.approvalLostReply=true;throw Error('Synthetic lost acknowledgement');}return result;};void 0;");
 await click('[data-action="history-evidence-approve"]');await wait("document.querySelector('#historical-evidence').innerText.includes('Synthetic lost acknowledgement')");
 assert.equal(store.data.timing.imports[0].status,'approved');assert.equal(await js("document.querySelector('#history-reject-note').disabled"),true);assert.equal(await js("document.querySelector('#dialog button[type=submit]').disabled"),true);
 await click('[data-action="history-evidence-tab"][data-id="Laps"]');await wait("historicalEvidenceState.result.status==='approved'");
 assert.equal(await js("document.querySelector('#dialog button[type=submit]')"),null);await click('[data-action="close-modal"]');
 await wait('db._view.historyImports.total===0');assert.equal(store.data.timing.sessions.length,1);
 await click('[data-action="history-import-inspect"]');assert.equal(await js("document.querySelector('#historical-evidence').innerText.includes('approved into shared history')"),true);await click('[data-action="close-modal"]');
 // A second pending item exercises successful approval through the UI.
 b.operationId='native-second';b.items[0].sessionId='native-second';await tasks.run(store,{kind:'history-import',action:'receive',input:b});await js('loadView()');await click('[data-action="history-import-inspect"]');
 await js('globalThis.approvalLostReply=false');await click('[data-action="history-evidence-approve"]');await wait("document.querySelector('#dialog').innerText.includes('Retry approval')");
 await click('[data-action="history-evidence-approve"]');await wait("!document.querySelector('#dialog').open&&db._view.historyImports.total===0");
 assert.equal(store.data.timing.sessions.length,2);assert.equal(store.data.timing.audit.length,2);await js('api=approvalOriginalApi;void 0');
 // Retained evidence from a previous recovery generation is visible but its
 // approval control must not let an owner bypass restore reconciliation.
 b.operationId='native-restored';b.items[0].sessionId='native-restored';await tasks.run(store,{kind:'history-import',action:'receive',input:b});await store.restoreAsync(store.snapshot(),store.data.revision);await js('loadView()');await click('[data-action="history-import-inspect"]');
 assert.equal(await js('historicalEvidenceState.result.recoveryChanged'),true);assert.equal(await js("document.querySelector('[data-action=history-evidence-approve]').disabled"),true);
 await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,150))))');fs.writeFileSync(path.join(qa,'historical-approval-restored.png'),(await win.webContents.capturePage()).toPNG());await click('[data-action="close-modal"]');
 return ['owner approval via actual IPC and worker','closed measured delivery gate retained','lost acknowledgement retains decision and blocks rejection','refresh reconciles already approved evidence','successful approval refreshes inbox','no duplicate sessions or audits','restored evidence approval blocked'];
};
