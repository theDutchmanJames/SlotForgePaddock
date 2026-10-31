// Shared presentation for the Timing-inspired collection and workshop interface.
// Rendering uses the existing data and action handlers; no preview records live here.
const uiIcons={
  home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  showroom:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M1 6v12M23 6v12M5 15l4-4 4 4 3-2 3 3"/>',
  library:'<path d="M4 3v18M8 3v18M12 3v18M16 4l5 16M3 7h10M3 17h10"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/>',
  transfer:'<path d="M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4"/>',
  history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l4 2"/>',
  identity:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16c0-4 6-4 6 0M14 9h4M14 13h4"/>',
  setup:'<path d="M4 3v6m0 4v8M12 3v10m0 4v4M20 3v2m0 4v12M1 9h6M9 17h6M17 5h6"/>',
  photos:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 5 5 4-7 4 7"/>',
  timer:'<circle cx="12" cy="14" r="8"/><path d="M9 2h6M12 2v4m6 1 2-2M12 10v5l3 2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5c4 0 4-9-6-9z"/><circle cx="7" cy="9" r="1"/><circle cx="11" cy="6" r="1"/><circle cx="16" cy="7" r="1"/>',
  bookmark:'<path d="M5 3h14v18l-7-4-7 4z"/>',
  banner:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M7 14h10M7 17h6"/>',
  edit:'<path d="m4 16 12-12 4 4L8 20H4zM14 6l4 4"/>',
  next:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  inbox:'<path d="M3 4h18v16H3zM3 13h5l2 3h4l2-3h5"/>',
  upload:'<path d="M12 17V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  assembly:'<path d="m3 7 4-2 4 2v5l-4 2-4-2zm10 0 4-2 4 2v5l-4 2-4-2zM8 16l4-2 4 2v5l-4 2-4-2z"/>',
  gear:'<circle cx="12" cy="12" r="4"/><path d="M9 3h6v3l3 2 3-1v6l-3 1-1 3 1 3-6 1-1-3-3-1-3 1-2-6 3-1 1-3z"/>'
};
const uiPageIcons={Review:'inbox',Overview:'home',Showroom:'showroom',Cars:'car',Parts:'box',Workshop:'tool',Library:'library',Connections:'share','Import & Export':'transfer',Settings:'settings'};
const uiSectionIcons={'Overview':'grid','Identity & ownership':'identity','Technical & parts':'gear','Setups':'setup','Maintenance':'tool','Performance':'timer','Photos & documents':'photos','History':'history'};
const uiSettingsSections=[['Appearance','palette'],['Welcome banner','banner'],['Database','database'],['Custom fields','list'],['Saved views','bookmark']];
let settingsSection='Appearance';
function uiTile(name,tone='accent'){return `<span class="section-icon tone-${tone}">${icon(name)}</span>`;}
function uiPanelIcon(title){if(/work|maintenance|service|job/i.test(title))return 'tool';if(/config|gear|motor|technical|transmission|chassis|factory/i.test(title))return 'gear';if(/histor|activity|recorded/i.test(title))return 'history';if(/photo|document/i.test(title))return 'photos';if(/theme|colour/i.test(title))return 'palette';if(/welcome/i.test(title))return 'banner';if(/database|backup/i.test(title))return 'database';if(/club|connect|submi/i.test(title))return 'share';if(/stock|inventory|part|component|assembl/i.test(title))return 'box';if(/view/i.test(title))return 'bookmark';return 'list';}
function uiHeading(title,subtitle,actions){return `<div class="page-head"><div class="page-heading">${uiTile(uiPageIcons[page]||'car',['Workshop','Review'].includes(page)?'amber':page==='Connections'?'blue':'accent')}<div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div><div class="actions">${actions}</div></div>`;}
function uiPanel(title,body){return `<section class="panel section-panel"><div class="panel-heading"><h2>${icon(uiPanelIcon(title))}${esc(title)}</h2></div><div class="panel-content">${body}</div></section>`;}
function uiSectionHeading(title,action=''){return `<div class="section-heading"><h2>${esc(title)}</h2><div class="actions">${action}</div></div>`;}
function renderOverviewDesign(){
  const d=current(),cars=d.cars.filter(c=>!c.archived),jobs=local()?d.jobs.filter(j=>j.status==='active'):[],due=local()?slotforgeDomain.reminders(d.events).filter(e=>cars.some(c=>c.id===e.carId)):[];
  const stats=local()?[
    ['Cars in collection',cars.length,'car','Cars','Your collection'],
    ['Unique parts',d.parts.length,'box','Parts','Individual inventory entries'],
    ['Open jobs',jobs.length,'tool','Workshop','Work in progress'],
    ['Service reminders',due.length,'calendar','Workshop','Upcoming maintenance']
  ]:[['Cars in collection',cars.length,'car','Cars','Shared collection'],['Shared setups',d.setups.length,'setup','Cars','Saved configurations']];
  const recent=cars.slice().sort((a,b)=>String(b.updated).localeCompare(String(a.updated))).slice(0,3);
  return `<section class="welcome"><div>${bannerMarkup(d.settings)}<div class="row mt">${badge(local()?'Personal collection':'Shared collection','good')}${badge(local()?'Saved on this computer':'Read only')}</div></div>${local()?`<div class="welcome-actions">${btn(icon('plus')+(cars.length?' Add car':' Add your first car'),'add-car','primary')}${btn(icon('edit')+' Customise welcome','settings-welcome')}</div>`:''}</section>`+
    `<div class="overview-stats">${stats.map(([title,value,ic,to,help])=>`<button class="panel overview-stat" data-action="nav" data-id="${to}"><span class="stat-label">${icon(ic)}${title}</span><strong class="stat">${value}</strong><span class="tiny muted">${help}</span></button>`).join('')}</div>`+
    (local()?uiSectionHeading('On the workbench',btn('Workshop '+icon('next'),'nav','ghost small','Workshop'))+(jobs.length?jobCards(jobs.slice(0,3)):`<div class="workbench-empty">${uiTile('tool','amber')}<div><h3>Your workbench is ready</h3><p class="muted">Plan maintenance, a modification or the steps towards a saved setup.</p></div>${btn(icon('plus')+' New workshop job','new-job','primary')}</div>`):'')+
    `<div class="two-col mt">${panel('Recent activity',timeline(d.events.slice(0,4)))}${panel('Back to your collection',recent.length?recent.map(c=>`<div class="recent-car list-row"><span class="recent-car-photo">${photo(c)}</span><div class="recent-car-name"><strong>${esc(c.name)}</strong><div class="tiny muted">${esc([c.maker,c.scale].filter(Boolean).join(' · '))}</div></div>${btn('Open '+icon('next'),'open-car','ghost small',c.id)}</div>`).join('')+`<div class="actions mt">${btn(icon('showroom')+' Visit the Showroom','nav','','Showroom')}</div>`:`<p class="muted">Your recently updated cars will appear here.</p>${local()?btn('Add your first car','add-car','primary'):''}`)}</div>`;
}
function renderExchangeDesign(){
  if(!local())return empty('Use your local database','Switch to your collection to import, export or back up records.');
  if(catalogueReview?.active)return renderCatalogueReview();
  const cards=[
    ['Import cars','download','blue','Open a SlotForge Paddock package or a SlotForge Timing JSON export. Review every car before importing.','Choose a JSON file','import','primary',''],
    ['Export cars','upload','accent','Choose a Paddock package or a Timing-compatible JSON file. Export one car or a selection, with optional additional photos.','Choose cars','nav','','Cars'],
    ['Back up this database','database','green','Keep a complete copy of cars, stock, jobs, photos, history and settings. Backups also contain your private information.','Create backup','backup','',''],
    ['Restore a backup','history','amber','Replace this database from a saved backup. Review and confirm before replacing it; the previous file is kept as a recovery copy.','Choose backup','restore-backup','danger','']
  ];
  return heading('Import & Export','Move cars and manufacturer information into your collection.')+catalogueImportCard()+`<div class="two-col exchange-grid">${cards.map(([title,ic,tone,desc,label,action,cls,id])=>`<section class="panel exchange-card tone-${tone}">${uiTile(ic,tone)}<h2>${title}</h2><p class="muted">${desc}</p><div class="actions">${btn(label,action,cls,id)}</div></section>`).join('')}</div>`+
    uiSectionHeading('Review inbox',badge(pendingItems().length+' cars awaiting review',pendingItems().length?'warn':''))+
    `<div class="panel review-inbox-summary"><div>${uiTile('inbox','blue')}<div><h3>${pendingItems().length?'Incoming cars are ready to review':'Your inbox is clear'}</h3><p class="muted">New entries and updates are approved here before changing your collection.</p></div></div>${btn('Open review inbox '+icon('next'),'open-review-inbox')}</div>`+
    `<details class="panel transfer-help mt"><summary>What is included in a Timing import?</summary><p class="muted mt">SlotForge Timing version 1 JSON exports can contain one or several cars. Timing tyre information becomes rear tyres. Lap/service counters and custom values are retained as reference notes, not live statistics. Photo framing and race sessions are not imported. Previously imported Timing IDs are recognised; separately entered cars are not matched by name.</p><p class="muted">Car-sharing packages exclude private ownership, storage, prices and documents. Timing and RaceCoordinatorAI live connections remain planned for a later release.</p></details>`;
}
function renderCarOverviewDesign(c){
  const d=current(),events=d.events.filter(e=>e.carId===c.id),job=local()?d.jobs.find(j=>j.carId===c.id&&j.status==='active'):null;
  const work=job?panel('On the workbench',`<div class="row">${badge(job.kind==='general'?'General work':'Setup job','warn')}${badge('Active','good')}</div><h3 class="mt">${esc(job.name)}</h3><p class="prewrap muted">${esc(job.notes||'Work towards the saved configuration.')}</p><div class="actions">${btn('Open job '+icon('next'),'open-job','',job.id)}</div>`):panel('Maintenance',timeline(events.filter(e=>e.type==='maintenance').slice(0,2)));
  return `<div class="profile-top"><div class="stack"><section class="profile-photo-card"><div class="hero-photo">${photo(c)}</div><div class="profile-photo-footer">${c.picture?photoFitControls():''}${btn(icon('photos')+' Photos & documents','section','ghost small','Photos & documents')}</div></section>${work}</div><div class="stack">${renderOverviewPanel(c,'details')}${renderOverviewPanel(c,'configuration')}</div></div><div class="mt">${panel('Recent activity',timeline(events.slice(0,4)))}</div>`;
}
function renderSettingsDesign(){
  if(!local())return empty('Settings belong to your local database','Switch to your collection to change preferences and custom fields.');
  return heading('Settings','Make SlotForge feel like your own workshop.')+`<div class="settings-layout"><nav class="rail settings-rail" aria-label="Settings sections">${uiSettingsSections.map(([name,ic])=>`<button type="button" data-action="settings-section" data-id="${name}" class="${settingsSection===name?'active':''}" aria-current="${settingsSection===name?'page':'false'}">${icon(ic)}${name}</button>`).join('')}</nav><div class="stack settings-content">${renderSettingsSection()}</div></div>`;
}
function renderSettingsSection(){
  if(settingsSection==='Appearance')return renderAppearance('theme');
  if(settingsSection==='Welcome banner')return renderAppearance('banner');
  if(settingsSection==='Database')return panel('Local database',dl([['Database name',db.settings.name],['Version',version],['Autosave','After every change']])+`<div class="actions mt">${btn(icon('edit')+' Edit preferences','preferences','primary')}${btn(icon('database')+' Back up database','backup')}</div><h3 class="mt">Data location</h3><div class="settings-path">${esc(dataPath)}</div><p class="tiny muted mt">A previous-file recovery copy is retained alongside the database.</p>`);
  if(settingsSection==='Custom fields')return panel('Custom car fields',`<p class="muted">Add the details that matter to your collection. Custom fields are private and included in complete backups.</p>${db.customFields.map(f=>`<div class="list-row"><strong>${esc(f.label)}</strong><span class="badge">${esc(f.type)}</span></div>`).join('')||'<p class="muted">No custom fields yet.</p>'}<div class="actions mt">${btn(icon('plus')+' Add custom field','custom-add','primary')}</div>`);
  return panel('Saved views',db.views.map(v=>`<div class="list-row"><div><strong>${esc(v.name)}</strong><div class="tiny muted">${esc(v.query||'All cars')} · ${esc(v.mode)}</div></div><div class="actions">${btn('Open','open-saved-view','small',v.id)}${btn('Remove','delete-view','small danger',v.id)}</div></div>`).join('')||'<p class="muted">Save a view from Cars to remember your search, usage filters, columns and layout.</p>');
}
function libraryRail(){
  const keys=['maker','location','tech_motor','tech_rearTyres','raceClass','track','driver'],items=keys.map(k=>choiceCatalogue.choices.find(f=>f.key===k)).filter(Boolean);
  if(!items.some(f=>f.key===choiceField)){const active=choiceCatalogue.choices.find(f=>f.key===choiceField);if(active)items.push(active);}
  return `<nav class="rail library-rail" aria-label="Common reusable fields"><div class="label">Frequently used fields</div>${items.map(f=>`<button type="button" class="${choiceField===f.key?'active':''}" aria-current="${choiceField===f.key?'page':'false'}" data-action="library-section" data-id="${esc(f.key)}">${icon(f.key.startsWith('tech_')?'gear':f.key==='location'?'pin':'list')}${esc(f.key.startsWith('tech_')?columnLabel(f.key):f.label)}</button>`).join('')}</nav>`;
}
function renderSubmissionReview(){
  if(!local())return empty('Review on your local database','Switch to your own database to approve incoming submissions.');
  const items=pendingItems(),active=items.find(x=>x.sub.id===reviewId&&x.incoming.id===reviewCarId)||items[0];
  if(!active)return empty('Your review inbox is clear','New car packages and network submissions appear here for approval.',btn('Import car package','import','primary'));
  reviewId=active.sub.id;reviewCarId=active.incoming.id;
  const incoming=active.incoming,existing=db.cars.find(c=>c.id===incoming.id),fields=Object.keys(incoming).filter(k=>!['id','sharedSetups'].includes(k)&&JSON.stringify(incoming[k])!==JSON.stringify(existing?.[k]));
  return `<div class="review-layout"><aside class="queue" aria-label="Submissions awaiting review">${items.map(({sub,incoming:c})=>`<button type="button" class="queue-item ${sub.id===reviewId&&c.id===reviewCarId?'on':''}" data-action="review-select" data-id="${sub.id}" data-car="${c.id}" aria-current="${sub.id===reviewId&&c.id===reviewCarId?'true':'false'}"><strong>${esc(c.name)}</strong><small>${esc(sub.package.sender)} · ${date(sub.received)}</small><span class="row mt">${badge(db.cars.some(x=>x.id===c.id)?'Update':'New car','usage')}</span></button>`).join('')}</aside><section class="panel review-card"><div class="row"><div><div class="label">Submission review</div><h2>${esc(incoming.name)}</h2></div><span class="spacer"></span>${badge(fields.length+' proposed fields','usage')}</div><p class="muted">${existing?'Update to an existing car':'New car submission'} · Source name: ${esc(active.sub.package.sender)}</p><p class="tiny muted">Source names come from the submitted package; verify the sender with the club.</p><div class="review-changes">${fields.map(k=>`<section class="review-field"><label class="check-row"><input type="checkbox" data-review-field="${esc(k)}" checked>${esc(fieldLabel(k))}</label><div class="review-values"><div class="review-value"><small>Current record</small><div class="prewrap">${esc(valuePreview(k,existing?.[k]))}</div></div><div class="review-value incoming"><small>Incoming value</small><div class="prewrap">${esc(valuePreview(k,incoming[k]))}</div></div></div></section>`).join('')||'<p>No field differences. Accepting will record the review.</p>'}</div>${incoming.sharedSetups?.length?`<label class="check-row"><input type="checkbox" id="review-setups" checked>Include ${incoming.sharedSetups.length} shared setup(s)</label>`:''}<div class="note info">Club storage, inspection notes, ownership and private fields stay unchanged. Omitted information is not deleted.</div><label class="field">Reviewer note<textarea id="review-note" placeholder="Optional explanation"></textarea></label><div class="actions mt">${btn('Reject submission','reject-review','danger')}${btn(icon('check')+' Accept selected changes','accept-review','primary')}</div><input type="hidden" id="review-revision" value="${existing?.revision||0}"></section></div>`;
}
function renderGeneralJobDesign(m,head){
  const j=m.job,c=db.cars.find(c=>c.id===j.carId),photo=ShowroomModel.photos(c)[0];
  const actions=j.status==='active'?`<div class="actions mt">${btn('Record progress','job-note','primary',j.id)}${btn('Record test','add-test','',j.carId)}${btn('Complete job…','finish-job','',j.id)}${btn('Cancel job…','cancel-job','danger',j.id)}</div>`:`<div class="note info mt">${j.status==='completed'?'Completed':'Cancelled'} ${date(j.finished)}. The recorded configuration is preserved.</div>`;
  return head+`<div class="two-col general-job-layout"><div class="stack">${panel('Planned work',`<div class="row">${badge('General work','warn')}${badge(j.status==='active'?'In progress':j.status==='completed'?'Completed':'Cancelled',j.status==='cancelled'?'':'good')}</div><p class="prewrap mt">${esc(j.notes||'No additional instructions.')}</p>${actions}`)}${jobLog(j)}</div><div class="stack">${panel(m.carName,`<div class="hero-photo">${photo?`<img src="${esc(photo.data)}" alt="${esc(m.carName)}">`:placeholder()}</div><div class="actions mt">${btn('Open car '+icon('next'),'open-car','',j.carId)}</div>`)}${panel('Job details',dl([['Created',date(j.created)],['Updated',date(j.updated)]]))+ (j.status==='active'?'<div class="note info">Progress notes record the work you have done. Update fitted parts and specifications on the car’s Technical & parts page.</div>':'')}</div></div><details class="panel mt"><summary>Configuration ${j.status==='active'?'at the start':'at the start and finish'}</summary><div class="two-col mt">${panel('Before work',snapshotDetails(j.baseline))}${j.actual?panel('When closed',snapshotDetails(j.actual)):''}</div></details>`;
}
async function interfaceAction(action,id){
  switch(action){
    case 'settings-section':if(!uiSettingsSections.some(([s])=>s===id))return true;settingsSection=id;render();return true;
    case 'settings-welcome':settingsSection='Welcome banner';page='Settings';carId=null;render();return true;
    case 'open-review-inbox':openReview('Incoming cars');return true;
    case 'library-section':if(!choiceCatalogue?.choices.some(f=>f.key===id))return true;choiceField=id;choiceQuery='';render();return true;
    case 'open-saved-view':{const view=db.views.find(v=>v.id===id);if(!view)return true;({query,usage,matchAll,mode,sort,archived}=structuredClone(view));tableColumns=[...(view.columns||db.settings.columns)];selected.clear();carId=null;page='Cars';render();return true;}
  }return false;
}
