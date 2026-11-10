let buildCurvePercent=50;
const performanceMetrics=[
  ['ratio','Gear ratio',':1',3,1],['axleRpm','No-load rear-axle speed','RPM',0,1],
  ['speedKmh','No-load theoretical speed','km/h',2,1],['rollout','Travel per motor revolution','mm',2,1],
  ['axleTorque','Rear-axle torque from rating','gf·cm',1,1/0.0000980665],['forceN','Driving force from rating','N',2,1],
  ['peakPowerW','Estimated peak motor power','W',2,1],['peakMotorRpm','Motor speed at peak power','RPM',0,1]
];
function performanceNumber(n,d=2){return Number.isFinite(n)?n.toLocaleString('en-GB',{maximumFractionDigits:d}):'—';}
function performanceValue(m,key,d,multiplier=1){return m[key]===null||m[key]===undefined?'—':performanceNumber(m[key]*multiplier,d);}
function performanceStats(input){
  const m=PerformanceModel.calculate(input);
  return `<div class="performance-stats">${performanceMetrics.map(([key,label,unit,d,multiplier])=>`<div class="performance-stat"><span>${label}</span><strong data-performance-result="${key}">${performanceValue(m,key,d,multiplier)} <small>${unit}</small></strong></div>`).join('')}</div><p class="tiny muted">Torque basis: <strong>${esc(m.torqueType)}</strong> at ${performanceNumber(m.torqueVoltage)} V. RPM basis: ${performanceNumber(m.ratedVoltage)} V. ${m.torqueType==='Stall'?'Stall torque and force apply at zero speed, not at the no-load speed above.':m.torqueType==='Rated running'?'Rated torque and force apply at the manufacturer’s rated operating point, not at no-load RPM.':'Confirm the torque type to calculate axle torque and driving force.'}</p>`;
}
function performanceCurve(input,kind){
  const m=PerformanceModel.calculate(input),torque=kind==='torque',max=torque?m.motorTorque:m.peakPowerW;
  if(!m.curveReady)return '';
  const x0=50,y0=24,w=280,h=130;
  const points=Array.from({length:41},(_,i)=>{const p=PerformanceModel.point(input,i*2.5),v=torque?p.torqueGfCm:p.powerW;return `${x0+i/40*w},${y0+h-v/max*h}`;}).join(' ');
  const title=torque?'Motor torque (gf·cm)':'Motor mechanical power (W)',cursor=x0+w*buildCurvePercent/100;
  return `<figure class="performance-curve"><figcaption>${title}</figcaption><svg viewBox="0 0 350 200" role="img" aria-label="${title} versus motor RPM. ${torque?'Torque decreases linearly from stall torque at zero RPM to zero at no-load RPM.':'Power peaks at half the no-load RPM.'}"><path class="curve-grid" d="M50 24H330M50 89H330M50 154H330"/><path class="curve-axis" d="M50 24V154H330"/><polyline class="curve-line ${torque?'torque':'power'}" points="${points}"/><line class="curve-cursor" data-curve-cursor x1="${cursor}" x2="${cursor}" y1="24" y2="154"/><text x="44" y="28" text-anchor="end">${performanceNumber(max,1)}</text><text x="44" y="157" text-anchor="end">0</text><text x="50" y="175">0</text><text x="190" y="175" text-anchor="middle">${performanceNumber(m.ratedRpm/2,0)}</text><text x="330" y="175" text-anchor="end">${performanceNumber(m.ratedRpm,0)}</text><text x="190" y="194" text-anchor="middle">Motor RPM</text></svg></figure>`;
}
function buildPerformanceInput(){
  const gear=BuildModel.gearing(effectiveBuildState(),db);
  return {...PerformanceModel.blank(),...(buildState.performance||{}),pinion:gear.pinion.value,gear:gear.gear.value};
}
function buildPerformanceEditor(){
  const values={...PerformanceModel.blank(),...(buildState.performance||{})};
  return `<section class="panel build-performance-editor"><h2>${icon('timer')}Motor & tyres</h2><p class="tiny muted">Optional specifications for theoretical performance. Enter the RPM and torque test voltages separately.</p><div class="form-grid">${Object.entries(PerformanceModel.numbers).map(([key,[label,max]])=>`<label class="field">${esc(label)}<input data-build-performance="${key}" type="number" min="0" max="${max}" step="any" inputmode="decimal" value="${esc(values[key])}" placeholder="Optional"></label>`).join('')}${Object.entries(PerformanceModel.choices).map(([key,choices])=>`<label class="field">${key==='motorType'?'Motor type':'Torque rating type'}<select data-build-performance="${key}">${choices.map(value=>`<option ${values[key]===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label>`).join('')}</div><p class="tiny muted">Torque uses gram-force centimetres (gf·cm), often labelled g·cm. Use the fitted rear tyre’s outside diameter. Recheck these entries after changing parts.</p></section>`;
}
function buildPerformanceComparison(input){
  const reference=buildState.performanceBaseline;
  if(!reference)return '<p class="muted tiny">Keep the current figures as a reference, then change the gears, motor or tyre diameter to compare. The reference stays with this draft.</p>';
  const before=PerformanceModel.calculate(reference),after=PerformanceModel.calculate(input);
  const delta=(key,d,multiplier)=>{const a=before[key],b=after[key];if(a===null||b===null||a===undefined||b===undefined)return '—';const change=b-a;return `${change>0?'+':''}${performanceNumber(change*multiplier,d)}${a!==0?` (${change>0?'+':''}${performanceNumber(change/a*100,1)}%)`:''}`;};
  const changedBasis=reference.torqueType!==input.torqueType||reference.motorType!==input.motorType||Number(reference.ratedVoltage)!==Number(input.ratedVoltage)||Number(reference.torqueVoltage)!==Number(input.torqueVoltage);
  return `<p class="tiny muted">Reference: ${esc(reference.pinion||'—')} / ${esc(reference.gear||'—')} teeth · ${esc(reference.ratedRpm||'—')} RPM · ${esc(reference.motorTorque||'—')} gf·cm (${esc(reference.torqueType)}) · ${esc(reference.rearDiameter||'—')} mm tyres. RPM at ${esc(reference.ratedVoltage||'—')} V; torque at ${esc(reference.torqueVoltage||'—')} V.</p>${changedBasis?'<p class="note info tiny">Motor type, torque type or test voltages differ. These are different rating conditions, not a like-for-like motor comparison.</p>':''}<div class="table-wrap"><table class="performance-comparison"><thead><tr><th>Statistic</th><th>Reference</th><th>Current</th><th>Change</th></tr></thead><tbody>${performanceMetrics.map(([key,label,unit,d,multiplier])=>`<tr><th>${label}<small class="muted"> ${unit}</small></th><td>${performanceValue(before,key,d,multiplier)}</td><td>${performanceValue(after,key,d,multiplier)}</td><td>${changedBasis&&['axleTorque','forceN','peakPowerW','peakMotorRpm'].includes(key)?'Different basis':delta(key,d,multiplier)}</td></tr>`).join('')}</tbody></table></div>`;
}
function buildPerformanceReadout(input){
  const p=PerformanceModel.point(input,buildCurvePercent);if(!p)return '';
  return `<strong>${performanceNumber(p.rpm,0)} motor RPM</strong> · ${performanceNumber(p.torqueGfCm,1)} gf·cm · ${performanceNumber(p.powerW)} W<br><span class="muted">${performanceNumber(p.axleRpm,0)} axle RPM · ${performanceNumber(p.speedKmh)} km/h · ${performanceNumber(p.forceN)} N driving force (before losses / grip limits)</span>`;
}
function buildPerformanceResults(){
  const input=buildPerformanceInput(),m=PerformanceModel.calculate(input);
  return performanceStats(input)+`<h3>Torque & power curves</h3>${m.curveReady?`<div class="performance-curves">${performanceCurve(input,'torque')}${performanceCurve(input,'power')}</div><label class="field performance-slider">Explore motor speed · <span id="build-curve-percent">${buildCurvePercent}% of no-load RPM</span><input id="build-curve-speed" type="range" min="0" max="100" step="1" value="${buildCurvePercent}"></label><output id="build-curve-readout" class="performance-readout" aria-live="polite">${buildPerformanceReadout(input)}</output>`:`<p class="note info tiny">${m.reasons.map(esc).join(' ')}</p>`}<h3>Compare your build</h3><div class="actions">${btn(buildState.performanceBaseline?'Replace reference with current':'Keep current as reference','build-performance-reference','small')}${buildState.performanceBaseline?btn('Clear reference','build-performance-clear','small ghost'):''}</div>${buildPerformanceComparison(input)}`;
}
function buildPerformancePanel(){return `<section class="panel build-performance"><h2>${icon('timer')}Theoretical performance</h2><p class="tiny muted">Ideal calculations at the entered test voltages. No drivetrain losses or tyre slip are included. Figures do not predict actual acceleration, lap times or continuous motor power.</p><div id="build-performance-results" aria-live="polite">${buildPerformanceResults()}</div><details class="performance-assumptions"><summary>Calculation assumptions</summary><p class="tiny muted">Rear-axle RPM = motor RPM ÷ ratio. Rollout = tyre circumference ÷ ratio. Torque at the axle = motor torque × ratio. Driving force = axle torque ÷ tyre radius. Speed uses no-load RPM and the fitted tyre diameter.</p><p class="tiny muted">Curves assume a linear brushed DC motor torque–speed relationship at one voltage. Stall torque occurs at zero RPM, and zero external torque at no-load RPM. Peak mechanical power occurs at half each value; it is not a continuous rating. Brushless and unknown motors, unknown/running torque ratings, and unmatched or missing voltages do not produce a peak-power estimate. Smaller tyres increase force and reduce speed at the same RPM.</p></details></section>`;}
function refreshBuildPerformance(){const result=$('#build-performance-results');if(result)result.innerHTML=buildPerformanceResults();}
document.addEventListener('input',event=>{
  const el=event.target,key=el.dataset.buildPerformance;
  if(key&&Object.hasOwn(PerformanceModel.numbers,key)){buildState.performance??=PerformanceModel.blank();buildState.performance[key]=el.validity.badInput?'invalid':el.value;markBuildDirty();refreshBuildPerformance();}
  if(el.id==='build-curve-speed'){buildCurvePercent=Number(el.value);$('#build-curve-percent').textContent=buildCurvePercent+'% of no-load RPM';$('#build-curve-readout').innerHTML=buildPerformanceReadout(buildPerformanceInput());for(const cursor of document.querySelectorAll('[data-curve-cursor]')){cursor.setAttribute('x1',50+280*buildCurvePercent/100);cursor.setAttribute('x2',50+280*buildCurvePercent/100);}}
});
document.addEventListener('change',event=>{const key=event.target.dataset.buildPerformance;if(key&&Object.hasOwn(PerformanceModel.choices,key)){buildState.performance??=PerformanceModel.blank();buildState.performance[key]=event.target.value;markBuildDirty();refreshBuildPerformance();}});
