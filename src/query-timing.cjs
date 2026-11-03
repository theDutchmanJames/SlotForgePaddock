'use strict';
const results=require('../renderer/timing-results-model.js'),pace=require('../renderer/pace-model.js');
function schema(db){db.exec(`CREATE TABLE IF NOT EXISTS query_sessions(key TEXT PRIMARY KEY REFERENCES records(key) ON DELETE CASCADE,source TEXT NOT NULL,session TEXT NOT NULL,received TEXT NOT NULL,json TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS query_session_identity ON query_sessions(source,session);
CREATE TABLE IF NOT EXISTS query_laps(key TEXT NOT NULL REFERENCES records(key) ON DELETE CASCADE,participant TEXT NOT NULL,position INTEGER NOT NULL,ended REAL NOT NULL,json TEXT NOT NULL,PRIMARY KEY(key,participant,position)) STRICT;
CREATE INDEX IF NOT EXISTS query_lap_order ON query_laps(key,participant,ended,position);
CREATE TABLE IF NOT EXISTS query_car_results(key TEXT NOT NULL REFERENCES records(key) ON DELETE CASCADE,car_id TEXT NOT NULL,json TEXT NOT NULL,lanes TEXT NOT NULL,PRIMARY KEY(car_id,key)) STRICT;`);}
function update(db,key,bucket,record){
 if(bucket!=='["timing","sessions"]')return;
 for(const table of ['query_laps','query_car_results','query_sessions'])db.prepare('DELETE FROM '+table+' WHERE key=?').run(key);
 const s=record.payload,requiresCorrection=results.requiresCorrection(s),summaries=results.summaries(s),payload={...s};
 if(s.state==='active')payload.participants=s.participants.map(p=>({...p,laps:[]}));
 const lite={...record,payload,_query:{requiresCorrection,summaries,runs:pace.runs({cars:[],timing:{sessions:[record]},tests:[]})}};
 db.prepare('INSERT INTO query_sessions(key,source,session,received,json) VALUES(?,?,?,?,?)').run(key,s.source.id,s.sessionId,record.receivedAt,JSON.stringify(lite));
 const lap=db.prepare('INSERT INTO query_laps(key,participant,position,ended,json) VALUES(?,?,?,?,?)');
 if(s.state==='active')for(const p of s.participants)for(let i=0;i<p.laps.length;i++)lap.run(key,p.id,i,p.laps[i].endedAtMs,JSON.stringify(p.laps[i]));
 const put=db.prepare('INSERT INTO query_car_results(key,car_id,json,lanes) VALUES(?,?,?,?)');
 for(const id of new Set(record.carIds)){const data={cars:[{id}],timing:{sessions:[record]},tests:[]};put.run(key,id,JSON.stringify(results.aggregate([record],id)),JSON.stringify(pace.laneRecords(data,id)));}
}
function page(reader,carId,offset=0){
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid session page.');
 const db=reader.db,total=db.prepare('SELECT count(*) n FROM query_car_results WHERE car_id=?').get(carId).n;
 const records=db.prepare('SELECT s.json FROM query_sessions s JOIN query_car_results c ON c.key=s.key WHERE c.car_id=? ORDER BY s.received DESC,s.key LIMIT 10 OFFSET ?').all(carId,offset).map(r=>JSON.parse(r.json));
 const aggregate={sessions:0,validLaps:0,recordEligibleLaps:0,bestLapMs:null,averageLapMs:null,measuredTimeMs:0,distanceM:0,distanceComplete:true,wins:0},lanes=new Map();
 for(const row of db.prepare('SELECT json,lanes FROM query_car_results WHERE car_id=?').all(carId)){const s=JSON.parse(row.json);for(const k of ['sessions','validLaps','recordEligibleLaps','measuredTimeMs','distanceM','wins'])aggregate[k]+=s[k];if(s.bestLapMs!==null)aggregate.bestLapMs=aggregate.bestLapMs===null?s.bestLapMs:Math.min(aggregate.bestLapMs,s.bestLapMs);aggregate.distanceComplete&&=s.distanceComplete;
  for(const r of JSON.parse(row.lanes)){const k=JSON.stringify([r.trackKey,r.lane.toLocaleLowerCase('en-GB')]),old=lanes.get(k);if(!old||r.best<old.best||r.best===old.best&&(r.recordedAt<old.recordedAt||r.recordedAt===old.recordedAt&&r.id<old.id))lanes.set(k,r);}}
 aggregate.averageLapMs=aggregate.validLaps?aggregate.measuredTimeMs/aggregate.validLaps:null;
 return {records,aggregate,lanes:[...lanes.values()],total,offset,nextOffset:offset+records.length<total?offset+records.length:null};
}
function session(reader,source,id,participant,offset=0){
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid lap page.');const db=reader.db,row=db.prepare('SELECT key,json FROM query_sessions WHERE source=? AND session=?').get(source,id);if(!row)throw Error('Session not found.');const record=JSON.parse(row.json),p=record.payload.participants?.find(p=>p.id===participant||p.carId===participant);
 const total=p?db.prepare('SELECT count(*) n FROM query_laps WHERE key=? AND participant=?').get(row.key,p.id).n:0;
 if(p)p.laps=db.prepare('SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY ended,position LIMIT 100 OFFSET ?').all(row.key,p.id,offset).map(l=>JSON.parse(l.json));
 return {record,total,offset,nextOffset:offset+100<total?offset+100:null,token:reader.token};
}
function allMetadata(reader){return reader.db.prepare(`WITH ordinals AS MATERIALIZED (
 SELECT json_extract(a.value,'$.record') key,CAST(a.key AS INTEGER) position FROM json_each((SELECT t.value FROM
 json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')='timing'),'$[1].object') t WHERE json_extract(t.value,'$[0]')='sessions'),'$[1].array') a)
 SELECT json_extract(s.json,'$.payload.state') state,json_extract(s.json,'$.payload.source.id') source,
 json_extract(s.json,'$.payload.sessionId') session,json_extract(s.json,'$.payload.revision') revision,
 json_extract(s.json,'$.payload.name') name,json_extract(s.json,'$.payload.type') type,
 json_extract(s.json,'$.payload.startedAt') started,json_extract(s.json,'$.payload.endedAt') ended,
 json_extract(s.json,'$.payload.track.id') trackId,json_extract(s.json,'$.payload.track.name') trackName,
 json_extract(s.json,'$.contentHash') hash,json_extract(s.json,'$.receivedAt') received,
 json_extract(s.json,'$.warnings') warnings,json_extract(s.json,'$.carIds') carIds,json_extract(s.json,'$.lastName') lastName,
 (SELECT json_group_array(json_object('kind',json_extract(p.value,'$.kind'),'carId',json_extract(p.value,'$.carId'))) FROM json_each(s.json,'$.payload.participants') p) participants
 FROM ordinals a JOIN query_sessions s ON s.key=a.key ORDER BY a.position`).all().map(r=>({contentHash:r.hash,receivedAt:r.received,warnings:JSON.parse(r.warnings),carIds:JSON.parse(r.carIds),lastName:r.lastName,payload:{state:r.state,source:{id:r.source},sessionId:r.session,revision:r.revision,name:r.name,type:r.type,startedAt:r.started,endedAt:r.ended,track:{id:r.trackId,name:r.trackName},participants:JSON.parse(r.participants)}}));}
function full(reader,source,id){const row=reader.db.prepare('SELECT key,json FROM query_sessions WHERE source=? AND session=?').get(source,id);if(!row)return null;const record=JSON.parse(row.json);delete record._query;if(record.payload.state==='active')for(const p of record.payload.participants)p.laps=reader.db.prepare('SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY position').all(row.key,p.id).map(r=>JSON.parse(r.json));return record;}
module.exports={schema,update,page,session,allMetadata,full};
