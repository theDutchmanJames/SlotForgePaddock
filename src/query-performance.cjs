'use strict';
// Disposable per-car totals. Dirty markers include cascaded deletions and are
// drained once per transaction, after all corrected contributions are in place.
function empty(){return {aggregate:{sessions:0,validLaps:0,recordEligibleLaps:0,bestLapMs:null,averageLapMs:null,measuredTimeMs:0,distanceM:0,distanceComplete:true,wins:0},lanes:[],total:0};}
function schema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS query_performance(car_id TEXT PRIMARY KEY,json TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS query_performance_dirty(car_id TEXT PRIMARY KEY) STRICT;
 CREATE INDEX IF NOT EXISTS query_car_results_session ON query_car_results(key,car_id);
 CREATE TRIGGER IF NOT EXISTS query_performance_insert AFTER INSERT ON query_car_results BEGIN INSERT OR IGNORE INTO query_performance_dirty VALUES(NEW.car_id); END;
 CREATE TRIGGER IF NOT EXISTS query_performance_delete AFTER DELETE ON query_car_results BEGIN INSERT OR IGNORE INTO query_performance_dirty VALUES(OLD.car_id); END;
 CREATE TRIGGER IF NOT EXISTS query_performance_update AFTER UPDATE ON query_car_results BEGIN INSERT OR IGNORE INTO query_performance_dirty VALUES(OLD.car_id); INSERT OR IGNORE INTO query_performance_dirty VALUES(NEW.car_id); END;`);
}
function flush(db){
 const rows=db.prepare('SELECT json,lanes FROM query_car_results WHERE car_id=? ORDER BY key');
 const put=db.prepare('INSERT INTO query_performance VALUES(?,?) ON CONFLICT(car_id) DO UPDATE SET json=excluded.json');
 for(const {car_id:id} of db.prepare('SELECT car_id FROM query_performance_dirty').all()){
  const value=empty(),a=value.aggregate,lanes=new Map();
  for(const row of rows.iterate(id)){
   value.total++;const s=JSON.parse(row.json);
   for(const k of ['sessions','validLaps','recordEligibleLaps','measuredTimeMs','distanceM','wins'])a[k]+=s[k];
   if(s.bestLapMs!==null)a.bestLapMs=a.bestLapMs===null?s.bestLapMs:Math.min(a.bestLapMs,s.bestLapMs);
   a.distanceComplete&&=s.distanceComplete;
   for(const r of JSON.parse(row.lanes)){
    const key=JSON.stringify([r.trackKey,r.lane.toLocaleLowerCase('en-GB')]),old=lanes.get(key);
    if(!old||r.best<old.best||r.best===old.best&&(r.recordedAt<old.recordedAt||r.recordedAt===old.recordedAt&&r.id<old.id))lanes.set(key,r);
   }
  }
  a.averageLapMs=a.validLaps?a.measuredTimeMs/a.validLaps:null;value.lanes=[...lanes.values()];
  if(value.total)put.run(id,JSON.stringify(value));else db.prepare('DELETE FROM query_performance WHERE car_id=?').run(id);
 }
 db.exec('DELETE FROM query_performance_dirty');
}
function rebuild(db){schema(db);db.exec('DELETE FROM query_performance; INSERT OR IGNORE INTO query_performance_dirty SELECT DISTINCT car_id FROM query_car_results');flush(db);}
function read(db,id){const row=db.prepare('SELECT json FROM query_performance WHERE car_id=?').get(id);return row?JSON.parse(row.json):empty();}
module.exports={schema,flush,rebuild,read};
