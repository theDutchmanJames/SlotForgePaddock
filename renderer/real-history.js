const historyClassifications=['Unverified','Real Racing Car','Fantasy Livery','Tribute Livery','Road / Show Car'];
const historyFields=[['team','Racing team'],['drivers','Drivers'],['event','Event / circuit'],['year','Year'],['raceNumber','Race number'],['qualifying','Qualifying result'],['finish','Finishing result (including DNF / DNS)'],['history','History of the represented entry']];
function liveryClassification(value){
  const styles={
    'Unverified':['unverified','history','Ready for research','The original car or livery has not been classified yet.'],
    'Real Racing Car':['racing','flag','Race-inspired history','Recorded as representing a real racing car and livery.'],
    'Fantasy Livery':['fantasy','palette','Creative by design','Recorded as an imagined racing colour scheme.'],
    'Tribute Livery':['tribute','bookmark','A nod to racing history','Recorded as a tribute to another car, team or era.'],
    'Road / Show Car':['road','car','Beyond the race circuit','Recorded as a road car or show-car appearance.']
  },name=Object.hasOwn(styles,value)?value:'Unverified',[tone,symbol,kicker,description]=styles[name];
  return `<section class="livery-classification livery-${tone}"><span class="livery-emblem">${icon(symbol)}</span><div><div class="label">Livery classification · ${esc(kicker)}</div><h3>${esc(name)}</h3><p>${esc(description)}</p><small>Collector classification · not independently verified</small></div></section>`;
}
function historySourceButton(url,label){return url?`<button type="button" class="btn ghost small" data-action="history-source" data-url="${esc(url)}">${esc(label||url)} ${icon('next')}</button>`:'';}
function renderRealHistorySummary(c){
  const h=c.realHistory||{},hasEntry=historyFields.some(([key])=>String(h[key]??'').trim()),classification=historyClassifications.includes(h.classification)?h.classification:'Unverified';
  const tones={'Real Racing Car':['racing','flag'],'Fantasy Livery':['fantasy','palette'],'Tribute Livery':['tribute','bookmark'],'Road / Show Car':['road','car'],'Unverified':['unverified','history']},[tone,symbol]=tones[classification];
  const classificationCard=`<div class="overview-livery livery-${tone}">${icon(symbol)}<div><strong>${esc(classification)}</strong><small>Collector classification · not independently verified</small></div></div>`;
  const entry=hasEntry?`<div class="overview-racing-entry">${String(h.raceNumber??'').trim()?`<span class="overview-race-number" aria-label="Race number ${esc(h.raceNumber)}">${esc(h.raceNumber)}</span>`:''}<div><div class="label">The car behind the model</div><h3>${esc(h.team||'Racing team not recorded')}</h3><p class="muted">${esc(h.event||'Event not recorded')}</p></div></div><dl class="overview-racing-facts">${[['Year',h.year],['Qualifying',h.qualifying],['Finish',h.finish]].map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(String(value??'').trim()||'Not recorded')}</dd></div>`).join('')}</dl><div class="overview-racing-drivers"><span class="tiny muted">Drivers</span><p>${esc(h.drivers||'Not recorded')}</p></div>`:`<div class="overview-history-empty">${icon('history')}<h3>The story starts here</h3><p class="muted">Add the team, drivers and race represented by this slotcar.</p></div>`;
  return `<section class="panel section-panel overview-racing-history"><div class="panel-heading"><h2>${icon('flag')}Real Racing History</h2></div><div class="panel-content">${entry}${hasEntry||classification!=='Unverified'?classificationCard:''}<div class="actions">${btn((hasEntry||classification!=='Unverified'?'View full history':local()?'Add real car history':'View history')+' '+icon('next'),'section','small ghost','Real Car History')}</div></div></section>`;
}
function renderRealHistory(c){
  const h=c.realHistory||{},photos=h.photos||[];
  return `<div class="page-head"><div><h2>Real Car History</h2><p class="muted">The full-size car and livery represented by this model.</p></div>${local()?btn('Edit history','history-edit','primary',c.id):''}</div>`+
    liveryClassification(h.classification)+
    (local()?historyResearchTools(c):'')+
    `<div class="two-col mt">${panel('Represented racing entry',dl(historyFields.filter(([key])=>key!=='history').map(([key,label])=>[label,h[key]])))}${panel('Research notes',`<p class="prewrap">${esc(h.history||'Add the story of the original car, or leave this section empty.')}</p>`)}</div>`+
    `<div class="mt">${panel('Sources',h.sources?.length?`<ul class="history-sources">${h.sources.map(s=>`<li>${historySourceButton(s.url,s.title||s.url)}${s.title?`<div class="tiny muted">${esc(s.url)}</div>`:''}</li>`).join('')}</ul>`:'<p class="muted">No sources recorded. Add event results, manufacturer references or historical photographs as evidence.</p>')}</div>`+
    (h.evidence?.length?`<details class="mt"><summary>Imported research · sources and uncertainty</summary>${h.evidence.map(e=>`<div class="research-proposal"><strong>${esc(HistoryResearch.labels[e.field])}</strong> ${badge(e.method==='webpage'?'Webpage extraction':'External research file','info')}<p class="prewrap">${esc(e.uncertainty||'No uncertainty supplied; not automatically verified.')}</p>${e.sourceUrls.length?e.sourceUrls.map(url=>historySourceButton(url,url)).join(''):'<p class="tiny muted">No source supplied.</p>'}</div>`).join('')}</details>`:'')+
    `<div class="mt">${panel('Full-size car photographs',`<div class="actions">${local()?btn('Add reference photograph','history-photo','',c.id):''}</div>${photos.length?`<div class="history-photo-grid mt">${photos.map(p=>`<figure><img src="${esc(p.data)}" alt="${esc(p.caption||p.name)}"><figcaption><strong>${esc(p.name)}</strong><p class="prewrap">${esc(p.caption)}</p>${historySourceButton(p.sourceUrl,'Photograph source')}${local()?btn('Remove','history-photo-remove','small ghost',p.id):''}</figcaption></figure>`).join('')}</div>`:'<p class="muted mt">Keep reference photographs separate from pictures of your slotcar. Add a source or credit when available.</p>'}`)}</div>`;
}
function historySourceRow(source={title:'',url:''}){return `<div class="history-source-editor"><label class="field">Source title<input data-history-title value="${esc(source.title)}" maxlength="200"></label><label class="field">Source URL<input data-history-url type="url" value="${esc(source.url)}" maxlength="2000" placeholder="https://…"></label>${btn('Remove','history-source-remove','small ghost')}</div>`;}
function editRealHistory(id){
  const ctx=researchContext(id),c=db.cars.find(c=>c.id===id),h=ctx.history,revision=ctx.revision;
  modal('Real Car History · '+c.name,`<p class="muted">Optional research about the original car. This does not change the model’s identity fields or race results.</p><div class="form-grid">${field('classification','Livery classification',h.classification,'select',historyClassifications)}${historyFields.map(([key,label])=>field(key,label,h[key]||'',key==='history'?'textarea':'text')).join('')}</div><h3 class="mt">Sources</h3><div id="history-source-editor">${(h.sources?.length?h.sources:[{title:'',url:''}]).map(historySourceRow).join('')}</div>${btn('Add source','history-source-add','small')}<p class="tiny muted mt">History text and sources travel with a Paddock car export. Reference photos are included only when exporting additional photos.</p>`,async values=>{
    const sources=[...document.querySelectorAll('.history-source-editor')].map(row=>({title:row.querySelector('[data-history-title]').value.trim(),url:row.querySelector('[data-history-url]').value.trim()})).filter(s=>s.title||s.url);
    checkResearchContext(ctx);
    const evidence=HistoryResearch.editedEvidence(h,values,sources);
    await change('car.save',{id,revision,data:{realHistory:{...h,...values,sources,evidence}}});
  });
}
async function historyAction(action,id,target){
  if(!action.startsWith('history-'))return false;
  if(await historyResearchAction(action,id))return true;
  if(action==='history-source'){await api('file','history.source',{url:target.dataset.url});return true;}
  if(!local())throw Error('Switch to your local collection to edit its history.');
  if(action==='history-edit'){editRealHistory(id);return true;}
  if(action==='history-source-add'){const list=$('#history-source-editor');if(list.children.length>=20)throw Error('Maximum 20 sources.');list.insertAdjacentHTML('beforeend',historySourceRow());list.lastElementChild.querySelector('input').focus();return true;}
  if(action==='history-source-remove'){target.closest('.history-source-editor').remove();return true;}
  if(action==='history-photo'){
    const ctx=researchContext(id),c=db.cars.find(c=>c.id===id),h={...ctx.history,photos:structuredClone(c.realHistory?.photos||[])},revision=ctx.revision;
    h.photos??=[];if(h.photos.length>=8)throw Error('Maximum eight reference photographs.');
    const picked=await api('file','image');if(!picked)return true;checkResearchContext(ctx);
    simpleForm('Reference photograph',field('name','Photograph title',picked.name)+field('caption','Caption / credit','','textarea')+field('sourceUrl','Source URL (optional)','','url'),async values=>{checkResearchContext(ctx);const photos=[...h.photos,{id:crypto.randomUUID(),data:picked.data,...values}];await change('car.save',{id,revision,data:{realHistory:{...h,photos}}});});return true;
  }
  if(action==='history-photo-remove'){
    const c=car(),ctx=researchContext(c.id),h=structuredClone(c.realHistory),revision=c.revision,p=h.photos.find(p=>p.id===id);
    modal('Remove reference photograph',`<p>Remove ${esc(p.name)} from Real Car History?</p>`,async()=>{checkResearchContext(ctx);await change('car.save',{id:c.id,revision,data:{realHistory:{...h,photos:h.photos.filter(p=>p.id!==id)}}});},'Remove photograph');return true;
  }
  return false;
}
