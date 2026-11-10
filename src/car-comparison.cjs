'use strict';
const Pace=require('../renderer/pace-model.js'),lazy=require('./lazy-assets.cjs');
function compare(store,ids){
 if(!Array.isArray(ids)||ids.length!==2||ids.some(id=>typeof id!=='string')||ids[0]===ids[1])throw Error('Choose two different cars.');
 const db=store.data,choose=read=>{
  const cars=ids.map(id=>{const c=read?read.one('cars',id):db.cars.find(c=>c.id===id);if(!c)throw Error('A selected car no longer exists. Choose again.');const out={};for(const k of ['id','name','maker','marque','model','scale','reference','raceClass','usage','availability','archived','technical','custom'])if(Object.hasOwn(c,k))out[k]=c[k];lazy.copyProperty(out,'picture',c);return out;});
  const tests=read?ids.flatMap(id=>{const rows=[];let offset=0;for(;;){const page=read.list('tests',{carId:id,offset,limit:200});rows.push(...page.rows);if(page.nextOffset===null)break;offset=page.nextOffset;}return rows;}):db.tests.filter(t=>ids.includes(t.carId));
  const timing=read?read.db.prepare("SELECT value FROM (SELECT DISTINCT key FROM query_car_results WHERE car_id IN (?,?)) selected JOIN query_sessions s ON s.key=selected.key, json_each(json_extract(s.json,'$._query.runs')) WHERE json_extract(value,'$.carId') IN (?,?)").all(...ids,...ids).map(r=>JSON.parse(r.value)):Pace.runs({...db,tests:[]}).filter(r=>ids.includes(r.carId));
  const runs=[...timing,...Pace.runs({cars,tests,timing:{sessions:[]}})].sort((a,b)=>b.date.localeCompare(a.date));
  return {databaseId:db.id,revision:db.revision,cars,runs,customFields:db.customFields};
 };
 return store.file&&store.expectedIdentity!==null?require('./sqlite-query.cjs').read(store,null,choose).value:choose();
}
module.exports={compare};
