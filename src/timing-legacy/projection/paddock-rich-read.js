'use strict';
// Only reads qualified rich history. Unknown historical values stay unknown;
// neither this adapter nor its renderer authorises richer writes or approval.
const schema=require('./paddock-rich-schema');
const check=ok=>{if(!ok)throw Object.assign(Error('Invalid rich history response. Previous cached data was retained.'),{code:'HISTORY_INVALID'});};
function shape(v,s){
 // Historical laps contain many explicit nulls. Select that schema directly
 // instead of throwing/catching an exception for every unknown field.
 if(v===null&&s.anyOf?.some(option=>option.type==='null'))return;
 if(s.anyOf){for(const option of s.anyOf)try{shape(v,option);return;}catch{}check(false);}
 if(Object.hasOwn(s,'const'))check(v===s.const);
 if(s.enum)check(s.enum.includes(v));
 switch(s.type){
 case 'null':check(v===null);break;
 case 'boolean':check(typeof v==='boolean');break;
 case 'string':check(typeof v==='string');check([...v].length>=(s.minLength??0)&&[...v].length<=(s.maxLength??Infinity));if(s.pattern)check(new RegExp(s.pattern).test(v));if(s.format==='date-time')check(Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v);break;
 case 'integer':check(Number.isSafeInteger(v)); // falls through
 case 'number':check(typeof v==='number'&&Number.isFinite(v)&&v>=(s.minimum??-Infinity)&&v<=(s.maximum??Infinity));break;
 case 'array':check(Array.isArray(v)&&v.length>=(s.minItems??0)&&v.length<=(s.maxItems??Infinity));v.forEach(x=>shape(x,s.items));break;
 case 'object':check(v&&typeof v==='object'&&!Array.isArray(v));for(const k of s.required||[])check(Object.hasOwn(v,k));for(const k of Object.keys(v)){check(Object.hasOwn(s.properties,k)||s.additionalProperties!==false);if(Object.hasOwn(s.properties,k))shape(v[k],s.properties[k]);}break;
 }
}
const unique=(rows,key='id')=>{check(new Set(rows.map(r=>r[key])).size===rows.length);};
function head(v){
 shape(v.body,schema.body);const {race:r,context:c}=v.body;
 unique(r.participants);unique(r.heats);unique(r.track.lanes,'lane');unique(c.classes);unique(c.teams);
 check(r.name.trim()&&r.participants.length&&v.body.provenance.evidence.trim());
 unique(v.body.provenance.missing.map(id=>({id})));
 const interval=x=>check(x.startedAtMs===null||x.endedAtMs===null||x.endedAtMs>=x.startedAtMs);
 check(r.startedAt===null||r.endedAt===null||r.endedAt>=r.startedAt);r.heats.forEach(interval);
 unique(r.participants.filter(p=>p.carId!==null),'carId');
 const has=(xs,id)=>xs.some(x=>x.id===id);
 for(const p of r.participants){
  unique(p.drivers);unique(p.stints);check(p.teamId===null||has(c.teams,p.teamId));
  check(p.kind!=='virtual'||p.carId===null&&p.configuration===null);
  check(p.configuration===null||p.carId!==null);p.stints.forEach(interval);
  if(p.configuration?.kind==='current')check(p.carId===p.configuration.carId&&p.configuration.databaseId===v.databaseId);
  for(const s of p.stints)check(has(r.heats,s.heatId)&&has(p.drivers,s.driverId)&&r.track.lanes.some(l=>l.lane===s.lane));
 }
 const awards=new Set();
 for(const a of c.classification){
  check(has(r.participants,a.participantId));const key=JSON.stringify([a.participantId,a.scope,a.scopeId,a.classId]);check(!awards.has(key));awards.add(key);
  check(a.classId===null||has(c.classes,a.classId));
  if(a.scope==='overall')check(a.scopeId===null&&a.classId===null);
  if(a.scope==='class')check(a.classId!==null&&a.classId===a.scopeId);
  if(a.scope==='heat')check(has(r.heats,a.scopeId));
  if(['final','championship-award'].includes(a.scope))check(a.scopeId!==null);
  check(a.position!==1||a.status==='finished');
  check((a.score===null)===(a.scoreUnit===null));
  unique(a.countedHeatIds.map(id=>({id})));unique(a.droppedHeatIds.map(id=>({id})));
  check([...a.countedHeatIds,...a.droppedHeatIds].every(id=>has(r.heats,id))&&!a.countedHeatIds.some(id=>a.droppedHeatIds.includes(id)));
 }
 check(v.accepted.state==='active'&&v.lapCounts.length===r.participants.length);
 unique(v.lapCounts,'participantId');check(v.lapCounts.every(x=>has(r.participants,x.participantId)));
 check(v.lapCounts.reduce((n,x)=>n+x.count,0)<=50000);
 // The small common view is only for shared paging and car-selection controls.
 // Classification and laps are rendered from their original rich shape.
 return {...v,format:'history-v1',protocol:'shared',payload:{...r,state:'active',revision:v.accepted.revision,notes:c.notes},summaries:[],warnings:[],requiresCorrection:false,summaryCoverage:'unavailable'};
}
function laps(v,o){
 check(v.participantId===o.participantId&&v.offset===(o.offset??0)&&Number.isSafeInteger(v.total)&&v.total>=0&&Array.isArray(v.laps)&&v.laps.length<=250);
 check(v.offset<=v.total&&v.offset+v.laps.length<=v.total&&v.nextOffset===(v.offset+v.laps.length===v.total?null:v.offset+v.laps.length)&&(v.nextOffset===null||v.laps.length>0));unique(v.laps);
 for(const l of v.laps){shape(l,schema.lap);check(new Set(l.flags).size===l.flags.length);if(l.personalRecordEligible===true||l.trackRecordEligible===true)check(l.valid===true&&l.pit===false&&l.durationMs!==null&&!l.flags.includes('invalid'));check(!l.flags.includes('invalid')||l.valid!==true);}
 return {...v,protocol:'shared'};
}
module.exports={head,laps,shape};
