'use strict';
// Rebuildable search metadata. This is never an authority for mutations or
// exported fields, and updates share the authoritative record's transaction.
const fields=require('./sqlite-records.cjs');
function update(db,key,bucket,value){
 require('./query-timing.cjs').update(db,key,bucket,value);
 const v=value&&typeof value==='object'?value:{},name=String(v.name||''),maker=String(v.maker||'');
 const search=[v.name,v.number,v.maker,v.model,v.reference,v.location,v.category,v.partType,v.compatibility,...(v.tags||[]),...Object.values(v.technical||{})].filter(x=>typeof x==='string').join(' ').toLowerCase();
 const aux={field:v.field||'',category:v.category||'',partType:v.partType||'',partId:v.partId||'',dismantled:!!v.dismantled,components:Array.isArray(v.components)&&!v.dismantled&&!v.carId?v.components:[],quantity:Number(v.quantity)||0,removed:!!v.removed,reserved:Array.isArray(v.components)&&!v.dismantled&&!v.carId?v.components.reduce((n,c)=>n+c.quantity,0):0,incoming:v.status==='pending'&&v.package?.cars?v.package.cars.filter(c=>!v.outcomes[c.id]).length:0};
 db.prepare(`INSERT INTO query_records(key,bucket,car_id,name,maker,updated,date,archived,status,usage,search,type,task,rank,due,aux) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,car_id=excluded.car_id,name=excluded.name,maker=excluded.maker,updated=excluded.updated,date=excluded.date,archived=excluded.archived,status=excluded.status,usage=excluded.usage,search=excluded.search,type=excluded.type,task=excluded.task,rank=excluded.rank,due=excluded.due,aux=excluded.aux`).run(key,bucket,typeof v.carId==='string'?v.carId:null,name.toLowerCase(),maker.toLowerCase(),String(v.updated||''),String(v.date||v.receivedAt||v.created||''),v.archived?1:0,String(v.status||''),JSON.stringify(v.usage||[]),search,String(v.type||''),String(v.task||v.title||'').trim().toLowerCase(),String(v.performedDate||String(v.date||'').slice(0,10))+'|'+String(v.date||''),String(v.nextDue||''),JSON.stringify(aux));
}
function identity(db){return JSON.stringify(['identity','change_epoch','change_sequence'].map(key=>db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value??null));}
function stamp(db){db.prepare("INSERT INTO state(key,value) VALUES('query_index_identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(identity(db));}
function structure(db){
 const objects=new Map(db.prepare("SELECT name,type FROM sqlite_master WHERE name LIKE 'query_%'").all().map(row=>[row.name,row.type]));
 const has=(type,names)=>names.every(name=>objects.get(name)===type);
 return {
  records:has('table',['query_records','query_sessions','query_laps','query_car_results']),
  totals:has('table',['query_totals'])&&has('trigger',['query_totals_insert','query_totals_update','query_totals_delete']),
  performance:has('table',['query_performance','query_performance_dirty'])&&has('trigger',['query_performance_insert','query_performance_update','query_performance_delete'])
 };
}
function objectsReady(db){return Object.values(structure(db)).every(Boolean);}
function ensure(db){
 // These maintenance queries run on every commit. In particular, bytes is
 // stored after the potentially large log JSON; a covering index avoids
 // traversing its overflow pages just to enforce the replay budget.
 db.exec('CREATE INDEX IF NOT EXISTS field_versions_revision ON field_versions(revision); CREATE INDEX IF NOT EXISTS change_log_sizes ON change_log(sequence,bytes);');
 const version=db.prepare("SELECT value FROM state WHERE key='query_index_version'").get()?.value,current=db.prepare("SELECT value FROM state WHERE key='query_index_identity'").get()?.value===identity(db);
 const ready=structure(db);
 if(current&&ready.records){
  if(version==='8'&&ready.totals&&ready.performance){require('./query-indexes.cjs').ensure(db);return;}
  // Versions 6 and 7 have the same record/lap projections. Build totals from
  // their small metadata rows without decoding any cars or measured laps.
  if(['6','7','8'].includes(version)){
   // Missing maintenance triggers can have left their summaries stale. Rebuild
   // the affected family, but preserve the independent healthy family.
   if(version==='6'||!ready.totals)require('./query-totals.cjs').rebuild(db);
   if(version!=='8'||!ready.performance)require('./query-performance.cjs').rebuild(db);
   require('./query-indexes.cjs').ensure(db);if(version!=='8')db.prepare("UPDATE state SET value='8' WHERE key='query_index_version'").run();return;
  }
 }
 require('./query-timing.cjs').schema(db);
 require('./query-performance.cjs').schema(db);
 db.exec('DELETE FROM query_laps; DELETE FROM query_car_results; DELETE FROM query_sessions; DELETE FROM query_performance;');
 db.exec(`DROP TABLE IF EXISTS query_records;
 CREATE TABLE query_records(key TEXT PRIMARY KEY REFERENCES records(key) ON DELETE CASCADE,bucket TEXT NOT NULL,car_id TEXT,name TEXT NOT NULL,maker TEXT NOT NULL,updated TEXT NOT NULL,date TEXT NOT NULL,archived INTEGER NOT NULL,status TEXT NOT NULL,usage TEXT NOT NULL,search TEXT NOT NULL,type TEXT NOT NULL,task TEXT NOT NULL,rank TEXT NOT NULL,due TEXT NOT NULL,aux TEXT NOT NULL) STRICT;
 CREATE INDEX query_names ON query_records(bucket,archived,name,key);
 CREATE INDEX query_makers ON query_records(bucket,archived,maker,key);
 CREATE INDEX query_updated ON query_records(bucket,archived,updated,key);
 CREATE INDEX query_car ON query_records(bucket,car_id,date,key);
 CREATE INDEX query_status ON query_records(bucket,status,key);
 CREATE INDEX query_reminders ON query_records(bucket,type,car_id,task,rank);`);
 require('./query-totals.cjs').schema(db);
 const get=db.prepare('SELECT path,json FROM record_fields WHERE record=?');
 for(const row of db.prepare('SELECT key,bucket,json FROM records').iterate()){const envelope=fields.decode(row.json,get.all(row.key).map(f=>[f.path,f.json]));update(db,row.key,row.bucket,envelope.value);}
 require('./query-performance.cjs').flush(db);
 require('./query-indexes.cjs').ensure(db);
 db.prepare("INSERT INTO state(key,value) VALUES('query_index_version','8') ON CONFLICT(key) DO UPDATE SET value='8'").run();stamp(db);
}
module.exports={ensure,update,stamp,identity,objectsReady,structure};
