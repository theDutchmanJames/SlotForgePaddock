'use strict';
// Documentation/fixture definitions only. Never imported by the host runtime.
const {schema:timing}=require('../../../../src/timing-schema.cjs');
const clone=structuredClone,ref=name=>({$ref:'#/$defs/'+name});
const text=(maxLength=2000)=>({type:'string',maxLength}),id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'},bool={type:'boolean'};
const integer=(maximum=Number.MAX_SAFE_INTEGER,minimum=0)=>({type:'integer',minimum,maximum}),num=(minimum=0,maximum=1e15)=>({type:'number',minimum,maximum});
const nullable=s=>({anyOf:[s,{type:'null'}]}),array=(items,maxItems=1000)=>({type:'array',items,maxItems}),object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const date={type:'string',format:'date-time',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'},token={type:'string',minLength:1,maxLength:4096};
const defs=clone(timing.$defs);
const base={version:{const:1},databaseId:id,recoveryId:id},sessionKey={sourceId:id,sessionId:id};
const accepted=object({revision:integer(1000000,1),contentHash:hash,state:{enum:['active','withdrawn']}});
const editor=object({installationId:id,application:{enum:['SlotForge Timing','SlotForge Paddock']},name:text(200)});
const identity=object({id,name:text(200)});
const classification=object({participantId:id,scope:{enum:['overall','class','heat','final','championship-award']},scopeId:nullable(id),classId:nullable(id),position:nullable(integer(1000,1)),status:{enum:['finished','dnf','dns','disqualified','unknown']},laps:nullable(num(0,1000000)),elapsedMs:nullable(num(0,604800000)),points:nullable(num(-1000000,1000000)),score:nullable(num(-1e12,1e12)),scoreUnit:nullable({enum:['ms','laps','points','m']}),gap:nullable(object({value:num(0,1e12),unit:{enum:['ms','laps','points','m']}})),countedHeatIds:array(id),droppedHeatIds:array(id),incomplete:nullable(bool),estimated:nullable(bool),effects:array(object({kind:{enum:['time','laps','points','other']},amount:num(-1e9,1e9),reason:text(2000)}),2000)});
const lap=object({id,originLapId:nullable(id),stintId:nullable(id),heatId:nullable(id),driverId:nullable(id),lane:nullable(integer(64,1)),number:integer(1000000,1),durationMs:nullable(num(0.001,86400000)),endedAtMs:nullable(num(0,604800000)),valid:nullable(bool),pit:nullable(bool),personalRecordEligible:nullable(bool),trackRecordEligible:nullable(bool),countsForDistance:bool,distanceM:nullable(num(0,100000)),flags:array({enum:['invalid','tooSlow','late','redFlag']},4),reason:text(500)});
const historicalConfiguration=object({kind:{const:'historical'},technical:clone(timing.$defs.configuration.properties.technical),recordedAt:nullable(date),evidence:text(2000)});
const heat=object({id,name:text(200),startedAtMs:nullable(num(0,604800000)),endedAtMs:nullable(num(0,604800000))});
const stint=object({id,heatId:id,driverId:id,lane:integer(64,1),startedAtMs:nullable(num(0,604800000)),endedAtMs:nullable(num(0,604800000))});
defs.historyRace=object({name:text(200),type:{enum:['practice','qualifying','race','endurance']},startedAt:nullable(date),endedAt:nullable(date),track:object({id:nullable(id),name:text(200),lanes:array(object({lane:integer(64,1),lengthM:nullable(num(0,100000))}),64)}),heats:array(heat,1000),participants:array(object({id,kind:{enum:['physical','virtual']},carId:nullable(id),configuration:{anyOf:[ref('configuration'),historicalConfiguration,{type:'null'}]},displayName:text(200),teamId:nullable(id),drivers:array(identity,100),stints:array(stint,2000),laps:array(lap,1000000)}),256)});
// Arbitrary JSON is limited to explanatory scoring evidence. Byte/depth bounds
// and credential exclusion are semantic requirements, not executable plugins.
defs.json={anyOf:[{type:'null'},{type:'boolean'},{type:'number'},{type:'string'},{type:'array',items:ref('json')},{type:'object',additionalProperties:ref('json')}]};
// Local evidence fixture, not an API request or permission to upload raw settings.
defs.originEvidence=object({session:ref('json'),laps:array(ref('json'),1000000)});
defs.context=object({savedAt:nullable(date),endedBy:nullable(text(200)),resumed:nullable(integer(100000)),weather:nullable(text(2000)),teams:array(identity,256),classes:array(identity,256),classification:array(classification,10000),systemChanges:array(object({system:text(100),enabled:bool,atMs:nullable(num(0,604800000))}),2000),scoringSnapshot:ref('json'),notes:text(4000)});
defs.bundle={anyOf:[object({format:{const:'timing-v1'},payload:ref('active')}),object({format:{const:'history-v1'},provenance:object({kind:{enum:['measured','historical']},evidence:text(2000),missing:array({enum:['configuration','crossing-times','driver-boundaries','lane-lengths','classification','record-eligibility','race-date']},7)}),race:ref('historyRace'),context:ref('context')})]};
const commandBase={...base,operationId:id,editor, ...sessionKey,expected:nullable(accepted),reason:text(2000)};
defs.operation={anyOf:[object({...commandBase,action:{const:'create'},expected:{type:'null'},bundle:ref('bundle')}),object({...commandBase,action:{const:'replace'},expected:accepted,bundle:ref('bundle')}),object({...commandBase,action:{const:'withdraw'},expected:accepted,withdrawalReason:text(2000)})]};
defs.receipt=object({...base,operationId:id,...sessionKey,requestHash:hash,status:{const:'committed'},accepted,duplicate:bool,committedAt:date,current:nullable(accepted)});
defs.importRequest=object({...base,operationId:id,editor,items:array(object({itemId:id,...sessionKey,originHash:hash,bundle:ref('bundle')}),25)});
defs.importRequest.properties.items.minItems=1;
const historicalBundle=clone(defs.bundle.anyOf[1]);historicalBundle.properties.provenance.properties.kind={const:'historical'};
defs.importRequest.properties.items.items.properties.bundle=historicalBundle;
defs.importReceipt=object({...base,operationId:id,requestHash:hash,items:array(object({itemId:id,...sessionKey,status:{enum:['pending','approved','rejected','cancelled','already-present','conflict']},accepted:nullable(accepted),message:text(2000)}),25)});
defs.error=object({code:{enum:['UNAUTHENTICATED','PERMISSION_REQUIRED','BROWSER_ORIGIN_FORBIDDEN','DATABASE_MISMATCH','RECOVERY_CHANGED','REVISION_CONFLICT','OPERATION_CONFLICT','OPERATION_NOT_FOUND','SESSION_NOT_FOUND','HISTORY_GUARD_REQUIRED','INVALID_PAYLOAD','INVALID_QUERY','CAR_NOT_FOUND','TOKEN_REQUIRED','RESULT_CHANGED','SESSION_WITHDRAWN','UNSUPPORTED_COVERAGE','SNAPSHOT_CHANGED','UPLOAD_EXPIRED','UPLOAD_INCOMPLETE','CHUNK_CONFLICT','CONTENT_HASH_MISMATCH','PAYLOAD_TOO_LARGE','CAPACITY_EXCEEDED','STORAGE_FAILED','RESULT_REQUIRES_SHARED_HISTORY','NOT_FOUND','CONFIGURATION_INVALID','CONFIGURATION_MISMATCH','SUMMARY_MISMATCH','UNSUPPORTED_VERSION','METHOD_NOT_ALLOWED']},error:text(2000),databaseId:nullable(id),recoveryId:nullable(id),current:nullable(accepted)});
const root='/v1/shared-history';
defs.capability=object({version:{const:1},operations:{const:root+'/operations'},receipt:{const:root+'/operations/{installationId}/{operationId}'},sessions:{const:root+'/sessions'},session:{const:root+'/sessions/{sourceId}/{sessionId}'},laps:{const:root+'/sessions/{sourceId}/{sessionId}/laps/{participantId}'},statistics:{const:root+'/cars/{carId}/statistics'},imports:{const:root+'/imports'},uploads:{const:root+'/uploads'},events:{const:'/v1/scalable/events'},changes:{const:'/v1/scalable/changes?kind=results'},recovery:{const:root+'/status'},formats:array({enum:['timing-v1','history-v1']},2),writeScope:{const:'trusted-local'},correctionPolicy:{const:'trusted-local-editors-with-cas'},immutableAudit:{const:true},maxInlineBytes:{const:8388608},maxUploadBytes:{enum:[8388608,67108864]},maxChunkBytes:{const:262144},maxLaps:{const:1000000},sessionPageSize:{const:50},lapPageSize:{const:250}});
defs.capability.properties.features=object({guardedWrites:bool,historyReads:bool,statistics:bool,historicalImports:bool,historicalReview:bool,resumableUploads:bool,resumableHistoricalImports:bool});
defs.capability.required.push('features');
defs.status=object({...base,capability:ref('capability'),cursor:token});
const entry=object({...sessionKey,accepted,name:text(200),startedAt:nullable(date),trackId:nullable(id),trackName:text(200),carIds:array(id,10000),resultToken:token,format:{enum:['timing-v1','history-v1']},provenance:{enum:['measured','historical']}});
defs.list=object({...base,snapshot:token,cursor:token,entries:array(entry,50),nextPage:nullable(token)});
// Session heads exclude all lap arrays. Format-specific body retains the rest.
const v1head=clone(timing.$defs.active);delete v1head.properties.participants.items.properties.laps;v1head.properties.participants.items.required=v1head.properties.participants.items.required.filter(k=>k!=='laps');
const historyHead=clone(defs.historyRace);delete historyHead.properties.participants.items.properties.laps;historyHead.properties.participants.items.required=historyHead.properties.participants.items.required.filter(k=>k!=='laps');
defs.head=object({...base,...sessionKey,accepted,resultToken:token,body:{anyOf:[object({format:{const:'timing-v1'},payload:v1head}),object({format:{const:'history-v1'},provenance:clone(defs.bundle.anyOf[1].properties.provenance),race:historyHead,context:ref('context')}),{type:'null'}]},lapCounts:array(object({participantId:id,count:integer(1000000)}),256)});
const lapPage={...base,...sessionKey,participantId:id,resultToken:token,offset:integer(1000000),total:integer(1000000),nextOffset:nullable(integer(1000000))};
defs.laps={anyOf:[object({...lapPage,format:{const:'timing-v1'},laps:array(clone(timing.$defs.active.properties.participants.items.properties.laps.items),250)}),object({...lapPage,format:{const:'history-v1'},laps:array(lap,250)})]};
defs.statistics=object({...base,carId:id,snapshot:token,cursor:token,acceptedSessions:integer(),historicalSessions:integer(),measuredLaps:integer(),validLaps:integer(),personalRecordLaps:integer(),trackRecordLaps:integer(),measuredTimeMs:num(),averageLapMs:nullable(num()),bestPersonalLapMs:nullable(num()),bestTrackLapMs:nullable(num()),distanceM:num(),distanceComplete:bool,unknownDistanceLaps:integer(),overallWins:integer(),classWins:integer(),manualIncluded:{const:false},quarantinedSessions:integer()});
defs.uploadStart=object({...base,uploadId:id,editor,kind:{enum:['operation','import']},byteLength:integer(67108864,1),sha256:hash});
defs.chunk=object({...base,uploadId:id,index:integer(255),sha256:hash,data:{type:'string',maxLength:349528,pattern:'^[A-Za-z0-9+/]*={0,2}$'}});
defs.uploadStatus=object({...base,uploadId:id,state:{enum:['staging','committed','expired']},byteLength:integer(67108864,1),sha256:hash,chunkBytes:{const:262144},received:array(integer(255),256),expiresAt:date,receipt:{anyOf:[ref('receipt'),ref('importReceipt'),{type:'null'}]}});
defs.uploadCommit=object({...base,uploadId:id,sha256:hash});
defs.importCancel=object({...base,operationId:id,itemIds:array(id,25)});
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://slotforge.invalid/proposals/shared-racing-history-v1.json',title:'Proposed shared racing history v1 — not implemented',$defs:defs};
const capability=Object.fromEntries(Object.entries(defs.capability.properties).filter(([,v])=>'const' in v).map(([k,v])=>[k,v.const]));capability.formats=['timing-v1','history-v1'];
capability.maxUploadBytes=67108864;
capability.features={guardedWrites:true,historyReads:true,statistics:true,historicalImports:true,historicalReview:true,resumableUploads:true,resumableHistoricalImports:true};
module.exports={schema,capability};
