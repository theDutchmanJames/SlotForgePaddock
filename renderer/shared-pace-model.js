(function(root){
 'use strict';
 const canonical=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const present=v=>v!==null&&v!==undefined&&v!=='';
 const text=v=>!present(v)?'Unknown':typeof v==='object'?JSON.stringify(canonical(v)):String(v);
 function differences(left,right){
  const a=left?.technical||{},b=right?.technical||{},rows=[...new Set([...Object.keys(a),...Object.keys(b)])].sort().map(key=>({key,left:text(a[key]),right:text(b[key]),status:!present(a[key])||!present(b[key])?'unknown':text(a[key])===text(b[key])?'same':'different'}));
  const components=c=>c?.components?JSON.stringify(c.components.map(canonical).sort((x,y)=>JSON.stringify(x).localeCompare(JSON.stringify(y)))):null;
  const describe=c=>!c?.components?'Unknown':c.components.length?c.components.map(x=>(x.position?x.position+': ':'')+(x.name||'Unnamed part')+' × '+(x.quantity??'Unknown')).sort().join('; '):'No tracked components recorded';
  const ac=components(left),bc=components(right);rows.push({key:'Captured components',left:describe(left),right:describe(right),status:ac===null||bc===null?'unknown':ac===bc?'same':'different'});return rows;
 }
 function warnings(a,b){
  const notes=[];
  if(!a.track.id||!b.track.id)notes.push('Track identity is missing. Matching names do not establish the same circuit.');
  else if(a.sourceId!==b.sourceId||a.track.id!==b.track.id)notes.push('Different source-scoped track identities. These runs are not confirmed to be on the same circuit.');
  const am=a.metrics,bm=b.metrics;
  if(am.unknownLaneLaps||bm.unknownLaneLaps)notes.push('Some laps have unknown lanes.');
  if(am.lanes.length!==1||bm.lanes.length!==1)notes.push('The selection includes multiple lanes or has no known lane. Choose one lane on each side for a closer comparison.');
  else if(am.lanes[0]!==bm.lanes[0])notes.push('Different lanes are selected.');
  if(am.lanes.some(lane=>bm.lanes.includes(lane)&&a.track.lanes.find(l=>l.lane===lane)?.lengthM!==b.track.lanes.find(l=>l.lane===lane)?.lengthM))notes.push('Recorded lane lengths differ. The circuit may have changed between these sessions.');
  if(am.unknownDriverLaps||bm.unknownDriverLaps)notes.push('Some laps have unknown drivers.');
  if(am.driverIds.length!==1||bm.driverIds.length!==1)notes.push('The selection includes multiple drivers or has no known driver.');
  else if(a.sourceId!==b.sourceId||a.sessionId!==b.sessionId||am.driverIds[0]!==bm.driverIds[0])notes.push('Driver identities are session-scoped. Matching names across sessions do not verify the same person.');
  if(am.validLaps<5||bm.validLaps<5)notes.push('Small sample: at least one side has fewer than five valid non-pit laps.');
  if(!am.validLaps||!bm.validLaps)notes.push('At least one selection has no timed, valid, non-pit laps. Unknown values are not zero.');
  if(!a.configuration||!b.configuration)notes.push('A captured configuration is missing. Today’s setup is not substituted.');
  if(a.provenance.kind==='historical'||b.provenance.kind==='historical')notes.push('Historical evidence is included; its missing measurements remain unknown.');
  if(a.sourceId===b.sourceId&&a.sessionId===b.sessionId&&a.participantId===b.participantId)notes.push('Both sides use the same recorded participant. The selected laps may overlap.');
  notes.push('Track direction, voltage, grip and environmental conditions are not established by these results. Pace differences alone do not prove a setup improvement.');return notes;
 }
 const api={text,differences,warnings};if(typeof module==='object'&&module.exports)module.exports=api;else root.SharedPaceModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
