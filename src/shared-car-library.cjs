'use strict';
// Trusted local writes reuse the ordinary car commands and the same atomic
// SQLite receipt boundary. No direct-write route exists on a LAN listener.
const crypto=require('node:crypto'),T=require('./timing-integration.cjs'),Q=require('./sqlite-query.cjs');
const BASE='/v1/local-library',MAX=128*1024;
const text=(path,maxLength=1000,clearable=true)=>({type:'string',path,maxLength,clearable});
const number=(path,unit,minimum,maximum,integer=false)=>({type:integer?'integer':'number',path,unit,minimum,maximum,clearable:true});
const fields={name:text(['name'],200,false),maker:text(['maker']),marque:text(['marque']),model:text(['model']),reference:text(['reference']),scale:text(['scale'],100),number:text(['number'],100),livery:text(['livery']),raceClass:text(['raceClass']),availability:text(['availability'],200),
 motor:text(['technical','motor']),motorLayout:text(['technical','motorLayout'],100),rearTyres:text(['technical','rearTyres']),frontTyres:text(['technical','frontTyres']),guide:text(['technical','guide']),braids:text(['technical','braids']),chassis:text(['technical','chassis']),body:text(['technical','body']),pod:text(['technical','pod']),
 pinion:number(['technical','pinion'],'teeth',1,1000,true),gear:number(['technical','gear'],'teeth',1,1000,true),weight:number(['technical','weight'],'g',0,100000),rearDiameter:number(['technical','rearDiameter'],'mm',0.001,1000),frontDiameter:number(['technical','frontDiameter'],'mm',0.001,1000),ratedRpm:number(['technical','ratedRpm'],'rpm',0,1000000,true),ratedVoltage:number(['technical','ratedVoltage'],'V',0.001,1000)};
const capability={version:1,schemaVersion:1,schema:BASE+'/car-schema',car:BASE+'/cars/{carId}',operations:BASE+'/car-operations',actions:['create','patch','archive','restore'],maxRequestBytes:MAX,reviewRequired:false,recoveryHeader:'X-SlotForge-Recovery',media:{write:false,read:'scalable-v1'}};
const fail=(code,message,status=400,details)=>{const e=T.fault(code,message,status);if(details)e.details=details;throw e;};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const epoch=store=>store.deferredState?.token.epoch||require('./sqlite-storage.cjs').syncState(store.file).epoch;
function recovery(store,wanted){if(typeof wanted!=='string'||!wanted)fail('RECOVERY_REQUIRED','Supply the recovery identifier from car-schema.');if(wanted!==epoch(store))fail('RECOVERY_CHANGED','This library was restored or replaced. Reconcile pending operations; do not automatically resubmit with a new recovery identifier.',409,{recoveryId:epoch(store)});}
function schema(store){return {...capability,databaseId:store.data.id,recoveryId:epoch(store),fields,clearSemantics:'Use clear array: empty text, unknown numeric value (null in projection).',omitted:'unchanged',receiptRetention:{maxCount:100000,maxBytes:33554432,sharedWithDesktopCommands:true,eviction:false,backup:'Restoration changes recoveryId; old operations require reconciliation.'}};}
function project(car){if(!car)return null;const values={},unparsed={},truncated=[];for(const [key,s]of Object.entries(fields)){const raw=s.path.length===1?car[s.path[0]]:car.technical?.[s.path[1]];if(s.type==='string'){values[key]=typeof raw==='string'?raw.slice(0,s.maxLength):'';if(raw?.length>s.maxLength)truncated.push(key);}else{const n=typeof raw==='string'&&raw.trim()!==''?Number(raw):NaN;values[key]=Number.isFinite(n)&&n>=s.minimum&&n<=s.maximum&&(s.type!=='integer'||Number.isInteger(n))?n:null;if(raw&&values[key]===null)unparsed[key]=String(raw).slice(0,1000);}}return {id:car.id,revision:car.revision,archived:!!car.archived,fields:values,unparsed,truncated};}
const car=(store,id)=>Q.read(store,null,r=>r.one('cars',id)).value;
function readCar(store,carId){
 if(!id(carId))fail('INVALID_QUERY','Supply a valid car ID.');
 // Identity, recovery generation and editable fields come from one SQLite
 // read transaction. Do not combine a cached epoch with a separately read car.
 return Q.read(store,null,r=>{const current=r.one('cars',carId);if(!current||require('./car-membership.cjs').isWishlist(current))fail('CAR_NOT_FOUND','The shared car no longer exists. Do not recreate it automatically.',404);return {version:1,databaseId:r.id,recoveryId:r.epoch,...project(current)};}).value;
}
function identity(sourceId,operationId){if(!id(sourceId)||!id(operationId))fail('INVALID_OPERATION','Source and operation IDs must use 1–100 letters, numbers, underscores or hyphens.');return 'shared-'+crypto.createHash('sha256').update(JSON.stringify([sourceId,operationId])).digest('hex');}
function envelope(store,input,allowEmptyPatch=false){
 if(!object(input)||Object.keys(input).some(k=>!['version','databaseId','recoveryId','sourceId','operationId','action','carId','expectedRevision','set','clear'].includes(k))||input.version!==1||!capability.actions.includes(input.action))fail('INVALID_OPERATION','Unknown fields, version or action.');
 identity(input.sourceId,input.operationId);if(input.databaseId!==store.data.id)fail('DATABASE_MISMATCH','This operation belongs to another library.',409);recovery(store,input.recoveryId);
 if(input.action==='create'){if(Object.hasOwn(input,'carId')||Object.hasOwn(input,'expectedRevision'))fail('INVALID_OPERATION','Create allocates the car identity.');}
 else if(!id(input.carId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_OPERATION','Supply a car ID and expectedRevision.');
 if(['archive','restore'].includes(input.action)&&(Object.hasOwn(input,'set')||Object.hasOwn(input,'clear')))fail('INVALID_OPERATION','Archive and restore do not accept field edits.');
 if(input.set!==undefined&&!object(input.set)||input.clear!==undefined&&(!Array.isArray(input.clear)||input.clear.length>Object.keys(fields).length||new Set(input.clear).size!==input.clear.length))fail('INVALID_OPERATION','Invalid set or clear fields.');
 const data={};const assign=(key,value)=>{const s=fields[key];if(s.path.length===1)data[s.path[0]]=value;else{data.technical??={};data.technical[s.path[1]]=value;}};
 for(const [key,value]of Object.entries(input.set||{})){const s=Object.hasOwn(fields,key)&&fields[key];if(!s)fail('INVALID_FIELD','Unsupported writable field: '+key);if(s.type==='string'){if(typeof value!=='string'||value.length>s.maxLength||!s.clearable&&!value.trim())fail('INVALID_FIELD','Invalid text for '+key);}else if(typeof value!=='number'||!Number.isFinite(value)||value<s.minimum||value>s.maximum||s.type==='integer'&&!Number.isInteger(value))fail('INVALID_FIELD','Invalid value or units for '+key);assign(key,String(value));}
 for(const key of input.clear||[]){if(typeof key!=='string'||!Object.hasOwn(fields,key)||!fields[key].clearable||Object.hasOwn(input.set||{},key))fail('INVALID_FIELD','Invalid, overlapping or required clear field.');assign(key,'');}
 if(input.action==='create'&&!data.name?.trim())fail('INVALID_FIELD','A new car needs a name.');
 if(input.action==='patch'&&!Object.keys(data).length&&!allowEmptyPatch)fail('INVALID_OPERATION','Choose at least one field to set or clear.');return data;
}
function prepare(store,command,options={}){
 // Only the direct-file engine opts in when it attaches a separately validated
 // companion write. HTTP callers cannot enable this through the payload.
 const input=command.payload,data=envelope(store,input,options.allowCompanionOnly===true),current=input.action==='create'?null:car(store,input.carId);
 if(input.action!=='create'){
  if(!current||require('./car-membership.cjs').isWishlist(current))fail('CAR_NOT_FOUND','The shared car no longer exists. Do not recreate it automatically.',404);
  if(current.merge){const identity=Q.read(store,null,r=>r.merges.identity(current.id)).value;fail('CAR_MERGED','This car was merged. Reopen the main car before creating a new edit.',409,{identity});}
  if(current.revision!==input.expectedRevision)fail('REVISION_CONFLICT','This car changed. Compare the current values before applying a new operation.',409,{current:project(current)});
  if(current.rebuild?.to&&['patch','restore'].includes(input.action))fail('CAR_REBUILT','Continue with the rebuilt successor. This original record preserves its history.',409,{successor:current.rebuild.to});
  if(input.action==='patch'&&current.archived)fail('CAR_ARCHIVED','Restore this car before editing it.',409,{current:project(current)});
 }
 if(current&&data.technical){
  const installed=Q.read(store,null,r=>r.list('installations',{carId:current.id,removed:false,limit:200})).value;
  // All installations are checked; the index keeps this bounded to this car.
  const all=[...installed.rows];for(let offset=installed.nextOffset;offset!==null;){const p=Q.read(store,null,r=>r.list('installations',{carId:current.id,removed:false,offset,limit:200})).value;all.push(...p.rows);offset=p.nextOffset;}
  const conflicts=[];for(const i of all){const part=Q.read(store,null,r=>r.one('parts',i.partId)).value;if(i.field&&Object.hasOwn(data.technical,i.field)&&data.technical[i.field]!==current.technical?.[i.field]&&data.technical[i.field]!==part?.name)conflicts.push(i.field);const toothField=({pinionPart:'pinion',gearPart:'gear'})[i.field];if(toothField&&Object.hasOwn(data.technical,toothField)&&data.technical[toothField]!==current.technical?.[toothField]){const count=require('../renderer/build-model.js').gearing({parts:[{slot:i.field,partId:i.partId}],assemblies:[]},{parts:[part],assemblies:[]})[toothField].automatic;if(count&&data.technical[toothField]!==count)conflicts.push(toothField);}}
  if(conflicts.length)fail('INSTALLED_PART_CONFLICT','An installed component owns these fields. Replace or remove it in Paddock’s workshop first; inventory was not changed.',409,{fields:[...new Set(conflicts)],current:project(current)});
 }
 const action=['archive','restore'].includes(input.action)?'car.archive':'car.save';
 const already=current&&((input.action==='archive'&&current.archived)||(input.action==='restore'&&!current.archived));
 const scoped=require('./scoped-write.cjs');let prepared;
 if(already||input.action==='patch'&&!Object.keys(data).length)prepared={noop:true,result:current.id};
 else prepared=scoped.command(store,action,input.action==='create'?{data}:{id:current.id,revision:current.revision,...(action==='car.save'?{data}:{})});
 const changed=prepared.noop?current:prepared.scope.after.cars.find(c=>c.id===(input.action==='create'?prepared.result:current.id));
 prepared.result={version:1,databaseId:store.data.id,recoveryId:input.recoveryId,sourceId:input.sourceId,operationId:input.operationId,requestHash:T.digest(input),action:input.action,committedAt:new Date().toISOString(),car:project(changed)};
 return prepared;
}
function currentState(store,result){const c=car(store,result.car.id);return {present:!!c,archived:!!c?.archived,revision:c?.revision??null};}
function receive(store,input){
 envelope(store,input);const command={id:identity(input.sourceId,input.operationId),action:'@shared-car',payload:input,databaseId:input.databaseId,epoch:input.recoveryId};
 let saved;try{saved=require('./command-receipts.cjs').execute(store,command,prepare);}catch(e){if(e.code==='COMMAND_CONFLICT')fail('OPERATION_CONFLICT','This operation ID was already used for different content.',409);if(e.code==='COMMAND_EPOCH_CHANGED')recovery(store,input.recoveryId);throw e;}
 return {...saved.result,duplicate:!!saved.duplicate,current:currentState(store,saved.result)};
}
function lookup(store,sourceId,operationId,recoveryId){recovery(store,recoveryId);const key=identity(sourceId,operationId),saved=Q.read(store,null,r=>{const row=r.db.prepare('SELECT epoch,result FROM command_receipts WHERE id=?').get(key);if(!row)return null;if(row.epoch!==recoveryId)fail('RECOVERY_CHANGED','The receipt belongs to a different library recovery generation.',409);return require('./command-receipts.cjs').decodeResult(row.result);}).value;
 if(!saved)fail('OPERATION_NOT_FOUND','No committed receipt exists in this recovery generation. Retry only the identical request with this same recovery identifier.',404);
 return {...saved,duplicate:true,current:currentState(store,saved)};
}
async function handle(network,req,res,url,code,send){
 const guard=()=>{if(!network.local||!network.access(code)?.sharedCars)fail('LOCAL_WRITES_DISABLED','Trusted local editing is unavailable.',403);if(req.headers['x-slotforge-database']!==network.store.data.id)fail('DATABASE_MISMATCH','The library changed.',409);};guard();
 if(url.search)fail('INVALID_QUERY','Shared-car operations do not accept query parameters.');
 if(req.method==='GET'&&url.pathname===BASE+'/car-schema')return network.store.withIdle(()=>{guard();return send(200,schema(network.store));});
 const readMatch=url.pathname.match(/^\/v1\/local-library\/cars\/([a-zA-Z0-9_-]{1,100})$/);
 if(req.method==='GET'&&readMatch)return network.store.withIdle(()=>{guard();return send(200,readCar(network.store,readMatch[1]));});
 const match=url.pathname.match(/^\/v1\/local-library\/car-operations\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
 if(req.method==='GET'&&match)return send(200,await require('./domain-tasks.cjs').run(network.store,{kind:'shared-car-receipt',sourceId:match[1],operationId:match[2],recoveryId:req.headers['x-slotforge-recovery']},guard));
 if(req.method!=='POST'||url.pathname!==BASE+'/car-operations')fail('NOT_FOUND','Unknown shared-car operation.',404);
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))fail('CONTENT_TYPE_REQUIRED','Send UTF-8 application/json.',415);
 if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')fail('CONTENT_ENCODING_UNSUPPORTED','Compressed requests are not supported.',415);
 if(Number(req.headers['content-length'])>MAX)fail('PAYLOAD_TOO_LARGE','Shared metadata writes are limited to 128 KiB.',413);
 const chunks=[];let bytes=0;for await(const b of req.iterator({destroyOnReturn:false})){bytes+=b.length;if(bytes>MAX)return send(413,{code:'PAYLOAD_TOO_LARGE',error:'Shared metadata writes are limited to 128 KiB.'});chunks.push(b);}
 const result=await require('./domain-tasks.cjs').run(network.store,{kind:'shared-car-write',bytes:Buffer.concat(chunks)},guard);
 if(!result.duplicate)try{network.onChange({kind:'shared-car',carId:result.car.id});}catch{}return send(200,result);
}
module.exports={fields,capability,schema,project,readCar,receive,lookup,handle,identity,prepare};
