const crypto=require('node:crypto');
const contract=require('./timing-schema.cjs');
const results=require('../renderer/timing-results-model.js');
const MAX_BYTES=8*1024*1024,MAX_LAPS=50000,MAX_SESSIONS=10000;
function fault(code,message,status=400){const e=Error(message);e.apiCode=code;e.httpStatus=status;return e;}
function check(ok,message){if(!ok)throw fault('INVALID_PAYLOAD',message);}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
const sign=(key,value)=>crypto.createHmac('sha256',key).update(canonical(value)).digest('hex');
function capabilities(){return {timing:{versions:[1],profile:'/v1/timing/cars/{carId}',sessions:'/v1/timing/sessions',receipt:'/v1/timing/sessions/{sourceId}/{sessionId}',permission:'timingResults',configurationKinds:['current'],maxRequestBytes:MAX_BYTES,maxLaps:MAX_LAPS,maxParticipants:256,laneBase:1,durationUnit:'ms',distanceUnit:'m'}};}
function profile(store,carId,{includePicture=true}={}){
  const car=store.file&&store.expectedIdentity!==null?require('./sqlite-query.cjs').read(store,null,r=>r.one('cars',carId)).value:store.data.cars.find(c=>c.id===carId);if(!car)throw fault('CAR_NOT_FOUND','The requested car does not exist.',404);
  if(car.rebuild?.to){const e=fault('CAR_REBUILT','This car has been rebuilt. Select its successor for future races.',409);e.details={successor:car.rebuild.to};throw e;}
  // A capture must remain verifiable after restart, even for a previously unsaved collection.
  if(!store.data.timing.key)store.scopedTransact('@timing-key',db=>{db.timing.key=crypto.randomBytes(32).toString('hex');});
  const db=store.file&&store.expectedIdentity!==null?require('./sqlite-query.cjs').read(store,null,r=>{const installations=[];let offset=0;for(;;){const page=r.list('installations',{carId,offset,limit:200});installations.push(...page.rows);if(page.nextOffset===null)break;offset=page.nextOffset;}const parts=[...new Set(installations.filter(i=>!i.removed).map(i=>i.partId))].map(id=>r.one('parts',id));return {id:store.data.id,revision:store.data.revision,timing:store.data.timing,installations,parts};}).value:store.data,technical=Object.fromEntries(contract.fields.filter(k=>Object.hasOwn(car.technical,k)).map(k=>[k,car.technical[k]]));
  const components=db.installations.filter(i=>i.carId===carId&&!i.removed).map(i=>({partId:i.partId,name:db.parts.find(p=>p.id===i.partId).name,quantity:i.quantity,field:i.field,position:i.position,assemblyId:i.assemblyId||null})).sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));
  const revision=digest({databaseId:db.id,carId,kind:'current',technical,components});
  const unsigned={databaseId:db.id,carId,kind:'current',configurationId:revision,revision,carRevision:car.revision,capturedAt:new Date().toISOString(),technical,components};
  const configuration={...unsigned,signature:sign(db.timing.key,unsigned)};
  const value={integrationVersion:1,databaseId:db.id,databaseRevision:db.revision,car:{id:car.id,name:car.name,...Object.fromEntries(['maker','marque','model','scale','raceClass','picture','availability'].map(k=>[k,k==='picture'&&!includePicture?'':car[k]||''])),archived:!!car.archived},configuration};
  contract.validate(value,contract.schema.$defs.profile);return value;
}
function verifyConfiguration(db,carId,configuration){
  if(!configuration||configuration.databaseId!==db.id||configuration.carId!==carId)throw fault('CONFIGURATION_MISMATCH','The captured configuration belongs to another car or database.',409);
  const {signature,...unsigned}=configuration;
  const expected=sign(db.timing.key||'',unsigned);
  if(!db.timing.key||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw fault('CONFIGURATION_INVALID','Use an unchanged configuration captured from this Paddock database.',409);
  const {databaseId,kind,technical,components,revision,configurationId}=configuration;
  if(configurationId!==revision||revision!==digest({databaseId,carId,kind,technical,components}))throw fault('CONFIGURATION_INVALID','Configuration content and revision disagree.',409);
}
function unique(rows,key,label){const map=new Map();for(const row of rows){check(!map.has(row[key]),'Duplicate '+label+': '+row[key]);map.set(row[key],row);}return map;}
function validatePayload(payload,{stored=false}={}){
  if(payload?.integrationVersion!==1)throw fault('UNSUPPORTED_VERSION','Supported Timing integration versions: 1.',422);
  contract.validate(payload,contract.schema.$defs[payload.state==='withdrawn'?'withdrawal':'active']);
  check(Buffer.byteLength(JSON.stringify(payload))<=MAX_BYTES,'Session exceeds the 8 MiB limit.');
  if(payload.state==='withdrawn')return;
  const duration=Date.parse(payload.endedAt)-Date.parse(payload.startedAt);
  check(duration>=0&&duration<=604800000,'Session must last between zero and seven days.');
  const lanes=unique(payload.track.lanes,'lane','track lane'),heats=unique(payload.heats,'id','heat'),participants=unique(payload.participants,'id','participant');
  for(const h of heats.values())check(h.startedAtMs<=h.endedAtMs&&h.endedAtMs<=duration,'Heat times fall outside the session.');
  let lapCount=0;const cars=new Set(),lapIds=new Set();
  for(const p of participants.values()){
    check((p.carId===null)===(p.configuration===null),'Car identity and configuration must both be present or both be null.');
    check(p.kind!=='virtual'||p.carId===null,'Virtual participants must not reference physical cars.');
    if(p.carId){check(!cars.has(p.carId),'A physical car must use one participant across all heats and driver changes.');cars.add(p.carId);}
    const drivers=unique(p.drivers,'id','driver'),stints=unique(p.stints,'id','stint'),sequences=new Set(),lastLap=new Map();
    let previousEnd=-1,previousLapEnd=-1;
    for(const s of [...stints.values()].sort((a,b)=>a.startedAtMs-b.startedAtMs)){
      const h=heats.get(s.heatId);check(h&&drivers.has(s.driverId)&&lanes.has(s.lane),'Unknown heat, driver or lane in stint.');
      check(s.startedAtMs<=s.endedAtMs&&s.startedAtMs>=h.startedAtMs&&s.endedAtMs<=h.endedAtMs,'Stint times fall outside its heat.');
      check(s.startedAtMs>=previousEnd,'A participant cannot drive overlapping stints.');previousEnd=s.endedAtMs;
    }
    lapCount+=p.laps.length;check(lapCount<=MAX_LAPS,'Maximum 50,000 laps per session.');
    for(const l of [...p.laps].sort((a,b)=>a.endedAtMs-b.endedAtMs)){
      const s=stints.get(l.stintId);check(s,'Unknown lap stint.');
      check(!lapIds.has(l.id),'Duplicate lap ID.');lapIds.add(l.id);
      const sequence=s.heatId+':'+l.number;check(!sequences.has(sequence),'Duplicate lap number for participant and heat.');sequences.add(sequence);
      check(l.endedAtMs>=s.startedAtMs&&l.endedAtMs<=s.endedAtMs&&l.durationMs<=l.endedAtMs-heats.get(s.heatId).startedAtMs,'Lap times fall outside the heat/stint.');
      if(!stored)check(l.endedAtMs-l.durationMs>=previousLapEnd,'Overlapping measured laps for one participant, including across heats.');previousLapEnd=l.endedAtMs;
      const last=lastLap.get(s.heatId);check(!last||l.number>last.number&&l.endedAtMs-l.durationMs>=last.endedAtMs,'Overlapping or out-of-order measured laps.');lastLap.set(s.heatId,l);
      check(!l.recordEligible||l.valid&&!l.pit,'Invalid and pit laps cannot be record eligible.');
    }
  }
  unique(payload.standings,'participantId','standing');
  for(const s of payload.standings){check(participants.has(s.participantId),'Unknown participant in final standings.');check(s.status==='finished'||s.position!==1,'Only a finished participant can be the winner.');}
  for(const a of payload.adjustments)check(participants.has(a.participantId),'Unknown adjustment participant.');
  // Previously accepted cross-heat overlaps remain readable, but are quarantined
  // by the derived-statistics model until Timing sends a valid higher revision.
  if(!(stored&&results.requiresCorrection(payload)))for(const p of participants.values())if(p.summary){const expected=results.statistics(payload,p,true);for(const key of Object.keys(expected))if(typeof expected[key]==='number'&&typeof p.summary[key]==='number'?Math.abs(expected[key]-p.summary[key])>0.000001:expected[key]!==p.summary[key])throw fault('SUMMARY_MISMATCH','Participant '+p.id+' summary disagrees with measured laps: '+key);}
}
function formatReceipt(db,record,duplicate,requiresCorrection,summaries){const warnings=[...record.warnings];if(requiresCorrection)for(const p of record.payload.participants)if(p.carId)warnings.push({code:'SESSION_REQUIRES_CORRECTION',carId:p.carId});return {ok:true,integrationVersion:1,databaseId:db.id,sourceId:record.payload.source.id,sessionId:record.payload.sessionId,revision:record.payload.revision,state:record.payload.state,contentHash:record.contentHash,receivedAt:record.receivedAt,duplicate,warnings,summaries};}
function receipt(db,record,duplicate=false){if(record.format==='history-v1')throw fault('RESULT_REQUIRES_SHARED_HISTORY','Read this session through the shared-history API.',409);return formatReceipt(db,record,duplicate,results.requiresCorrection(record.payload),results.summaries(record.payload));}
function receive(store,input,{guarded=false}={}){
  validatePayload(input);if(input.databaseId!==store.data.id)throw fault('DATABASE_MISMATCH','This session targets a different Paddock database.',409);
  if(store.deferredState)return require('./scoped-write.cjs').receiveTiming(store,input,{guarded});
  const contentHash=digest(input),existing=store.data.timing.sessions.find(s=>s.payload.source.id===input.source.id&&s.payload.sessionId===input.sessionId);
  if(existing?.format==='history-v1')throw fault('RESULT_REQUIRES_SHARED_HISTORY','This session requires the shared-history format; legacy writes cannot replace it.',409);
  if(existing){
    if(existing.guard&&!guarded&&(input.revision!==existing.payload.revision||contentHash!==existing.contentHash))throw fault('HISTORY_GUARD_REQUIRED','This session uses guarded shared-history writes. Reload it and submit a guarded operation.',409);
    if(input.revision<existing.payload.revision)throw fault('STALE_REVISION','A newer session revision is already stored.',409);
    if(input.revision===existing.payload.revision){if(contentHash!==existing.contentHash)throw fault('REVISION_CONFLICT','This revision already exists with different content.',409);return receipt(store.data,existing,true);}
  }
  if(!existing&&store.data.timing.sessions.length>=MAX_SESSIONS)throw fault('CAPACITY_EXCEEDED','Maximum 10,000 imported session identities in this database.',507);
  const warnings=[];
  if(input.state==='active')for(const p of input.participants){if(!p.carId)continue;const car=store.data.cars.find(c=>c.id===p.carId);if(!car)throw fault('CAR_NOT_FOUND','Car '+p.carId+' does not exist in this database.',404);verifyConfiguration(store.data,p.carId,p.configuration);if(car.archived)warnings.push({code:'CAR_ARCHIVED',carId:car.id});}
  const carIds=[...new Set([...(existing?.carIds||[]),...(input.state==='active'?input.participants.map(p=>p.carId).filter(Boolean):[])])];
  const history=[...(existing?.history||[]),...(existing?[{revision:existing.payload.revision,state:existing.payload.state,contentHash:existing.contentHash,receivedAt:existing.receivedAt}]:[])];
  if(history.length>=1000)throw fault('CAPACITY_EXCEEDED','Maximum 1,000 accepted revisions per session.',507);
  const record={payload:structuredClone(input),contentHash,receivedAt:new Date().toISOString(),warnings,carIds,history,lastName:input.state==='active'?input.name:existing?.lastName||input.sessionId,...(existing?.guard?{guard:existing.guard}:{})};
  const active=input.state==='active'?input:existing?.payload.state==='active'?existing.payload:null;
  if(active)record.lastActive={startedAt:active.startedAt,trackId:active.track.id,trackName:active.track.name};
  else if(existing?.lastActive)record.lastActive=structuredClone(existing.lastActive);
  try{store.transact(db=>{const index=db.timing.sessions.findIndex(s=>s.payload.source.id===input.source.id&&s.payload.sessionId===input.sessionId);if(index<0)db.timing.sessions.push(record);else db.timing.sessions[index]=record;});}
  catch(e){if(e.apiCode)throw e;throw fault(e.code==='COLLECTION_LIMIT'?'CAPACITY_EXCEEDED':'STORAGE_FAILED',e.code==='COLLECTION_LIMIT'?'Database metadata exceeds its working limit. Archive unneeded records before retrying.':'Paddock could not save this session. Retry after checking host storage.',e.code==='COLLECTION_LIMIT'?507:500);}
  return receipt(store.data,record);
}
function validateStored(db,previous=null){
  const t=db.timing;check(t&&typeof t==='object'&&!Array.isArray(t),'Missing Timing storage.');check(t.key===null||typeof t.key==='string'&&/^[a-f0-9]{64}$/.test(t.key),'Invalid Timing capture key.');check(Array.isArray(t.sessions)&&t.sessions.length<=MAX_SESSIONS,'Invalid Timing sessions.');
  // Only a validated immutable predecessor supplied by Store may be reused.
  // Key, identity or replica-policy changes require signature validation again.
  const unchanged=new Set(previous&&previous.id===db.id&&previous.timing.key===t.key&&!!previous.club?.replica===!!db.club?.replica?previous.timing.sessions:[]),ids=new Set();
  for(const r of t.sessions){
    check(r.format===undefined||r.format==='history-v1','Unsupported stored session format.');
    if(r.format==='history-v1'){require('./rich-history.cjs').validateRecord(db,r);const id=r.payload.source.id+':'+r.payload.sessionId;check(!ids.has(id),'Duplicate stored session identity.');ids.add(id);continue;}
    if(!unchanged.has(r))validatePayload(r.payload,{stored:true});check(r.payload.databaseId===db.id,'Stored session targets another database.');const id=r.payload.source.id+':'+r.payload.sessionId;check(!ids.has(id),'Duplicate stored session identity.');ids.add(id);if(unchanged.has(r))continue;
    check(r.contentHash===digest(r.payload),'Stored session hash mismatch.');
    if(Object.hasOwn(r,'guard')){const s=require('./shared-history-schema.cjs');s.validate(r.guard,s.guard);check(r.guard.adoptedRevision<=r.payload.revision,'Invalid guarded adoption revision.');}
    contract.validate(receipt(db,r),contract.schema.$defs.receipt);
    check(Array.isArray(r.carIds)&&r.carIds.length<=10000&&new Set(r.carIds).size===r.carIds.length&&r.carIds.every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)),'Invalid session car references.');
    if(Object.hasOwn(r,'lastActive')){const a=contract.schema.$defs.active.properties;contract.validate(r.lastActive,{type:'object',additionalProperties:false,required:['startedAt','trackId','trackName'],properties:{startedAt:a.startedAt,trackId:a.track.properties.id,trackName:a.track.properties.name}},'$.lastActive');if(r.payload.state==='active')check(canonical(r.lastActive)===canonical({startedAt:r.payload.startedAt,trackId:r.payload.track.id,trackName:r.payload.track.name}),'Invalid searchable history metadata.');}
    contract.validate(r.lastName,contract.schema.$defs.active.properties.name,'$.lastName');
    check(Array.isArray(r.history)&&r.history.length<1000,'Invalid revision history.');let previous=0;
    for(const h of r.history){check(Number.isInteger(h.revision)&&h.revision>previous&&h.revision<r.payload.revision,'Invalid historical revision.');previous=h.revision;check(['active','withdrawn'].includes(h.state)&&/^[a-f0-9]{64}$/.test(h.contentHash)&&typeof h.receivedAt==='string'&&Number.isFinite(Date.parse(h.receivedAt)),'Invalid session audit record.');}
    if(r.payload.state==='active')for(const p of r.payload.participants)if(p.carId){check(r.carIds.includes(p.carId),'Missing session car reference.');if(!db.club?.replica)verifyConfiguration(db,p.carId,p.configuration);}
  }
  require('./shared-history.cjs').validateAudit(db,previous);
  require('./history-imports.cjs').validateStored(db,previous);
}
async function receiveAsync(store,bytes,guard=()=>{}){
 if(!store.file||store.expectedIdentity===null){await store.whenIdle();guard();let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fault('INVALID_JSON','Request must contain valid UTF-8 JSON.');}return receive(store,input);}
 return require('./domain-tasks.cjs').run(store,{kind:'timing',bytes},guard);
}
module.exports={capabilities,profile,receive,receiveAsync,receipt,formatReceipt,validateStored,validatePayload,verifyConfiguration,canonical,digest,fault,MAX_BYTES};
