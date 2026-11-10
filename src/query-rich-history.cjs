'use strict';
// Same session/lap index as timing-v1, with a format discriminator. Lap JSON
// preserves unknown values; ended=0 is only an internal ordering index sentinel.
function update(db,key,record){
 const race=record.bundle?.race,participants=race?.participants||[];
 const head=record.bundle?{...record.bundle,race:{...race,participants:participants.map(({laps,...p})=>p)}}:null;
 const payload={...record.payload,...(race?{...race,participants:participants.map(({laps,...p})=>({...p,laps:[]}))}:{})};
 const lite={...record,bundle:head,payload,_query:{requiresCorrection:false,summaries:[],runs:[]}};
 db.prepare('INSERT INTO query_sessions(key,source,session,received,json) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET source=excluded.source,session=excluded.session,received=excluded.received,json=excluded.json').run(key,record.payload.source.id,record.payload.sessionId,record.receivedAt,JSON.stringify(lite));
 const ids=new Set(participants.map(p=>p.id));for(const row of db.prepare('SELECT DISTINCT participant FROM query_laps WHERE key=?').all(key))if(!ids.has(row.participant))db.prepare('DELETE FROM query_laps WHERE key=? AND participant=?').run(key,row.participant);
 const put=db.prepare('INSERT INTO query_laps VALUES(?,?,?,?,?) ON CONFLICT(key,participant,position) DO UPDATE SET ended=excluded.ended,json=excluded.json');
 for(const p of participants){const old=new Map(db.prepare('SELECT position,json FROM query_laps WHERE key=? AND participant=?').all(key,p.id).map(r=>[r.position,r.json]));for(let i=0;i<p.laps.length;i++){const l=p.laps[i],json=JSON.stringify(l);if(old.get(i)!==json)put.run(key,p.id,i,l.endedAtMs??0,json);}db.prepare('DELETE FROM query_laps WHERE key=? AND participant=? AND position>=?').run(key,p.id,p.laps.length);}
 // Existing car-result keys drive filtering and invalidation. Legacy summaries
 // must not approximate separate eligibility/classification as timing-v1.
 const zero=JSON.stringify(require('../renderer/timing-results-model.js').aggregateStatistics([]));
 const old=new Map(db.prepare('SELECT car_id,json,lanes FROM query_car_results WHERE key=?').all(key).map(r=>[r.car_id,r]));
 for(const id of record.carIds){const prior=old.get(id);old.delete(id);if(!prior)db.prepare('INSERT INTO query_car_results VALUES(?,?,?,?)').run(key,id,zero,'[]');else if(prior.json!==zero||prior.lanes!=='[]')db.prepare('UPDATE query_car_results SET json=?,lanes=? WHERE key=? AND car_id=?').run(zero,'[]',key,id);}
 for(const id of old.keys())db.prepare('DELETE FROM query_car_results WHERE key=? AND car_id=?').run(key,id);
}
module.exports={update};
