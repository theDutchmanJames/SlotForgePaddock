'use strict';
// Historical intake is evidence, never a measured-result delivery or an award.
const hash=require('./paddock-value-hash');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const text=(v,n=200)=>typeof v==='string'?v.slice(0,n):'';
const numeric=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
function capture(session,laps){
 if(!session||!id(session.id))throw Error('Saved session not found or its identity is unsupported.');
 if(session.sessionType==='tokens')throw Error('Token stints are not supported by Historical Review yet.');
 if(session.paddockDelivery?.payload||session.paddockDelivery?.previousPayload||session.paddockDelivery?.receipt)throw Error('This session already has a result-delivery identity. Use Result Delivery to recover or correct it.');
 if(!Array.isArray(laps)||laps.length>50000)throw Error('Historical Review supports at most 50,000 laps per session.');
 const evidence=structuredClone({session,laps});
 if(Buffer.byteLength(JSON.stringify(evidence))>48*1024*1024)throw Error('The original evidence exceeds the 48 MiB local journal limit.');
 return evidence;
}
function project(e,databaseId,reviewedCars={},nativeTiming=false){
 const {session:s,laps}=e,participants=[],groups=new Map(),heats=new Map(),lanes=new Set();
 const missing=new Set(['crossing-times','driver-boundaries','classification','record-eligibility','race-date']);
 const virtualIds=new Set((s.virtualRivals||[]).flatMap(v=>v.rivals||[v]).flatMap(v=>[v.carId,v.driverId,v.id]).filter(Boolean));
 const names=new Map((s.standings||[]).map(r=>[r.carId,r]));
 for(const l of laps){
  if(nativeTiming&&l.sessionId!==undefined&&l.sessionId!==s.id)throw Error('A saved lap belongs to another session. Retain its original evidence for reconciliation.');
  if(!Number.isInteger(l.lapNumber)||l.lapNumber<1||l.lapNumber>1000000)throw Error('A saved lap has an unsupported lap number. Original evidence was not altered.');
  const virtual=l.virtual===true||l.virtualRival===true||virtualIds.has(l.carId)||virtualIds.has(l.driverId);
  const key=JSON.stringify([virtual,l.carId||null,l.carId?null:l.lane??null]);
  let p=groups.get(key);
  if(!p){
   const saved=s.paddockJournal?.captures?.[l.carId],configuration=virtual?null:saved?.configuration||null;
   if(configuration&&configuration.databaseId!==databaseId)throw Error('Historical configuration belongs to another collection. Reconnect the original collection.');
   const reviewed=Object.hasOwn(reviewedCars,l.carId)?reviewedCars[l.carId]:null;
   if(reviewed&&!id(reviewed))throw Error('Invalid reviewed historical car identity.');
   if(configuration&&reviewed&&configuration.carId!==reviewed)throw Error('Captured car identity conflicts with the reviewed migration link.');
   p={id:'participant-'+participants.length,kind:virtual?'virtual':'physical',carId:virtual?null:configuration?.carId||reviewed||null,configuration,displayName:text(saved?.name||names.get(l.carId)?.carName||names.get(l.carId)?.driverName||l.driverName||l.carId)||'Unknown participant',teamId:null,drivers:[],stints:[],laps:[]};
   if(!configuration&&!virtual)missing.add('configuration');groups.set(key,p);participants.push(p);
  }
  const driverId=id(l.driverId)?l.driverId:null;
  if(driverId&&!p.drivers.some(d=>d.id===driverId))p.drivers.push({id:driverId,name:text(l.driverName||names.get(l.carId)?.driverName)||driverId});
  const lane=Number.isInteger(l.lane)&&l.lane>=1&&l.lane<=64?l.lane:null;if(lane)lanes.add(lane);
  let heatId=null;if(l.heat!==undefined&&l.heat!==null&&l.heat!==''){const key=String(l.heat);if(!heats.has(key))heats.set(key,{id:'heat-'+heats.size,name:text('Heat '+key),startedAtMs:null,endedAtMs:null});heatId=heats.get(key).id;}
  const length=lane?numeric(s.paddockJournal?.lanes?.[lane-1],0,100000):null;if(length===null)missing.add('lane-lengths');
  const flags=['invalid','tooSlow','late','redFlag'].filter(k=>nativeTiming?!!l[k]:l[k]===true);
  // Native Timing lapRows stores only true exclusions. Absence means a normal
  // lap, not missing evidence. Explicit null/invalid values remain unknown.
  // This rule must never be inferred for arbitrary Historical Review intake.
  const valid=flags.length?false:typeof l.valid==='boolean'?l.valid:nativeTiming&&l.valid===undefined?true:null;
  const pit=typeof l.pit==='boolean'?l.pit:nativeTiming&&l.pit===undefined?false:null;
  const durationMs=numeric(l.time,0.001,86400000),eligible=nativeTiming&&!virtual&&valid===true&&pit===false&&durationMs!==null;
  p.laps.push({id:'lap-'+p.id+'-'+p.laps.length,originLapId:id(l.id)?l.id:null,stintId:null,heatId,driverId,lane,number:l.lapNumber,durationMs,endedAtMs:null,valid,pit,personalRecordEligible:eligible&&!l.noPersonalBest,trackRecordEligible:eligible&&!l.noTrackRecord,countsForDistance:!virtual,distanceM:virtual?null:length,flags,reason:text(l.reason,500)});
 }
 if(!participants.length)throw Error('This session has no saved lap evidence to submit.');
 if(participants.length>256||heats.size>1000||participants.some(p=>p.drivers.length>100))throw Error('Historical participant/heat limits exceeded.');
 const linked=participants.map(p=>p.carId).filter(Boolean);if(new Set(linked).size!==linked.length)throw Error('Multiple participant entries refer to the same physical car; this evidence needs manual reconciliation.');
 const result={format:'history-v1',provenance:{kind:'historical',evidence:'Saved Timing session and lap records. The immutable original is retained in Timing. Missing timing boundaries and classification are not reconstructed.',missing:[...missing]},race:{name:text(s.setupName)||'Saved session',type:['practice','qualifying','endurance'].includes(s.sessionType)?s.sessionType:'race',startedAt:null,endedAt:null,track:{id:id(s.trackId)?s.trackId:null,name:text(s.trackName)||'Unknown track',lanes:[...lanes].sort((a,b)=>a-b).map(lane=>({lane,lengthM:numeric(s.paddockJournal?.lanes?.[lane-1],0,100000)}))},heats:[...heats.values()],participants},context:{savedAt:iso(s.date),endedBy:typeof s.endedBy==='string'?text(s.endedBy):null,resumed:Number.isInteger(s.resumed)?numeric(s.resumed,0,100000):null,weather:typeof s.weatherNote==='string'?text(s.weatherNote,2000):null,teams:[],classes:[],classification:[],systemChanges:[],scoringSnapshot:null,notes:'Historical evidence only. Classification, awards, race-system settings and original snapshots remain preserved in Timing’s journal. No acceptance, mileage or record eligibility is claimed. Current car links/configuration and current track lengths are never substituted for historical evidence.'}};
 const mapped=require('./paddock-rich-mapper').historical(result,e,groups);
 if(nativeTiming){
  mapped.provenance.evidence+=' Native Timing saved-lap semantics preserve explicit exclusions and omitted false flags; this is a local database conversion, not Historical Review approval.';
  if(participants.every(p=>p.laps.every(l=>l.valid!==null&&l.pit!==null&&l.durationMs!==null)))mapped.provenance.missing=mapped.provenance.missing.filter(k=>k!=='record-eligibility');
 }
 if(Object.keys(reviewedCars).length)mapped.provenance.evidence+=' Physical car identities without captured configurations were explicitly reconciled through the initial collection migration. Configurations remain unknown.';
 return mapped;
}
const bundle=(e,databaseId,reviewedCars={})=>project(e,databaseId,reviewedCars,false);
// Local adoption and corrections of adopted Timing originals only. The shared
// engine must verify the originals itself; this function is not an authority flag.
const nativeBundle=(e,databaseId,reviewedCars={})=>project(e,databaseId,reviewedCars,true);
function preview(e,db,reviewedCars){const b=bundle(e,db,reviewedCars);return {sessionId:e.session.id,originHash:hash(e),name:b.race.name,track:b.race.track.name,laps:e.laps.length,missing:b.provenance.missing,participants:b.race.participants.map(p=>({name:p.displayName,kind:p.kind,carId:p.carId,laps:p.laps.length})),bundle:b};}
module.exports={capture,bundle,nativeBundle,preview,id,hash};
