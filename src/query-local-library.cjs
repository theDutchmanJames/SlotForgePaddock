'use strict';
// Use existing indexed scalar fields. Receipt polling must not hydrate every
// submitted package or car, especially when those packages contain photos.
function find(reader,packageId){
 const row=reader.db.prepare(`SELECT f.record FROM record_fields f JOIN records r ON r.key=f.record
 WHERE f.path='["package","packageId"]' AND f.json=? AND length(f.json)<=512 AND r.bucket='["submissions"]' LIMIT 1`).get(JSON.stringify(packageId));
 return row?reader.record(row.record,{assetHandle:true}):null;
}
function origin(reader,sourceId,timingCarId){
 const row=reader.db.prepare(`SELECT src.record FROM record_fields src JOIN records r ON r.key=src.record
 JOIN record_fields items ON items.record=src.record AND items.path='["localTransfer","items"]'
 JOIN json_each(items.json) item
 LEFT JOIN record_fields decision ON decision.record=src.record AND decision.path=json_array('outcomes',json_extract(item.value,'$.paddockCarId'),'decision')
 WHERE src.path='["localTransfer","sourceId"]' AND src.json=? AND length(src.json)<=512 AND r.bucket='["submissions"]'
 AND json_extract(item.value,'$.timingCarId')=? AND coalesce(decision.json,'')<>'"reject"' LIMIT 1`).get(JSON.stringify(sourceId),timingCarId);
 if(!row)return null;const sub=reader.record(row.record,{assetHandle:true});return {sub,item:sub.localTransfer.items.find(i=>i.timingCarId===timingCarId)};
}
module.exports={find,origin};
