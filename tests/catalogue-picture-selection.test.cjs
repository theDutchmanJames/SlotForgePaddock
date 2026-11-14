'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function screen(rows,options={}){
 const root={innerHTML:''},footer={innerHTML:''},calls=[],messages=[],timers=[];let closed=0,refreshed=0;const dialog={close:()=>closed++};
 const data={databaseId:'library',requestId:'request',manufacturer:'Example',rows,stagingBytes:0,stagingLimit:67108864,running:false,applying:false};
 const context=vm.createContext({URL,Set,clearTimeout:()=>{},setTimeout:fn=>{timers.push(fn);return timers.length;},local:()=>true,esc:value=>String(value??''),badge:()=>'',document:{addEventListener:()=>{}},$:selector=>options.inputs?.[selector]||(selector==='#dialog'?dialog:selector==='#dialog .dialog-footer'?footer:root),dataPath:'profile/library.sqlite',db:{id:'library'},net:{},clubState:{},collectionMeta:{},toast:(message,error)=>messages.push({message,error}),readScreen:async()=>{refreshed++;if(options.refreshError)throw Error('offline');return {data:{id:'library'},network:{}};},acceptSnapshot:()=>{},render:()=>{},
  api:async(_type,action,p)=>{calls.push({action,p});if(options.onApi)await options.onApi(action,data,p);if(action==='pictures.preview.select')for(const row of rows)row.selected=p.itemIds.includes(row.itemId);return data;}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/catalogue-picture-previews.js'),'utf8'),context);
 context.data=data;vm.runInContext("cataloguePreview={data,query:'visible',category:'Motor',offset:8,error:''};previewDraw()",context);
 return {root,footer,calls,data,messages,timers,closed:()=>closed,refreshed:()=>refreshed,run:code=>vm.runInContext(code,context),action:name=>vm.runInContext('picturePreviewAction('+JSON.stringify('illustrated-'+name)+')',context)};
}
const row=(i,extra={})=>({itemId:'item-'+i,name:'visible '+i,reference:'R'+i,manufacturer:'Example',category:i?'Tyre':'Motor',status:'ready',conflict:'READY',selected:false,hasCurrent:false,attention:false,...extra});

test('automatic continuation stays open for the next selection even if downloads complete before polling',async()=>{
 const rows=[row(0),row(1,{status:'needs-download'})],s=screen(rows,{onApi:(action,data)=>{if(action==='pictures.preview.apply'){rows[0].status='applied';rows[0].selected=false;rows[1].status='ready';data.remainingDownloads=0;}}});
 s.data.remainingDownloads=1;await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');
 assert.equal(s.closed(),0);assert.equal(rows[1].selected,false);assert.match(s.root.innerHTML,/Review the remaining pictures/);assert.match(s.footer.innerHTML,/disabled>Finish import \(0\)/);
 await s.action('select-all');assert.equal(rows[1].selected,true);assert.equal(s.calls.filter(c=>c.action==='pictures.preview.apply').length,1);
});
test('manufacturer filtering leaves Select all ready global across the combined files',async()=>{
 const s=screen([row(0),row(1,{manufacturer:'Other'})]);s.run("cataloguePreview.query='';cataloguePreview.category='';cataloguePreview.manufacturer='Other';previewDraw()");
 assert.equal(s.run('previewRows().length'),1);assert.match(s.root.innerHTML,/All manufacturers/);await s.action('select-all');assert.equal(s.data.rows.filter(r=>r.selected).length,2);
});

test('full staging shows a resumable queue instead of failed pictures and leaves imports explicit',async()=>{
 const rows=[row(0),row(1,{status:'needs-download',imageUrl:'https://example.com/1.png'})],s=screen(rows);
 s.data.downloadPause={code:'STAGING_FULL',message:'Downloads paused: temporary picture storage is full.',remaining:1};s.run('previewDraw()');
 assert.match(s.root.innerHTML,/Resume downloads/);assert.match(s.root.innerHTML,/1 pictures waiting/);assert.match(s.root.innerHTML,/0 failed/);
 s.run("cataloguePreview.category='';cataloguePreview.query='';");await s.action('download');const call=s.calls.find(c=>c.action==='pictures.preview.download');assert.deepEqual(Array.from(call.p.itemIds),['item-1']);assert.equal(s.calls.some(c=>c.action==='pictures.preview.apply'),false);
});

test('Select all spans pages and filters, includes replacements and uncertain matches, and excludes non-ready outcomes',async()=>{
 const rows=Array.from({length:12},(_,i)=>row(i,{hasCurrent:i===1,attention:i===2}));
 rows.push(...['no-image','needs-download','downloading','download-failed','needs-attention','unchanged','pending','uncertain','failed','applied','rejected'].map((status,i)=>row(i+12,{status})));
 const s=screen(rows);await s.action('select-all');
 assert.equal(rows.filter(r=>r.selected).length,12);assert.ok(rows.slice(0,12).every(r=>r.selected));assert.ok(rows.slice(12).every(r=>!r.selected));
 assert.equal(s.calls.length,1);assert.equal(s.calls[0].action,'pictures.preview.select');assert.notEqual(s.calls[0].p.bulk,true);
 await s.action('import-selected');assert.equal(s.calls.length,1);assert.match(s.footer.innerHTML,/Import 12 pictures/);assert.match(s.footer.innerHTML,/1 existing pictures will be replaced/);
 await s.action('cancel-import');await s.run("picturePreviewAction('illustrated-toggle','item-1')");assert.equal(rows[1].selected,false);
 await s.action('import-selected');assert.match(s.footer.innerHTML,/Import 11 pictures/);assert.match(s.footer.innerHTML,/0 existing pictures will be replaced/);assert.equal(s.calls.filter(c=>c.action==='pictures.preview.apply').length,0);
 await s.action('confirm-import');assert.equal(s.calls.filter(c=>c.action==='pictures.preview.apply').length,1);
});

test('Select all never applies an empty selection and is disabled during downloading or saving',async()=>{
 const s=screen([row(0,{status:'download-failed'})]);await s.action('select-all');await s.action('import-selected');
 assert.match(s.root.innerHTML,/Select pictures to import first/);assert.equal(s.calls.length,1);
 for(const field of ['running','applying']){s.data[field]=true;s.run('previewDraw()');assert.match(s.root.innerHTML,/data-action="illustrated-select-all"[^>]*disabled/);s.data[field]=false;}
});

test('Select all and Finish import confirm once and close only after a successful batch',async()=>{
 const rows=[row(0),row(1,{hasCurrent:true}),row(2,{attention:true}),row(3,{status:'download-failed'})];
 const s=screen(rows,{onApi:action=>{if(action==='pictures.preview.apply')for(const r of rows.filter(r=>r.selected)){r.status='applied';r.selected=false;}}});
 await s.action('select-all');await s.action('import-selected');assert.equal(rows.filter(r=>r.selected).length,3);assert.equal(s.closed(),0);assert.equal(s.calls.some(c=>c.action==='pictures.preview.apply'),false);
 assert.match(s.footer.innerHTML,/Import 3 pictures/);assert.match(s.footer.innerHTML,/1 existing pictures will be replaced/);
 await s.action('confirm-import');assert.equal(s.closed(),1);assert.equal(s.refreshed(),1);assert.equal(s.messages[0].message,'3 pictures imported successfully.');
 assert.equal(rows[3].status,'download-failed');await s.action('confirm-import');assert.equal(s.calls.filter(c=>c.action==='pictures.preview.apply').length,1);
});

test('Import selected respects unticked rows and requires fresh confirmation after selection changes',async()=>{
 const rows=[row(0),row(1,{hasCurrent:true})];const s=screen(rows,{onApi:action=>{if(action==='pictures.preview.apply')for(const r of rows.filter(r=>r.selected)){r.status='applied';r.selected=false;}}});
 await s.action('select-all');await s.action('import-selected');await s.run("picturePreviewAction('illustrated-toggle','item-1')");await s.action('confirm-import');assert.equal(s.calls.some(c=>c.action==='pictures.preview.apply'),false);
 await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),1);assert.equal(rows[1].status,'ready');assert.equal(s.messages[0].message,'1 picture imported successfully.');
});

test('partial failures stay open, count only this batch and close after a successful retry',async()=>{
 const rows=[row(0,{status:'applied',locked:true}),row(1),row(2)];const s=screen(rows,{onApi:action=>{
  if(action==='pictures.preview.apply'){Object.assign(rows[1],{status:'applied',selected:false,locked:true});Object.assign(rows[2],{status:'failed',error:'Disk full',selected:false,locked:true});}
  if(action==='pictures.preview.retry-save')Object.assign(rows[2],{status:'applied',error:''});
 }});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),0);assert.match(s.root.innerHTML,/1 picture imported successfully/);assert.match(s.root.innerHTML,/1 picture still needs attention/);assert.doesNotMatch(s.root.innerHTML,/2 pictures imported successfully/);
 await s.action('retry-save');assert.equal(s.closed(),1);assert.equal(s.messages[0].message,'1 picture imported successfully.');
});

test('Dealership delivery closes with submitted wording, never claiming pending pictures were imported',async()=>{
 const rows=[row(0)];const s=screen(rows,{onApi:action=>{if(action==='pictures.preview.apply')Object.assign(rows[0],{status:'pending',selected:false,locked:true});}});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),1);assert.equal(s.messages[0].message,'1 picture submitted for review.');assert.doesNotMatch(s.messages[0].message,/imported/);
});

test('lost acknowledgement stays open until receipt reconciliation confirms the chosen pictures',async()=>{
 const rows=[row(0)];const s=screen(rows,{onApi:action=>{if(action==='pictures.preview.apply'){Object.assign(rows[0],{status:'uncertain',locked:true,selected:false});throw Error('Acknowledgement lost');}if(action==='pictures.preview.reconcile')rows[0].status='applied';}});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),0);assert.match(s.root.innerHTML,/Acknowledgement lost/);
 await s.action('reconcile');assert.equal(s.closed(),1);assert.match(s.messages[0].message,/imported successfully/);
});

test('stopped imports remain open even if the in-flight picture succeeded',async()=>{
 const rows=[row(0)];const s=screen(rows,{onApi:(action,data)=>{if(action==='pictures.preview.apply')data.applying=true;if(action==='pictures.preview.stop-save'){data.applying=false;Object.assign(rows[0],{status:'applied',selected:false});}}});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),0);await s.action('stop-save');assert.equal(s.closed(),0);assert.match(s.root.innerHTML,/Import stopped/);assert.match(s.root.innerHTML,/1 picture imported successfully/);
});

test('background completion closes the original window; old receipts alone never close a reopened preview',async()=>{
 const rows=[row(0)];const s=screen(rows,{onApi:(action,data)=>{if(action==='pictures.preview.apply')data.applying=true;}});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),0);s.data.applying=false;rows[0].status='applied';await s.timers.at(-1)();assert.equal(s.closed(),1);
 const reopened=screen([row(0,{status:'applied',locked:true})]);await reopened.action('reconcile');assert.equal(reopened.closed(),0);
});

test('completion never closes a different preview opened while an import is finishing',async()=>{
 const s=screen([row(0)]);await s.action('select-all');await s.action('import-selected');s.run("cataloguePreview.batch={ids:['item-0']};oldPreview=cataloguePreview;cataloguePreview={data:{rows:[]}};oldPreview.data.rows[0].status='applied'");
 assert.equal(await s.run('previewComplete(oldPreview)'),false);assert.equal(s.closed(),0);
});

test('refresh failure after successful import closes the window and reports refresh separately',async()=>{
 const rows=[row(0)];const s=screen(rows,{refreshError:true,onApi:action=>{if(action==='pictures.preview.apply')rows[0].status='applied';}});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),1);assert.match(s.messages.at(-1).message,/imported successfully.*could not refresh/);assert.equal(s.messages.at(-1).error,true);
});

test('busy-state rendering does not lose edited URLs or filters',async()=>{
 const inputs={'#preview-image-url':{value:' https://example.com/new.png '},'#preview-page-url':{value:' https://example.com/product '},'#preview-category':{value:'Tyre'},'#preview-query':{value:'new query'}};
 const s=screen([row(0)],{inputs});
 // Rendering really replaces inputs in the browser. Simulate the same reset.
 s.run("originalDraw=previewDraw;previewDraw=()=>{originalDraw();$('#preview-image-url').value='https://example.com/old.png';$('#preview-page-url').value='';$('#preview-category').value='Motor';$('#preview-query').value='old query'}");
 await s.run("picturePreviewAction('illustrated-save-link','item-0')");const request=s.calls.find(c=>c.action==='pictures.preview.edit');assert.equal(request.p.imageUrl,'https://example.com/new.png');assert.equal(request.p.imagePageUrl,'https://example.com/product');
 inputs['#preview-category'].value='Tyre';inputs['#preview-query'].value='new query';await s.action('filter');assert.equal(s.run('cataloguePreview.category'),'Tyre');assert.equal(s.run('cataloguePreview.query'),'new query');
});

test('duplicate confirmation while dispatching cannot start a second import',async()=>{
 let release;const rows=[row(0)];const s=screen(rows,{onApi:async action=>{if(action==='pictures.preview.apply'){await new Promise(resolve=>release=resolve);rows[0].status='applied';}}});
 await s.action('select-all');await s.action('import-selected');const importing=s.action('confirm-import');await s.action('confirm-import');assert.equal(s.calls.filter(c=>c.action==='pictures.preview.apply').length,1);release();await importing;assert.equal(s.closed(),1);
});

test('a journal error blocks automatic success until saved outcomes can be checked',async()=>{
 const rows=[row(0)];const s=screen(rows,{onApi:(action,data)=>{if(action==='pictures.preview.apply'){rows[0].status='applied';data.saveError='Progress could not be saved';}if(action==='pictures.preview.reconcile')data.saveError='';}});
 await s.action('select-all');await s.action('import-selected');await s.action('confirm-import');assert.equal(s.closed(),0);assert.match(s.root.innerHTML,/Progress could not be saved/);await s.action('reconcile');assert.equal(s.closed(),1);
});

test('Finish import and its confirmation live in the footer, and saved requests offer Done',async()=>{
 const s=screen([row(0),row(1,{hasCurrent:true})]);
 assert.match(s.footer.innerHTML,/disabled>Finish import \(0\)/);
 await s.action('select-all');assert.match(s.footer.innerHTML,/Finish import \(2\)/);assert.doesNotMatch(s.root.innerHTML,/>Finish import|>Confirm import|>Import all ready pictures/);
 await s.action('import-selected');assert.match(s.footer.innerHTML,/Confirm import/);assert.match(s.footer.innerHTML,/1 existing pictures will be replaced/);
 const saved=screen([row(0,{status:'applied',locked:true}),row(1,{status:'download-failed'})]);assert.match(saved.footer.innerHTML,/>Done</);assert.match(saved.footer.innerHTML,/1 imported/);assert.equal(saved.calls.length,0);
});
