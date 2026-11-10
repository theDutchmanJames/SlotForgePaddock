'use strict';
let historyCarState=null,historySessionState=null,historyRequest=0;
const historyIdentity=()=>({databaseId:db.id,recoveryId:db._view?.token?.epoch});
const historyContext=()=>JSON.stringify([dataPath,db?.id,db?._view?.token?.epoch,db?.revision]);
const historyNumber=n=>Number.isFinite(n)?n.toLocaleString('en-GB',{maximumFractionDigits:3}):'Unknown';
const historyDate=d=>d?date(d):'Date unknown';
const historySessionDate=(startedAt,savedAt)=>startedAt?historyDate(startedAt):savedAt?'Saved '+historyDate(savedAt):'Date unknown';
const historyTable=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v??'Unknown')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
function historyStatistics(s,c,{mixed=false}={}){
 if(!s)return '<p class="note">No physical-car totals: this participant is virtual, unlinked, or its car is no longer in this library.</p>';
 const items=[['Physical distance',!s.distanceComplete&&!s.distanceM?'Unknown':historyNumber(s.distanceM)+' m',s.distanceComplete?'Known measured travel':s.unknownDistanceLaps+' lap(s) with unknown distance'],['Average valid lap',HistoryViewModel.seconds(s.averageLapMs),s.validLaps+' valid non-pit laps'],['Personal record',HistoryViewModel.seconds(s.bestPersonalLapMs),s.personalRecordLaps+' eligible laps'],['Track-eligible best',HistoryViewModel.seconds(s.bestTrackLapMs),s.trackRecordLaps+' eligible laps'],['Consistency · standard deviation',HistoryViewModel.seconds(c?.standardDeviationMs),c?.sampleLaps>=2?historyNumber(c.coefficientPercent)+'% of mean pace':'Needs at least two valid laps'],['Classification wins',s.overallWins+' overall · '+s.classWins+' class','Adjusted classification; no added distance']];
 return `<div class="history-metrics">${items.map(([label,value,note])=>`<div class="history-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('')}</div><p class="tiny muted">${s.acceptedSessions} contributing sessions · ${s.historicalSessions} historical · ${s.measuredLaps} timed laps. Invalid and pit laps never set records. ${s.quarantinedSessions?s.quarantinedSessions+' session(s) need timing correction and are excluded. ':''}${mixed?'Totals combine tracks, lanes and drivers; compare pace and consistency within a single session and lane below. ':''}Manual test records remain separate.</p>`;
}
function renderSharedHistory(car){
 const context=historyContext(),key=context+'|'+car.id;
 if(historyCarState?.key!==key)historyCarState={key,context,carId:car.id,pages:[undefined],index:0,result:null,error:'',loading:false};
 const state=historyCarState;queueMicrotask(()=>{if(historyCarState===state&&document.getElementById('shared-history-car')&&!state.result&&!state.loading&&!state.error)void loadHistoryCar();});
 return `<section id="shared-history-car" class="timing-results shared-history" aria-label="Shared racing history">${historyCarHtml(state)}</section>`;
}
function historyCarHtml(state){
 const result=state.result;
 return `<div class="page-head"><div><h2>Shared racing history</h2><p class="muted">Accepted Timing results and historical evidence, attached to the car that raced.</p></div>${btn('Refresh','history-view-refresh','small')}</div>${state.error?`<p class="note warning" role="alert">${esc(state.error)}</p>`:''}${!result?'<p class="muted" role="status">'+(state.error?'Use Refresh to try again.':'Loading racing history…')+'</p>':historyStatistics(result.statistics,result.consistency,{mixed:true})+historyLaneRecords(result.records)+`<div class="history-session-cards">${result.entries.length?result.entries.map((e,i)=>{
 const status=e.accepted.state==='withdrawn'?'Withdrawn':e.quarantined?'Needs correction':!e.participants.length?'Car removed by correction':e.corrections?'Corrected':'Accepted';
 return `<article class="panel history-session-card"><div class="actions">${badge(status,e.accepted.state==='active'&&!e.quarantined?'info':'')}${badge(e.provenance==='historical'?'Historical evidence':'Measured session')}<span class="tiny muted">Revision ${e.accepted.revision}</span></div><h3>${esc(e.name||'Race session')}</h3><p>${esc(e.trackName||'Unknown track')} · ${esc(historySessionDate(e.startedAt,e.savedAt))}</p><p class="muted">${esc(e.participants.flatMap(p=>p.drivers.map(d=>d.name)).join(' · ')||'No current participant for this car')}</p>${e.participants.map(p=>`<p class="tiny muted">${esc(p.lanes.length?'Lanes '+p.lanes.join(', '):'Lane unknown')} · ${esc(p.configurationRevision?'Captured configuration '+p.configurationRevision.slice(0,12):p.configurationKind==='historical'?'Historical configuration supplied':'Configuration unknown')}</p>`).join('')}${e.accepted.state==='withdrawn'?'<p class="note">'+esc(e.reason||'Withdrawn by the source')+' · No current contribution.</p>':''}${btn('View session','history-view-open','',String(i))}</article>`;
 }).join(''):'<p class="muted">No accepted racing history for this car yet.</p>'}</div><div class="actions mt">${state.index?btn('Previous sessions','history-view-prev'):''}<span>Page ${state.index+1}</span>${result.nextPage?btn('Next sessions','history-view-next'):''}</div>`}`;
}
function historyLaneRecords(info){
 return `<section class="panel history-lane-records"><h3>Measured track and lane records</h3><p class="tiny muted">Fastest track-eligible lap for this car on each source, track and lane. Personal-only eligibility does not set these records. Corrections and withdrawals are reflected here.</p>${info.rows.length?`<div class="table-wrap"><table><thead><tr><th>Track / source</th><th>Lane</th><th>Best lap</th><th>Driver</th><th>Race date</th><th></th></tr></thead><tbody>${info.rows.map((r,i)=>`<tr><td>${esc(r.track)}<small class="muted">${esc(r.source)}</small></td><td>${r.lane}</td><td><strong>${HistoryViewModel.seconds(r.durationMs)}</strong></td><td>${esc(r.driver||'Unknown')}</td><td>${esc(historySessionDate(r.startedAt,r.savedAt))}</td><td>${btn('View session','history-view-record','small',String(i))}</td></tr>`).join('')}</tbody></table></div><div class="actions mt">${info.offset?btn('Previous records','history-view-records-prev'):''}<span>${info.offset+1}–${info.offset+info.rows.length} of ${info.total}</span>${info.nextOffset!==null?btn('Next records','history-view-records-next'):''}</div>`:'<p class="muted">No eligible measured lane records yet.</p>'}</section>`;
}
async function loadHistoryCar(){
 const state=historyCarState;if(!state)return;state.loading=true;state.error='';const serial=++historyRequest;
 try{const result=await api('historyView',{...historyIdentity(),operation:'car',carId:state.carId,page:state.pages[state.index]});if(historyCarState!==state||serial!==historyRequest||historyContext()!==state.context)return;state.result=result;}
 catch(e){if(historyCarState!==state||serial!==historyRequest)return;state.error=e.code==='SNAPSHOT_CHANGED'?'History changed while browsing. Refresh to start from the latest sessions.':e.message;state.result=null;}
 finally{state.loading=false;if(historyCarState===state&&historyContext()===state.context){const root=document.getElementById('shared-history-car');if(root)root.innerHTML=historyCarHtml(state);}}
}
async function openSharedHistory(sourceId,sessionId,selectedCar=carId){
 const state={context:historyContext(),identity:historyIdentity(),libraryPath:dataPath,sourceId,sessionId,carId:selectedCar||undefined,head:null,participantId:null,tab:'Summary',lane:undefined,driverId:undefined,offset:0,tablePage:0,laps:null,error:'',serial:0};historySessionState=state;
 modal('Race session','<div id="shared-history-session" class="shared-history"><p role="status">Loading session…</p></div>',null);
 $('#dialog .dialog-footer [data-action="close-modal"]').textContent='Close';
 await loadHistorySession(true);
}
const historySessionCurrent=s=>historySessionState===s&&historyContext()===s.context&&$('#dialog').open&&!!$('#shared-history-session');
async function loadHistorySession(reload=false){
 const s=historySessionState;if(!s)return;const serial=++s.serial;s.error='';
 try{
  const head=await api('historyView',{...s.identity,operation:'session',sourceId:s.sourceId,sessionId:s.sessionId,carId:s.carId,participantId:reload?undefined:s.participantId,resultToken:reload?undefined:s.head?.resultToken,lane:s.lane,driverId:s.driverId});
  if(!historySessionCurrent(s)||serial!==s.serial)return;s.head=head;s.participantId=head.participantId;s.laps=null;s.offset=0;
  if(s.tab==='Laps'&&s.participantId&&head.body)await loadHistoryLaps();else paintHistorySession();
 }catch(e){if(historySessionCurrent(s)&&serial===s.serial){s.error=e.message;paintHistorySession();}}
}
async function loadHistoryLaps(){
 const s=historySessionState;if(!s?.head||!s.participantId)return;const serial=++s.serial;s.error='';
 try{const result=await api('historyView',{...s.identity,operation:'laps',sourceId:s.sourceId,sessionId:s.sessionId,participantId:s.participantId,resultToken:s.head.resultToken,offset:s.offset});if(!historySessionCurrent(s)||serial!==s.serial)return;s.laps=result;}
 catch(e){if(!historySessionCurrent(s)||serial!==s.serial)return;s.laps=null;s.error=e.message;}
 if(historySessionCurrent(s))paintHistorySession();
}
function historyConfiguration(p){
 const c=p.configuration;if(!c)return '<p class="note">Configuration unknown. Today’s car specification has not been substituted.</p>';
 const technical=Object.entries(c.technical||{}).map(([k,v])=>[typeof techLabels!=='undefined'?techLabels[k]||k:k,v]);
 return `<p class="note info">${c.kind==='historical'?'Historical specification supplied with evidence.':'Original configuration captured before racing.'} Later car edits do not change this record.</p>${dl([['Recorded',c.capturedAt||c.recordedAt||'Unknown'],['Configuration revision',c.revision||'Not recorded'],['Car revision',String(c.carRevision??'Unknown')]])}${c.evidence?'<p class="prewrap">'+esc(c.evidence)+'</p>':''}${technical.length?historyTable(['Specification','Recorded value'],technical):'<p>No technical values recorded.</p>'}${c.components?.length?historyTable(['Installed part','Quantity','Position'],c.components.map(x=>[x.name,x.quantity,x.position])):''}`;
}
function historyRowsPage(headers,rows,s){
 s.tablePage=Math.min(s.tablePage,Math.max(0,Math.ceil(rows.length/50)-1));const start=s.tablePage*50;
 return rows.length?historyTable(headers,rows.slice(start,start+50))+(rows.length>50?`<div class="actions mt">${start?btn('Previous rows','history-view-rows-prev'):''}<span>${start+1}–${Math.min(start+50,rows.length)} of ${rows.length}</span>${start+50<rows.length?btn('Next rows','history-view-rows-next'):''}</div>`:''):'<p class="muted">Not recorded.</p>';
}
function paintHistorySession(){
 const s=historySessionState;if(!historySessionCurrent(s))return;const h=s.head,root=$('#shared-history-session');
 if(s.error){root.innerHTML=`<p class="note warning" role="alert">${esc(s.error)}</p><p>The previous page has been discarded. Reload to read the current accepted revision.</p>${btn('Reload session','history-view-reload')}`;return;}
 if(!h){root.innerHTML='<p role="status">Loading session…</p>';return;}
 const m=HistoryViewModel.normalize(h),race=m.race,p=race?.participants.find(p=>p.id===s.participantId);
 const history=`<details class="mt"><summary>Receipt and revision history</summary>${dl([['Original source',s.sourceId],['Session ID',s.sessionId],['Accepted revision',String(h.accepted.revision)],['Received',h.receivedAt],['Content hash',h.accepted.contentHash]])}<p>Showing the latest ${h.history.length} of ${h.historyCount} earlier revisions.</p>${historyTable(['Revision','State','Received'],h.history.map(x=>[x.revision,x.state,x.receivedAt]))}</details>`;
 if(!race){root.innerHTML=`<h3>${esc(h.name)}</h3>${badge('Withdrawn')}<p class="note">${esc(h.reason||'Withdrawn by the source')}. This session contributes no current statistics.</p>${history}`;return;}
 const tabs=['Summary','Laps','Configuration','Classification','Heats','Driver stints','Evidence'];
 let content='';
 if(s.tab==='Summary')content=(h.quarantined?timingCorrectionNotice():'')+historyStatistics(h.statistics,h.consistency)+`<p class="tiny muted">Standard deviation is the population spread of valid non-pit lap times. Smaller spread means more consistent times, not necessarily better driving. Lane or driver filters apply to these statistics only; other tabs show the original evidence. Filtered views do not award session wins.</p><div class="history-filters"><label>Lane<select id="history-lane"><option value="">All recorded lanes</option>${race.track.lanes.map(l=>`<option value="${l.lane}" ${s.lane===l.lane?'selected':''}>Lane ${l.lane}</option>`).join('')}</select></label><label>Driver<select id="history-driver"><option value="">All recorded drivers</option>${(p?.drivers||[]).map(d=>`<option value="${esc(d.id)}" ${s.driverId===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label>${btn('Apply filters','history-view-filter')}</div><p class="prewrap">${esc(m.context.notes)}</p>`;
 if(s.tab==='Configuration')content=p?historyConfiguration(p):'<p>No participant selected.</p>';
 if(s.tab==='Laps')content=s.laps?`<p class="muted">Original lap order · ${s.laps.total} laps · ${s.laps.total?s.laps.offset+1:0}–${Math.min(s.laps.offset+s.laps.laps.length,s.laps.total)}. Unknown values are not estimates.</p>${!m.rich?'<p class="tiny muted">Timing-v1 supplied one combined eligibility flag; it is shown in both record columns.</p>':''}${historyTable(['Lap','Heat','Driver','Lane','Time','Completion offset','Valid','Pit','Personal record','Track record','Distance','Flags / reason'],s.laps.laps.map(l=>HistoryViewModel.lap(l,p,race,m.rich)))}<div class="actions mt">${s.offset?btn('Previous laps','history-view-laps-prev'):''}${s.laps.nextOffset!==null?btn('Next laps','history-view-laps-next'):''}</div>`:'<p role="status">Loading laps…</p>';
 if(s.tab==='Classification'){const table=HistoryViewModel.classification(race,m.context);content='<p class="note info">These are the awarded results. Penalties and adjustments are already included; they do not alter measured laps or physical distance. Points and scoring values are shown separately; unknown evidence stays unknown.</p>'+historyRowsPage(table.headers,table.rows,s);}
 if(s.tab==='Driver stints')content=historyRowsPage(['Heat','Driver','Lane','Start offset','End offset'],(p?.stints||[]).map(st=>[race.heats.find(h=>h.id===st.heatId)?.name||st.heatId,p.drivers.find(d=>d.id===st.driverId)?.name||'Unknown',st.lane,HistoryViewModel.seconds(st.startedAtMs),HistoryViewModel.seconds(st.endedAtMs)]),s)+`<details class="mt"><summary>Track and heat information</summary>${historyTable(['Lane','Recorded length'],race.track.lanes.map(l=>[l.lane,l.lengthM===null?'Unknown':l.lengthM+' m']))}<p>${race.heats.length} heat(s); names are shown with each driver stint.</p></details>`;
 if(s.tab==='Heats')content=historyRowsPage(['Heat','Start offset','End offset'],race.heats.map(h=>[h.name,HistoryViewModel.seconds(h.startedAtMs),HistoryViewModel.seconds(h.endedAtMs)]),s)+historyTable(['Lane','Recorded length'],race.track.lanes.map(l=>[l.lane,l.lengthM===null?'Unknown':l.lengthM+' m']));
 if(s.tab==='Evidence')content=`${badge(m.provenance.kind==='historical'?'Historical evidence':'Measured session','info')}<p class="prewrap">${esc(m.provenance.evidence)}</p><p><strong>Missing evidence declared by source:</strong> ${esc(m.provenance.missing.join(', ')||'None declared')}</p><p class="tiny muted">No missing configuration, crossing time or lane length is inferred from today’s car or track.</p>${history}`;
 const linked=p?.carId?h.linkedCars[p.carId]:null,team=m.context.teams.find(t=>t.id===p?.teamId);
 root.innerHTML=`<div class="history-detail-heading"><h3>${esc(race.name)}</h3>${badge(h.accepted.revision>1?'Corrected · revision '+h.accepted.revision:'Accepted · revision 1','info')}<p>${esc(race.track.name||'Unknown track')} · ${esc(historySessionDate(race.startedAt,m.context.savedAt))} · ${esc(race.type)}</p></div>${h.requestedCarAbsent?'<p class="note warning">The car you opened is absent from this accepted revision. Select a participant to inspect the retained session; it contributes nothing to the removed car.</p>':''}<label class="history-participant">Participant<select id="history-participant">${race.participants.map(p=>`<option value="${esc(p.id)}" ${p.id===s.participantId?'selected':''}>${esc(p.displayName)}${p.kind==='virtual'?' · virtual':!p.carId?' · unlinked':''}</option>`).join('')}</select></label><p class="tiny muted">${esc(p?.kind==='virtual'?'Virtual participant · no physical car contribution':p?.carId?linked?'Linked to '+linked.name+(linked.archived?' (archived)':''):'Original car is missing; history is retained.':'No physical car link')}</p>${team?'<p class="tiny muted">Team: '+esc(team.name)+'</p>':''}<div class="tabs history-tabs" role="tablist" aria-label="Session details">${tabs.map(t=>`<button type="button" role="tab" aria-selected="${s.tab===t}" class="${s.tab===t?'active':''}" data-action="history-view-tab" data-id="${esc(t)}">${esc(t)}</button>`).join('')}</div><div class="history-tab-content">${content}</div>`;
}
async function historyViewAction(action,id){
 if(!action.startsWith('history-view-'))return false;
 if(action==='history-view-open'){const e=historyCarState?.result?.entries[Number(id)];if(e)await openSharedHistory(e.sourceId,e.sessionId,historyCarState.carId);return true;}
 if(action==='history-view-record'){const r=historyCarState?.result?.records?.rows[Number(id)];if(r)await openSharedHistory(r.source,r.session,historyCarState.carId);return true;}
 if(action==='history-view-records-prev'||action==='history-view-records-next'){
  const state=historyCarState,info=state?.result?.records;if(!info)return true;const serial=++historyRequest;
  try{const records=await api('historyView',{...historyIdentity(),operation:'records',carId:state.carId,offset:action.endsWith('prev')?Math.max(0,info.offset-20):info.nextOffset??info.offset,resultToken:info.token});if(historyCarState===state&&serial===historyRequest&&historyContext()===state.context&&$('#shared-history-car')){state.result.records=records;$('#shared-history-car').innerHTML=historyCarHtml(state);}}
  catch(e){if(historyCarState===state&&serial===historyRequest&&historyContext()===state.context&&$('#shared-history-car')){state.error=e.message;state.result=null;$('#shared-history-car').innerHTML=historyCarHtml(state);}}return true;
 }
 if(['history-view-refresh','history-view-prev','history-view-next'].includes(action)){
  const s=historyCarState;if(!s)return true;if(action==='history-view-refresh'){s.pages=[undefined];s.index=0;s.context=historyContext();s.key=s.context+'|'+s.carId;}
  if(action==='history-view-prev')s.index=Math.max(0,s.index-1);if(action==='history-view-next'&&s.result?.nextPage){s.pages[++s.index]=s.result.nextPage;}await loadHistoryCar();return true;
 }
 const s=historySessionState;if(!s)return true;
 if(action==='history-view-reload'){if(s.identity.databaseId!==db.id||s.libraryPath!==dataPath){toast('Close this session and reopen history in the selected collection.',true);return true;}s.lane=undefined;s.driverId=undefined;s.identity=historyIdentity();s.context=historyContext();await loadHistorySession(true);}
 if(action==='history-view-tab'){s.tab=id;s.tablePage=0;if(id==='Laps'&&!s.laps)await loadHistoryLaps();else paintHistorySession();}
 if(action==='history-view-filter'){s.lane=$('#history-lane').value?Number($('#history-lane').value):undefined;s.driverId=$('#history-driver').value||undefined;await loadHistorySession();}
 if(action==='history-view-laps-prev'||action==='history-view-laps-next'){s.offset=action.endsWith('prev')?Math.max(0,s.offset-250):s.laps?.nextOffset??s.offset;await loadHistoryLaps();}
 if(action==='history-view-rows-prev'||action==='history-view-rows-next'){s.tablePage=Math.max(0,s.tablePage+(action.endsWith('prev')?-1:1));paintHistorySession();}
 return true;
}
document.addEventListener('change',async e=>{if(e.target.id!=='history-participant')return;const s=historySessionState;if(!s)return;s.participantId=e.target.value;s.driverId=undefined;s.lane=undefined;s.tablePage=0;await loadHistorySession();});
function releaseInactiveHistory(){if(!$('#shared-history-car')){historyCarState=null;++historyRequest;}}
document.getElementById('dialog').addEventListener('close',()=>queueMicrotask(()=>{if(!$('#dialog').open||!$('#shared-history-session'))historySessionState=null;}));
