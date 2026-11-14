'use strict';
// A reviewed bootstrap transport. The ordinary submission transaction remains
// the sole authority for applying cars and returning overridden stock.
const crypto=require('node:crypto'),model=require('./local-library-model.cjs');
const {fault}=require('./timing-integration.cjs');
const MAX=8*1024*1024,BASE='/v1/local-library';
const capability={version:1,imports:BASE+'/imports',origins:BASE+'/origins',maxCars:25,maxRequestBytes:MAX,reviewRequired:true,cancellation:true,sharedCars:require('./shared-car-library.cjs').capability};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const check=(ok,message)=>{if(!ok)throw fault('INVALID_IMPORT',message);};
function identity(sourceId,transferId){check(id(sourceId)&&id(transferId),'Source and transfer IDs must use 1–100 letters, numbers, underscores or hyphens.');return 'local-'+digest([sourceId,transferId]);}
function find(store,packageId){return store.deferredState?store.deferredState.read(r=>require('./query-local-library.cjs').find(r,packageId)):store.data.submissions.find(s=>s.package.packageId===packageId);}
function origin(store,sourceId,timingCarId){return store.deferredState?store.deferredState.read(r=>require('./query-local-library.cjs').origin(r,sourceId,timingCarId)):model.origin(store.data,sourceId,timingCarId);}
function car(store,id){return store.deferredState?store.deferredState.read(r=>r.one('cars',id)):store.data.cars.find(c=>c.id===id);}
function receipt(store,sub){
 return {version:1,databaseId:store.data.id,submissionId:sub.id,sourceId:sub.localTransfer?.sourceId,transferId:sub.localTransfer?.transferId,hash:sub.localTransfer?.hash,status:sub.status,cars:sub.package.cars.map((c,index)=>{
  const outcome=sub.outcomes[c.id],car=store.deferredState?store.deferredState.read(r=>r.one('cars',c.id)):store.data.cars.find(v=>v.id===c.id);
  const item=sub.localTransfer?.items[index];
  return {index,itemId:item?.itemId,timingCarId:item?.timingCarId,action:item?.action,paddockCarId:c.id,decision:outcome?.decision||'pending',status:outcome?.cancelled?'cancelled':outcome?.decision==='accept'?'approved':outcome?.decision==='reject'?'rejected':'pending',reviewedAt:outcome?.date||null,carRevision:outcome?.carRevision??null,present:!!car,archived:!!car?.archived};
 })};
}
function lookup(store,sourceId,transferId){const sub=find(store,identity(sourceId,transferId));if(!sub)throw fault('IMPORT_NOT_FOUND','This transfer has not been received.',404);return receipt(store,sub);}
function receive(store,input){
 check(object(input)&&Object.keys(input).every(k=>['version','databaseId','sourceId','transferId','export','targets'].includes(k)),'Unknown import fields.');
 check(input.version===1,'Unsupported local import version.');
 if(input.databaseId!==store.data.id)throw fault('DATABASE_MISMATCH','This import belongs to another database.',409);
 const packageId=identity(input.sourceId,input.transferId);
 check(Array.isArray(input.export?.items?.slotcars)&&input.export.items.slotcars.length>=1&&input.export.items.slotcars.length<=25,'Send 1–25 cars per transfer.');
 const fields=['id','name','brand','manufacturer','model','scale','reference','motor','gearing','weight','raceClass','tyres','picture'];
 check(Object.keys(input.export).every(k=>['format','fileVersion','exported','items'].includes(k))&&Object.keys(input.export.items).every(k=>['slotcars','raceclasses'].includes(k)),'Only supported catalogue export fields may be transferred.');
 check(input.export.exported===undefined||typeof input.export.exported==='string'&&input.export.exported.length<=100,'Invalid export date.');
 for(const row of input.export.items.slotcars){check(object(row)&&Object.keys(row).every(k=>fields.includes(k))&&(row.picture===undefined||typeof row.picture==='string'),'Remove simulation, service and race-history fields from the local transfer.');for(const [k,v]of Object.entries(row))check(typeof v==='string'&&(k==='picture'||v.length<=20000)||typeof v==='number'&&Number.isFinite(v),'Car fields must be text or finite numbers.');}
 if(input.export.items.raceclasses!==undefined){check(Array.isArray(input.export.items.raceclasses)&&input.export.items.raceclasses.length<=10000,'Invalid race classes.');for(const row of input.export.items.raceclasses)check(object(row)&&Object.keys(row).every(k=>['id','name'].includes(k))&&typeof row.id==='string'&&typeof row.name==='string','Invalid race class.');}
 const converted=require('./timing-import.cjs').timingPackage(input.export);
 const rows=input.export.items.slotcars,targets=input.targets===undefined?[]:input.targets;
 check(Array.isArray(targets)&&targets.length<=rows.length,'Invalid target links.');
 const links=new Map();
 for(const target of targets){
  check(object(target)&&Object.keys(target).length===3&&Number.isSafeInteger(target.expectedRevision)&&target.expectedRevision>=1&&typeof target.timingCarId==='string'&&id(target.paddockCarId),'Invalid target link.');
  check(rows.some(c=>c.id===target.timingCarId)&&!links.has(target.timingCarId),'Target links must refer to distinct incoming cars.');
  links.set(target.timingCarId,target);
 }
 const hash=crypto.createHash('sha256').update(require('./timing-integration.cjs').canonical(input)).digest('hex');
 const existing=find(store,packageId);if(existing){if(existing.localTransfer?.hash!==hash)throw fault('IMPORT_CONFLICT','This transfer ID was used for different data. Keep retries unchanged.',409);return {...receipt(store,existing),duplicate:true};}
 const items=rows.map(row=>({itemId:'item-'+digest(row.id),timingCarId:row.id,paddockCarId:links.get(row.id)?.paddockCarId||'local-timing-'+digest([input.sourceId,row.id]),action:links.has(row.id)?'link':'create',...(links.has(row.id)?{expectedRevision:links.get(row.id).expectedRevision}:{})}));
 for(const item of items){if(origin(store,input.sourceId,item.timingCarId))throw fault('ORIGIN_CONFLICT','This Timing car already has a pending or accepted transfer. Look up its origin before proceeding.',409);const existingCar=car(store,item.paddockCarId);if(item.action==='link'){if(!existingCar||require('./car-membership.cjs').isWishlist(existingCar)||existingCar.archived||existingCar.revision!==item.expectedRevision)throw fault('TARGET_CHANGED','The selected car changed or is unavailable. Review the match again.',409);}else if(existingCar)throw fault('ORIGIN_CONFLICT','This car identity already exists; review an explicit link.',409);}
 const pack=require('./store.cjs').validatePackage({...converted,packageId,source:'local-'+digest(input.sourceId),sender:'SlotForge Timing · local library',cars:converted.cars.map((c,i)=>items[i].action==='link'?{id:items[i].paddockCarId,name:car(store,items[i].paddockCarId).name}:{...c,...(rows[i].reference!==undefined?{reference:String(rows[i].reference)}:{}),id:items[i].paddockCarId})});
 store.mutate('submission.add',{package:pack,localTransfer:{version:1,sourceId:input.sourceId,transferId:input.transferId,hash,items}},{snapshot:false});
 return {...receipt(store,find(store,packageId)),duplicate:false};
}
function parse(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fault('INVALID_JSON','Send valid UTF-8 JSON.');}}
async function handle(network,req,res,url,code,send){
 const store=network.store,expected=req.headers['x-slotforge-database'];
 const guard=()=>{if(!expected)throw fault('DATABASE_REQUIRED','Send X-SlotForge-Database.');if(expected!==store.data.id)throw fault('DATABASE_MISMATCH','The library identity changed. Reconnect explicitly.',409);if(!network.access(code)?.localImport)throw fault('LOCAL_UNAVAILABLE','The local library is temporarily unavailable.',503);};
 guard();
 if(url.pathname===BASE+'/car-schema'||url.pathname.startsWith(BASE+'/cars/')||url.pathname===BASE+'/car-operations'||url.pathname.startsWith(BASE+'/car-operations/'))return require('./shared-car-library.cjs').handle(network,req,res,url,code,send);
 const origin=url.pathname.match(/^\/v1\/local-library\/origins\/([a-zA-Z0-9_-]{1,100})$/);
 if(req.method==='GET'&&origin){const carId=url.searchParams.get('timingCarId');if([...url.searchParams.keys()].some(k=>k!=='timingCarId')||url.searchParams.getAll('timingCarId').length!==1||!carId||carId.length>200)throw fault('INVALID_QUERY','Supply one Timing car ID.');const value=await require('./domain-tasks.cjs').run(store,{kind:'local-library-origin',sourceId:origin[1],timingCarId:carId},guard);return send(200,value);}
 if(url.search)throw fault('INVALID_QUERY','Local imports do not accept query parameters.');
 const cancellation=url.pathname.match(/^\/v1\/local-library\/imports\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})\/cancel$/);
 const match=url.pathname.match(/^\/v1\/local-library\/imports\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
 if(req.method==='GET'&&match){const value=await require('./domain-tasks.cjs').run(store,{kind:'local-library-receipt',sourceId:match[1],transferId:match[2]},guard);return send(200,value);}
 if(req.method!=='POST'||url.pathname!==BASE+'/imports'&&!cancellation)throw fault('NOT_FOUND','Unknown local library operation.',404);
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))throw fault('CONTENT_TYPE_REQUIRED','Send application/json with UTF-8 encoding.',415);
 if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw fault('CONTENT_ENCODING_UNSUPPORTED','Compressed requests are not supported.',415);
 if(Number(req.headers['content-length'])>MAX)throw fault('PAYLOAD_TOO_LARGE','Local imports are limited to 8 MiB.',413);
 const chunks=[];let size=0;
 for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>MAX)return send(413,{error:'Local imports are limited to 8 MiB.',code:'PAYLOAD_TOO_LARGE'});chunks.push(chunk);}
 guard();const value=await require('./domain-tasks.cjs').run(store,{kind:cancellation?'local-library-cancel':'local-library-import',...(cancellation?{sourceId:cancellation[1],transferId:cancellation[2]}:{}),bytes:Buffer.concat(chunks)},guard);
 if(!value.duplicate)try{network.onChange({kind:'local-import'});}catch{/* A failed notification does not undo a committed submission. */}
 return send(200,value);
}
function originReceipt(store,sourceId,timingCarId){const found=origin(store,sourceId,timingCarId);if(!found)throw fault('ORIGIN_NOT_FOUND','No pending or accepted transfer exists for this Timing car.',404);return receipt(store,found.sub);}
function cancel(store,sourceId,transferId,input){
 check(object(input)&&input.version===1&&Object.keys(input).every(k=>['version','itemIds'].includes(k))&&Array.isArray(input.itemIds)&&input.itemIds.length>=1&&input.itemIds.length<=25&&new Set(input.itemIds).size===input.itemIds.length,'Supply 1–25 distinct item IDs to cancel.');
 const sub=find(store,identity(sourceId,transferId));if(!sub?.localTransfer)throw fault('IMPORT_NOT_FOUND','This transfer has not been received.',404);
 const ids=input.itemIds.map(id=>{const item=sub.localTransfer.items.find(i=>i.itemId===id);check(item,'Unknown transfer item.');return item.paddockCarId;});
 if(ids.some(id=>!sub.outcomes[id]))store.mutate('submission.cancelLocal',{id:sub.id,carIds:ids},{snapshot:false});
 return receipt(store,find(store,sub.package.packageId));
}
module.exports={cancel,originReceipt,capability,identity,receive,lookup,parse,handle,MAX};
