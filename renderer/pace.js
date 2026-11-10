let paceState=null;
async function openLegacyPace(id){
 const origin=dataPath,identity=db.id,result=await api('read',{queryView:{...desiredView(),editor:{action:'compare-pace'}}});
 if(origin!==dataPath||identity!==db.id||!local())return;acceptSnapshot(result.data);openPace(id);
}
const paceMetrics=[['best','Best eligible / reported lap'],['median','Median valid lap'],['sustained5','Best uninterrupted 5 laps (average)'],['sustained10','Best uninterrupted 10 laps (average)']];
function paceSelect(name,label,values,value){return `<label class="field">${esc(label)}<select data-pace="${name}">${values.map(([id,text])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(text)}</option>`).join('')}</select></label>`;}
function paceDescription(r){return [r.track,'Lane '+r.lane,r.driver,date(r.date),r.session,r.heat].filter(Boolean).join(' · ');}
function openPace(id){
  const all=db._view?.paceRuns||PaceModel.runs(db),cars=db.cars.filter(c=>!c.archived&&all.some(r=>r.carId===c.id)).sort((a,b)=>a.name.localeCompare(b.name));
  if(!cars.length){modal('Compare pace',empty('Record some track time first','Add a manual test with a track and best lap, or receive measured sessions from Timing. Comparisons use recorded performance, not motor specifications.'),null);return;}
  const selected=cars.some(c=>c.id===id)?id:cars[0].id;
  paceState={databaseId:db.id,revision:db.revision,all,cars,carId:selected,reference:all.find(r=>r.carId===selected).id,metric:'best',tolerance:.2,sameLane:true,sameDriver:true};
  showPace();
}
function showPace(){
  const p=paceState,referenceRuns=p.all.filter(r=>r.carId===p.carId).sort((a,b)=>b.date.localeCompare(a.date));if(!referenceRuns.some(r=>r.id===p.reference))p.reference=referenceRuns[0].id;
  modal('Compare pace',`<p class="muted">Find other cars with similar measured pace on the same circuit. Each result uses that car’s fastest matching run for the selected metric.</p><div class="form-grid">${paceSelect('carId','Reference car',p.cars.map(c=>[c.id,c.name]),p.carId)}${paceSelect('metric','Compare using',paceMetrics,p.metric)}${paceSelect('reference','Reference session / stint',referenceRuns.map(r=>[r.id,paceDescription(r)]),p.reference)}<label class="field">Within ± seconds<input data-pace="tolerance" type="number" min="0" max="60" step="0.01" value="${p.tolerance}"></label></div><div class="actions mt"><label class="check-row"><input data-pace="sameLane" type="checkbox" ${p.sameLane?'checked':''}>Same lane</label><label class="check-row"><input data-pace="sameDriver" type="checkbox" ${p.sameDriver?'checked':''}>Same driver name</label></div><div id="pace-results" aria-live="polite"></div>`,null);
  paintPace();
}
function paintPace(){
  const p=paceState,result=PaceModel.compare(p.all,p.cars,p.reference,p),r=result.reference;
  const warnings=['direction','voltage','magnetStatus',...(p.sameDriver?['driver']:[]),...(p.sameLane?['lane']:[])].filter(k=>r[k]==='Unknown');
  const labels={direction:'track direction',voltage:'session voltage',magnetStatus:'magnet status',driver:'driver',lane:'lane'};
  const notes=(db.id!==p.databaseId||db.revision!==p.revision?`<p class="note mt">The database changed since this comparison opened. Close and reopen it for current results.</p>`:'')+`<p class="note info mt">${warnings.length?`Not recorded: ${warnings.map(k=>labels[k]).join(', ')}. Unknown conditions match only other unknown values, but that does not establish equal conditions. `:''}${!p.sameLane?'Different lanes are included. ':''}${!p.sameDriver?'Different drivers are included. ':''}Driver names are labels, not verified identities across sessions.</p>`;
  $('#pace-results').innerHTML=`<div class="pace-reference mt"><strong>${esc(p.cars.find(c=>c.id===r.carId).name)}</strong><span>${timingSeconds(r[p.metric])}</span><p class="tiny muted">${esc(paceDescription(r))}</p>${btn('Recorded setup & conditions','pace-evidence','small',r.id)}</div>${notes}${r.kind==='manual'?'<p class="tiny muted">Manual best laps are reported figures. Manual averages cannot provide a median or an uninterrupted run. Manual tracks match by name and remain separate from Timing track identities.</p>':'<p class="tiny muted">Best laps must be record-eligible. Median and sustained pace use valid, non-pit measured laps, including practice laps. Withdrawn, virtual and overlapping sessions are excluded.</p>'}${result.unavailable?'<p class="note mt">This run has insufficient data for the selected metric. Choose another run or metric.</p>':`<h3 class="mt">${result.rows.length} matching car${result.rows.length===1?'':'s'}</h3>${result.rows.length?`<div class="pace-grid">${result.rows.slice(0,50).map(({car:c,run,deltaMs})=>`<article class="pace-card"><div class="pace-car">${c.picture?`<img src="${esc(thumbnailSource(c.picture))}" alt="${esc(c.name)}">`:icon('car')}<div><strong>${esc(c.name)}</strong><p class="tiny muted">${esc(c.maker||'')}</p></div></div><div class="pace-score"><strong>${timingSeconds(run[p.metric])}</strong><span>${deltaMs>0?'+':''}${(deltaMs/1000).toFixed(3)} s</span></div><p class="tiny muted">${esc(paceDescription(run))}</p><p class="tiny">${run.kind==='manual'?run.totalLaps+' reported laps':run.validLaps+' valid / '+run.totalLaps+' measured laps'}${run.kind==='timing'&&run.validLaps<5?' · Small sample':''}</p><div class="actions">${btn('View evidence','pace-evidence','small',run.id)}${btn('View car','pace-car','small ghost',c.id)}</div></article>`).join('')}</div>${result.rows.length>50?'<p class="tiny muted">Showing the closest 50 cars. Narrow the tolerance to refine the list.</p>':''}`:'<p class="muted">No other car matches these conditions and tolerance. Try another reference run or widen the tolerance.</p>'}`}`;
}
function paceEvidence(id){
  const run=paceState?.all.find(r=>r.id===id);if(!run)return;
  modal('Recorded evidence',`<p>${esc(paceDescription(run))}</p>${dl([['Source',run.kind==='manual'?'Manual test':'SlotForge Timing'],['Direction',run.direction],['Voltage',run.voltage==='Unknown'?'Unknown':run.voltage+' V'],['Traction magnets',run.magnetStatus],['Configuration',run.configuration],['Best lap',timingSeconds(run.best)],['Median',timingSeconds(run.median)],['Best 5-lap average',timingSeconds(run.sustained5)],['Best 10-lap average',timingSeconds(run.sustained10)]])}<h3 class="mt">Captured specifications</h3>${dl(Object.entries(run.technical||{}).map(([k,v])=>[techLabels[k]||k,v]))}<p class="tiny muted">This is the configuration saved with the run, not the car’s current setup. Missing conditions stay unknown.</p><div class="actions">${btn('Back to comparison','pace-back')}</div>`,null);
}
async function paceAction(action,id){
  if(action==='lane-record'){openLaneRecord(id);return true;}
  if(action==='compare-pace'){if(local()){if(window.slotforge.historyView)await openSharedPace(id);else openPace(id);}return true;}
  if(action==='pace-evidence'){paceEvidence(id);return true;}
  if(action==='pace-back'){showPace();return true;}
  if(action==='pace-car'){$('#dialog').close();carId=id;section='Performance';page='Cars';render();return true;}
  return false;
}
document.addEventListener('change',event=>{
  const input=event.target,key=input.dataset.pace;if(!key||!paceState)return;
  if(key==='tolerance'&&!input.checkValidity())return;
  paceState[key]=['sameLane','sameDriver'].includes(key)?input.checked:key==='tolerance'?Number(input.value):input.value;
  if(key==='carId'){showPace();return;}paintPace();
});
function renderLaneRecords(c){
  const rows=(db._view?.lanes||PaceModel.laneRecords(db,c.id));if(db._view?.timing?.background&&!rows.length)return '';
  return `<section class="mt">${panel(db._view?.timing?.background?'Reported manual lane records':'Lane records',`<p class="muted">${db._view?.timing?.background?'Manual best laps are separate from measured shared-history records above.':'This car’s fastest recorded lap on each track and lane.'}</p><p class="tiny muted">Timing records use valid, non-pit, record-eligible laps. Manual best laps are reported separately. Different Timing installations have separate track identities. Conditions may differ between records.</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>Track / source</th><th>Lane</th><th>Best lap</th><th>Driver</th><th>Recorded</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.track)}</strong><div class="tiny muted">${esc(r.kind==='manual'?'Manual · reported best':r.sourceName+' · Timing')}</div></td><td>${esc(r.lane)}</td><td><strong>${timingSeconds(r.best)}</strong></td><td>${esc(r.driver)}</td><td>${date(r.recordedAt)}</td><td>${btn('View record','lane-record','small',r.id)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No lane records yet. Receive eligible Timing laps, or record a manual test with a track, lane and positive best lap time.</p>'}`)}</section>`;
}
function openLaneRecord(id){
  if(!local()||!carId)return;const r=(db._view?.lanes||PaceModel.laneRecords(db,carId)).find(r=>r.id===id);
  if(!r){toast('This record changed. The lane summary has been refreshed.');render();return;}
  modal('Lane '+r.lane+' · '+r.track,`${badge(r.kind==='manual'?'Reported manual best':'Measured Timing record','info')}${dl([['Best lap',timingSeconds(r.best)],['Driver',r.driver],['Recorded',r.kind==='manual'?date(r.recordedAt):connectionTime(r.recordedAt)],['Session',r.session],['Heat',r.heat],['Lap number',r.bestLap?String(r.bestLap.number):'Not recorded'],['Direction',r.direction],['Voltage',r.voltage==='Unknown'?'Unknown':r.voltage+' V'],['Magnets',r.magnetStatus],['Configuration',r.configuration]])}<h3 class="mt">Configuration recorded at the time</h3>${dl(Object.entries(r.technical||{}).map(([key,value])=>[techLabels[key]||key,value]))}${r.components?.length?`<h3 class="mt">Captured components</h3>${dl(r.components.map(p=>[p.position||p.name,p.name+' × '+p.quantity]))}`:''}<p class="tiny muted">Current car edits do not rewrite this record’s configuration. This view is a snapshot; reopen after results change. ${r.kind==='manual'?'A manual best has no individual-lap validity evidence.':'Corrections and withdrawals recompute lane records; race-classification adjustments do not change measured lap times.'}</p><div class="actions">${r.kind==='manual'?btn('Open manual configuration','test-snapshot','',r.testId):btn('Open Timing session','timing-session','',r.recordKey)}</div>`,null);
}
