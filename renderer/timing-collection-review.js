'use strict';
function timingCollectionNotice(){const total=db._view?.timingCollection?.total||0;return local()&&total?`<section class="note info"><strong>Existing Timing collection · ${total} items await review</strong><p>Approve the cars first. Timing then brings across their older racing history here, keeping the original records safe.</p>${btn('Review Timing collection','timing-collection-open','primary')}</section>`:'';}
function renderTimingCollection(){
 const info=db._view?.timingCollection,rows=info?.rows||[];
 if(clubState?.active)return empty('Review on the library computer','Open this collection on the original Paddock computer.');
 if(!rows.length)return empty('No Timing collection items awaiting approval','Start “Use existing Timing collection” in Timing. After approving cars here, keep both apps open while Timing prepares their old sessions. Progress and any blocked items are shown in Timing.');
 const sources=[...new Set(rows.map(r=>r.sourceId))];
 return `<div data-timing-collection="${esc(info.databaseId)}"><p class="note info"><strong>1. Bring across cars → 2. Bring across their racing history</strong><br>Timing keeps its original IDs and history. Explicit links connect to existing Paddock cars without overwriting their details. Old sessions keep unknown configurations and cannot create personal or track records.</p>${info.total>rows.length?'<p class="note warning">Showing the first 1,000 pending items. Further items appear after this selection is processed.</p>':''}<div class="actions">${btn('Select all displayed','timing-collection-select')}${btn('Clear selection','timing-collection-clear')}${btn('Approve selected…','timing-collection-approve','primary')}${btn('Reject selected…','timing-collection-reject')}</div>`+sources.map(source=>panel('Timing collection',`<p class="tiny muted">Timing installation: ${esc(source)}</p>${rows.map((r,i)=>r.sourceId===source?`<div class="list-row"><label><input type="checkbox" data-collection-key="${esc(JSON.stringify([r.kind,r.id,r.carId,r.requestHash]))}" data-collection-item="${i}" ${r.recoveryChanged||r.kind==='history'&&!info.approvalEnabled?'disabled':''}> <strong>${esc(r.name)}</strong> ${badge(r.kind==='car'?r.action==='link'?'Link existing car':'Add car':'Historical session',r.kind==='car'?'info':'')}</label><div>${r.kind==='history'?`<span class="muted">${esc(r.track||'Unknown track')} · ${r.laps} laps</span>`:''} ${btn('Inspect','timing-collection-inspect','small',String(i))}</div>${r.recoveryChanged?'<p class="note warning">This item predates a library restore. Reconcile it in Timing.</p>':''}</div>`:'').join('')}`)).join('');
}
async function timingCollectionAction(action,id){
 if(!action.startsWith('timing-collection-'))return false;
 if(action==='timing-collection-open'){openReview('Timing collection');return true;}
 if(action==='timing-collection-select'||action==='timing-collection-clear'){document.querySelectorAll('[data-collection-item]:not(:disabled)').forEach(e=>e.checked=action.endsWith('select'));return true;}
 const info=db._view?.timingCollection;if(!info?.rows)return true;
 const base={databaseId:info.databaseId,recoveryId:info.recoveryId};
 if(action==='timing-collection-inspect'){
  const row=info.rows[Number(id)];if(!row)return true;
  if(row.kind==='history'){const payload={...base,id:row.id,requestHash:row.requestHash},result=await api('historyImport',{...payload,action:'inspect'});if(db.id===base.databaseId)showHistoricalEvidence(result,payload,result);}
  else {const result=await api('timingCollectionReview',{...base,...row,action:'inspect'});if(db.id!==base.databaseId)return true;modal(row.name,`<p class="note info">${result.action==='link'?'This explicit link preserves every existing Paddock field.':'These details will create a new Paddock car.'}</p>${dl(Object.entries(result.fields).map(([k,v])=>[columnLabel(k),typeof v==='object'?JSON.stringify(v):String(v)]))}${result.hasPicture?'<p>Includes the original transferred picture.</p>':''}`,null,'Close');}return true;
 }
 if(!['timing-collection-approve','timing-collection-reject'].includes(action))return true;
 // Freeze exactly the displayed selection, never include arrivals during approval.
 const items=[...document.querySelectorAll('[data-collection-item]:checked:not(:disabled)')].map(e=>info.rows[Number(e.dataset.collectionItem)]).filter(Boolean).map(({kind,id,sourceId,requestHash,carId,itemId})=>({kind,id,sourceId,requestHash,carId,itemId}));
 if(!items.length){toast('Select the cars or sessions you want to review.');return true;}
 const decision=action.endsWith('approve')?'approve':'reject',request={...base,items,action:decision,note:'Reviewed in Timing collection'},context=dataPath;
 let done=0;
 modal(`${decision==='approve'?'Approve':'Reject'} ${items.length} selected items?`,`<p>${decision==='approve'?'The selected cars and historical sessions will enter this library.':'Only the selected pending items will be rejected. Already approved cars and results stay unchanged.'}</p><p>Your original Timing data is preserved. Each item is saved separately; interrupted work can be resumed.</p><p id="timing-collection-progress" role="status"></p>`,async()=>{
  if(db.id!==base.databaseId||dataPath!==context)throw Error('The library changed. Reopen Review.');
  while(done<items.length){
   const result=await api('timingCollectionReview',{...request,items:items.slice(done,done+25)});
   for(const row of result.results){if(row.status==='error')throw Error(row.message);done++;}
   const status=$('#timing-collection-progress');if(status)status.textContent=`Saved ${done} of ${items.length}`;
  }
  if(db._view)db._view.request=null;
 },decision==='approve'?'Approve selection':'Reject selection');
 return true;
}
