'use strict';
// Shared rich preparation. Public measured delivery uses this only behind the
// fixed, closed rich-history gate. Owner Review has its own closed approval gate.
// Both formats use timing.sessions, its identity index and durable receipts.
const T=require('./timing-integration.cjs'),I=require('./history-imports.cjs'),IS=require('./history-import-schema.cjs'),Q=require('./sqlite-query.cjs');
const fail=(code,message,status=400,current=null)=>{const e=T.fault(code,message,status);e.details={current};throw e;};
const check=(ok,message)=>{if(!ok)fail('INVALID_PAYLOAD',message);};
const tuple=r=>r?{revision:r.payload.revision,contentHash:r.contentHash,state:r.payload.state}:null;
const key=(source,session)=>JSON.stringify(['timing','sessions','session:'+JSON.stringify([source,session])]);
const auditId=(source,session,revision)=>'history-'+T.digest([source,session,revision]);
function operationSchema(){const schema=structuredClone(require('./shared-history-schema.cjs').operation);for(const variant of schema.anyOf)if(variant.properties.bundle)variant.properties.bundle=IS.historyBundle;return schema;}
function validateBundle(bundle,{historicalIntake=false,nativeTiming=false}={}){
 IS.validate(bundle,IS.historyBundle);
 check(Buffer.byteLength(JSON.stringify(bundle))<=T.MAX_BYTES,'History bundle exceeds 8 MiB.');
 // The provenance rule also applies to future corrections, not just Review intake.
 I.semantics({bundle},{historical:historicalIntake||bundle.provenance.kind==='historical'&&!nativeTiming});
 const {race,provenance,context}=bundle,measured=provenance.kind==='measured';
 const duration=race.startedAt&&race.endedAt?Date.parse(race.endedAt)-Date.parse(race.startedAt):null;
 check(duration===null||duration>=0&&duration<=604800000,'Session duration exceeds seven days.');
 if(measured)check(duration!==null,'Measured history requires actual session dates.');
 const within=(x,parent)=>{if(parent.startedAtMs!==null&&x.startedAtMs!==null)check(x.startedAtMs>=parent.startedAtMs,'Interval starts outside its parent.');if(parent.endedAtMs!==null&&x.endedAtMs!==null)check(x.endedAtMs<=parent.endedAtMs,'Interval ends outside its parent.');};
 const heats=new Map(race.heats.map(h=>[h.id,h]));
 for(const h of race.heats)within(h,{startedAtMs:0,endedAtMs:duration});
 for(const p of race.participants){
  if(measured&&p.carId)check(p.configuration?.kind==='current','Measured linked cars require a signed captured configuration.');
  if(p.configuration?.kind==='historical')check(p.configuration.evidence.trim(),'Historical configuration needs evidence.');
  const stints=new Map(p.stints.map(s=>[s.id,s]));
  let priorStintEnd=null;
  for(const s of p.stints.toSorted((a,b)=>(a.startedAtMs??Infinity)-(b.startedAtMs??Infinity))){within(s,heats.get(s.heatId));if(priorStintEnd!==null&&s.startedAtMs!==null)check(s.startedAtMs>=priorStintEnd,'Overlapping driver stints.');if(s.endedAtMs!==null)priorStintEnd=Math.max(priorStintEnd??0,s.endedAtMs);}
  const sequences=new Set();let lastEnd=null;
  for(const l of p.laps.toSorted((a,b)=>(a.endedAtMs??Infinity)-(b.endedAtMs??Infinity))){
   const s=stints.get(l.stintId),h=heats.get(l.heatId);
   if(measured)check(s&&h&&l.driverId!==null&&l.lane!==null&&l.durationMs!==null&&l.endedAtMs!==null&&l.valid!==null&&l.pit!==null,'Measured laps need complete timing and participant references.');
   if(l.heatId!==null){const id=JSON.stringify([l.heatId,l.number]);check(!sequences.has(id),'Duplicate lap number within a heat.');sequences.add(id);}
   check(new Set(l.flags).size===l.flags.length,'Duplicate lap flags.');
   if(l.flags.includes('invalid'))check(l.valid!==true,'Invalid flag contradicts valid lap.');
   if(l.personalRecordEligible===true||l.trackRecordEligible===true)check(p.kind==='physical'&&l.valid===true&&l.pit===false&&l.durationMs!==null&&!l.flags.includes('invalid'),'Record eligibility requires a valid measured physical lap.');
   if(l.endedAtMs!==null){
    if(duration!==null)check(l.endedAtMs<=duration,'Lap ends outside session.');
    for(const parent of [h,s].filter(Boolean)){if(parent.startedAtMs!==null)check(l.endedAtMs>=parent.startedAtMs,'Lap ends before heat/stint.');if(parent.endedAtMs!==null)check(l.endedAtMs<=parent.endedAtMs,'Lap ends after heat/stint.');}
    if(l.durationMs!==null){const start=l.endedAtMs-l.durationMs;check(start>=0&&(h?.startedAtMs==null||start>=h.startedAtMs),'Lap starts before its heat.');if(lastEnd!==null)check(start>=lastEnd,'Overlapping measured laps.');}
    lastEnd=l.endedAtMs;
   }
  }
 }
 const awards=new Set();for(const row of context.classification){
  const id=JSON.stringify([row.participantId,row.scope,row.scopeId,row.classId]);check(!awards.has(id),'Duplicate classification award.');awards.add(id);
  check(row.position!==1||row.status==='finished','Only a finished participant can win.');
  if(row.scope==='overall')check(row.scopeId===null&&row.classId===null,'Overall awards cannot use a class/scope identity.');
  if(row.scope==='class')check(row.classId===row.scopeId,'Class award identities disagree.');
  if(['final','championship-award'].includes(row.scope))check(row.scopeId!==null,'Scoped awards require an identity.');
 }
 return bundle;
}
function envelope(store,input,options={}){
 IS.validate(input,operationSchema());check(Buffer.byteLength(JSON.stringify(input))<=T.MAX_BYTES,'History operation exceeds 8 MiB.');
 Q.read(store,null,r=>{if(input.databaseId!==r.id)fail('DATABASE_MISMATCH','History targets another library.',409);if(input.recoveryId!==r.epoch)fail('RECOVERY_CHANGED','Reconcile this operation after the restore; do not rewrite recoveryId.',409);});
 if(input.bundle)validateBundle(input.bundle,options);
}
function validateRecord(db,r){
 const S=require('./shared-history-schema.cjs'),p=r.payload;
 check(r.format==='history-v1'&&p&&p.databaseId===db.id,'Invalid rich history identity.');
 IS.validate(p,{type:'object',additionalProperties:false,required:['databaseId','source','sessionId','revision','state','reason'],properties:{databaseId:S.operation.anyOf[0].properties.databaseId,source:{type:'object',additionalProperties:false,required:['id'],properties:{id:S.operation.anyOf[0].properties.sourceId}},sessionId:S.operation.anyOf[0].properties.sessionId,revision:S.receipt.properties.accepted.properties.revision,state:{enum:['active','withdrawn']},reason:{type:'string',maxLength:2000}}});
 check((r.nativeTiming===undefined||r.nativeTiming===1)&&Object.keys(r).length===(r.nativeTiming===1?13:12)&&Object.keys(r).every(k=>['format','payload','bundle','contentHash','receivedAt','warnings','carIds','history','lastName','lastActive','guard','provenanceKind','nativeTiming'].includes(k)),'Unknown or missing stored history field.');
 check(['measured','historical'].includes(r.provenanceKind),'Invalid history provenance.');
 IS.validate(r.receivedAt,{type:'string',format:'date-time'});IS.validate(r.guard,S.guard);check(r.guard.adoptedRevision<=p.revision,'Invalid adoption revision.');
 check(Array.isArray(r.warnings)&&r.warnings.length===0,'Unsupported rich history warnings.');
 check(Array.isArray(r.carIds)&&r.carIds.length<=10000&&new Set(r.carIds).size===r.carIds.length&&r.carIds.every(id=>/^[\w-]{1,100}$/.test(id)),'Invalid car references.');
 check(typeof r.lastName==='string'&&r.lastName.length<=200,'Invalid session name.');
 IS.validate(r.lastActive,{type:'object',additionalProperties:false,required:['startedAt','trackId','trackName'],properties:{startedAt:IS.historyBundle.properties.race.properties.startedAt,savedAt:IS.historyBundle.properties.context.properties.savedAt,trackId:IS.historyBundle.properties.race.properties.track.properties.id,trackName:IS.historyBundle.properties.race.properties.track.properties.name}});
 check(Array.isArray(r.history)&&r.history.length<1000,'Invalid revision history.');let previous=0;for(const h of r.history){IS.validate(h,{type:'object',additionalProperties:false,required:['revision','state','contentHash','receivedAt'],properties:{...S.receipt.properties.accepted.properties,receivedAt:{type:'string',format:'date-time'}}});check(h.revision>previous&&h.revision<p.revision,'Invalid prior revision.');previous=h.revision;}
 if(p.state==='active'){
  validateBundle(r.bundle,{nativeTiming:r.nativeTiming===1});check(r.contentHash===T.digest(r.bundle)&&r.provenanceKind===r.bundle.provenance.kind,'History content hash or provenance mismatch.');
  const race=r.bundle.race;check(r.lastName===race.name&&T.canonical(r.lastActive)===T.canonical({startedAt:race.startedAt,trackId:race.track.id,trackName:race.track.name,...(Object.hasOwn(r.lastActive,'savedAt')?{savedAt:r.bundle.context.savedAt}:{})}),'Invalid history metadata.');
  for(const participant of race.participants)if(participant.carId){check(r.carIds.includes(participant.carId),'Missing history car reference.');if(!db.club?.replica&&participant.configuration?.kind==='current')T.verifyConfiguration(db,participant.carId,participant.configuration);}
 }else check(r.bundle===null&&r.contentHash===T.digest(p),'Invalid withdrawal evidence.');
}
function archive(record,operation){return {id:auditId(record.payload.source.id,record.payload.sessionId,record.payload.revision),sourceId:record.payload.source.id,sessionId:record.payload.sessionId,revision:record.payload.revision,contentHash:record.contentHash,format:'history-v1',record,acceptedAt:record.receivedAt,operation};}
function validateAudit(db,row){
 check(Object.keys(row).length===9&&Object.keys(row).every(k=>['id','sourceId','sessionId','revision','contentHash','format','record','acceptedAt','operation'].includes(k)),'Invalid rich audit shape.');
 validateRecord(db,row.record);const p=row.record.payload;
 check(row.id===auditId(p.source.id,p.sessionId,p.revision)&&row.sourceId===p.source.id&&row.sessionId===p.sessionId&&row.revision===p.revision&&row.contentHash===row.record.contentHash&&row.acceptedAt===row.record.receivedAt,'Invalid rich audit identity.');
 const attribution=require('./shared-history-schema.cjs').audit.properties.operation;IS.validate(row.operation,attribution);check(row.operation&&row.operation.databaseId===db.id,'Missing history editor attribution.');
}
function prepare(store,command,{nativeTiming=false}={}){
 const input=command.payload;envelope(store,input,{nativeTiming});
 const old=Q.read(store,null,r=>r.record(key(input.sourceId,input.sessionId))).value,accepted=tuple(old);
 if(T.canonical(accepted)!==T.canonical(input.expected))fail('REVISION_CONFLICT','Accepted history changed; compare the current revision.',409,accepted);
 if(old&&old.format!=='history-v1')fail('UNSUPPORTED_COVERAGE','Cross-format replacement requires a separately reviewed migration.',409);
 if(old?.payload.state==='withdrawn'&&input.action==='replace'&&!input.reason.trim())fail('INVALID_PAYLOAD','Reactivation requires a reason.');
 const revision=(accepted?.revision||0)+1,now=new Date().toISOString(),active=input.action!=='withdraw',race=active?input.bundle.race:null;
 const payload={databaseId:input.databaseId,source:{id:input.sourceId},sessionId:input.sessionId,revision,state:active?'active':'withdrawn',reason:active?'':input.withdrawalReason};
 const scoped=require('./scoped-write.cjs'),before=scoped.context(store,'@timing',{...payload,participants:race?.participants||[]}).data;
 if(active)for(const p of race.participants)if(p.carId&&!before.cars.some(c=>c.id===p.carId))fail('CAR_NOT_FOUND','Car '+p.carId+' no longer exists; history is never redirected to a successor.',404);
 const record={format:'history-v1',payload,bundle:active?structuredClone(input.bundle):null,provenanceKind:active?input.bundle.provenance.kind:old.provenanceKind,contentHash:T.digest(active?input.bundle:payload),receivedAt:now,warnings:[],carIds:[...new Set([...(old?.carIds||[]),...(race?.participants||[]).map(p=>p.carId).filter(Boolean)])],history:[...(old?.history||[]),...(old?[{...tuple(old),receivedAt:old.receivedAt}]:[])],lastName:race?.name||old.lastName,lastActive:race?{startedAt:race.startedAt,trackId:race.track.id,trackName:race.track.name,...(input.bundle.context.savedAt?{savedAt:input.bundle.context.savedAt}:{})}:old.lastActive,guard:old?.guard||{version:1,adoptedAt:now,adoptedRevision:revision}};
 if(nativeTiming||!active&&old?.nativeTiming===1)record.nativeTiming=1;
 validateRecord(before,record);
 const attribution={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,editor:input.editor,requestHash:T.digest(input),reason:input.reason};
 const roots=new Map(JSON.parse(store.persistedManifest).object),timing=new Map(roots.get('timing').object);
 if((timing.get('audit')?.array.length||0)>=require('./shared-history.cjs').MAX_AUDIT)fail('CAPACITY_EXCEEDED','Immutable history audit is full.',507);
 before.timing.audit=[];
 const after={...before,revision:before.revision+1,timing:{...before.timing,sessions:[record],audit:[archive(record,attribution)]}};
 require('./shared-history.cjs').validateAudit(after);
 const result={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:input.operationId,sourceId:input.sourceId,sessionId:input.sessionId,requestHash:T.digest(input),status:'committed',accepted:tuple(record),duplicate:false,committedAt:now,current:tuple(record)};
 return scoped.prepare(store,before,after,result);
}
function receiveQualified(store,input){store.assertIdle();envelope(store,input);return require('./shared-history.cjs').execute(store,input,prepare);}
function approveQualified(store,input){
 store.assertIdle();check(input.action==='approve'&&typeof input.note==='string'&&input.note.length<=2000,'Invalid approval.');
 const row=Q.read(store,null,r=>{if(input.databaseId!==r.id)fail('DATABASE_MISMATCH','Wrong library.',409);if(input.recoveryId!==r.epoch)fail('RECOVERY_CHANGED','Reconcile after restore.',409);const value=r.record(I.recordKey(input.id));if(!value)fail('OPERATION_NOT_FOUND','Import no longer exists.',404);if(value.requestHash!==input.requestHash)fail('REVISION_CONFLICT','Import evidence changed.',409);return value;}).value;
 if(row.batch.recoveryId!==input.recoveryId)fail('RECOVERY_CHANGED','This evidence predates recovery; reconcile it explicitly first.',409);
 if(!['pending','approved'].includes(row.status))fail('REVISION_CONFLICT','This item is already decided.',409);
 if(row.status==='approved'&&row.decisionNote!==input.note)fail('OPERATION_CONFLICT','An approval retry must retain its original note.',409);
 validateBundle(row.item.bundle,{historicalIntake:true});
 const operation={version:1,databaseId:input.databaseId,recoveryId:input.recoveryId,operationId:'approve-'+T.digest([row.id,row.requestHash]),editor:{installationId:'paddock-review',application:'SlotForge Paddock',name:'Historical Review'},sourceId:row.sourceId,sessionId:row.sessionId,reason:input.note,action:'create',expected:null,bundle:row.item.bundle};
 envelope(store,operation);
 return require('./shared-history.cjs').execute(store,operation,(s,c)=>{
  if(row.status!=='pending')fail('STORAGE_FAILED','Approval receipt is missing; reconcile accepted history.',503);
  const prepared=prepare(s,c),{before,after}=prepared.scope;
  before.timing.imports=[row];after.timing.imports=[{...row,status:'approved',accepted:prepared.result.accepted,decidedAt:prepared.result.committedAt,decisionNote:input.note,message:'Approved into shared racing history.'}];
  I.validateStored(after,null,{partial:true});
  return require('./scoped-write.cjs').prepare(s,before,after,prepared.result);
 });
}
module.exports={validateBundle,validateRecord,validateAudit,operationSchema,receiveQualified,approveQualified,prepare};
