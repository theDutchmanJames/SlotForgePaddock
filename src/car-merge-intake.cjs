'use strict';
// Attach late-history Review decisions to the SAME transaction as the incoming
// evidence. Never modify the result payload, signature or delivery receipt.
const Q=require('./sqlite-query.cjs'),S=require('./scoped-write.cjs'),M=require('./car-merge-model.cjs'),A=require('./car-merge-archive.cjs');
const {cloneJSON:clone}=require('./json-data.cjs');
function prepare(store,prepared){
 if(prepared.noop||!store.file||['backup.restore','replica.sync'].includes(prepared.scope?.kind))return prepared;
 if(prepared.scope?.kind!=='scoped'){
  // Full-model writes already own their history. Copy only mutable merge
  // metadata; unchanged frozen archives and lazy photographs remain shared.
  const data=prepared.data;if(!data?.mergeMappings?.length||data.id!==store.data.id)return prepared;
  const next={...data,mergeMeta:clone(data.mergeMeta),mergeInclusions:clone(data.mergeInclusions)};
  if(!M.reconcileHistory(next))return prepared;
  return {...prepared,data:next};
 }
 const scope=prepared.scope,changed=[],buckets=new Map();
 for(const record of scope.packed.records){
  const path=JSON.parse(record.key);
  if((path[0]==='timing'&&path[1]==='sessions')||path[0]==='libraryOrigins'||path[0]==='libraryExtras'){
   // Use the prepared objects: packed envelopes replace media/evidence chunks
   // with null + asset references, which must not change the evidence digest.
   const bucket=JSON.stringify(path.slice(0,-1));
   if(!buckets.has(bucket)){
    const values=path.slice(0,-1).reduce((v,k)=>v[k],scope.after);
    buckets.set(bucket,new Map(values.map((v,i)=>[typeof v?.id==='string'?'id:'+v.id:path[0]==='timing'&&v?.payload?'session:'+JSON.stringify([v.payload.source.id,v.payload.sessionId]):'index:'+i,v])));
   }
   const value=buckets.get(bucket).get(path.at(-1));
   if(!value)throw Error('Incoming history record is missing from its prepared transaction.');
   changed.push({path,value});
  }
 }
 const sessions=changed.filter(r=>r.path[0]==='timing'&&r.path[1]==='sessions').map(r=>r.value);
 const origins=changed.filter(r=>r.path[0]==='libraryOrigins'&&r.value.entity==='session').map(r=>r.value);
 const extras=changed.filter(r=>r.path[0]==='libraryExtras'&&r.value.namespace==='timing.historyOriginals').map(r=>r.value);
 if(!sessions.length&&!origins.length&&!extras.length)return prepared;
 const context=Q.read(store,null,r=>{
  if(!r.merges.active)return null;
  const all=bucket=>r.db.prepare('SELECT key FROM records WHERE bucket=?').all(JSON.stringify([bucket])).map(k=>r.record(k.key));
  const rawOrigins=new Map(origins.map(o=>[o.id,o]));
  for(const extra of extras){
   const keys=r.db.prepare(`SELECT o.key FROM records o JOIN record_fields s ON s.record=o.key AND s.path='["sourceId"]' AND s.json=? JOIN record_fields i ON i.record=o.key AND i.path='["originalId"]' AND i.json=? WHERE o.bucket='["libraryOrigins"]'`).all(JSON.stringify(extra.sourceId),JSON.stringify(extra.originalId));
   for(const k of keys){const o=r.record(k.key);if(o.entity==='session'&&!rawOrigins.has(o.id))rawOrigins.set(o.id,o);}
  }
  const rows=M.contributions({timing:{sessions}});
  for(const o of rawOrigins.values())if(o.projectionStatus==='raw-only'){
   let extra=extras.find(e=>e.sourceId===o.sourceId&&e.originalId===o.originalId);
   if(!extra){const id='extra-'+require('./timing-integration.cjs').digest(['timing.historyOriginals',o.sourceId,o.originalId]);extra=r.record(JSON.stringify(['libraryExtras','id:'+id]));}
   if(!extra)throw Object.assign(Error('Original-only session has lost its evidence.'),{code:'MERGE_LINEAGE_CONFLICT'});
   for(const carId of o.carIds||[]){const participantId='raw-car-'+A.digest(carId).slice(0,48);rows.push({key:M.historyKey(o.sourceId,o.sessionId,participantId),carId,format:'raw-only',record:{origin:o,extra}});}
  }
  const keys=[...new Set(rows.map(row=>row.key))];
  const selected=r.db.prepare(`SELECT i.key FROM records i JOIN record_fields k ON k.record=i.key AND k.path='["key"]' WHERE i.bucket='["mergeInclusions"]' AND k.json IN (SELECT json_quote(value) FROM json_each(?))`).all(JSON.stringify(keys));
  return {rows,mergeMappings:all('mergeMappings'),mergeMeta:r.scalar('mergeMeta'),mergeInclusions:selected.map(k=>r.record(k.key))};
 }).value;
 if(!context)return prepared;
 const next={mergeMappings:context.mergeMappings,mergeMeta:clone(context.mergeMeta),mergeInclusions:clone(context.mergeInclusions)};
 if(!M.reconcileRows(next,context.rows))return prepared;
 const before={...scope.before,mergeMeta:context.mergeMeta,mergeInclusions:context.mergeInclusions};
 const after={...scope.after,mergeMeta:next.mergeMeta,mergeInclusions:next.mergeInclusions};
 const result=S.prepare(store,before,after,prepared.result);
 if(scope.receipt)result.scope.receipt=scope.receipt;
 return result;
}
module.exports={prepare};
