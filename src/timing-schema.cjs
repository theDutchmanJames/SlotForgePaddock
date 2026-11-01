// JSON Schema and the wire validator share this definition. No coercion or unknown fields.
const str=(maxLength=200)=>({type:'string',minLength:1,maxLength});
const id={...str(100),pattern:'^[a-zA-Z0-9_-]+$'};
const text=(maxLength=2000)=>({type:'string',maxLength});
const number=(maximum=1e9)=>({type:'number',minimum:0,maximum});
const integer=(maximum=Number.MAX_SAFE_INTEGER,minimum=0)=>({type:'integer',minimum,maximum});
const nullable=s=>({anyOf:[s,{type:'null'}]});
const date={...str(24),format:'date-time',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'};
const array=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const ref=name=>({$ref:'#/$defs/'+name});
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
// Explicit public specification fields. Free-form technical notes are deliberately absent.
const fields=['body','bodyMaterial','bodySettings','chassis','wheelbase','motor','motorLayout','pod','podSettings','ratedRpm','ratedVoltage','measuredRpm','measuredVoltage','measuredDate','pinion','gear','gearType','pinionPart','gearPart','frontAxle','rearAxle','frontBearings','rearBearings','frontWheels','rearWheels','frontTyres','rearTyres','frontDiameter','rearDiameter','frontAxlePlay','rearAxlePlay','guide','braids','wiring','lights','digitalSystem','chip','magnets','ballast','suspension','fasteners','weight','clearance','frontWidth','rearWidth','motorTorque','torqueVoltage','torqueType','motorType'];
const technical={type:'object',properties:Object.fromEntries(fields.map(k=>[k,text(20000)])),additionalProperties:false};
const component=object({partId:id,name:str(),quantity:integer(1000000,1),field:text(100),position:text(160),assemblyId:nullable(id)});
const configuration=object({databaseId:id,carId:id,kind:{const:'current'},configurationId:hash,revision:hash,carRevision:integer(Number.MAX_SAFE_INTEGER,1),capturedAt:date,technical,components:array(component,1000),signature:hash});
const driver=object({id,name:str()});
const heat=object({id,name:str(),startedAtMs:integer(604800000),endedAtMs:integer(604800000)});
const stint=object({id,heatId:id,driverId:id,lane:integer(64,1),startedAtMs:integer(604800000),endedAtMs:integer(604800000)});
const lap=object({id,stintId:id,number:integer(1000000,1),durationMs:integer(86400000,1),endedAtMs:integer(604800000),valid:{type:'boolean'},pit:{type:'boolean'},recordEligible:{type:'boolean'},countsForDistance:{type:'boolean'},distanceM:nullable(number(100000)),reason:text(500)});
const participant=object({id,kind:{enum:['physical','virtual']},carId:nullable(id),configuration:nullable(ref('configuration')),displayName:str(),drivers:array(driver,100,1),stints:array(stint,2000,1),laps:array(lap,50000)});
const standing=object({participantId:id,position:nullable(integer(1000,1)),status:{enum:['finished','dnf','dns','disqualified']},classifiedLaps:number(1000000),classifiedElapsedMs:integer(604800000),points:{type:'number',minimum:-1000000,maximum:1000000}});
const adjustment=object({participantId:id,kind:{enum:['time','laps','points','other']},amount:{type:'number',minimum:-1e9,maximum:1e9},reason:str(2000)});
const envelope={integrationVersion:{const:1},databaseId:id,source:object({id,name:str(),application:{const:'SlotForge Timing'}}),sessionId:id,revision:integer(1000000,1)};
const active=object({...envelope,state:{const:'active'},name:str(),type:{enum:['practice','qualifying','race','endurance']},startedAt:date,endedAt:date,track:object({id,name:str(),lanes:array(object({lane:integer(64,1),lengthM:nullable(number(100000))}),64,1)}),heats:array(heat,1000,1),participants:array(participant,256,1),standings:array(standing,256),adjustments:array(adjustment,2000),notes:text(4000)});
const withdrawal=object({...envelope,state:{const:'withdrawn'},reason:str(2000)});
const summary=object({validLaps:integer(),recordEligibleLaps:integer(),bestLapMs:nullable(integer()),averageLapMs:nullable(number()),measuredTimeMs:integer(),distanceM:number(1e15),distanceComplete:{type:'boolean'},wins:integer()});
// Optional client cross-check; Paddock always derives its own statistics from laps.
participant.properties.summary=ref('summary');
const receipt=object({ok:{const:true},integrationVersion:{const:1},databaseId:id,sourceId:id,sessionId:id,revision:integer(1000000,1),state:{enum:['active','withdrawn']},contentHash:hash,receivedAt:date,duplicate:{type:'boolean'},warnings:array(object({code:{enum:['CAR_ARCHIVED','SESSION_REQUIRES_CORRECTION']},carId:id}),512),summaries:array(object({participantId:id,carId:nullable(id),included:{type:'boolean'},statistics:ref('summary')}),256)});
const profile=object({integrationVersion:{const:1},databaseId:id,databaseRevision:integer(),car:object({id,name:str(),maker:text(20000),marque:text(20000),model:text(20000),scale:text(20000),raceClass:text(20000),picture:text(12*1024*1024),availability:text(20000),archived:{type:'boolean'}}),configuration:ref('configuration')});
const error=object({error:str(2000),code:str(100)});
const timingCapability=object({versions:array({const:1},1,1),profile:{const:'/v1/timing/cars/{carId}'},sessions:{const:'/v1/timing/sessions'},receipt:{const:'/v1/timing/sessions/{sourceId}/{sessionId}'},permission:{const:'timingResults'},configurationKinds:array({const:'current'},1,1),maxRequestBytes:{const:8388608},maxLaps:{const:50000},maxParticipants:{const:256},laneBase:{const:1},durationUnit:{const:'ms'},distanceUnit:{const:'m'}});
const status=object({protocol:{const:2},id,revision:integer(),name:str(),permissions:object({browse:{const:true},submit:{type:'boolean'},timingResults:{type:'boolean'}}),capabilities:object({timing:timingCapability})});
// Additive response metadata, deliberately absent from each required list.
status.properties.catalogueRevision=integer();
status.properties.clubId=id;
status.properties.capabilities.properties.club={const:1};
status.properties.permissions.properties.club={type:'boolean'};
const catalogueFields=['number','maker','reference','marque','model','scale','vehicleYear','releaseYear','livery','colours','raceNumber','team','drivers','event','edition','origin','category','raceClass','description'];
// Collection sharing has its own established publicCar projection. In particular,
// its technicalNotes field is not part of the signed Timing profile projection.
const catalogueCar=object({id,name:str()});
Object.assign(catalogueCar.properties,Object.fromEntries(catalogueFields.map(k=>[k,text(20000)])),{technical:{...technical,properties:{...technical.properties,technicalNotes:text(20000)}},picture:text(12*1024*1024),usage:array(text(160),100)});
const collection=object({schema:{const:1},id,revision:integer(),settings:object({name:str()}),cars:array(ref('catalogueCar'),10000),...Object.fromEntries(['setups','parts','assemblies','installations','events','tests','submissions','views','customFields'].map(k=>[k,array({},0)])),choices:object({}),permissions:status.properties.permissions});
collection.properties.catalogueRevision=integer();
collection.properties.nextOffset=nullable(integer());
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://slotforge.invalid/contracts/timing-v1.schema.json',title:'SlotForge Paddock Timing integration v1',anyOf:[ref('active'),ref('withdrawal')],$defs:{active,withdrawal,configuration,summary,receipt,profile,error,status,collection,catalogueCar}};
function validate(value,definition=schema,path='$'){
  const fail=message=>{const e=Error((path+': '+message).slice(0,1800));e.apiCode='INVALID_PAYLOAD';e.httpStatus=400;throw e;};
  if(definition.$ref)return validate(value,schema.$defs[definition.$ref.split('/').pop()],path);
  if(definition.anyOf){for(const option of definition.anyOf)try{validate(value,option,path);return;}catch{}return fail('does not match a supported shape');}
  if('const'in definition&&value!==definition.const)fail('unexpected constant');
  if(definition.enum&&!definition.enum.includes(value))fail('unsupported value');
  const t=definition.type;
  if(t==='null'&&value!==null||t==='object'&&(!value||typeof value!=='object'||Array.isArray(value))||t==='array'&&!Array.isArray(value)||t==='string'&&typeof value!=='string'||t==='boolean'&&typeof value!=='boolean'||(t==='number'||t==='integer')&&(typeof value!=='number'||!Number.isFinite(value)||t==='integer'&&!Number.isSafeInteger(value)))fail('expected '+t);
  if(t==='object'){
    for(const k of definition.required||[])if(!Object.hasOwn(value,k))fail('missing '+k);
    for(const k of Object.keys(value)){if(!Object.hasOwn(definition.properties,k))fail('unknown field '+k);validate(value[k],definition.properties[k],path+'.'+k);}
  }
  if(t==='array'){if(value.length>(definition.maxItems??Infinity)||value.length<(definition.minItems??0))fail('invalid item count');value.forEach((v,i)=>validate(v,definition.items,path+'['+i+']'));}
  if(t==='string'){
    // UTF-16 length bounds Unicode code-point length. Most strings (especially
    // base64 pictures) can be accepted without a per-character scan. Count only
    // near a bound, preserving JSON Schema's code-point length semantics.
    const min=definition.minLength??0,max=definition.maxLength??Infinity;
    let length=value.length;
    if(length>max||length<min*2){length=0;for(const character of value){length++;if(length>max)fail('invalid text length');}}
    if(length<min)fail('invalid text length');
    if(definition.pattern&&!new RegExp(definition.pattern).test(value))fail('invalid text format');
    if(definition.format==='date-time'&&(!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value))fail('expected an ISO UTC timestamp with milliseconds');
  }
  if((t==='number'||t==='integer')&&(value<(definition.minimum??-Infinity)||value>(definition.maximum??Infinity)))fail('number outside supported range');
}
module.exports={schema,validate,fields};
