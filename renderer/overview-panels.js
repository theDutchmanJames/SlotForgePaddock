let overviewDraft=null;
const overviewPanelTitles={details:'Car details',configuration:'Current configuration'};
function overviewFieldLabel(key){return ({gearing:'Gearing',gearRatio:'Gear ratio',raceClass:'Class',tech_weight:'Weight'})[key]||columnLabel(key);}
function overviewFieldValue(c,key){
  if(key==='gearing'){const t=c.technical||{};return t.pinion||t.gear?(t.pinion||'—')+' / '+(t.gear||'—'):'';}
  if(key==='gearRatio')return slotforgeDomain.gearRatioText(c.technical?.pinion,c.technical?.gear);
  const value=OverviewLayout.value(c,key);
  if(Array.isArray(value))return value.join(', ');
  if(key==='tech_weight'&&String(value).trim())return /^\d+(?:[.,]\d+)?$/.test(String(value).trim())?value+' g':value;
  return String(value);
}
function renderOverviewPanel(c,section){
  // Shared cars use the standard public presentation; local layout choices stay private.
  const keys=OverviewLayout.read(local()?db.settings:null)[section],title=overviewPanelTitles[section];
  return `<section class="panel section-panel overview-details-panel" data-overview-panel="${section}"><div class="panel-heading"><h2>${icon(uiPanelIcon(title))}${title}</h2>${local()?btn(icon('edit')+' Choose fields','overview-fields','small ghost',section):''}</div><div class="panel-content">${keys.length?dl(keys.map(k=>[overviewFieldLabel(k),overviewFieldValue(c,k)])):'<p class="muted">No fields selected. Choose fields to personalise this panel.</p>'}${section==='configuration'?btn('View technical details '+icon('next'),'section','small ghost','Technical & parts'):''}</div></section>`;
}
function overviewEditorBody(){
  const {section,layout}=overviewDraft,keys=layout[section],available=OverviewLayout.fields(collectionMeta.columns,section).filter(f=>!keys.includes(f.key));
  return `<p class="muted">Choose up to 16 fields and arrange their order. This panel layout applies to every car in your local collection.</p><div class="overview-field-order">${keys.map((key,index)=>`<div class="list-row"><strong>${esc(overviewFieldLabel(key))}</strong><div class="actions"><button type="button" class="btn small" data-action="overview-up" data-id="${index}" aria-label="Move ${esc(overviewFieldLabel(key))} up" ${index===0?'disabled':''}>↑</button><button type="button" class="btn small" data-action="overview-down" data-id="${index}" aria-label="Move ${esc(overviewFieldLabel(key))} down" ${index===keys.length-1?'disabled':''}>↓</button>${btn('Remove','overview-remove','small',String(index))}</div></div>`).join('')||'<p class="muted">No fields selected.</p>'}</div><div class="overview-add-field mt"><label class="field">Available fields<select id="overview-field-add" ${available.length&&keys.length<16?'':'disabled'}>${available.map(f=>`<option value="${esc(f.key)}">${esc(overviewFieldLabel(f.key))}</option>`).join('')}</select></label><button type="button" class="btn" data-action="overview-add" ${available.length&&keys.length<16?'':'disabled'}>Add field</button></div><div class="actions mt">${btn('Restore default fields','overview-defaults','small')}</div>`;
}
function editOverviewFields(section){
  if(!local()||!Object.hasOwn(overviewPanelTitles,section))return;
  overviewDraft={section,layout:OverviewLayout.read(db.settings),revision:db.revision};
  modal('Choose fields · '+overviewPanelTitles[section],`<div id="overview-fields-editor">${overviewEditorBody()}</div>`,async()=>{await change('settings.save',{revision:overviewDraft.revision,overviewLayout:overviewDraft.layout});overviewDraft=null;},'Save layout');
}
function overviewAction(action,id){
  if(action==='overview-fields'){editOverviewFields(id);return true;}
  if(!['overview-add','overview-remove','overview-up','overview-down','overview-defaults'].includes(action))return false;
  if(!overviewDraft||!$('#overview-fields-editor'))return true;
  const keys=overviewDraft.layout[overviewDraft.section],index=Number(id);
  if(action==='overview-add'){const key=$('#overview-field-add')?.value;if(keys.length<16&&!keys.includes(key)&&OverviewLayout.fields(collectionMeta.columns,overviewDraft.section).some(f=>f.key===key))keys.push(key);}
  if(action==='overview-remove'&&Number.isInteger(index)&&index>=0&&index<keys.length)keys.splice(index,1);
  if(action==='overview-up'||action==='overview-down'){const target=index+(action==='overview-up'?-1:1);if(Number.isInteger(index)&&index>=0&&index<keys.length&&target>=0&&target<keys.length)[keys[index],keys[target]]=[keys[target],keys[index]];}
  if(action==='overview-defaults')overviewDraft.layout[overviewDraft.section]=[...OverviewLayout.defaults[overviewDraft.section]];
  $('#overview-fields-editor').innerHTML=overviewEditorBody();return true;
}
