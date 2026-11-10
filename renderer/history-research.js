function historyResearchTools(c){return `<div class="history-research-tools mt">${panel('Research this car',`<p class="muted">Read a webpage, or give a research template to your own AI. Review proposed values before saving.</p><div class="actions">${btn('Read webpage…','history-web','',c.id)}${btn('Download research template','history-kit','',c.id)}${btn('Import research JSON…','history-pick','',c.id)}</div><p class="tiny muted mt">The template contains this car’s identity, English instructions and empty research fields. Paddock has no built-in AI and does not send it anywhere.</p>`)}</div>`;}
function researchContext(id){const c=db.cars.find(c=>c.id===id);if(!c)throw Error('Car not found.');return {databaseId:db.id,carId:id,revision:c.revision,path:dataPath,history:HistoryResearch.textHistory(c.realHistory||{classification:'Unverified',sources:[]})};}
function checkResearchContext(ctx){if(!ctx||!local()||db.id!==ctx.databaseId||dataPath!==ctx.path||db.cars.find(c=>c.id===ctx.carId)?.revision!==ctx.revision)throw Error('The car or collection changed. Reopen its research tools.');}
function reviewHistoryResearch(ctx,result){
  checkResearchContext(ctx);
  modal('Review car research',`<p>Choose the fields to import. Selected values replace those fields; unselected values and photographs stay as they are.</p><p class="tiny muted">Source links and uncertainty are retained. Neither AI output nor extracted webpage text is automatically verified. Choose only one value per field.</p><p class="tiny muted">Select all skips fields with competing suggestions; choose those individually.</p><div data-review-selection>${ReviewSelection.toolbar()}<div class="research-proposals">${result.proposals.map((p,i)=>`<article class="research-proposal"><label class="check"><input type="checkbox" data-review-choice data-review-alternative="${esc(p.field)}" name="research-${i}"> <strong>${esc(HistoryResearch.labels[p.field])}</strong></label><div class="research-values"><div><span class="tiny muted">Saved value</span><p class="prewrap">${esc(ctx.history[p.field]||'—')}</p></div><div><span class="tiny muted">Proposed value</span><p class="prewrap">${esc(p.value)}</p></div></div><p class="tiny muted prewrap">${esc(p.uncertainty||'No uncertainty supplied. Check the evidence before accepting.')}</p>${p.sourceUrls.length?p.sourceUrls.map(url=>historySourceButton(url,result.sources.find(s=>s.url===url)?.title||url)).join(''):'<p class="tiny">No source provided.</p>'}</article>`).join('')}</div></div>`,async values=>{
    checkResearchContext(ctx);const indices=Object.keys(values).filter(k=>k.startsWith('research-')).map(k=>Number(k.slice(9)));
    const realHistory=HistoryResearch.merge(ctx.history,result,indices);
    await change('car.save',{id:ctx.carId,revision:ctx.revision,data:{realHistory}});
  },'Import selected fields');
}
let historyWebContext=null;
async function historyResearchAction(action,id){
  if(!['history-kit','history-pick','history-web','history-fetch'].includes(action))return false;
  if(!local())throw Error('Switch to your local collection to research a car.');
  if(action==='history-fetch'){
    const ctx=historyWebContext;checkResearchContext(ctx);const input=$('#history-web-url');if(!input.reportValidity())return true;
    const status=$('#history-web-status');status.textContent='Reading webpage…';
    try{const result=await api('file','history.web',{...ctx,url:input.value.trim(),history:undefined});reviewHistoryResearch(ctx,result);}catch(e){status.textContent=e.message;throw e;}return true;
  }
  const ctx=researchContext(id),request={databaseId:ctx.databaseId,carId:id,revision:ctx.revision};
  if(action==='history-kit'){if(await api('file','history.kit',request))toast('Research template saved. Give it to your own AI, then import the completed JSON.');return true;}
  if(action==='history-pick'){const result=await api('file','history.pick',request);if(result)reviewHistoryResearch(ctx,result);return true;}
  historyWebContext=ctx;
  modal('Read a research webpage',`<p>Paste a public page about this car or represented entry. Paddock reads labelled fields and page descriptions; it does not use AI or website-specific rules.</p><label class="field">Webpage URL<input id="history-web-url" type="url" required maxlength="2000" placeholder="https://…"></label>${btn('Read webpage','history-fetch','primary')}<p id="history-web-status" class="tiny muted" role="status">Images, PDFs, complex race tables and pages that require JavaScript may need the research template instead. Non-English text is not translated.</p>`,null);return true;
}
