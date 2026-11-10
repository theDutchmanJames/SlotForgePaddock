'use strict';
const Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs');
function startedAt(raw){const date=raw?.session?.startedAt??raw?.session?.date,ms=typeof date==='number'?date:typeof date==='string'?Date.parse(date):NaN;return Number.isFinite(ms)&&Math.abs(ms)<=8640000000000000?new Date(ms).toISOString():null;}
function rawMeta(store,sourceId,raw,carIds){return Q.read(store,null,r=>{
 const allowed=new Set(carIds),counts=Object.fromEntries(carIds.map(id=>[id,0])),links=new Map();
 for(const lap of raw?.laps||[]){if(lap.virtual||lap.virtualRival||typeof lap.carId!=='string')continue;let id=lap.carId;if(!allowed.has(id)){if(!links.has(id)){const origin=r.record(JSON.stringify(['libraryOrigins','id:origin-'+T.digest([sourceId,'car',id])]));links.set(id,origin?.carId);}id=links.get(id);}if(allowed.has(id))counts[id]++;}
 return {carLapCounts:counts,startedAt:startedAt(raw)};
 }).value;}
function originals(r,carId,from){let total=0;
 const originalIds=r.merges.originalIds(carId);if(!originalIds.length)return 0;
 const included=(o,id)=>{const v=r.merges.contribution(o.sourceId,o.sessionId,require('./car-merge-query.cjs').rawParticipant(id),id,'raw-only');return v.status==='included'&&v.canonicalCarId===carId;};
 const rows=r.db.prepare(`SELECT r.key FROM records r JOIN record_fields p ON p.record=r.key AND p.path='["projectionStatus"]' JOIN record_fields c ON c.record=r.key AND c.path='["carIds"]' WHERE r.bucket='["libraryOrigins"]' AND p.json='"raw-only"' AND EXISTS(SELECT 1 FROM json_each(c.json) WHERE value IN (SELECT value FROM json_each(?)))`).iterate(JSON.stringify(originalIds));
 for(const row of rows){const o=r.record(row.key);if(o.state==='withdrawn')continue;if(from&&o.startedAt&&o.startedAt<from)continue;
  if(o.carLapCounts){for(const id of originalIds)if(included(o,id))total+=o.carLapCounts[id]||0;continue;}
  // Compatibility for isolated earlier candidates; new writes index counts.
  const body=r.record(JSON.stringify(['libraryExtras','id:extra-'+T.digest(['timing.historyOriginals',o.sourceId,o.originalId])]));if(!body)continue;const raw=require('./shared-library-evidence.cjs').decode(body);
  const date=o.startedAt||startedAt(raw);if(from&&date&&date<from)continue;
  const links=new Map(originalIds.map(id=>[id,id]));for(const lap of raw.laps||[]){if(lap.virtual||lap.virtualRival||typeof lap.carId!=='string')continue;if(!links.has(lap.carId)){const origin=r.record(JSON.stringify(['libraryOrigins','id:origin-'+T.digest([o.sourceId,'car',lap.carId])]));links.set(lap.carId,origin?.carId);}if(originalIds.includes(links.get(lap.carId))&&included(o,links.get(lap.carId)))total++;}
 }
 return total;
}
module.exports={rawMeta,originals,startedAt};
