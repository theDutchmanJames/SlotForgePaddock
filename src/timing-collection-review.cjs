'use strict';
// Owner-only grouping of the existing durable transfer/import decisions.
// Lists contain metadata only; photos and lap evidence are read on inspection.
const Q=require('./sqlite-query.cjs'),H=require('./history-imports.cjs');
const fault=(code,message)=>{throw Q.fault(code,message);};
const pending=`
 SELECT 'car' kind,r.key record,json_extract(src.json,'$') sourceId,
 json_extract(hash.json,'$') requestHash,json_extract(item.value,'$.paddockCarId') carId,
 json_extract(item.value,'$.action') action,json_extract(item.value,'$.itemId') itemId,
 json_extract(id.json,'$') id,json_extract(c.value,'$.name') name,
 NULL track,NULL laps,NULL recoveryId,json_extract(received.json,'$') receivedAt
 FROM records r JOIN record_fields src ON src.record=r.key AND src.path='["localTransfer","sourceId"]'
 JOIN record_fields hash ON hash.record=r.key AND hash.path='["localTransfer","hash"]'
 JOIN record_fields items ON items.record=r.key AND items.path='["localTransfer","items"]'
 JOIN json_each(items.json) item
 JOIN record_fields cars ON cars.record=r.key AND cars.path='["package","cars"]'
 JOIN json_each(cars.json) c ON json_extract(c.value,'$.id')=json_extract(item.value,'$.paddockCarId')
 JOIN record_fields id ON id.record=r.key AND id.path='["id"]'
 JOIN record_fields received ON received.record=r.key AND received.path='["received"]'
 LEFT JOIN record_fields outcome ON outcome.record=r.key AND outcome.path=json_array('outcomes',json_extract(item.value,'$.paddockCarId'),'decision')
 WHERE r.bucket='["submissions"]' AND outcome.record IS NULL
 UNION ALL
 SELECT 'history',r.key,json_extract(src.json,'$'),json_extract(hash.json,'$'),NULL,'history',NULL,
 json_extract(id.json,'$'),json_extract(name.json,'$'),json_extract(track.json,'$'),json_extract(laps.json,'$'),json_extract(recovery.json,'$'),json_extract(received.json,'$')
 FROM records r JOIN record_fields src ON src.record=r.key AND src.path='["batch","editor","installationId"]'
 JOIN record_fields hash ON hash.record=r.key AND hash.path='["requestHash"]'
 JOIN record_fields id ON id.record=r.key AND id.path='["id"]'
 JOIN record_fields name ON name.record=r.key AND name.path='["summary","name"]'
 JOIN record_fields track ON track.record=r.key AND track.path='["summary","track"]'
 JOIN record_fields laps ON laps.record=r.key AND laps.path='["summary","laps"]'
 JOIN record_fields recovery ON recovery.record=r.key AND recovery.path='["batch","recoveryId"]'
 JOIN record_fields received ON received.record=r.key AND received.path='["receivedAt"]'
 JOIN record_fields status ON status.record=r.key AND status.path='["status"]' AND status.json='"pending"'
 WHERE r.bucket='["timing","imports"]'`;
function inbox(r,expanded=false){
 const total=r.db.prepare('SELECT count(*) n FROM ('+pending+')').get().n;
 return {total,...(expanded?{databaseId:r.id,recoveryId:r.epoch,approvalEnabled:require('./historical-approval-gate.cjs').enabled(),rows:r.db.prepare('SELECT * FROM ('+pending+') ORDER BY sourceId,kind,receivedAt,id LIMIT 1000').all().map(({record,...row})=>({...row,recoveryChanged:!!row.recoveryId&&row.recoveryId!==r.epoch}))}: {})};
}
function guard(r,input){
 if(input.databaseId!==r.id)fault('DATABASE_MISMATCH','Open the original library to review this collection.');
 if(input.recoveryId!==r.epoch)fault('RECOVERY_CHANGED','The library was restored. Reconcile this import with Timing before continuing.');
}
function decide(store,input){
 if(input?.action==='inspect')return Q.read(store,null,r=>{guard(r,input);const row=r.one('submissions',input.id);if(!row?.localTransfer||row.localTransfer.sourceId!==input.sourceId||row.localTransfer.hash!==input.requestHash)fault('REVISION_CONFLICT','The selected transfer changed.');const car=row.package.cars.find(c=>c.id===input.carId),item=row.localTransfer.items.find(i=>i.itemId===input.itemId&&i.paddockCarId===input.carId);if(!car||!item)fault('OPERATION_NOT_FOUND','Unknown transfer item.');return {action:item.action,fields:Object.fromEntries(Object.entries(car).filter(([k])=>!['picture','photos','id','sharedSetups'].includes(k))),hasPicture:Object.hasOwn(car,'picture')};}).value;
 if(!input||!['approve','reject'].includes(input.action)||!Array.isArray(input.items)||!input.items.length||input.items.length>25||typeof input.note!=='string'||input.note.length>2000)fault('INVALID_QUERY','Choose 1–25 displayed items and a review decision.');
 const keys=new Set();for(const item of input.items){
  if(!item||!['car','history'].includes(item.kind)||typeof item.id!=='string'||typeof item.sourceId!=='string'||typeof item.requestHash!=='string'||(item.kind==='car'&&(typeof item.carId!=='string'||typeof item.itemId!=='string')))fault('INVALID_QUERY','Invalid collection review item.');
  const key=JSON.stringify([item.kind,item.id,item.carId]);if(keys.has(key))fault('INVALID_QUERY','Duplicate collection review item.');keys.add(key);
 }
 Q.read(store,null,r=>guard(r,input));const results=[];
 for(const item of input.items){
  try{
   const row=Q.read(store,null,r=>{guard(r,input);const row=item.kind==='car'?r.one('submissions',item.id):r.record(H.recordKey(item.id));if(!row)fault('OPERATION_NOT_FOUND','The import no longer exists.');
    if((item.kind==='car'?row.localTransfer?.sourceId:row.batch.editor.installationId)!==item.sourceId||(item.kind==='car'?row.localTransfer?.hash:row.requestHash)!==item.requestHash)fault('REVISION_CONFLICT','The selected import changed. Reopen Review.');return row;
   }).value;
   if(item.kind==='history')H.review(store,{databaseId:input.databaseId,recoveryId:input.recoveryId,id:item.id,requestHash:item.requestHash,action:input.action,note:input.note});
   else {
    const transfer=row.localTransfer.items.find(v=>v.itemId===item.itemId&&v.paddockCarId===item.carId);if(!transfer)fault('REVISION_CONFLICT','The selected car does not belong to this transfer.');
    const decision=input.action==='approve'?'accept':'reject',outcome=row.outcomes[item.carId];
    if(outcome){if(outcome.decision!==decision||outcome.cancelled||outcome.note!==input.note)fault('REVISION_CONFLICT','This car has already received a different decision.');}
    else store.mutate('submission.review',{id:row.id,carId:item.carId,decision,note:input.note,revision:transfer.action==='link'?transfer.expectedRevision:0},{snapshot:false});
   }
   results.push({id:item.id,carId:item.carId,status:input.action==='approve'?'approved':'rejected'});
  }catch(e){
   // Unknown commit outcomes must refresh the worker owner before any retry.
   if(e.code==='WRITE_UNCERTAIN'||!e.code&&!e.apiCode){e.code='WRITE_UNCERTAIN';throw e;}
   results.push({id:item.id,carId:item.carId,status:'error',code:e.apiCode||e.code,message:e.message});
   break;
  }
 }
 return {results};
}
module.exports={inbox,decide};
