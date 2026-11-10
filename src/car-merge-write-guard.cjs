'use strict';
// Last-line storage protection, shared by full, scoped and worker writes.
// Verified restore/reset intentionally replaces a complete recovery generation.
function check(bucket,before,after,db){
 if(!before)return;
 const fail=message=>{throw Object.assign(Error(message),{code:'MERGE_IMMUTABLE'});};
 if(bucket==='["cars"]'&&before.merge)throw Object.assign(Error('This car was merged. Open its main car; its retired record is read-only.'),{code:'CAR_MERGED'});
 if(bucket==='["cars"]'&&!after&&db.prepare(`SELECT 1 FROM records r JOIN record_fields f ON f.record=r.key
  WHERE r.bucket='["mergeMappings"]' AND f.path='["mainCarId"]' AND f.json=? LIMIT 1`).get(JSON.stringify(before.id)))fail('This car is the destination of a merge. Keep its identity and original archives.');
 if(['["mergeMappings"]','["mergeArchives"]','["mergeChunks"]'].includes(bucket))fail('Merge identities and original archives cannot be changed or deleted.');
 if(bucket==='["mergeProposals"]'&&before.status!=='pending')fail('A completed merge decision cannot be changed or deleted.');
 if(bucket==='["libraryOrigins"]'&&before.entity==='car'&&protectedCar(before.carId,before.sourceId,db))fail('Original Timing car identities remain preserved after a merge or settings binding.');
 if(bucket==='["libraryExtras"]'&&before.namespace==='timing.carExtras'){
  const origins=db.prepare(`SELECT c.json car FROM records r
   JOIN record_fields s ON s.record=r.key AND s.path='["sourceId"]' AND s.json=?
   JOIN record_fields o ON o.record=r.key AND o.path='["originalId"]' AND o.json=?
   JOIN record_fields e ON e.record=r.key AND e.path='["entity"]' AND e.json='"car"'
   JOIN record_fields c ON c.record=r.key AND c.path='["carId"]' WHERE r.bucket='["libraryOrigins"]'`).all(JSON.stringify(before.sourceId),JSON.stringify(before.originalId));
  if(origins.some(o=>protectedCar(JSON.parse(o.car),before.sourceId,db)))fail('Original Timing settings remain preserved; edit the effective settings binding.');
 }
 if(bucket==='["mergeCompanions"]'){
  const retired=db.prepare(`SELECT 1 FROM records r JOIN record_fields c ON c.record=r.key WHERE r.bucket='["mergeMappings"]' AND c.path='["retiredCarId"]' AND c.json=?`).get(JSON.stringify(before.carId));
  if(retired||!after||['id','sourceId','carId','localCarId'].some(k=>before[k]!==after[k]))fail('Effective settings identities and retired settings cannot be changed or deleted.');
  if(after.revision!==before.revision+1)fail('Effective settings require the next revision.');
  require('./car-merge-settings.cjs').validateFields(after.fields);
 }
}
function protectedCar(carId,sourceId,db){
 return !!db.prepare(`SELECT 1 FROM records r JOIN record_fields c ON c.record=r.key WHERE
  (r.bucket='["mergeMappings"]' AND c.path IN ('["retiredCarId"]','["mainCarId"]') AND c.json=?) OR
  (r.bucket='["mergeCompanions"]' AND c.path='["carId"]' AND c.json=? AND EXISTS(SELECT 1 FROM record_fields s WHERE s.record=r.key AND s.path='["sourceId"]' AND s.json=?)) LIMIT 1`).get(JSON.stringify(carId),JSON.stringify(carId),JSON.stringify(sourceId));
}
module.exports={check};
