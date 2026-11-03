'use strict';
// Exported JSON Schema for the opt-in interface; legacy definitions stay intact.
const timing=require('./timing-schema.cjs');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const text=(maxLength=20000)=>({type:'string',maxLength}),id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_-]+$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'},integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},bool={type:'boolean'},nullable=s=>({anyOf:[s,{type:'null'}]}),array=(items,maxItems)=>({type:'array',items,maxItems}),ref=name=>({$ref:'#/$defs/'+name});
const cursor={type:'string',minLength:1,maxLength:512,pattern:'^[a-zA-Z0-9_-]+$'},base={version:{const:1},databaseId:id},nextOffset=nullable(integer);
const media=object({hash,mime:{enum:['image/png','image/jpeg','image/webp']},size:integer,encoding:{const:'utf8-data-uri'},url:text(400)});
const car=object({id,revision:integer,name:text(),maker:text(),marque:text(),model:text(),scale:text(),raceClass:text(),availability:text(),archived:bool,media:nullable(media)});
const active=structuredClone(timing.schema.$defs.active),participant=active.properties.participants.items;
delete participant.properties.laps;participant.required=participant.required.filter(k=>k!=='laps');
const defs={...timing.schema.$defs,
 scalableDiscovery:object({...base,root:text(100),cars:text(100),results:text(100),changes:text(100),status:text(100),events:text(100),pageSize:{const:50},lapPageSize:{const:250},mediaChunkBytes:{const:262144},maxResponseBytes:{const:8388608}}),
 scalableStatus:object({...base,cursor}),
 scalableCars:object({...base,snapshot:cursor,cursor,cars:array(car,50),nextOffset}),
 scalableProfile:object({version:{const:1},profile:ref('profile'),media:nullable(media)}),
 scalableMedia:object({...base,hash,offset:integer,size:integer,data:{type:'string',maxLength:349528,pattern:'^[A-Za-z0-9+/]*={0,2}$'},nextOffset}),
 scalableChanges:object({...base,kind:{enum:['cars','results']},resetRequired:bool,reason:nullable({enum:['epoch','expired','batch-size','configuration-dependency']}),cursor,entries:array({anyOf:[object({carId:id,operation:{enum:['remove','invalidate']}}),object({sourceId:id,sessionId:id,operation:{enum:['remove','invalidate']}})]},512),more:bool}),
 scalableResults:object({...base,snapshot:cursor,cursor,results:array(object({sourceId:id,sessionId:id,revision:integer,state:{enum:['active','withdrawn']},name:text(),carIds:array(id,256),resultToken:hash}),50),nextOffset}),
 scalableSession:object({...base,resultToken:hash,payload:{anyOf:[active,ref('withdrawal')]},summaries:timing.schema.$defs.receipt.properties.summaries,requiresCorrection:bool,warnings:timing.schema.$defs.receipt.properties.warnings,lapCounts:array(object({participantId:id,count:integer}),256)}),
 scalableLaps:object({...base,sourceId:id,sessionId:id,participantId:id,resultToken:hash,laps:array(timing.schema.$defs.active.properties.participants.items.properties.laps.items,250),total:integer,nextOffset})
};
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://slotforge.local/contracts/scalable-v1.json',$defs:defs};
// The existing validator accepts resolved definitions. Resolve against this
// schema without adding new definitions to the old, strict public contract.
function resolve(v){if(Array.isArray(v))return v.map(resolve);if(v&&typeof v==='object'){if(v.$ref)return resolve(defs[v.$ref.split('/').pop()]);return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]));}return v;}
const resolved=new Map();
function validate(value,name){if(!defs[name])throw Error('Unknown scalable schema definition.');if(!resolved.has(name))resolved.set(name,resolve(defs[name]));return timing.validate(value,resolved.get(name));}
module.exports={schema,validate};
