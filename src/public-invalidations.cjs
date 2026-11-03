'use strict';
// Compute public configuration dependencies inside the authoritative write
// transaction. Old journal entries intentionally keep the conservative fallback.
const fields=require('./sqlite-records.cjs');
function begin(db,packed){
 const parts=new Set(),cars=new Set();
 const get=db.prepare('SELECT json FROM records WHERE key=?'),leaves=db.prepare('SELECT path,json FROM record_fields WHERE record=?');
 const previous=key=>{const row=get.get(key);return row?fields.decode(row.json,leaves.all(key).map(f=>[f.path,f.json])).value:null;};
 const component=v=>v&&!v.removed?Object.fromEntries(['carId','partId','quantity','field','position','assemblyId'].map(k=>[k,v[k]??null])):null;
 const inspect=(key,next)=>{
  const path=JSON.parse(key);if(!['parts','installations'].includes(path[0]))return;
  const old=previous(key);
  if(path[0]==='parts'){if((old?.name??null)!==(next?.name??null))parts.add(path[1].slice(3));}
  else if(JSON.stringify(component(old))!==JSON.stringify(component(next))){if(old&&!old.removed&&old.carId)cars.add(old.carId);if(next&&!next.removed&&next.carId)cars.add(next.carId);}
 };
 for(const row of packed.records)inspect(row.key,JSON.parse(row.json).value);
 const nextKeys=new Set(packed.records.map(r=>r.key));
 const removed=packed.partial?(packed.removed||[]):db.prepare('SELECT key FROM records').all().map(r=>r.key).filter(k=>!nextKeys.has(k));
 for(const key of removed)inspect(key,null);
 const dependents=()=>{if(!parts.size||cars.size>512)return;const q=db.prepare(`SELECT DISTINCT car_id FROM query_records WHERE bucket='["installations"]' AND json_extract(aux,'$.partId') IN (SELECT value FROM json_each(?)) AND json_extract(aux,'$.removed')=0 AND car_id IS NOT NULL LIMIT 513`);for(const r of q.all(JSON.stringify([...parts])))cars.add(r.car_id);};
 dependents();
 return ()=>{dependents();return cars.size>512?null:[...cars].sort();};
}
module.exports={begin};
