'use strict';
// A private bridge supplies bounded projections, never the complete collection.
// Normal builds advertise enabled:false until the coordinated client phase.
let mergeReviewAvailable=false;
async function initMergeReview(){mergeReviewAvailable=!!(window.slotforge.carMerge&&(await api('carMerge',{action:'status'})).enabled);}
function renderMergeHub(){return '<p class="note info">Merge duplicate entries of the same physical car. Every merge stays pending until you approve its selections. The retired entry is preserved in a read-only archive.</p>'+btn('Open merge reviews','merge-hub','primary');}
async function mergeReviewAction(action,id){
 if(!['merge-hub','merge-start'].includes(action))return false;
 if(!mergeReviewAvailable||!local())throw Error('Car merging is not activated.');
 if($('#dialog').open)$('#dialog').close();
 await CarMergeUI.open({databaseId:db.id,mainCarId:action==='merge-start'?id:null,request:q=>api('carMerge',q),onCar:id=>{carId=id;page='Cars';section='Overview';render();}});return true;
}
const CarMergeUI=(()=>{
 const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const titles={fields:'Car details & configuration',settings:'Timing settings',photos:'Photos',documents:'Documents',setups:'Setups',tests:'Manual performance',jobs:'Workshop jobs',events:'Work & history',history:'Racing history',stock:'Installed parts'};
 const archiveTitles={car:'Original car',documents:'Documents',setups:'Saved setups',tests:'Manual performance',jobs:'Workshop jobs',events:'Work & history',installations:'Installed parts',assemblies:'Assemblies',parts:'Part records',stockUsage:'Stock usage',stockReservations:'Stock reservations',plans:'Job plans',shopping:'Shopping items',shelves:'Showroom shelves',focus:'Photo framing',featured:'Spotlight car',drafts:'Build drafts',sessions:'Racing sessions',origins:'Original car & session links',extras:'Preserved source information',companions:'Effective Timing settings',audit:'Racing audit trail',submissions:'Incoming submissions',clubProposals:'Dealership proposals',imports:'Historical imports',mappings:'Earlier merge links',inclusions:'History inclusion decisions',definitions:'Custom field definitions'};
 const archiveLabel=k=>archiveTitles[k]||String(k).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
 let dialog,state,bridge,busy=false,pendingCommand=null,retries;
 const B=(label,action,id='',disabled=false)=>`<button type="button" class="btn" data-merge="${action}" data-key="${E(id)}" ${disabled?'disabled':''}>${label}</button>`;
 const choice=(value,label,current)=>`<option value="${E(value)}" ${value===current?'selected':''}>${E(label)}</option>`;
 const select=(kind,key,options)=>`<select aria-label="${E(key)}" data-choice="${kind}" data-key="${E(key)}">${options}</select>`;
 const check=(kind,key,value,label)=>`<label class="merge-check"><input type="checkbox" data-choice="${kind}" data-key="${E(key)}" ${value?'checked':''}>${E(label)}</label>`;
 function announce(message,error=false){const el=dialog.querySelector('[data-merge-message]');if(el){el.textContent=message;el.className=error?'note warning':'muted';}}
 async function query(action,extra={}){return bridge.request({action,databaseId:state.databaseId,recoveryId:state.recoveryId,...extra});}
 async function command(action,payload){
  const content=JSON.stringify({action,payload});
  if(pendingCommand&&pendingCommand.content!==content)throw Error('The previous save has an uncertain outcome. Retry that same action before making another change.');
  if(!pendingCommand)pendingCommand={content,command:{databaseId:state.databaseId,recoveryId:state.recoveryId,sourceId:'paddock-review',action,payload}};
  try{const r=await retries.run(pendingCommand.command,(value,operationId)=>bridge.request({command:{...value,operationId}}));pendingCommand=null;return r.result;}
  catch(e){if(e.code&&e.code!=='WRITE_UNCERTAIN')pendingCommand=null;throw e;}
 }
 function frame(title,body,footer=''){
  dialog.innerHTML=`<div class="dialog-head"><div><span class="muted">CAR MERGES</span><h2>${E(title)}</h2></div>${B('Close','close')}</div><div class="dialog-body"><p data-merge-message role="status" aria-live="polite"></p>${body}</div><div class="dialog-footer">${footer}</div>`;
 }
 function pager(data){return `<div class="merge-pager"><span>${data.total?data.offset+1:0}–${Math.min(data.total,data.offset+data.limit)} of ${data.total}</span>${B('Previous','prev','',!data.offset)}${B('Next','next','',data.offset+data.limit>=data.total)}</div>`;}
 async function hub(tab='pending',offset=0){
  state.view='hub';state.tab=tab;state.offset=offset;state.draft=null;state.dirty=false;
  const action=tab==='archives'?'archives':tab==='late'?'late':'list',data=await query(action,{offset,completed:tab==='completed'});state.recoveryId=data.recoveryId;
  const nav=`<div class="tabs">${[['pending','Pending reviews'],['completed','Reviewed merges'],['archives','Merge archives'],['late','Late history']].map(([key,label])=>B(label,'hub',key)).join('')}</div>`;
  const cards=data.rows.map(r=>tab==='archives'?`<article class="panel"><h3>${E(r.retiredName)} → ${E(r.mainName)}</h3><p>Original information preserved · ${E(r.date)}</p>${B('Retired car archive','archive',r.archives.retired)} ${B('Main car before merge','archive',r.archives.main)}</article>`:tab==='late'?`<article class="panel"><h3>${E(r.retiredName)} → ${E(r.mainName)}</h3><strong>${E(r.label)}</strong><p>${E(r.detail)}</p><p>${E(r.status)} · Only approved inclusion contributes to the main car.</p>${r.status==='pending'?B('Review inclusion','late',r.id):''}</article>`:`<article class="panel"><span class="badge">${E(r.status)}</span><h3>${E(r.retiredName)} → ${E(r.mainName)}</h3><p>Keep ${E(r.mainName)} as the main car · Revision ${r.revision}</p>${r.status==='pending'?B('Continue review','inspect',r.id):r.archives?B('View preserved original','archive',r.archives.retired):'<p>The cars were not merged.</p>'}</article>`).join('');
  state.lateRows=tab==='late'?data.rows:[];
  frame('Merge reviews',nav+'<p>Only merge duplicate records for the same physical car. Rebuilds belong in Workshop. Nothing changes on the cars until approval.</p><div class="merge-cards">'+(cards||'<p>No items here.</p>')+'</div>'+pager(data),B('New merge review','new'));
 }
 async function chooser(mainCarId,offset=0,search=''){
  state.view='choose';state.offset=offset;state.search=search;
  if(mainCarId)state.mainCarId=mainCarId;
  const data=await query('candidates',{offset,search,main:!state.mainCarId});state.recoveryId=data.recoveryId;
  frame(state.mainCarId?'Choose the duplicate to retire':'Choose the main car to keep',`<p>${state.mainCarId?'The main car keeps its identity. The duplicate will be preserved in an archive only after you approve.':'The selected main car will remain in the collection. You will choose the duplicate next.'}</p><form data-merge-search><label>Find a car <input name="search" value="${E(search)}"></label><button class="btn" type="submit">Search</button></form><div class="merge-cards">${data.rows.filter(c=>c.id!==state.mainCarId).map(c=>`<article class="panel"><h3>${E(c.name)}</h3><p>${E(c.detail)} · ${E(c.id)}</p>${B(state.mainCarId?'Create pending review':'Keep as main car',state.mainCarId?'create':'main',c.id)}</article>`).join('')}</div>${pager(data)}`,B('Back to reviews','hub','pending')+(state.mainCarId?B('Choose a different main car','new'):''));
 }
 async function inspect(id){
  const detail=await query('inspect',{id});state.recoveryId=detail.recoveryId;state.detail=detail;state.draft=structuredClone(detail.choices);state.dirty=false;state.view='editor';state.group='fields';state.offset=0;
  await editor();
 }
 function row(r){const d=state.draft,g=state.group;
  if(g==='settings')return `<article class="panel"><h4>${E(r.label)}</h4><p>Timing installation: ${E(r.sourceId)}</p><p>Main: ${E(r.mainText)}</p><label>Selected value ${select('settings',r.key,choice('keep','Keep main: '+r.mainText,d.settings[r.key])+r.candidates.filter(v=>v.valid).map(v=>choice(v.key,v.label+' — '+v.text,d.settings[r.key])).join(''))}</label><p class="muted">Original values stay preserved. Missing incoming fields cannot clear the main value.</p></article>`;
  if(g==='fields')return `<tr class="${r.different?'merge-different':''}"><th scope="row">${E(r.label)}</th><td class="merge-value">${E(r.main)}</td><td class="merge-value">${E(r.incoming)}</td><td><label class="merge-check"><input type="checkbox" data-choice="fields" data-key="${E(r.key)}" aria-label="${E(r.label)}: use incoming value" ${d.fields[r.key]==='take'?'checked':''}>Use incoming</label></td></tr>`;
  if(g==='stock'){
   const current=r.kind==='assembly'?d.assemblies[r.key]:d.installations[r.key].action,opts=[r.main?['retain','Keep fitted to main']:['transfer','Transfer to main'],['return','Return to stock']];if(r.kind==='installation'&&!r.main&&r.matches.length)opts.push(['same','Same physical part (correct duplicate stock)']);
   return `<article class="panel"><h4>${E(r.label)}</h4><p>${E(r.detail)}</p>${select(r.kind,r.key,opts.map(([v,l])=>choice(v,l,current)).join(''))}${r.kind==='installation'&&current==='same'?select('match',r.key,r.matches.map(j=>choice(j.id,j.name,d.installations[r.key].with)).join('')):''}</article>`;
  }
  const checked=g==='photos'?d.photos[r.key]:g==='history'?d.history[r.key]:d.records[g][r.key];
  return `<article class="panel">${check(g,r.key,checked,r.label)}${r.active?'<p class="note info">Active job: transfer it, or cancel it in Workshop before refreshing this review.</p>':''}${r.detail?`<details><summary>Details</summary><pre>${E(r.detail)}</pre></details>`:''}${r.asset?B('View photo','photo',r.key):r.document?B('Open document','document',r.key):g==='history'?B('Inspect source evidence','evidence',r.key):''}</article>`;
 }
 function sectionChoices(){const d=state.draft,g=state.group;return ['fields','photos','history'].includes(g)?d[g]:d.records[g];}
 function selectionCount(){const values=Object.values(sectionChoices()||{});return values.filter(v=>v===true||v==='take').length+' of '+values.length+' selected in this section';}
 function updateSelectionCount(){const el=dialog.querySelector('[data-merge-count]');if(el)el.textContent=selectionCount();}
 async function editor(){
  const p=state.detail,g=state.group,data=await query('rows',{id:p.id,revision:p.revision,group:g,offset:state.offset});
  const choices=state.draft,nav=`<div class="merge-tabs">${p.groups.map(s=>B(`${E(titles[s.key])} (${s.count})`,'group',s.key).replace('data-merge=',`aria-pressed="${s.key===g}" data-merge=`)).join('')}</div>`;
  const service=`<details><summary>Service counter baselines</summary><div class="merge-summary"><div><h4>Current main car</h4><pre>${E(JSON.stringify(p.serviceDetails.main,null,2))}</pre></div><div><h4>Incoming duplicate</h4><pre>${E(JSON.stringify(p.serviceDetails.incoming,null,2))}</pre></div></div></details><label>Service counters ${select('service','Service baseline',choice('keep','Keep main car baseline',choices.service)+(p.incomingService?choice('take','Use duplicate baseline',choices.service):''))}</label>`;
  const cover=g==='photos'?`<label>Main photo ${select('cover','Main photo',choice('keep','Keep current main photo',choices.cover)+Object.keys(choices.photos).filter(k=>choices.photos[k]).map(k=>choice(k,k==='picture'?'Incoming cover':k,choices.cover)).join(''))}</label><p>Unticked incoming photos stay in the retired archive. Existing main-car photos remain.</p>`:'';
  frame(`${p.retiredName} → ${p.mainName}`,`<div class="merge-summary"><div><span class="badge">Pending · revision ${p.revision}</span><p><strong>Main car: ${E(p.mainName)}</strong><br>Retire duplicate: ${E(p.retiredName)}</p></div><p>Originals are preserved. Unticked information is excluded from the main car, not deleted.</p></div>${p.needsRefresh?'<p class="note warning">Related data or the recovery generation changed. Refresh before continuing.</p>':''}${p.blocker?`<p class="note warning">${E(p.blocker.message)}</p>`:''}${nav}<h3>${E(titles[g])}</h3>${cover}${sectionChoices()?'<div class="actions review-selection-bar">'+B('Select all in section','select-all')+B('Clear section selection','select-none')+'<span class="tiny muted" data-merge-count role="status" aria-live="polite">'+selectionCount()+'</span></div>':''}${g==='fields'?'<div class="table-wrap"><table><thead><tr><th>Field</th><th>Current main</th><th>Incoming duplicate</th><th>Choice</th></tr></thead><tbody>'+data.rows.map(row).join('')+'</tbody></table></div>':'<div class="merge-cards">'+data.rows.map(row).join('')+'</div>'}${!data.total?'<p>No incoming items in this section.</p>':''}${pager(data)}${g==='stock'?'<p>Return creates available stock. “Same physical part” removes a duplicate count and does not create a spare. Assemblies are handled as a whole.</p>':''}${g==='history'?'<p>Selected sessions retain their original car and configuration evidence. Unticked sessions do not contribute to the main car, but remain in overall Timing records, wins and mileage. Later old-car history requires its own inclusion review.</p>':''}${service}`,B('Back to reviews','back')+B('Refresh comparison','refresh')+B('Reject merge','reject')+B('Save selections','save','',p.needsRefresh)+B('Review approval…','confirm','',p.needsRefresh));
  announce(state.dirty?'Unsaved selections — save before leaving.':'Saved selections. You can close this window and return later.');
 }
 async function save(){const p=state.detail;await command('save',{id:p.id,expectedRevision:p.revision,choices:state.draft});state.detail=await query('inspect',{id:p.id});state.draft=structuredClone(state.detail.choices);state.dirty=false;}
 async function archiveView(id,path=[],offset=0){
  const data=await query('archive',{id,path,offset});state.view='archive';state.archiveId=id;state.path=path;state.offset=offset;
  const control=(r,i)=>r.branch?B('Inspect','node',String(i)):r.asset?B('Open attachment','archive-asset',String(i)):'';
  const contents=path.length?`<div class="table-wrap"><table><thead><tr><th>Detail</th><th>Preserved information</th><th>View</th></tr></thead><tbody>${data.rows.map((r,i)=>`<tr><th>${E(archiveLabel(r.label||r.key||'Value'))}</th><td class="merge-value">${E(r.value)}</td><td>${control(r,i)}</td></tr>`).join('')}</tbody></table></div>`:`<div class="merge-archive-grid">${data.rows.map((r,i)=>`<article class="panel"><h4>${E(archiveLabel(r.key))}</h4><p>${E(r.value)}</p>${control(r,i)}</article>`).join('')}</div>`;
  frame(data.carName+' · preserved original',`<p class="note info">Read-only ${data.side==='retired'?'retired duplicate':'main-car pre-merge'} snapshot · ${E(data.created)}. Includes information excluded from the merge.</p><p>Linked main car: <strong>${E(data.mainName)}</strong> ${B('Open main car','car',data.mainCarId)}</p><p>${E(['Archive',...path.map(archiveLabel)].join(' / '))}</p>${path.length?B('Up one level','up'):''}${contents}${pager(data)}`,B('Back to archives','hub','archives'));state.archiveRows=data.rows;
 }
 async function media(action,key){
  const v=await query(action,action!=='archiveAsset'?{id:state.detail.id,key}:{id:state.archiveId,path:[...state.path,state.archiveRows[Number(key)].key]});
  // A separate viewer leaves the unsaved review intact. No remote URLs or SVG.
  const viewer=document.createElement('dialog');viewer.className='merge-media';viewer.innerHTML=`<button class="btn" type="button">Close preview</button>${v.mime.startsWith('image/')?`<img alt="Preserved car attachment" src="${E(v.data)}">`:`<p>Preserved document</p><a class="btn" download="${E(v.name)}" href="${E(v.data)}">Save document to open</a>`}`;document.body.append(viewer);viewer.querySelector('button').onclick=()=>viewer.close();viewer.addEventListener('close',()=>viewer.remove(),{once:true});viewer.showModal();
 }
 async function evidenceView(path=[],offset=0){
  const data=await query('evidence',{...state.evidence,path,offset});state.view='evidence';state.path=path;state.offset=offset;state.evidenceRows=data.rows;
  frame(data.title+' · source evidence',`<p class="note info">Read-only source record. Unknown values stay unknown; inspecting evidence does not approve or alter it.</p><p>${E(['Evidence',...path].join(' / '))}</p>${path.length?B('Up one level','evidence-up'):''}<div class="merge-cards">${data.rows.map((r,i)=>`<article class="panel"><h4>${E(r.label||r.key||'Value')}</h4><p class="merge-value">${E(r.value)}</p>${r.branch?B('Inspect','evidence-node',String(i)):''}</article>`).join('')}</div>${pager(data)}`,B('Back to review','evidence-back'));
 }
 function dirtyLeave(next){if(!state.dirty){return next();}state.afterLeave=next;frame('Save your selections first','<p>This review is still pending. Save your choices to return to them later, or discard only the unsaved changes.</p>',B('Keep editing','resume')+B('Discard unsaved changes','discard')+B('Save and continue','save-leave'));}
 async function action(a,key){
  if(a==='close')return dirtyLeave(()=>dialog.close());
  if(a==='evidence'){state.editorGroup=state.group;state.editorOffset=state.offset;state.evidence={id:state.detail.id,key};return evidenceView();}
  if(a==='late-evidence'){state.evidence={id:state.inclusion.id,late:true};return evidenceView();}
  if(a==='evidence-node')return evidenceView([...state.path,state.evidenceRows[Number(key)].key]);
  if(a==='evidence-up')return evidenceView(state.path.slice(0,-1));
  if(a==='evidence-back'){if(state.evidence.late)return action('late',state.inclusion.id);state.view='editor';state.group=state.editorGroup;state.offset=state.editorOffset;return editor();}
  if(a==='resume')return editor();
  if(a==='discard'){state.dirty=false;return state.afterLeave();}
  if(a==='save-leave'){await save();return state.afterLeave();}
  if(a==='back')return dirtyLeave(()=>hub());
  if(a==='hub')return hub(key);
  if(a==='new'){state.mainCarId=null;return chooser();}
  if(a==='main')return chooser(key);
  if(a==='create'){const p=await command('create',{mainCarId:state.mainCarId,retiredCarId:key});return inspect(p.id);}
  if(a==='inspect')return inspect(key);
  if(a==='select-all'||a==='select-none'){
   const choices=sectionChoices();if(!choices)return;const on=a==='select-all';
   for(const key of Object.keys(choices))choices[key]=state.group==='fields'?(on?'take':'keep'):on;
   if(state.group==='photos'&&!on)state.draft.cover='keep';
   state.dirty=true;return editor();
  }
  if(a==='group'){state.group=key;state.offset=0;return editor();}
  if(a==='prev'||a==='next'){state.offset=Math.max(0,state.offset+(a==='next'?30:-30));if(state.view==='editor')return editor();if(state.view==='choose')return chooser(state.mainCarId,state.offset,state.search);if(state.view==='archive')return archiveView(state.archiveId,state.path,state.offset);if(state.view==='evidence')return evidenceView(state.path,state.offset);return hub(state.tab,state.offset);}
  if(a==='save'){await save();await editor();return announce('Selections saved. The merge is still pending.');}
  if(a==='refresh')return dirtyLeave(async()=>{const p=state.detail;await command('refresh',{id:p.id,expectedRevision:p.revision});await inspect(p.id);});
  if(a==='reject'){frame('Reject this merge?',`<p>${E(state.detail.retiredName)} and ${E(state.detail.mainName)} will remain separate. The review decision is retained.</p>`,B('Keep reviewing','resume')+B('Reject merge','reject-confirm'));return;}
  if(a==='reject-confirm'){const p=state.detail;await command('reject',{id:p.id,expectedRevision:p.revision});return hub();}
  if(a==='confirm'){
   if(state.dirty)await save();const p=state.detail=await query('inspect',{id:state.detail.id});if(p.blocker){await editor();return;}
   frame('Approve this merge?',`<p>Keep <strong>${E(p.mainName)}</strong> as the main car and retire <strong>${E(p.retiredName)}</strong>.</p><p>Only your saved selections will be included. A verified recovery backup and immutable snapshots of both originals will be created before the change is committed.</p><p>Late-arriving old-car racing history will await a separate review.</p>`,B('Keep reviewing','resume')+B('Approve merge','approve'));return;
  }
  if(a==='approve'){const p=state.detail,r=await command('approve',{id:p.id,expectedRevision:p.revision});state.dirty=false;return archiveView(r.archives.retired);}
  if(a==='archive')return archiveView(key);
  if(a==='node')return archiveView(state.archiveId,[...state.path,state.archiveRows[Number(key)].key]);
  if(a==='up')return archiveView(state.archiveId,state.path.slice(0,-1));
  if(['archive-asset','photo','document'].includes(a))return media(a==='archive-asset'?'archiveAsset':a,key);
  if(a==='car'){dialog.close();return bridge.onCar(key);}
  if(a==='late'){const r=state.lateRows.find(r=>r.id===key);state.inclusion=r;frame('Review late old-car history',`<h3>${E(r.retiredName)} → ${E(r.mainName)}</h3><p>${E(r.label)}</p><p>${E(r.detail)}</p><p>This evidence arrived after the merge. Include its contribution in the main car, or keep it excluded. The original evidence remains stored either way.</p>${r.canInclude===false?'<p class="note warning">This session was withdrawn or the original participant is no longer present. Keep it excluded to close this review.</p>':''}`,B('Inspect source evidence','late-evidence')+B('Decide later','hub','late')+B('Keep excluded','exclude')+B('Include history','include','',r.canInclude===false));return;}
  if(a==='include'||a==='exclude'){const r=state.inclusion;await command('includeHistory',{id:r.id,expectedRevision:r.revision,include:a==='include'});return hub('late');}
 }
 async function run(fn){if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');dialog.inert=true;try{await fn();}catch(e){announce(e.message,true);}finally{busy=false;dialog.inert=false;dialog.removeAttribute('aria-busy');if(dialog.open&&!dialog.contains(document.activeElement))dialog.querySelector('button:not(:disabled)')?.focus();}}
 function changed(el){if(busy){el.blur();return;}const k=el.dataset.key,t=el.dataset.choice,d=state.draft;if(!d)return;
  if(t==='fields')d.fields[k]=el.checked?'take':'keep';
  else if(t==='settings')d.settings[k]=el.value;
  else if(t==='photos'||t==='history'){d[t][k]=el.checked;if(t==='photos'&&!el.checked&&d.cover===k)d.cover='keep';}
  else if(t==='service'||t==='cover')d[t]=el.value;
  else if(t==='assembly')d.assemblies[k]=el.value;
  else if(t==='installation')d.installations[k]={action:el.value};
  else if(t==='match')d.installations[k].with=el.value;
  else if(Object.hasOwn(d.records,t))d.records[t][k]=el.checked;
  state.dirty=true;updateSelectionCount();announce('Unsaved selections — save before leaving.');
  if(t==='installation'&&el.value==='same')void run(async()=>{const r=await query('rows',{id:state.detail.id,revision:state.detail.revision,group:'stock',offset:state.offset});d.installations[k].with=r.rows.find(r=>r.key===k).matches[0].id;await editor();});
  else if(t==='installation'||t==='photos')void run(editor);
 }
 async function open(options){
  if(dialog?.open)return;
  bridge=options;state={databaseId:options.databaseId,mainCarId:options.mainCarId};pendingCommand=null;
  retries??=SaveRetry.create({storage:localStorage,crypto});
  if(!dialog){dialog=document.createElement('dialog');dialog.className='merge-dialog';dialog.setAttribute('aria-label','Merge review');document.body.append(dialog);
   dialog.addEventListener('click',e=>{const b=e.target.closest('[data-merge]');if(b&&!b.disabled)void run(()=>action(b.dataset.merge,b.dataset.key));});
   dialog.addEventListener('change',e=>{if(e.target.matches('[data-choice]'))changed(e.target);});
   dialog.addEventListener('submit',e=>{if(e.target.matches('[data-merge-search]')){e.preventDefault();void run(()=>chooser(state.mainCarId,0,new FormData(e.target).get('search')));}});
   dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)void run(()=>action('close'));});
  }
  dialog.showModal();frame('Loading review…','<p>Reading the saved review.</p>');await run(()=>options.mainCarId?chooser(options.mainCarId):hub());
 }
 return {open};
})();
