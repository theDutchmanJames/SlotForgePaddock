'use strict';
// Guarded writes and expanded reads of timing-v1. New history formats stay gated.
const T=require('./timing-schema.cjs');
const id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const text=n=>({type:'string',maxLength:n}),object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const date={type:'string',format:'date-time'},nullable=s=>({anyOf:[s,{type:'null'}]});
const accepted=object({revision:{type:'integer',minimum:1,maximum:1000000},contentHash:hash,state:{enum:['active','withdrawn']}});
const editor=object({installationId:id,application:{enum:['SlotForge Timing','SlotForge Paddock']},name:text(200)});
const base={version:{const:1},databaseId:id,recoveryId:id},key={sourceId:id,sessionId:id};
const common={...base,operationId:id,editor,...key,reason:text(2000)};
const bundle=object({format:{const:'timing-v1'},payload:T.schema.$defs.active});
const operation={anyOf:[object({...common,action:{const:'create'},expected:{type:'null'},bundle}),object({...common,action:{const:'replace'},expected:accepted,bundle}),object({...common,action:{const:'withdraw'},expected:accepted,withdrawalReason:text(2000)})]};
const receipt=object({...base,operationId:id,...key,requestHash:hash,status:{const:'committed'},accepted,duplicate:{type:'boolean'},committedAt:date,current:nullable(accepted)});
const guard=object({version:{const:1},adoptedAt:date,adoptedRevision:{type:'integer',minimum:1,maximum:1000000}});
const audit=object({id,...key,revision:accepted.properties.revision,contentHash:hash,payload:{anyOf:[T.schema.$defs.active,T.schema.$defs.withdrawal]},acceptedAt:date,operation:nullable(object({...base,operationId:id,editor,requestHash:hash,reason:text(2000)}))});
const root='/v1/shared-history';
const capability={version:1,operations:root+'/operations',receipt:root+'/operations/{installationId}/{operationId}',sessions:root+'/sessions',session:root+'/sessions/{sourceId}/{sessionId}',laps:root+'/sessions/{sourceId}/{sessionId}/laps/{participantId}',statistics:root+'/cars/{carId}/statistics',imports:root+'/imports',uploads:root+'/uploads',events:'/v1/scalable/events',changes:'/v1/scalable/changes?kind=results',recovery:root+'/status',formats:['timing-v1'],writeScope:'trusted-local',correctionPolicy:'trusted-local-editors-with-cas',immutableAudit:true,maxInlineBytes:8388608,maxUploadBytes:8388608,maxChunkBytes:262144,maxLaps:1000000,sessionPageSize:50,lapPageSize:250,features:{guardedWrites:true,historyReads:true,statistics:true,historicalImports:false,historicalReview:true,resumableUploads:true,resumableHistoricalImports:true}};
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},num={type:'number',minimum:0,maximum:1e15},bool={type:'boolean'},token={type:'string',minLength:1,maxLength:4096};
const array=(items,maxItems)=>({type:'array',items,maxItems});
const v1head=structuredClone(T.schema.$defs.active);delete v1head.properties.participants.items.properties.laps;v1head.properties.participants.items.required=v1head.properties.participants.items.required.filter(k=>k!=='laps');
const reads={
 list:object({...base,snapshot:token,cursor:token,entries:array(object({...key,accepted,name:text(200),startedAt:nullable(T.schema.$defs.active.properties.startedAt),trackId:nullable(id),trackName:text(200),carIds:array(id,10000),resultToken:hash,format:{const:'timing-v1'},provenance:{const:'measured'}}),50),nextPage:nullable(token)}),
 head:object({...base,...key,accepted,resultToken:hash,body:nullable(object({format:{const:'timing-v1'},payload:v1head})),lapCounts:array(object({participantId:id,count:integer}),256)}),
 laps:object({...base,...key,participantId:id,resultToken:hash,format:{const:'timing-v1'},offset:integer,total:integer,nextOffset:nullable(integer),laps:array(T.schema.$defs.active.properties.participants.items.properties.laps.items,250)}),
 statistics:object({...base,carId:id,snapshot:token,cursor:token,acceptedSessions:integer,historicalSessions:{const:0},measuredLaps:integer,validLaps:integer,personalRecordLaps:integer,trackRecordLaps:integer,measuredTimeMs:num,averageLapMs:nullable(num),bestPersonalLapMs:nullable(num),bestTrackLapMs:nullable(num),distanceM:num,distanceComplete:bool,unknownDistanceLaps:integer,overallWins:integer,classWins:{const:0},manualIncluded:{const:false},quarantinedSessions:integer})
};
const uploadBase={...base,uploadId:id};
const uploads={
 uploadStart:object({...uploadBase,editor,kind:{enum:['operation','import']},byteLength:{type:'integer',minimum:1,maximum:8388608},sha256:hash}),
 chunk:object({...uploadBase,index:{type:'integer',minimum:0,maximum:31},sha256:hash,data:{type:'string',maxLength:349528,pattern:'^[A-Za-z0-9+/]*={0,2}$'}}),
 uploadLookup:object(uploadBase),
 uploadCommit:object({...uploadBase,sha256:hash}),
 uploadCancel:object({...uploadBase,cancelled:{const:true}}),
 uploadStatus:object({...uploadBase,state:{enum:['staging','committed','expired']},byteLength:{type:'integer',minimum:1,maximum:8388608},sha256:hash,chunkBytes:{const:262144},received:array({type:'integer',minimum:0,maximum:31},32),expiresAt:date,receipt:nullable({anyOf:[receipt,require('./history-import-schema.cjs').receipt]})})
};
// Read/storage readiness does not advertise richer write acceptance. Qualified
// fixtures exercise these projections before client mappings enable the format.
const rich=structuredClone(require('./history-import-schema.cjs').historyBundle),richLap=rich.properties.race.properties.participants.items.properties.laps.items;
delete rich.properties.race.properties.participants.items.properties.laps;
rich.properties.race.properties.participants.items.required=rich.properties.race.properties.participants.items.required.filter(k=>k!=='laps');
reads.list.properties.entries.items.properties.format={enum:['timing-v1','history-v1']};
reads.list.properties.entries.items.properties.provenance={enum:['measured','historical']};
// Additive date context: a saved timestamp must never masquerade as race start.
Object.assign(reads.list.properties.entries.items.properties,{savedAt:nullable(date),effectiveDate:nullable(date),dateBasis:{enum:['started','saved','unknown']}});
reads.head.properties.body.anyOf.unshift(rich);
const oldLaps=reads.laps;
reads.laps={anyOf:[oldLaps,{...oldLaps,properties:{...oldLaps.properties,format:{const:'history-v1'},laps:array(richLap,250)}}]};
reads.statistics.properties.historicalSessions=integer;reads.statistics.properties.classWins=integer;
if(require('./rich-history-gate.cjs').enabled()){
 capability.formats.push('history-v1');
 // Conservative shared bound while rich and legacy results use one endpoint.
 capability.maxLaps=50000;
}
capability.features.historicalImports=require('./historical-approval-gate.cjs').enabled();
module.exports={operation,receipt,guard,audit,capability,reads,uploads,validate:T.validate};
