'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// Picture request after docs/ui-reference/picture-request-2026-11 option A: manufacturers with counts, product
// cards to tick (existing pictures shown through the cached thumbnails), and the request beside them.
module.exports=async({win,store,js,wait,click,qa})=>{
 const capture=async name=>{win.webContents.invalidate();await new Promise(r=>setTimeout(r,500));fs.writeFileSync(path.join(qa,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
 const shoot=async name=>{{const [w,h]=win.getSize();win.setSize(w,h+1);await new Promise(r=>setTimeout(r,300));win.setSize(w,h);}const was=await js('db.settings.theme');await js("db.settings.theme='light';applyTheme()");await capture(name+'-light.png');await js(`db.settings.theme=${JSON.stringify(was)};applyTheme()`);await capture(name+'.png');};
 const image=require('./support/thumbnail-images.cjs')(64,48,100);
 const part=data=>store.mutate('part.save',{revision:store.data.revision,data:{quantity:0,tracking:'quantity',category:'Motors & motor parts',partType:'Motor',...data}}).result;
 for(let i=1;i<=5;i++)part({name:'PQ Velox motor '+i,maker:'PQ Velox',reference:'PV-'+i});
 part({name:'PQ Velox motor with a picture',maker:'PQ Velox',reference:'PV-P',picture:image});
 part({name:'PQ Velox tyres no ref',maker:'PQ Velox',reference:'',category:'Wheels & tyres',partType:'Tyre'});
 part({name:'PQ Ortus guide',maker:'PQ Ortus',reference:'PO-1',picture:image});
 await js("(async()=>{page='Import & Export';acceptSnapshot((await api('read',{queryView:{page}})).data);render()})()");
 await click('[data-action="pictures-open"]');await wait(`!!document.querySelector('.pq-maker.on')&&!!document.querySelector('.pq-card')`);
 // Opens on the manufacturer with the most missing pictures; its counts are shown.
 assert.equal(await js('pictureRequestView.filters.manufacturer'),await js('pictureRequestView.result.makerStats.reduce((b,m)=>!b||m.total-m.pictured>b.total-b.pictured?m:b,null).name'));
 if(await js('pictureRequestView.filters.manufacturer')!=='PQ Velox'){await click('[data-action="pictures-maker"][data-id="PQ Velox"]');await wait(`pictureRequestView.filters.manufacturer==='PQ Velox'`);}
 assert.match(await js(`document.querySelector('.pq-maker[data-id="PQ Velox"]').textContent`),/6 missing[\s\S]*1 of 7 have a picture/);
 assert.equal(await js('document.querySelectorAll(".pq-card").length'),6);
 assert.equal(await js('!!document.querySelector(".pq-noref")'),true);
 // Ticking a card adds it to the request.
 await js(`document.querySelectorAll('.pq-card')[0].click()`);await js(`document.querySelectorAll('.pq-card')[1].click()`);
 assert.equal(await js('pictureRequestView.selected.size'),2);assert.match(await js('document.querySelector("#pictures-side").textContent'),/PQ Velox · 2 products[\s\S]*1 request file/);
 assert.equal(await js('document.querySelector(\'.dialog-footer [data-action="pictures-export"]\').disabled'),false);
 // Kind and category chips filter; the switch includes products that already have a picture.
 await click('[data-action="pictures-cat"][data-id="Wheels & tyres"]');assert.equal(await js('pictureRequestView.result.total'),1);
 await click('[data-action="pictures-cat"][data-id="Wheels & tyres"]');assert.equal(await js('pictureRequestView.result.total'),6);
 await js(`(()=>{const e=document.querySelector('#pictures-include');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await wait('pictureRequestView.result.total===7');
 // The existing picture shows as a cached thumbnail, and its reference never travels back to the main process.
 const thumb=await js(`document.querySelector('.pq-card .pq-pic img')?.getAttribute('src')||''`);assert.match(thumb,/^paddock-media:\/\/image\/.+\?thumbnail=1$/);
 await wait(`(()=>{const i=document.querySelector('.pq-card .pq-pic img');return i&&i.complete&&i.naturalWidth>0})()`);
 assert.equal(await js('pictureRequestView.result.rows.some(r=>Object.hasOwn(r,"picture"))'),false);
 // Search narrows after a short pause.
 await js(`(()=>{const e=document.querySelector('#pictures-query');e.focus();e.value='tyres';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 await wait('pictureRequestView.result.total===1');assert.equal(await js('document.activeElement.id'),'pictures-query');
 await js(`(()=>{const e=document.querySelector('#pictures-query');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait('pictureRequestView.result.total===7');
 await js(`document.querySelectorAll('.pq-card')[2].click()`);
 await shoot('picture-request');
 win.setSize(860,720);await capture('picture-request-narrow.png');assert.equal(await js('document.querySelector(".dialog-body").scrollWidth<=document.querySelector(".dialog-body").clientWidth+1'),true);win.setSize(1440,980);
 // Another manufacturer starts a fresh selection.
 await click('[data-action="pictures-maker"][data-id="PQ Ortus"]');assert.equal(await js('pictureRequestView.selected.size'),0);
 // The Saved requests tab opens in the same window.
 await click('[data-action="pictures-saved"]');await wait(`!!document.querySelector('.pq-saved')`);assert.equal(await js(`document.querySelector('.pq-tabs .on').textContent`),'Saved requests');
 await click('[data-action="close-modal"]');
 return ['Manufacturers list with missing-picture counts; opens on the one with most missing','Cards tick into the request; files and footer follow','Kind, category and include-existing filters; search after a pause keeps focus','Existing pictures shown via cached thumbnails without sending photos back','Saved requests in the same window'];
};
