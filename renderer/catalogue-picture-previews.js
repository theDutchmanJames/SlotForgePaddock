let cataloguePreview=null;
const previewDomain=value=>{try{return new URL(value).hostname;}catch{return '';}};
const previewReady=row=>row.status==='ready';
const previewDownloadable=row=>row.conflict==='READY'&&row.imageUrl&&['needs-download','download-failed'].includes(row.status);
function previewCall(method,extra={},v=cataloguePreview){return api('file','pictures.preview.'+method,{id:v.data.requestId,expected:v.data,...extra});}
function previewRows(){const v=cataloguePreview;return v.data.rows.filter(r=>(!v.manufacturer||r.manufacturer===v.manufacturer)&&(!v.category||r.category===v.category)&&(!v.query||[r.name,r.reference,r.manufacturer].join(' ').toLowerCase().includes(v.query.toLowerCase())));}
function previewDraw(){const v=cataloguePreview,root=$('#catalogue-preview');if(!v||!root)return;const d=v.data,rows=previewRows(),shown=rows.slice(v.offset,v.offset+8),busy=d.running||d.applying||v.requesting,button=(label,action,id='',cls='')=>`<button type="button" class="btn ${cls}" data-action="illustrated-${action}" data-id="${esc(id)}" ${busy&&!['stop','stop-save'].includes(action)?'disabled':''}>${label}</button>`;
 root.innerHTML=`<p>Check each proposed picture against its product. Previews download automatically after all selected files pass validation. Select the pictures you want, then choose Finish import at the bottom right. Dealership submissions wait for approval in Review.</p>${d.files?.length?`<p class="tiny muted">${d.files.length} files · ${d.rows.length} products · ${d.remainingDownloads||0} downloads queued</p>`:''}${(d.notices||[]).map(n=>`<p class="tiny muted">${esc(n)}</p>`).join('')}<div class="form-grid"><label class="field">Manufacturer<select id="preview-manufacturer" ${busy?'disabled':''}><option value="">All manufacturers</option>${[...new Set(d.rows.map(r=>r.manufacturer))].sort().map(m=>`<option ${m===v.manufacturer?'selected':''}>${esc(m)}</option>`).join('')}</select></label><label class="field">Category<select id="preview-category" ${busy?'disabled':''}><option value="">All categories</option>${[...new Set(d.rows.map(r=>r.category))].sort().map(c=>`<option ${c===v.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label class="field">Find a product<input ${busy?'disabled':''} id="preview-query" value="${esc(v.query)}" maxlength="500" placeholder="Name or reference"></label></div><div class="actions">${button('Filter','filter')}${button(d.downloadPause?'Resume downloads':'Download filtered previews','download')}${d.running?button('Stop downloads','stop'):''}${d.applying?button('Stop import','stop-save'):''}${button('Select all ready pictures','select-all')}${button('Select ready missing pictures','select-missing')}${button('Clear selection','select-none')}${button('Clear unselected previews','clear')}${d.rows.some(r=>r.locked)||v.batch?button('Check import status','reconcile')+(d.rows.some(r=>['failed','uncertain'].includes(r.status))?button('Retry incomplete imports','retry-save'):''):''}</div><p class="tiny muted" role="status">${d.rows.filter(r=>r.selected).length} selected · ${d.rows.filter(r=>r.thumbnail).length} downloaded · ${d.rows.filter(r=>r.status==='download-failed').length} failed · ${(d.stagingBytes/1048576).toFixed(1)} / ${d.stagingLimit/1048576} MiB staging${d.running?' · Downloading…':d.applying?' · Importing…':''} · ${d.rows.filter(r=>r.status==='applied').length} imported · ${d.rows.filter(r=>r.status==='pending').length} awaiting review</p><p class="note info">Select all ready pictures includes replacements and uncertain matches across all pages and filters. Untick anything you do not want, then choose Finish import at the bottom right. Selections are saved for later. Stop leaves completed pictures saved and pending reviews intact.</p>${d.downloadPause?`<p class="note warn" role="status">${esc(d.downloadPause.message)} ${d.downloadPause.remaining} pictures waiting. Importing ready pictures frees space and continues queued downloads automatically; new pictures still need your selection and confirmation.</p>`:''}${v.result?`<p class="note info" role="status">${esc(v.result)}</p>`:''}${v.error||d.saveError?`<p class="note danger" role="alert">${esc(v.error||d.saveError)}</p>`:''}<div class="catalogue-preview-rows">${shown.map(r=>`<section class="panel catalogue-preview-row"><div class="row between"><div><strong>${esc(r.name)}</strong><p class="tiny muted">${esc([r.manufacturer,r.reference.trim()||'No product reference',r.category,r.kind==='supply'?'Workshop supply':'Part'].filter(Boolean).join(' · '))}</p></div>${badge(({pending:'Awaiting review',uncertain:'Check import status',failed:'Import needs attention',applied:'Imported',unchanged:'Already up to date'}[r.status]||r.status.replaceAll('-',' ')),r.status==='ready'?'good':'')}</div><div class="catalogue-preview-pair"><figure><figcaption>Current picture</figcaption>${r.currentThumbnail?`<img src="${esc(r.currentThumbnail)}" alt="Current ${esc(r.name)}">`:`<div class="catalogue-preview-empty">${r.hasCurrent?'An existing picture is kept until explicitly replaced.':'No current picture'}</div>`}</figure><figure><figcaption>Proposed picture</figcaption>${r.thumbnail?`<img src="${esc(r.thumbnail)}" alt="Proposed ${esc(r.name)}">`:`<div class="catalogue-preview-empty">${['applied','unchanged'].includes(r.status)?'Picture saved. Temporary preview released.':'No downloaded preview'}</div>`}</figure></div><p class="tiny muted">Image source: ${esc(previewDomain(r.imageUrl)||'Not supplied')}${r.imagePageUrl?' · Product page: '+esc(previewDomain(r.imagePageUrl)):''}</p>${r.sourceFile?`<p class="tiny muted">File: ${esc(r.sourceFile)}</p>`:''}${r.notes?`<p class="note warn">${esc(r.notes)}</p>`:''}${!r.reference.trim()?'<p class="tiny">No product reference: verify the exact variant before selecting.</p>':''}${r.conflict!=='READY'?`<p class="note warn">${esc(r.conflict.replaceAll('_',' '))}. Create a fresh request for this product.</p>`:''}${r.error?`<p role="status">${esc(r.error)}</p>`:''}${r.currentPreviewNote?`<p class="tiny muted">${esc(r.currentPreviewNote)}</p>`:''}<div class="actions">${previewReady(r)?`<label class="check-row"><input type="checkbox" data-action="illustrated-toggle" data-id="${esc(r.itemId)}" ${r.selected?'checked':''} ${busy?'disabled':''}>${r.hasCurrent?'Replace existing picture':'Select picture'}</label>`:''}${previewDownloadable(r)?button(r.status==='download-failed'?'Retry download':'Download preview','retry',r.itemId):''}${!r.locked?button('Edit image links','edit',r.itemId):''}${r.thumbnail&&!r.locked?button('Remove preview','remove',r.itemId):''}</div>${v.edit===r.itemId?`<div class="catalogue-preview-edit"><label class="field">Direct image URL<input id="preview-image-url" type="url" maxlength="4096" value="${esc(r.imageUrl)}"></label><label class="field">Source page URL (optional)<input id="preview-page-url" type="url" maxlength="4096" value="${esc(r.imagePageUrl)}"></label><p class="tiny muted">An empty image URL removes the proposal. Changing links clears this row’s preview and selection.</p><div class="actions">${button('Save links','save-link',r.itemId)}${button('Cancel editing','cancel-edit')}</div></div>`:''}</section>`).join('')||'<p>No products match these filters.</p>'}</div><div class="actions mt">${v.offset?button('Previous','prev'):''}${v.offset+8<rows.length?button('Next','next'):''}<span>${rows.length} products</span></div>`;
 previewFooter(v,button,busy);
}
function previewFooter(v,button,busy){
 const footer=$('#dialog .dialog-footer');if(!footer)return;
 const rows=v.data.rows,selected=rows.filter(r=>r.selected),imported=rows.filter(r=>r.status==='applied').length,pending=rows.filter(r=>r.status==='pending').length;
 const done=!v.data.remainingDownloads&&!rows.some(previewReady)&&!selected.length&&(imported||pending||rows.some(r=>r.status==='unchanged'))&&!rows.some(r=>['failed','uncertain'].includes(r.status));
 const status=v.confirm?`<strong>Import ${selected.length} pictures?</strong><br>${selected.filter(r=>r.hasCurrent).length} existing pictures will be replaced.`:busy?(v.data.applying?'Importing pictures…':'Preparing pictures…'):done?`${imported} imported · ${pending} awaiting review. Your changes are saved.`:`${selected.length} pictures selected`;
 const primary=busy?'<button type="button" class="btn primary" disabled>Working…</button>':v.confirm?button('Confirm import','confirm-import','','primary'):done?'<button type="button" class="btn primary" data-action="close-modal">Done</button>':`<button type="button" class="btn primary" data-action="illustrated-import-selected" ${selected.length?'':'disabled'}>Finish import (${selected.length})</button>`;
 footer.innerHTML=`<div class="catalogue-preview-footer"><div role="status">${status}</div><div class="actions">${v.confirm?button('Back to selection','cancel-import'):done?'':'<button type="button" class="btn" data-action="close-modal">Close</button>'}${primary}</div></div>`;
}
async function previewComplete(v){
 if(cataloguePreview!==v||!v.batch||v.requesting||v.data.applying||v.data.running)return false;
 const rows=v.batch.ids.map(id=>v.data.rows.find(r=>r.itemId===id));
 const count=status=>rows.filter(r=>r?.status===status&&!r.error).length;
 const imported=count('applied'),submitted=count('pending'),unchanged=count('unchanged'),remaining=rows.length-imported-submitted-unchanged;
 const parts=[];
 if(imported)parts.push(`${imported} picture${imported===1?'':'s'} imported successfully`);
 if(submitted)parts.push(`${submitted} picture${submitted===1?'':'s'} submitted for review`);
 if(unchanged)parts.push(`${unchanged} picture${unchanged===1?'':'s'} already up to date`);
 if(v.batch.stopped||remaining||v.data.saveError||!rows.length){
  v.result=[v.batch.stopped?'Import stopped':null,...parts,remaining?`${remaining} picture${remaining===1?' still needs':'s still need'} attention. Check import status or retry incomplete imports`:null].filter(Boolean).join('. ')+'.';
  return false;
 }
 // Only the batch initiated in this window can finish it. Old receipts and
 // unrelated unselected pictures cannot turn a partial import into success.
 if(v.batch.continuing||v.data.remainingDownloads){v.result=parts.join('. ')+'. Review the remaining pictures and confirm their import when ready.';v.batch=null;return false;}
 const message=parts.join('. ')+'.',identity=v.data.databaseId,originalPath=dataPath;
 clearTimeout(v.timer);v.batch=null;cataloguePreview=null;
 $('#dialog').close();
 void api('file','pictures.preview.close',{id:v.data.requestId,expected:v.data}).catch(()=>{});
 toast(message);
 try{
  const result=await readScreen();
  if(local()&&db.id===identity&&result.data.id===identity&&dataPath===originalPath){acceptSnapshot(result.data);net=result.network;if(result.club)clubState=result.club;if(result.collection)collectionMeta=result.collection;render();}
 }catch(e){toast(message+' The catalogue could not refresh: '+e.message,true);}
 return true;
}
function previewSchedule(){const v=cataloguePreview;if(!v)return;clearTimeout(v.timer);if(!(v.data.running||v.data.applying)||v.edit||!$('#catalogue-preview'))return;v.timer=setTimeout(async()=>{const actionVersion=v.actionVersion||0;try{const data=await previewCall('status',{},v);if(cataloguePreview!==v||v.requesting||actionVersion!==(v.actionVersion||0)||!$('#catalogue-preview'))return;v.data=data;if(await previewComplete(v))return;previewDraw();}catch(e){v.error=e.message;v.data.running=false;v.data.applying=false;previewDraw();}finally{if(cataloguePreview===v)previewSchedule();}},1000);}
function previewOpen(data){if(cataloguePreview)clearTimeout(cataloguePreview.timer);cataloguePreview={data,manufacturer:'',category:'',query:'',offset:0,edit:null,error:''};modal('Illustrated Catalogue · '+data.manufacturer,'<div id="catalogue-preview"></div>',null);previewDraw();previewSchedule();}
async function picturePreviewAction(action,id){if(!action.startsWith('illustrated-'))return false;if(!local())return true;
 if(action==='illustrated-import'){const expected=await api('file','pictures.browse',{}),data=await api('file','pictures.response.pick',{expected});if(data)previewOpen(data);return true;}
 if(action==='illustrated-open'){const expected=await api('file','pictures.browse',{});previewOpen(await api('file','pictures.preview.open',{id,expected}));return true;}
 const v=cataloguePreview;if(!v||!$('#catalogue-preview'))return true;if(v.requesting||(v.data.running||v.data.applying)&&!['illustrated-stop','illustrated-stop-save'].includes(action))return true;const call=(method,extra={})=>previewCall(method,extra,v);v.actionVersion=(v.actionVersion||0)+1;clearTimeout(v.timer);v.error='';
 if(['illustrated-toggle','illustrated-select-all','illustrated-select-missing','illustrated-select-none','illustrated-edit','illustrated-save-link','illustrated-remove','illustrated-clear'].includes(action))v.confirm=false;
 // Read unsaved inputs before the busy-state render replaces their elements.
 const filters=action==='illustrated-filter'?{manufacturer:$('#preview-manufacturer')?.value||'',category:$('#preview-category').value,query:$('#preview-query').value}:null;
 const links=action==='illustrated-save-link'?{itemId:id,imageUrl:$('#preview-image-url').value.trim(),imagePageUrl:$('#preview-page-url').value.trim()}:null;
 v.requesting=true;previewDraw();
 try{
  if(action==='illustrated-import-selected'){v.batch=null;v.result='';if(!v.data.rows.some(r=>r.selected))throw Error('Select pictures to import first.');v.confirm=true;}
  if(action==='illustrated-cancel-import')v.confirm=false;
  if(action==='illustrated-confirm-import'){if(!v.confirm)throw Error('Review the import before confirming.');v.batch={ids:v.data.rows.filter(r=>r.selected).map(r=>r.itemId),stopped:false,continuing:!!v.data.remainingDownloads};v.confirm=false;v.result='';await call('apply');v.data=await call('status');}
  if(action==='illustrated-retry-save'){v.batch={ids:v.data.rows.filter(r=>r.locked&&!['applied','unchanged','rejected'].includes(r.status)).map(r=>r.itemId),stopped:false,continuing:!!v.data.remainingDownloads};v.result='';await call('retry-save');v.data=await call('status');}
  if(action==='illustrated-stop-save'){if(v.batch)v.batch.stopped=true;await call('stop-save');v.data=await call('status');}
  if(action==='illustrated-reconcile'){await call('reconcile');v.data=await call('status');}
  if(action==='illustrated-filter'){v.manufacturer=filters.manufacturer;v.category=filters.category;v.query=filters.query;v.offset=0;}
  if(action==='illustrated-prev')v.offset=Math.max(0,v.offset-8);
  if(action==='illustrated-next')v.offset+=8;
  if(action==='illustrated-edit')v.edit=id;
  if(action==='illustrated-cancel-edit')v.edit=null;
  if(action==='illustrated-save-link'){v.data=await call('edit',links);v.edit=null;}
  if(action==='illustrated-download'||action==='illustrated-retry'){const itemIds=action==='illustrated-retry'?[id]:(v.data.downloadPause?v.data.rows:previewRows()).filter(previewDownloadable).map(r=>r.itemId);if(!itemIds.length)throw Error('No pictures in this selection need downloading.');await call('download',{itemIds});v.data=await call('status');}
  if(action==='illustrated-stop'){await call('cancel');v.data=await call('status');}
  if(action==='illustrated-toggle'){const selected=new Set(v.data.rows.filter(r=>r.selected).map(r=>r.itemId));selected.has(id)?selected.delete(id):selected.add(id);v.data=await call('select',{itemIds:[...selected]});}
  if(action==='illustrated-select-missing')v.data=await call('select',{itemIds:[...new Set([...v.data.rows.filter(r=>r.selected).map(r=>r.itemId),...previewRows().filter(r=>previewReady(r)&&!r.hasCurrent&&!r.attention).map(r=>r.itemId)])],bulk:true});
  if(action==='illustrated-select-all')v.data=await call('select',{itemIds:v.data.rows.filter(previewReady).map(r=>r.itemId)});
  if(action==='illustrated-select-none')v.data=await call('select',{itemIds:[]});
  if(action==='illustrated-remove')v.data=await call('clear',{itemId:id});
  if(action==='illustrated-clear')v.data=await call('clear');
 }catch(e){v.error=e.message;}finally{v.requesting=false;}
 if(cataloguePreview!==v)return true;
 if(!v.error&&await previewComplete(v))return true;
 previewDraw();previewSchedule();return true;
}
document.addEventListener('DOMContentLoaded',()=>$('#dialog').addEventListener('close',()=>{const v=cataloguePreview;if(!v||$('#dialog').open&&$('#catalogue-preview'))return;clearTimeout(v.timer);cataloguePreview=null;void api('file','pictures.preview.close',{id:v.data.requestId,expected:v.data}).catch(()=>{});}));
