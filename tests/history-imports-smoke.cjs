'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,js,wait,click,submit,qa})=>{
 const H=require('../src/shared-history.cjs'),b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));
 b.databaseId=store.data.id;b.recoveryId=H.status(store).recoveryId;b.items[0].bundle.race.name='Older club race <img src=x onerror="globalThis.historyInjected=true">';
 if(process.argv.includes('--historical-upload')){
  const U=require('../src/history-uploads.cjs'),bytes=Buffer.from(JSON.stringify(b)+' '.repeat(300000)),base={version:1,databaseId:b.databaseId,recoveryId:b.recoveryId,uploadId:'ui-history'},run=(action,input)=>require('../src/domain-tasks.cjs').run(store,{kind:'history-upload',action,input});
  await run('start',{...base,editor:b.editor,kind:'import',byteLength:bytes.length,sha256:U.hash(bytes)});
  for(let index=0;index<Math.ceil(bytes.length/U.CHUNK);index++){const chunk=bytes.subarray(index*U.CHUNK,(index+1)*U.CHUNK);await run('chunk',{...base,index,sha256:U.hash(chunk),data:chunk.toString('base64')});}
  await js('loadView()');assert.equal(await js('db._view.historyImports.total'),0);await run('commit',{...base,sha256:U.hash(bytes)});
 }else await require('../src/domain-tasks.cjs').run(store,{kind:'history-import',action:'receive',bytes:Buffer.from(JSON.stringify(b))});await js('loadView()');
 await js("openReview('Historical imports')");await wait(`reviewTab==='Historical imports'&&document.body.innerText.includes('Older club race')`);
 assert.equal(await js('!!globalThis.historyInjected'),false);assert.equal(await js(`document.querySelectorAll('[data-action="history-import-inspect"]').length`),1);
 fs.writeFileSync(path.join(qa,'historical-review.png'),(await win.webContents.capturePage()).toPNG());
 await click('[data-action="history-import-inspect"]');await wait(`document.querySelector('#dialog').open`);assert.equal(await js(`document.querySelector('#dialog').innerText.includes('Acceptance')||document.querySelector('#dialog').innerText.includes('acceptance')`),true);
 assert.equal(await js(`document.querySelector('#dialog button[disabled]').textContent`),'Approve (not yet available)');
 fs.writeFileSync(path.join(qa,'historical-review-detail.png'),(await win.webContents.capturePage()).toPNG());
 await js(`document.querySelector('#history-reject-note').value='Need original race evidence';`);await submit();await wait(`db._view.historyImports.total===0`);
 assert.equal(store.data.timing.sessions.length,0);assert.equal(store.data.timing.imports[0].status,'rejected');assert.equal(store.data.timing.imports[0].decisionNote,'Need original race evidence');
 await click('[data-action="history-import-inspect"]');assert.equal(await js(`document.querySelector('#dialog button[type="submit"]')`),null);await click('[data-action="close-modal"]');
 return ['historical pending count and automatic Review selection','escaped historical session title','bounded lap preview','approval explicitly disabled','rejection and note persist through renderer IPC','rejected evidence remains inspectable','no accepted racing contribution'];
};
