'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{dialog,app}=require('electron');
module.exports=async({win,store,js,wait,click,fill,submit,qa,errors})=>{
 const P=require('../src/catalogue-picture-requests.cjs'),journal=new P.Journal(app.getPath('userData')),out=path.join(qa,'picture-request-exports');fs.mkdirSync(out,{recursive:true});
 // Use a normal domain-created record as the valid shape for this isolated collection.
 const seed=store.mutate('part.save',{data:{name:'QA illustrated product',maker:'QA Pictures',reference:'QA-01',quantity:0,tracking:'quantity',category:'Motors & motor parts',partType:'Motor'}}).result;
 const expanded=store.snapshot(),p=expanded.parts.find(x=>x.id===seed);for(let i=1;i<=100;i++)expanded.parts.push({...p,id:'qa-picture-'+i,name:'QA illustrated product '+i,reference:'QA-'+i});store.replace(expanded);
 const original=dialog.showOpenDialog;let cancel=true;dialog.showOpenDialog=async()=>({canceled:cancel,filePaths:[out]});
 const before=store.snapshot();try{
  await js("(async()=>{page='Import & Export';acceptSnapshot((await api('read',{queryView:{page}})).data);render()})()");
  await click('[data-action="pictures-open"]');await wait("!!document.querySelector('#pictures-maker')");
  await js("document.querySelector('#pictures-maker').value='QA Pictures'");await click('[data-action="pictures-filter"]');assert.equal(await js('pictureRequestView.result.total'),101);
  await click('[data-action="pictures-select"]');assert.equal(await js('pictureRequestView.selected.size'),101);
  const count=journal.list(store.data.id).length;await click('[data-action="pictures-export"]');assert.equal(journal.list(store.data.id).length,count);
  cancel=false;await click('[data-action="pictures-export"]');await wait("document.querySelector('#pictures-export-result')?.textContent.includes('2 request file(s)')");assert.equal(journal.list(store.data.id).length,count+2);
  const files=fs.readdirSync(out).flatMap(folder=>fs.readdirSync(path.join(out,folder)).filter(f=>f.endsWith('.json')).map(f=>path.join(out,folder,f)));assert.ok(files.length>=2);for(const file of files){const request=JSON.parse(fs.readFileSync(file));require('../src/catalogue-pictures-contract.cjs').validateRequest(request);assert.ok(request.items.length<=100);}
  await js("document.querySelector('#toast').hidden=true;applyTheme({...db.settings,theme:'light'})");await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(qa,'picture-requests-light.png'),(await win.webContents.capturePage()).toPNG());await js("applyTheme({...db.settings,theme:'dark'})");await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(qa,'picture-requests-dark.png'),(await win.webContents.capturePage()).toPNG());
  await click('[data-action="close-modal"]');await click('[data-action="pictures-saved"]');assert.ok(await js("document.querySelector('#dialog').textContent.includes('QA Pictures')"));await click('[data-action="pictures-again"]');assert.equal(journal.list(store.data.id).length,count+2);
  await click('[data-action="pictures-discard"]');await submit();assert.equal(journal.list(store.data.id).length,count+1);assert.deepEqual(store.snapshot(),before);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(qa,'catalogue-pictures-smoke.json'),JSON.stringify({passed:true,checks:['Import & Export entry','manufacturer filter','select all 101','cancel creates no journal','two 100-item batches','public JSON validation','durable saved requests','reexport same identity','discard confirmation','collection unchanged','light and dark layout'],rendererErrors:errors},null,2));
 }finally{dialog.showOpenDialog=original;}
};
