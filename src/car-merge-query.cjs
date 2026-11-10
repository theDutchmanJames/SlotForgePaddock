'use strict';
// Snapshot-bound identity and contribution resolution. This reads only small
// mapping/decision records; it never hydrates cars, lap arrays or archives.
const ID=/^[a-zA-Z0-9_-]{1,100}$/;
const rawParticipant=id=>'raw-car-'+require('./car-merge-archive.cjs').digest(id).slice(0,48);
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function install(reader){
 const db=reader.db,edges=new Map(),decisions=new Map(),resolved=new Map();
 const keys=db.prepare('SELECT key FROM records WHERE bucket=? ORDER BY key');
 for(const row of keys.all('["mergeMappings"]')){
  const edge=reader.record(row.key);
  if(edges.has(edge.retiredCarId))fail('MERGE_LINEAGE_CONFLICT','Duplicate merge retirement.');
  edges.set(edge.retiredCarId,edge);
 }
 const meta=edges.size?reader.scalar('mergeMeta'):null;
 function path(id){
  const chain=[],seen=new Set();let current=id;
  while(edges.has(current)){
   if(seen.has(current))fail('MERGE_LINEAGE_CONFLICT','Merge identity cycle.');
   seen.add(current);const edge=edges.get(current);chain.push(edge);current=edge.mainCarId;
  }
  return {current,chain};
 }
 // Validate all chains once, before allowing queries to resolve any identity.
 for(const id of edges.keys())path(id);
 const decisionRows=db.prepare(`SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key
  WHERE r.bucket='["mergeInclusions"]' AND f.path='["key"]' AND f.json=? ORDER BY r.key`);
 function forContribution(key){
  if(!decisions.has(key))decisions.set(key,decisionRows.all(JSON.stringify(key)).map(row=>reader.record(row.key)));
  return decisions.get(key);
 }
 function contribution(sourceId,sessionId,participantId,originalCarId,format='timing-v1'){
  const cacheKey=JSON.stringify([sourceId,sessionId,participantId,originalCarId,format]);
  if(resolved.has(cacheKey))return resolved.get(cacheKey);
  const {current,chain}=path(originalCarId),key=JSON.stringify([sourceId,sessionId,participantId]);
  let status='included';
  if(edges.size){
   const items=forContribution(key);
   if(items.some(i=>i.originalCarId!==originalCarId||i.format!==format))status='conflict';
   else for(const edge of chain){
    const matches=items.filter(i=>i.mergeId===edge.id);
    if(matches.length>1)fail('MERGE_LINEAGE_CONFLICT','Duplicate contribution decision.');
    const item=matches[0];
    if(!item||item.status==='pending'){status='pending';break;}
    if(item.status!=='included'){status='excluded';break;}
   }
  }
  const result={originalCarId,canonicalCarId:current,status,mergeIds:chain.map(e=>e.id)};
  resolved.set(cacheKey,result);return result;
 }
 function identity(carId){
  if(typeof carId!=='string'||!ID.test(carId))fail('INVALID_QUERY','Choose a valid car identity.');
  const exists=id=>!!db.prepare('SELECT 1 FROM records WHERE key=?').get(JSON.stringify(['cars','id:'+id]));
  if(!exists(carId))fail('CAR_NOT_FOUND','Car no longer exists.');
  const {current,chain}=path(carId);
  if(!exists(current))fail('MERGE_LINEAGE_CONFLICT','The main car is missing.');
  return {version:1,databaseId:reader.id,recoveryId:reader.epoch,mergeRevision:meta?.revision||0,requestedCarId:carId,canonicalCarId:current,state:chain.length?'merged':'current',mergeIds:chain.map(e=>e.id)};
 }
 db.function('sf_history_car',{deterministic:true},(source,session,participant,car,format)=>{
  if(car===null)return null;
  const result=contribution(source,session,participant,car,format||'timing-v1');
  return result.status==='included'?result.canonicalCarId:null;
 });
 db.function('sf_history_withdrawal',{deterministic:true},(source,session,carIds,target)=>{
  const ids=JSON.parse(carIds||'[]');
  if(ids.includes(target)&&!edges.has(target))return 1;
  if(!edges.size)return 0;
  const rows=db.prepare(`SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key
   WHERE r.bucket='["mergeInclusions"]' AND f.path='["key"]'
   AND json_extract(json_extract(f.json,'$'),'$[0]')=?
   AND json_extract(json_extract(f.json,'$'),'$[1]')=?`).all(source,session);
  for(const row of rows){const i=reader.record(row.key),tuple=JSON.parse(i.key);
   if(!ids.includes(i.originalCarId))continue;
   const v=contribution(source,session,tuple[2],i.originalCarId,i.format);
   if(v.status==='included'&&v.canonicalCarId===target)return 1;
  }
  return 0;
 });
 db.function('sf_original_car',{deterministic:true},(source,session,car)=>{
  if(car===null)return null;
  const result=contribution(source,session,rawParticipant(car),car,'raw-only');
  return result.status==='included'?result.canonicalCarId:null;
 });
 reader.merges={identity,contribution,active:edges.size>0,revision:meta?.revision||0,
  mappings:input=>require('./car-merge-model.cjs').mappingPage({id:reader.id,mergeMeta:meta,mergeMappings:[...edges.values()].sort((a,b)=>a.revision-b.revision||a.id.localeCompare(b.id))},reader.epoch,input),
  originalIds:target=>edges.has(target)?[]:[target,...[...edges.keys()].filter(id=>path(id).current===target)]};
 return reader.merges;
}
// These aliases are fixed internal SQL identifiers, never user input.
const owner=(s='s',p='p')=>`sf_history_car(${s}.source,${s}.session,json_extract(${p}.value,'$.id'),json_extract(${p}.value,'$.carId'),coalesce(json_extract(${s}.json,'$.format'),'timing-v1'))`;
const rawMember=(record='r',ids='c.json')=>`EXISTS(SELECT 1 FROM json_each(${ids}) j WHERE sf_original_car(
 (SELECT json_extract(ms.json,'$') FROM record_fields ms WHERE ms.record=${record}.key AND ms.path='["sourceId"]'),
 (SELECT json_extract(mn.json,'$') FROM record_fields mn WHERE mn.record=${record}.key AND mn.path='["sessionId"]'),j.value)=?)`;
function assertWritable(reader,id){const value=reader.merges.identity(id);if(value.state==='merged')throw Object.assign(Error('This car was merged. Reopen the main car before making a new change.'),{code:'CAR_MERGED',details:{identity:value}});}
function contributions(store,input){
 const allowed=['sourceId','sessionId','offset','limit','token'];
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||!ID.test(input.sourceId||'')||!ID.test(input.sessionId||''))fail('INVALID_QUERY','Choose a source and session identity.');
 const offset=input.offset??0,limit=input.limit??50;
 if(input.token!==undefined&&(!input.token||typeof input.token!=='object'||Array.isArray(input.token)||Object.keys(input.token).some(k=>!['id','revision','epoch'].includes(k))||!ID.test(input.token.id||'')||!ID.test(input.token.epoch||'')||!Number.isSafeInteger(input.token.revision)||input.token.revision<0))fail('INVALID_QUERY','Use the contribution page snapshot token unchanged.');
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID_QUERY','Choose a bounded contribution page.');
 if(offset&&!input.token)fail('SNAPSHOT_REQUIRED','Continue with the first page token.');
 return require('./sqlite-query.cjs').read(store,input.token,r=>{
  const head=r.db.prepare('SELECT json FROM query_sessions WHERE source=? AND session=?').get(input.sourceId,input.sessionId);
  let rows,format,state;
  if(head){const s=JSON.parse(head.json);format=s.format||'timing-v1';state=s.payload.state;
   rows=(s.payload.participants||[]).filter(p=>p.carId).map(p=>({participantId:p.id,...r.merges.contribution(input.sourceId,input.sessionId,p.id,p.carId,format)}));
  }else{
   const keys=r.db.prepare(`SELECT o.key FROM records o JOIN record_fields s ON s.record=o.key AND s.path='["sourceId"]' AND s.json=? JOIN record_fields n ON n.record=o.key AND n.path='["sessionId"]' AND n.json=? WHERE o.bucket='["libraryOrigins"]'`).all(JSON.stringify(input.sourceId),JSON.stringify(input.sessionId));
   const originals=keys.map(k=>r.record(k.key)).filter(o=>o.entity==='session'&&o.projectionStatus==='raw-only');
   if(!originals.length)fail('SESSION_NOT_FOUND','Session not found.');
   if(originals.length!==1)fail('MERGE_LINEAGE_CONFLICT','Ambiguous original session identity.');
   const o=originals[0];format='raw-only';state=o.state||'active';rows=(o.carIds||[]).map(id=>({participantId:rawParticipant(id),...r.merges.contribution(input.sourceId,input.sessionId,rawParticipant(id),id,format)}));
  }
  if(offset>rows.length)fail('INVALID_QUERY','Contribution offset is outside this session.');
  const page=rows.slice(offset,offset+limit);
  return {version:1,databaseId:r.id,recoveryId:r.epoch,mergeRevision:r.merges.revision,token:r.token,sourceId:input.sourceId,sessionId:input.sessionId,format,state,rows:page,total:rows.length,offset,nextOffset:offset+page.length<rows.length?offset+page.length:null};
 }).value;
}
module.exports={install,owner,rawParticipant,rawMember,assertWritable,contributions};
