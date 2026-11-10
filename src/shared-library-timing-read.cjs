'use strict';
// Direct-file UI projections. SQL aggregates indexed laps inside the worker;
// original-only evidence is deliberately absent from this index.
const Q=require('./sqlite-query.cjs');
const fail=message=>{throw Object.assign(Error(message),{code:'INVALID_QUERY'});};
const owner=require('./car-merge-query.cjs').owner;
function base(includeUnselected=false){
 // Inclusion controls attribution to the main car, not the historical race.
 // Global Timing records retain all evidence under its original
 // identity. A car-filtered query and service counters use selected history.
 const car=includeUnselected?`json_extract(p.value,'$.carId')`:owner();
 return `WITH physical AS (
 SELECT s.key sessionKey,s.source sourceId,s.session sessionId,s.json sessionJson,p.value participant,
 coalesce(json_extract(s.json,'$.format')='history-v1',0) rich,
 json_extract(s.json,'$.bundle.provenance.kind')='historical' historical,
 json_extract(s.json,'$.payload.name') sessionName,json_extract(s.json,'$.payload.type') sessionType,
 json_extract(s.json,'$.payload.startedAt') startedAt,json_extract(s.json,'$.bundle.context.savedAt') savedAt,
 coalesce(json_extract(s.json,'$.payload.startedAt'),json_extract(s.json,'$.bundle.context.savedAt')) effectiveDate,
 CASE WHEN json_extract(s.json,'$.payload.startedAt') IS NOT NULL THEN 'started' WHEN json_extract(s.json,'$.bundle.context.savedAt') IS NOT NULL THEN 'saved' ELSE 'unknown' END dateBasis,
 json_extract(s.json,'$.payload.track.id') trackId,json_extract(s.json,'$.payload.track.name') trackName,
 ${car} carId,json_extract(p.value,'$.id') participantId,
 coalesce((SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=json_array('cars','id:'||${car}) AND f.path='["name"]'),json_extract(p.value,'$.displayName')) carName
 FROM query_sessions s JOIN json_each(s.json,'$.payload.participants') p
 WHERE json_extract(s.json,'$.payload.state')='active' AND coalesce(json_extract(s.json,'$._query.requiresCorrection'),0)=0
 AND json_extract(p.value,'$.kind')='physical' AND ${car} IS NOT NULL
), samples AS (
 SELECT p.*,json_extract(l.json,'$.id') lapId,json_extract(l.json,'$.originLapId') originLapId,json_extract(l.json,'$.number') lapNumber,
 json_extract(l.json,'$.durationMs') durationMs,json_extract(l.json,'$.endedAtMs') endedAtMs,
 json_extract(l.json,'$.valid') valid,json_extract(l.json,'$.pit') pit,
 json_extract(l.json,'$.countsForDistance') countsDistance,json_extract(l.json,'$.distanceM') distanceM,
 CASE WHEN rich THEN json_extract(l.json,'$.personalRecordEligible') ELSE json_extract(l.json,'$.recordEligible') END personalEligible,
 CASE WHEN rich THEN json_extract(l.json,'$.trackRecordEligible') ELSE json_extract(l.json,'$.recordEligible') END trackEligible,
 CASE WHEN rich THEN json_extract(l.json,'$.lane') ELSE json_extract(st.value,'$.lane') END lane,
 CASE WHEN rich THEN json_extract(l.json,'$.driverId') ELSE json_extract(st.value,'$.driverId') END driverId
 FROM physical p JOIN query_laps l ON l.key=p.sessionKey AND l.participant=p.participantId
 LEFT JOIN json_each(p.participant,'$.stints') st ON NOT p.rich AND json_extract(st.value,'$.id')=json_extract(l.json,'$.stintId')
)`;}
const BASE=base();
const VALID='durationMs IS NOT NULL AND valid=1 AND pit=0';
const SUMMARY=`count(*) recordedLaps,count(DISTINCT sessionKey) acceptedSessions,
 count(DISTINCT CASE WHEN historical THEN sessionKey END) historicalSessions,
 coalesce(sum(durationMs IS NOT NULL),0) measuredLaps,coalesce(sum(${VALID}),0) validLaps,
 coalesce(sum(CASE WHEN ${VALID} THEN durationMs ELSE 0 END),0) measuredTimeMs,
 avg(CASE WHEN ${VALID} THEN durationMs END) averageLapMs,
 min(CASE WHEN ${VALID} AND personalEligible=1 THEN durationMs END) bestPersonalLapMs,
 min(CASE WHEN ${VALID} AND trackEligible=1 THEN durationMs END) bestTrackLapMs,
 coalesce(sum(${VALID} AND personalEligible=1),0) personalRecordLaps,coalesce(sum(${VALID} AND trackEligible=1),0) trackRecordLaps,
 coalesce(sum(CASE WHEN countsDistance=1 THEN coalesce(distanceM,0) ELSE 0 END),0) distanceM,
 coalesce(sum(countsDistance=1),0) distanceLaps,coalesce(sum(countsDistance=1 AND distanceM IS NULL),0) unknownDistanceLaps,max(effectiveDate) lastDrivenAt,CASE WHEN max(effectiveDate) IS NULL THEN 'unknown' WHEN max(effectiveDate)=max(startedAt) THEN 'started' ELSE 'saved' END lastDrivenDateBasis`;
const RECORD=`sourceId,sessionId,sessionName,startedAt,savedAt,effectiveDate,dateBasis,trackId,trackName,carId,carName,participantId,lapId,originLapId,lapNumber,lane,driverId,durationMs,endedAtMs,
 (SELECT json_extract(d.value,'$.name') FROM json_each(participant,'$.drivers') d WHERE json_extract(d.value,'$.id')=driverId LIMIT 1) driverName`;
function query(input){
 if(!input||!['home','records','carStatistics','classes','resultSessions','sessionState'].includes(input.kind))fail('Choose a Timing projection.');
 const allowed=['kind','sourceId','sessionId','trackId','driverId','carId','lane','from','to','offset','limit','token','scope','weekStart','sort','grouping'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('Unknown Timing projection option.');
 if(input.kind==='classes'&&Object.keys(input).some(k=>!['kind','offset','limit','token'].includes(k)))fail('Class labels support pagination only.');
 const terms=[],args=[];
 for(const k of ['sourceId','trackId','driverId','carId'])if(input[k]!==undefined){if(typeof input[k]!=='string'||!/^[\w-]{1,100}$/.test(input[k]))fail('Invalid '+k);terms.push(k+'=?');args.push(input[k]);}
 if((input.trackId||input.driverId)&&!input.sourceId)fail('Track and driver identities require sourceId.');
 if(input.lane!==undefined){if(!Number.isInteger(input.lane)||input.lane<1||input.lane>64)fail('Invalid lane.');terms.push('lane=?');args.push(input.lane);}
 for(const k of ['from','to','weekStart'])if(input[k]!==undefined&&(typeof input[k]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input[k])||!Number.isFinite(Date.parse(input[k]))||new Date(input[k]).toISOString().replace('.000Z','Z')!==input[k].replace('.000Z','Z')))fail('Use valid UTC ISO timestamps.');
 if(input.from&&input.to&&Date.parse(input.from)>=Date.parse(input.to))fail('from must precede to.');
 if(input.from){terms.push('julianday(effectiveDate)>=julianday(?)');args.push(input.from);}if(input.to){terms.push('julianday(effectiveDate)<julianday(?)');args.push(input.to);}
 const offset=input.offset??0,limit=input.limit??50;if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)fail('Invalid page bounds.');
 if(offset&&!input.token)fail('Continue with the first page token.');if(input.kind==='carStatistics'&&!input.carId)fail('Choose a car.');
 if(input.scope!==undefined&&!['personal','track'].includes(input.scope))fail('Unknown record scope.');
 if(input.sort!==undefined&&!['track','time'].includes(input.sort))fail('Unknown record ordering.');
 if(input.grouping!==undefined&&(input.kind!=='records'||!['lane','timing'].includes(input.grouping)))fail('Unknown record grouping.');
 if(input.sessionId!==undefined&&input.kind!=='sessionState')fail('Session identity is only supported by sessionState.');
 if(['resultSessions','sessionState'].includes(input.kind)){
  if(Object.keys(input).some(k=>!['kind','sourceId','sessionId','offset','limit','token'].includes(k)))fail('Invalid session projection option.');
  if(input.kind==='sessionState'&&(!input.sourceId||typeof input.sessionId!=='string'||!input.sessionId||input.sessionId.length>200))fail('Choose a source session.');
  if(input.kind==='sessionState'&&(input.offset!==undefined||input.limit!==undefined))fail('A single session state does not support pagination.');
 }
 return {sql:base(!input.carId)+', filtered AS (SELECT * FROM samples WHERE '+(terms.length?terms.join(' AND '):'1')+')',args,offset,limit};
}
function summary(r,q,where='1',args=[]){
 const row=r.db.prepare(q.sql+` SELECT ${SUMMARY} FROM filtered WHERE ${where}`).get(...q.args,...args);
 // Count classifications separately from laps; an award never adds distance.
 const wins=r.db.prepare(q.sql+`, participants AS (SELECT DISTINCT sessionKey,participantId,sessionJson,rich,sessionType FROM filtered WHERE ${where}), awards AS (
 SELECT p.sessionKey,p.participantId,a.value award,p.rich FROM participants p JOIN json_each(p.sessionJson,CASE WHEN p.rich THEN '$.bundle.context.classification' ELSE '$.payload.standings' END) a
 WHERE p.sessionType NOT IN ('practice','qualifying') AND json_extract(a.value,'$.participantId')=p.participantId AND json_extract(a.value,'$.position')=1 AND json_extract(a.value,'$.status')='finished')
 SELECT count(DISTINCT CASE WHEN NOT rich OR json_extract(award,'$.scope')='overall' THEN sessionKey END) overallWins,
 count(DISTINCT CASE WHEN rich AND json_extract(award,'$.scope')='class' THEN json_array(sessionKey,json_extract(award,'$.classId')) END) classWins FROM awards`).get(...q.args,...args);
 return {...row,...wins,distanceComplete:row.unknownDistanceLaps===0,originalOnlyIncluded:false,manualIncluded:false};
}
function page(r,q,sql,args=[]){const total=r.db.prepare(q.sql+` SELECT count(*) n FROM (${sql})`).get(...q.args,...args).n,rows=r.db.prepare(q.sql+sql+' LIMIT ? OFFSET ?').all(...q.args,...args,q.limit,q.offset);return {rows,total,offset:q.offset,nextOffset:q.offset+rows.length<total?q.offset+rows.length:null};}
function read(store,input){const q=query(input);return Q.read(store,input.token,r=>{
 const identity={version:1,databaseId:r.id,recoveryId:r.epoch,token:r.token};
 if(['resultSessions','sessionState'].includes(input.kind)){
  // Timing's Results restoration relies on these small metadata reads. Keep
  // session/evidence identities independent of merge contribution selections.
  const field=name=>`(SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=o.key AND f.path='["${name}"]')`;
  const sql=`SELECT source sourceId,session sessionId,json_extract(json,'$.payload.state') state,
   coalesce(json_extract(json,'$.bundle.context.savedAt'),json_extract(json,'$.payload.startedAt')) date,
   json_extract(json,'$.payload.name') setupName,json_extract(json,'$.payload.type') sessionType,
   json_extract(json,'$.payload.track.id') trackId,json_extract(json,'$.payload.track.name') trackName,0 originalOnly,
   json_extract(json,'$.contentHash') contentHash,json_extract(json,'$.provenanceKind') provenance
   FROM query_sessions UNION ALL SELECT ${field('sourceId')},${field('originalId')},coalesce(${field('state')},'active'),
   ${field('startedAt')},${field('name')},NULL,NULL,NULL,1,NULL,NULL FROM records o
   WHERE o.bucket='["libraryOrigins"]' AND ${field('projectionStatus')}='raw-only'`;
  if(input.kind==='sessionState')return {...identity,row:r.db.prepare('SELECT * FROM ('+sql+') WHERE sourceId=? AND sessionId=?').get(input.sourceId,input.sessionId)||null};
  const where="state='active'"+(input.sourceId?' AND sourceId=?':''),args=input.sourceId?[input.sourceId]:[];
  const rows=r.db.prepare('SELECT * FROM ('+sql+') WHERE '+where+' ORDER BY coalesce(julianday(date),-1) DESC,sourceId,sessionId LIMIT ? OFFSET ?').all(...args,q.limit+1,q.offset);
  const more=rows.length>q.limit;if(more)rows.pop();return {...identity,rows,nextOffset:more?q.offset+rows.length:null};
 }
 if(input.kind==='classes'){
  const sql=`SELECT DISTINCT json_extract(f.json,'$') label FROM records r JOIN record_fields f ON f.record=r.key AND f.path='["raceClass"]' WHERE r.bucket='["cars"]' AND json_type(f.json)='text' AND trim(json_extract(f.json,'$'))<>''`;
  const total=r.db.prepare('SELECT count(*) n FROM ('+sql+')').get().n,rows=r.db.prepare(sql+' ORDER BY label LIMIT ? OFFSET ?').all(q.limit,q.offset);return {...identity,rows,total,offset:q.offset,nextOffset:q.offset+rows.length<total?q.offset+rows.length:null};
 }
 if(input.kind==='records'){
  const scope=input.scope||'track',groups=input.grouping==='timing'?(scope==='personal'?'sourceId,trackId,driverId':'sourceId,trackId'):(scope==='personal'?'sourceId,trackId,carId,driverId,lane':'sourceId,trackId,lane');
  const sql=`SELECT ${RECORD} FROM (SELECT *,row_number() OVER(PARTITION BY ${groups} ORDER BY durationMs,coalesce(effectiveDate,'9999'),coalesce(endedAtMs,1e20),sessionId,participantId,lapId) winner FROM filtered WHERE ${VALID} AND ${scope}Eligible=1 AND trackId IS NOT NULL) WHERE winner=1 ORDER BY ${input.sort==='time'?'durationMs,':''}trackName,sourceId,trackId,lane,carId,driverId`;
  return {...identity,scope,...page(r,q,sql)};
 }
 if(input.kind==='carStatistics')return {...identity,carId:input.carId,summary:summary(r,q),tracks:page(r,q,`SELECT sourceId,trackId,max(trackName) trackName,${SUMMARY} FROM filtered GROUP BY sourceId,trackId ORDER BY trackName,sourceId,trackId`)};
 let week=input.weekStart;if(!week){const now=new Date();now.setUTCHours(0,0,0,0);now.setUTCDate(now.getUTCDate()-(now.getUTCDay()+6)%7);week=now.toISOString();}
 const topDistanceCars=r.db.prepare(q.sql+` SELECT carId,max(carName) carName,${SUMMARY} FROM filtered GROUP BY carId ORDER BY distanceM DESC,carId LIMIT 20`).all(...q.args);
 const recentSessions=r.db.prepare(q.sql+' SELECT sourceId,sessionId,max(sessionName) name,max(startedAt) startedAt,max(savedAt) savedAt,max(effectiveDate) effectiveDate,max(dateBasis) dateBasis,max(trackId) trackId,max(trackName) trackName,count(*) recordedLaps FROM filtered GROUP BY sourceId,sessionId ORDER BY effectiveDate DESC,sourceId,sessionId LIMIT 20').all(...q.args);
 const topWinners=r.db.prepare(q.sql+`, entries AS (SELECT DISTINCT sessionKey,sourceId,sessionId,effectiveDate,sessionJson,sessionType,participant,participantId,rich FROM filtered), winners AS (
 SELECT e.* FROM entries e JOIN json_each(e.sessionJson,CASE WHEN rich THEN '$.bundle.context.classification' ELSE '$.payload.standings' END) a
 WHERE sessionType NOT IN ('practice','qualifying') AND json_extract(a.value,'$.participantId')=participantId AND json_extract(a.value,'$.position')=1 AND json_extract(a.value,'$.status')='finished' AND (NOT rich OR json_extract(a.value,'$.scope')='overall')),
 recipients AS (SELECT w.sourceId,w.sessionKey,w.effectiveDate,json_extract(d.value,'$.id') driverId,json_extract(d.value,'$.name') driverName FROM winners w JOIN json_each(w.participant,'$.drivers') d)
 SELECT sourceId,driverId,max(driverName) driverName,count(DISTINCT sessionKey) wins,max(effectiveDate) lastWinAt FROM recipients${input.driverId?' WHERE driverId=?':''} GROUP BY sourceId,driverId ORDER BY wins DESC,lastWinAt DESC,sourceId,driverId LIMIT 20`).all(...q.args,...(input.driverId?[input.driverId]:[]));
 const fastestThisWeek=r.db.prepare(q.sql+` SELECT ${RECORD} FROM filtered WHERE ${VALID} AND trackEligible=1 AND julianday(effectiveDate)>=julianday(?) ORDER BY durationMs,effectiveDate,sourceId,sessionId,participantId,lapId LIMIT 1`).get(...q.args,week)||null;
 return {...identity,summary:summary(r,q),weekStart:week,topDistanceCars,topWinners,recentSessions,fastestThisWeek};
 }).value;}
function serviceCount(r,carId,from=null){return r.db.prepare(BASE+' SELECT count(*) n FROM samples WHERE carId=?'+(from?' AND (startedAt IS NULL OR julianday(startedAt)>=julianday(?))':'')).get(...(from?[carId,from]:[carId])).n+require('./shared-library-lap-counts.cjs').originals(r,carId,from);}
module.exports={read,serviceCount};
