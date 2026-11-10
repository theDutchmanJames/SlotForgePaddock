'use strict';
const results=require('../renderer/timing-results-model.js'),pace=require('../renderer/pace-model.js');
function schema(db){db.exec(`CREATE TABLE IF NOT EXISTS query_sessions(key TEXT PRIMARY KEY REFERENCES records(key) ON DELETE CASCADE,source TEXT NOT NULL,session TEXT NOT NULL,received TEXT NOT NULL,json TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS query_session_identity ON query_sessions(source,session);
CREATE TABLE IF NOT EXISTS query_laps(key TEXT NOT NULL REFERENCES records(key) ON DELETE CASCADE,participant TEXT NOT NULL,position INTEGER NOT NULL,ended REAL NOT NULL,json TEXT NOT NULL,PRIMARY KEY(key,participant,position)) STRICT;
CREATE INDEX IF NOT EXISTS query_lap_order ON query_laps(key,participant,ended,position);
CREATE TABLE IF NOT EXISTS query_car_results(key TEXT NOT NULL REFERENCES records(key) ON DELETE CASCADE,car_id TEXT NOT NULL,json TEXT NOT NULL,lanes TEXT NOT NULL,PRIMARY KEY(car_id,key)) STRICT;`);}
function update(db,key,bucket,record){
 if(bucket!=='["timing","sessions"]')return;
 if(record.format==='history-v1')return require('./query-rich-history.cjs').update(db,key,record);
 const previous=db.prepare('SELECT json FROM query_sessions WHERE key=?').get(key),projection=require('./timing-projection.cjs');
 const prepared=projection.build(record,previous?JSON.parse(previous.json):null),{lite}=prepared,{summaries,runs}=lite._query,s=record.payload;
 db.prepare('INSERT INTO query_sessions(key,source,session,received,json) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET source=excluded.source,session=excluded.session,received=excluded.received,json=excluded.json').run(key,s.source.id,s.sessionId,record.receivedAt,JSON.stringify(lite));
 projection.writeLaps(db,key,record,prepared);
 const put=db.prepare('INSERT INTO query_car_results(key,car_id,json,lanes) VALUES(?,?,?,?)'),change=db.prepare('UPDATE query_car_results SET json=?,lanes=? WHERE key=? AND car_id=?');
 const existing=new Map(db.prepare('SELECT car_id,json,lanes FROM query_car_results WHERE key=?').all(key).map(row=>[row.car_id,row]));
 // Reuse each participant's statistics and stint measurements. Never rescan
 // every participant's laps once for each car in a multi-car session.
 const statisticsByCar=new Map(),runsByCar=new Map();
 for(const summary of summaries)if(summary.included){if(!statisticsByCar.has(summary.carId))statisticsByCar.set(summary.carId,[]);statisticsByCar.get(summary.carId).push(summary.statistics);}
 for(const run of runs){if(!runsByCar.has(run.carId))runsByCar.set(run.carId,[]);runsByCar.get(run.carId).push({...run,median:null,sustained5:null,sustained10:null});}
 for(const id of new Set(record.carIds)){const json=JSON.stringify(results.aggregateStatistics(statisticsByCar.get(id)||[])),lanes=JSON.stringify(pace.laneRecordsFromRuns(runsByCar.get(id)||[])),old=existing.get(id);existing.delete(id);if(!old)put.run(key,id,json,lanes);else if(old.json!==json||old.lanes!==lanes)change.run(json,lanes,key,id);}
 for(const id of existing.keys())db.prepare('DELETE FROM query_car_results WHERE key=? AND car_id=?').run(key,id);
}
function page(reader,carId,offset=0){
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid session page.');
 const db=reader.db,{total,aggregate,lanes}=require('./query-performance.cjs').read(db,carId);
 const records=db.prepare('SELECT s.json FROM query_sessions s JOIN query_car_results c ON c.key=s.key WHERE c.car_id=? ORDER BY s.received DESC,s.key LIMIT 10 OFFSET ?').all(carId,offset).map(r=>JSON.parse(r.json));
 return {records,aggregate,lanes,total,offset,nextOffset:offset+records.length<total?offset+records.length:null};
}
function receipt(reader,source,id){
 // Extract only receipt fields; no laps, configurations, audit history or pace
 // runs are decoded. These statistics committed atomically with the session.
 const row=reader.db.prepare(`SELECT json_object(
 'format',json_extract(json,'$.format'),'contentHash',json_extract(json,'$.contentHash'),'receivedAt',json_extract(json,'$.receivedAt'),
 'warnings',json_extract(json,'$.warnings'),'requiresCorrection',json_extract(json,'$._query.requiresCorrection'),
 'summaries',json_extract(json,'$._query.summaries'),
 'payload',json_object('source',json_object('id',source),'sessionId',session,
 'revision',json_extract(json,'$.payload.revision'),'state',json_extract(json,'$.payload.state'),
 'participants',(SELECT json_group_array(json_object('carId',json_extract(p.value,'$.carId'))) FROM json_each(query_sessions.json,'$.payload.participants') p))) json
 FROM query_sessions WHERE source=? AND session=?`).get(source,id);
 const timing=require('./timing-integration.cjs');
 if(!row)throw timing.fault('SESSION_NOT_FOUND','No session with that source and session ID is stored.',404);
 const record=JSON.parse(row.json);
 if(record.format==='history-v1')throw timing.fault('RESULT_REQUIRES_SHARED_HISTORY','Read this session through the shared-history API.',409);
 return timing.formatReceipt({id:reader.id},record,false,record.requiresCorrection,record.summaries);
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
 SELECT json_extract(s.json,'$.format') format,json_extract(s.json,'$.payload.state') state,json_extract(s.json,'$.payload.source.id') source,
 json_extract(s.json,'$.payload.sessionId') session,json_extract(s.json,'$.payload.revision') revision,
 json_extract(s.json,'$.payload.name') name,json_extract(s.json,'$.payload.type') type,
 json_extract(s.json,'$.payload.startedAt') started,json_extract(s.json,'$.payload.endedAt') ended,
 json_extract(s.json,'$.payload.track.id') trackId,json_extract(s.json,'$.payload.track.name') trackName,
 json_extract(s.json,'$.contentHash') hash,json_extract(s.json,'$.receivedAt') received,
 json_extract(s.json,'$.warnings') warnings,json_extract(s.json,'$.carIds') carIds,json_extract(s.json,'$.lastName') lastName,
 (SELECT json_group_array(json_object('kind',json_extract(p.value,'$.kind'),'carId',json_extract(p.value,'$.carId'))) FROM json_each(s.json,'$.payload.participants') p) participants
 FROM ordinals a JOIN query_sessions s ON s.key=a.key ORDER BY a.position`).all().map(r=>({...(r.format?{format:r.format}:{}),contentHash:r.hash,receivedAt:r.received,warnings:JSON.parse(r.warnings),carIds:JSON.parse(r.carIds),lastName:r.lastName,payload:{state:r.state,source:{id:r.source},sessionId:r.session,revision:r.revision,name:r.name,type:r.type,startedAt:r.started,endedAt:r.ended,track:{id:r.trackId,name:r.trackName},participants:JSON.parse(r.participants)}}));}
function full(reader,source,id){const row=reader.db.prepare('SELECT key,json FROM query_sessions WHERE source=? AND session=?').get(source,id);if(!row)return null;const record=JSON.parse(row.json);if(record.format==='history-v1')throw require('./timing-integration.cjs').fault('RESULT_REQUIRES_SHARED_HISTORY','Read this session through the shared-history API.',409);delete record._query;if(record.payload.state==='active')for(const p of record.payload.participants)p.laps=reader.db.prepare('SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY position').all(row.key,p.id).map(r=>JSON.parse(r.json));return record;}
module.exports={schema,update,page,session,receipt,allMetadata,full};
