'use strict';
// Preserved legacy evidence which cannot honestly be projected into measured
// racing statistics. Desktop-only; raw app metadata is never exposed on LAN APIs.
const Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const WHERE=`FROM records r JOIN record_fields p ON p.record=r.key AND p.path='["projectionStatus"]' JOIN record_fields c ON c.record=r.key AND c.path='["carIds"]' WHERE r.bucket='["libraryOrigins"]' AND p.json='"raw-only"' AND ${require('./car-merge-query.cjs').rawMember()}`;
function count(r,carId){return r.db.prepare('SELECT count(*) n '+WHERE).get(carId).n;}
function read(store,input){
 if(!['originals','original'].includes(input.operation)||Object.keys(input).some(k=>!['operation','databaseId','recoveryId','carId','originId','offset'].includes(k)))fail('INVALID_QUERY','Invalid original history view.');
 const offset=input.offset??0;if(!Number.isSafeInteger(offset)||offset<0)fail('INVALID_QUERY','Invalid original history offset.');
 return Q.read(store,null,r=>{
  if(input.databaseId!==r.id||input.recoveryId!==r.epoch)fail('RECOVERY_CHANGED','The collection changed. Reopen its history.');if(!r.one('cars',input.carId))fail('CAR_NOT_FOUND','This car no longer exists.');
  if(input.operation==='originals'){const total=count(r,input.carId),rows=r.db.prepare('SELECT r.key '+WHERE+' ORDER BY r.key LIMIT 20 OFFSET ?').all(input.carId,offset).map(x=>r.record(x.key));return {rows,total,offset,nextOffset:offset+rows.length<total?offset+rows.length:null};}
  const origin=r.record(JSON.stringify(['libraryOrigins','id:'+input.originId]));const selected=(origin?.carIds||[]).filter(id=>{const v=r.merges.contribution(origin.sourceId,origin.sessionId,require('./car-merge-query.cjs').rawParticipant(id),id,'raw-only');return v.status==='included'&&v.canonicalCarId===input.carId;});if(origin?.projectionStatus!=='raw-only'||!selected.length)fail('ORIGINAL_NOT_FOUND','No original history for this car.');
  const row=r.record(JSON.stringify(['libraryExtras','id:extra-'+T.digest(['timing.historyOriginals',origin.sourceId,origin.originalId]) ]));if(!row)fail('ORIGINAL_NOT_FOUND','Original evidence is missing.');
  const raw=require('./shared-library-evidence.cjs').decode(row);
  const ids=r.db.prepare(`SELECT json_extract(f.json,'$') originalId FROM records x JOIN record_fields f ON f.record=x.key AND f.path='["originalId"]' JOIN record_fields s ON s.record=x.key AND s.path='["sourceId"]' JOIN record_fields c ON c.record=x.key AND c.path='["carId"]' WHERE x.bucket='["libraryOrigins"]' AND s.json=? AND c.json IN (SELECT json_quote(value) FROM json_each(?))`).all(JSON.stringify(origin.sourceId),JSON.stringify(selected)).map(x=>x.originalId);
  const linked=new Set([...selected,...ids]),laps=(raw.laps||[]).filter(l=>linked.has(l.carId)&&!l.virtual&&!l.virtualRival),total=laps.length;
  return {origin,total,offset,nextOffset:offset+100<total?offset+100:null,laps:laps.slice(offset,offset+100).map(l=>({number:l.lapNumber??null,lane:l.lane??null,driver:l.driverName??null,time:l.time??null,valid:typeof l.valid==='boolean'?l.valid:null,pit:typeof l.pit==='boolean'?l.pit:null})),date:typeof raw.session?.date==='string'?raw.session.date:null};
 }).value;
}
module.exports={count,read};
