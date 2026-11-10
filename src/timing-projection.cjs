'use strict';
// Optional, versioned calculation hints within a disposable session projection.
// Hashes cover calculation inputs, not public identities or accepted revisions.
const crypto=require('node:crypto'),results=require('../renderer/timing-results-model.js'),pace=require('../renderer/pace-model.js');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const lapInputs={overlap:['durationMs','endedAtMs'],statistics:['durationMs','valid','pit','recordEligible','countsForDistance','distanceM'],pace:['id','number','durationMs','endedAtMs','valid','pit','recordEligible','stintId']};
function prepareLaps(laps){
 const entries=Object.entries(lapInputs),digests=Object.fromEntries(entries.map(([k])=>[k,crypto.createHash('sha256')])),digest=crypto.createHash('sha256');digest.update('[');
 const strings=laps.map((lap,i)=>{const json=JSON.stringify(lap);if(i)digest.update(',');digest.update(json);for(const [key,fields]of entries)digests[key].update(JSON.stringify(fields.map(field=>lap[field]))+'\n');return json;});digest.update(']');
 return {strings,lapHash:digest.digest('hex'),selected:Object.fromEntries(Object.entries(digests).map(([k,d])=>[k,d.digest('hex')]))};
}
const metrics=['best','bestLap','median','sustained5','sustained10','validLaps','totalLaps','eligibleLaps'];
function build(record,prior){
 const s=record.payload,participants=s.state==='active'?s.participants:[],rows=new Map(),inputs=new Map();
 const previous=prior?._query?.calculations,old=new Map(previous?.version===2?previous.participants.map(p=>[p.id,p]):[]);
 const summariesById=new Map((prior?._query?.summaries||[]).map(p=>[p.participantId,p])),measurements=new Map();
 for(const p of participants){
  const {strings,lapHash,selected}=prepareLaps(p.laps);rows.set(p.id,strings);
  inputs.set(p.id,{id:p.id,lapHash,overlapHash:selected.overlap,statisticsLapHash:selected.statistics,measurementsHash:hash([selected.pace,p.kind,!!p.carId,!!p.configuration,p.stints.map(stint=>stint.id)])});
 }
 const analysis=results.analyze(s,{
  correctionFor:p=>{const before=old.get(p.id);return before?.overlapHash===inputs.get(p.id).overlapHash?before.overlap:results.participantRequiresCorrection(p);},
  summaryFor:(session,p,safe)=>{
   const input=inputs.get(p.id);input.statisticsHash=hash([safe,s.type,p.id,p.kind,p.carId,input.statisticsLapHash,s.standings.filter(row=>row.participantId===p.id)]);
   return old.get(p.id)?.statisticsHash===input.statisticsHash&&summariesById.has(p.id)?summariesById.get(p.id):results.participantSummary(session,p,safe);
  }
 });
 participants.forEach((p,i)=>{inputs.get(p.id).overlap=analysis.overlaps[i];});
 if(!analysis.requiresCorrection&&prior?._query?.requiresCorrection===false){
  for(const p of participants)if(old.get(p.id)?.measurementsHash===inputs.get(p.id).measurementsHash)measurements.set(p.id,new Map());
  for(const run of prior._query.runs){const id=JSON.parse(run.id);if(measurements.has(id[3]))measurements.get(id[3]).set(id[4],Object.fromEntries(metrics.map(k=>[k,run[k]])));}
 }
 const runs=pace.sessionRuns(s,null,false,!analysis.requiresCorrection,measurements),payload={...s};
 if(s.state==='active')payload.participants=participants.map(p=>({...p,laps:[]}));
 return {rows,unchanged:new Set(participants.filter(p=>old.get(p.id)?.lapHash===inputs.get(p.id).lapHash).map(p=>p.id)),
  lite:{...record,payload,_query:{requiresCorrection:analysis.requiresCorrection,summaries:analysis.summaries,runs,calculations:{version:2,participants:[...inputs.values()]}}}};
}
function writeLaps(db,key,record,prepared){
 const participants=record.payload.state==='active'?record.payload.participants:[],ids=new Set(participants.map(p=>p.id));
 for(const {participant} of db.prepare('SELECT DISTINCT participant FROM query_laps WHERE key=?').all(key))if(!ids.has(participant))db.prepare('DELETE FROM query_laps WHERE key=? AND participant=?').run(key,participant);
 const get=db.prepare('SELECT position,json FROM query_laps WHERE key=? AND participant=? ORDER BY position');
 const put=db.prepare('INSERT INTO query_laps(key,participant,position,ended,json) VALUES(?,?,?,?,?) ON CONFLICT(key,participant,position) DO UPDATE SET ended=excluded.ended,json=excluded.json');
 for(const p of participants){
  if(prepared.unchanged.has(p.id))continue;
  const existing=new Map(get.all(key,p.id).map(row=>[row.position,row.json])),strings=prepared.rows.get(p.id);
  for(let i=0;i<strings.length;i++)if(existing.get(i)!==strings[i])put.run(key,p.id,i,p.laps[i].endedAtMs,strings[i]);
  db.prepare('DELETE FROM query_laps WHERE key=? AND participant=? AND position>=?').run(key,p.id,strings.length);
 }
}
module.exports={build,writeLaps};
