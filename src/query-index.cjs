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
function ensure(db){
 // These maintenance queries run on every commit. In particular, bytes is
 // stored after the potentially large log JSON; a covering index avoids
 // traversing its overflow pages just to enforce the replay budget.
 db.exec('CREATE INDEX IF NOT EXISTS field_versions_revision ON field_versions(revision); CREATE INDEX IF NOT EXISTS change_log_sizes ON change_log(sequence,bytes);');
 const version=db.prepare("SELECT value FROM state WHERE key='query_index_version'").get()?.value,current=db.prepare("SELECT value FROM state WHERE key='query_index_identity'").get()?.value===identity(db);
 const tables=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('query_records','query_sessions','query_laps','query_car_results')").get().n;
 if(current&&tables===4){
  const totals=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='query_totals'").get();
  if(version==='7'&&totals)return;
  // Version 6 already has the same record/lap projections. Adding counters
  // needs only their small metadata rows, not every car and measured lap.
  if(version==='6'){require('./query-totals.cjs').rebuild(db);db.prepare("UPDATE state SET value='7' WHERE key='query_index_version'").run();return;}
 }
 require('./query-timing.cjs').schema(db);
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
 db.prepare("INSERT INTO state(key,value) VALUES('query_index_version','7') ON CONFLICT(key) DO UPDATE SET value='7'").run();stamp(db);
}
module.exports={ensure,update,stamp,identity};
