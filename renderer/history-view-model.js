(function(root){
 'use strict';
 const unknown='Unknown';
 const text=v=>v===null||v===undefined||v===''?unknown:String(v);
 const seconds=v=>Number.isFinite(v)?(v/1000).toLocaleString('en-GB',{minimumFractionDigits:3,maximumFractionDigits:3})+' s':unknown;
 function normalize(head){
  const bundle=head.body,rich=bundle?.format==='history-v1',race=bundle?.race||bundle?.payload||null;
  const context=rich?{...bundle.context,notes:head.accepted?.state==='active'?String(bundle.context.notes||'').replace(/^Pending historical evidence, not accepted\.\s*/, 'Accepted historical Timing evidence. '):bundle.context.notes}:{classes:[],teams:[],notes:race?.notes||'',classification:(race?.standings||[]).map(s=>({...s,scope:'overall',scopeId:null,classId:null,laps:s.classifiedLaps,elapsedMs:s.classifiedElapsedMs,score:s.points,scoreUnit:'points',effects:(race.adjustments||[]).filter(a=>a.participantId===s.participantId)}))};
  return {rich,race,context,provenance:rich?bundle.provenance:{kind:'measured',evidence:'Received from Timing with its captured configuration.',missing:[]}};
 }
 function lap(l,p,race,rich){
  const stint=p.stints.find(s=>s.id===l.stintId),heatId=rich?l.heatId:stint?.heatId,driverId=rich?l.driverId:stint?.driverId,lane=rich?l.lane:stint?.lane;
  const eligibility=v=>v===true?'Eligible':v===false?'Excluded':unknown;
  return [text(l.number),race.heats.find(h=>h.id===heatId)?.name||unknown,p.drivers.find(d=>d.id===driverId)?.name||unknown,text(lane),seconds(l.durationMs),seconds(l.endedAtMs),l.valid===true?'Valid':l.valid===false?'Invalid':unknown,l.pit===true?'Pit':l.pit===false?'No':unknown,eligibility(rich?l.personalRecordEligible:l.recordEligible),eligibility(rich?l.trackRecordEligible:l.recordEligible),l.countsForDistance?l.distanceM===null?unknown:l.distanceM+' m':'Not counted',[(l.flags||[]).join(', '),l.reason].filter(Boolean).join(' · ')||'—'];
 }
 function classification(race,context){
  const heats=new Map(race.heats.map((h,i)=>[h.id,h.name+' ['+(i+1)+']']));
  const amount=(value,unit)=>value==null?unknown:unit==='ms'?seconds(value):text(value)+(unit?' '+unit:'');
  const yes=v=>v===true?'Yes':v===false?'No':unknown;
  const headers=['Participant','Scope','Class / scope','Position','Status','Classified laps','Classified time','Points','Score','Gap','Counted / dropped heats','Evidence','Adjustments'];
  const rows=context.classification.map(a=>[
   race.participants.find(p=>p.id===a.participantId)?.displayName||a.participantId,a.scope,
   context.classes.find(c=>c.id===a.classId)?.name||heats.get(a.scopeId)||a.scopeId||'—',
   a.position??unknown,a.status,a.laps??unknown,seconds(a.elapsedMs),a.points??unknown,
   amount(a.score,a.scoreUnit),a.gap?amount(a.gap.value,a.gap.unit):unknown,
   ['countedHeatIds','droppedHeatIds'].map(k=>(a[k]||[]).map(id=>heats.get(id)||id).join(', ')||'None recorded').join(' / '),
   'Incomplete: '+yes(a.incomplete)+' · Estimated: '+yes(a.estimated),
   (a.effects||[]).map(e=>amount(e.amount,e.kind==='time'?'ms':e.kind==='other'?'':e.kind)+' · '+e.reason).join('; ')||'None recorded'
  ]);
  return {headers,rows};
 }
 const api={text,seconds,normalize,lap,classification};if(typeof module==='object'&&module.exports)module.exports=api;else root.HistoryViewModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
