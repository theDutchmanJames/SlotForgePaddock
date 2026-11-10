'use strict';
// Read-only desktop projections. Called in the domain worker; public contracts
// and mutation capabilities are unchanged. Every response uses one read snapshot.
const Q=require('./sqlite-query.cjs'),H=require('./shared-history-read.cjs'),T=require('./timing-integration.cjs');
const fail=(code,message)=>{throw T.fault(code,message,409);};
const owner=require('./car-merge-query.cjs').owner;
const resultJoin=r=>r.merges.active?'':" JOIN query_car_results c ON c.key=s.key AND c.car_id=?";
const url=(route,values={})=>'http://localhost/v1/shared-history/'+route+'?'+new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined));
function consistency(r,carId,{sourceId,sessionId,participantId,driverId,lane}={}){
 const conditions=["json_extract(p.value,'$.kind')='physical'",owner()+'=?',"coalesce(json_extract(s.json,'$._query.requiresCorrection'),0)=0","json_extract(s.json,'$.payload.state')='active'"],args=[carId];
 if(sourceId){conditions.push('s.source=?');args.push(sourceId);}if(sessionId){conditions.push('s.session=?');args.push(sessionId);}if(participantId){conditions.push("json_extract(p.value,'$.id')=?");args.push(participantId);}
 const valid="json_extract(l.json,'$.durationMs') IS NOT NULL AND json_extract(l.json,'$.valid')=1 AND json_extract(l.json,'$.pit')=0";
 const lapWhere=[valid];if(lane!==undefined){lapWhere.push("CASE WHEN json_extract(s.json,'$.format')='history-v1' THEN json_extract(l.json,'$.lane') ELSE (SELECT json_extract(st.value,'$.lane') FROM json_each(p.value,'$.stints') st WHERE json_extract(st.value,'$.id')=json_extract(l.json,'$.stintId')) END=?");args.push(lane);}
 if(driverId!==undefined){lapWhere.push("CASE WHEN json_extract(s.json,'$.format')='history-v1' THEN json_extract(l.json,'$.driverId') ELSE (SELECT json_extract(st.value,'$.driverId') FROM json_each(p.value,'$.stints') st WHERE json_extract(st.value,'$.id')=json_extract(l.json,'$.stintId')) END=?");args.push(driverId);}
 const row=r.db.prepare(`WITH samples AS MATERIALIZED (SELECT json_extract(l.json,'$.durationMs') duration FROM query_sessions s ${resultJoin(r)} JOIN json_each(s.json,'$.payload.participants') p JOIN query_laps l ON l.key=s.key AND l.participant=json_extract(p.value,'$.id') WHERE ${conditions.join(' AND ')} AND ${lapWhere.join(' AND ')}), moments AS (SELECT count(*) n,avg(duration) mean,min(duration) fastest,max(duration) slowest FROM samples) SELECT *, (SELECT avg((duration-moments.mean)*(duration-moments.mean)) FROM samples) variance FROM moments`).get(...(r.merges.active?[]:[carId]),...args);
 const deviation=row.n>=2?Math.sqrt(Math.max(0,row.variance)):null;
 return {sampleLaps:row.n,standardDeviationMs:deviation,coefficientPercent:deviation===null||!row.mean?null:deviation/row.mean*100,fastestValidMs:row.fastest,slowestValidMs:row.slowest};
}
function linked(r,id){if(!id)return null;const row=r.db.prepare("SELECT json_extract(f.json,'$') name,q.archived FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='[\"name\"]' WHERE q.bucket='[\"cars\"]' AND q.key=?").get(JSON.stringify(['cars','id:'+id]));return row?{id,...row}:null;}
function laneRecords(r,carId,offset=0){
 const rows=r.db.prepare(`WITH laps AS (
  SELECT s.source,s.session,json_extract(s.json,'$.payload.track.id') trackId,json_extract(s.json,'$.payload.track.name') track,
   json_extract(s.json,'$.payload.name') name,json_extract(s.json,'$.payload.startedAt') startedAt,json_extract(s.json,'$.bundle.context.savedAt') savedAt,
   json_extract(p.value,'$.id') participantId,json_extract(l.json,'$.id') lapId,json_extract(l.json,'$.number') lapNumber,
   json_extract(l.json,'$.durationMs') durationMs,json_extract(l.json,'$.endedAtMs') endedAtMs,
   CASE WHEN json_extract(s.json,'$.format')='history-v1' THEN json_extract(l.json,'$.lane') ELSE json_extract(st.value,'$.lane') END lane,
   CASE WHEN json_extract(s.json,'$.format')='history-v1' THEN json_extract(l.json,'$.driverId') ELSE json_extract(st.value,'$.driverId') END driverId,
   json_extract(p.value,'$.drivers') drivers
  FROM query_sessions s ${resultJoin(r)} JOIN json_each(s.json,'$.payload.participants') p
   JOIN query_laps l ON l.key=s.key AND l.participant=json_extract(p.value,'$.id')
   LEFT JOIN json_each(p.value,'$.stints') st ON json_extract(st.value,'$.id')=json_extract(l.json,'$.stintId')
  WHERE json_extract(s.json,'$.payload.state')='active' AND coalesce(json_extract(s.json,'$._query.requiresCorrection'),0)=0
   AND json_extract(p.value,'$.kind')='physical' AND ${owner()}=? AND json_extract(s.json,'$.payload.track.id') IS NOT NULL
   AND json_extract(l.json,'$.valid')=1 AND json_extract(l.json,'$.pit')=0 AND json_extract(l.json,'$.durationMs') IS NOT NULL
   AND CASE WHEN json_extract(s.json,'$.format')='history-v1' THEN json_extract(l.json,'$.trackRecordEligible') ELSE json_extract(l.json,'$.recordEligible') END=1
 ), ranked AS (SELECT *,row_number() OVER(PARTITION BY source,trackId,lane ORDER BY durationMs,coalesce(startedAt,savedAt,'9999'),coalesce(endedAtMs,1e20),session,participantId,lapId) rank FROM laps WHERE lane IS NOT NULL),
 winners AS (SELECT *,count(*) OVER() total FROM ranked WHERE rank=1)
 SELECT source,session,trackId,track,name,participantId,lapId,lapNumber,durationMs,startedAt,savedAt,endedAtMs,lane,total,
 (SELECT json_extract(d.value,'$.name') FROM json_each(winners.drivers) d WHERE json_extract(d.value,'$.id')=winners.driverId) driver FROM winners ORDER BY track,source,trackId,lane LIMIT 20 OFFSET ?`).all(...(r.merges.active?[]:[carId]),carId,offset);
 return {rows,total:rows[0]?.total??0,offset,token:JSON.stringify(r.token),nextOffset:rows.length&&offset+rows.length<rows[0].total?offset+rows.length:null};
}
function read(store,input){
 if(['originals','original'].includes(input?.operation))return require('./shared-library-originals.cjs').read(store,input);
 if(input?.operation?.startsWith?.('pace-'))return require('./history-pace.cjs').read(store,input);
 if(!input||typeof input!=='object'||!['car','records','session','laps'].includes(input.operation))fail('INVALID_QUERY','Choose a history view.');
 const allowed=new Set(['operation','databaseId','recoveryId','carId','sourceId','sessionId','participantId','driverId','lane','page','offset','resultToken']);if(Object.keys(input).some(k=>!allowed.has(k)))fail('INVALID_QUERY','Unknown history view option.');
 for(const k of ['databaseId','recoveryId','carId','sourceId','sessionId','participantId','driverId'])if(input[k]!==undefined&&(typeof input[k]!=='string'||!/^[\w-]{1,100}$/.test(input[k])))fail('INVALID_QUERY','Invalid '+k+'.');
 if(input.lane!==undefined&&(!Number.isInteger(input.lane)||input.lane<1||input.lane>64))fail('INVALID_QUERY','Invalid lane.');
 if(input.offset!==undefined&&(!Number.isSafeInteger(input.offset)||input.offset<0))fail('INVALID_QUERY','Invalid lap offset.');
 for(const k of ['page','resultToken'])if(input[k]!==undefined&&(typeof input[k]!=='string'||input[k].length>4000))fail('INVALID_QUERY','Invalid page token.');
 return Q.read(store,null,r=>{
  if(input.databaseId!==r.id)fail('DATABASE_MISMATCH','The collection changed. Reopen its history.');if(input.recoveryId!==r.epoch)fail('RECOVERY_CHANGED','The collection was restored. Reopen its history.');
  let value;
  if(input.operation==='car'||input.operation==='records'){
   if(!input.carId||!linked(r,input.carId))fail('CAR_NOT_FOUND','This car no longer exists.');
   if(input.operation==='records'){if(input.resultToken!==JSON.stringify(r.token))fail('SNAPSHOT_CHANGED','History changed. Refresh its lane records.');return {databaseId:r.id,recoveryId:r.epoch,...laneRecords(r,input.carId,input.offset||0)};}
   const list=H.readWith(r,url('sessions',{carId:input.carId,limit:10,page:input.page}));
   const entries=list.entries.map(e=>{const row=r.db.prepare(`SELECT json_extract(json,'$.receivedAt') receivedAt,json_array_length(json,'$.history') corrections,json_extract(json,'$.payload.reason') reason,json_extract(json,'$._query.requiresCorrection') quarantined,
    (SELECT json_group_array(json_object('id',json_extract(p.value,'$.id'),'name',json_extract(p.value,'$.displayName'),'drivers',json_extract(p.value,'$.drivers'),'configurationKind',json_extract(p.value,'$.configuration.kind'),'configurationRevision',json_extract(p.value,'$.configuration.revision'),'capturedAt',json_extract(p.value,'$.configuration.capturedAt'),'lanes',(SELECT json_group_array(lane) FROM (SELECT json_extract(st.value,'$.lane') lane FROM json_each(p.value,'$.stints') st UNION SELECT json_extract(l.json,'$.lane') lane FROM query_laps l WHERE l.key=query_sessions.key AND l.participant=json_extract(p.value,'$.id')) WHERE lane IS NOT NULL ORDER BY lane))) FROM json_each(query_sessions.json,'$.payload.participants') p WHERE ${owner('query_sessions')}=?) participants FROM query_sessions WHERE source=? AND session=?`).get(input.carId,e.sourceId,e.sessionId);return {...e,...row,participants:JSON.parse(row.participants)};});
   const statistics=H.statistics(r,new URL(url('cars/'+input.carId+'/statistics')),input.carId);value={...list,entries,statistics,consistency:consistency(r,input.carId),records:laneRecords(r,input.carId)};
  }else{
   if(!input.sourceId||!input.sessionId)fail('INVALID_QUERY','Choose a session.');const route='sessions/'+input.sourceId+'/'+input.sessionId;
   if(input.operation==='laps'){
    if(!input.participantId)fail('INVALID_QUERY','Choose a participant.');value=H.readWith(r,url(route+'/laps/'+input.participantId,{token:input.resultToken,offset:input.offset}));
   }else{
    const head=H.readWith(r,url(route));if(input.resultToken&&head.resultToken!==input.resultToken)fail('RESULT_CHANGED','This session changed. Reload its current revision.');
    const row=r.db.prepare("SELECT json_extract(json,'$.lastName') name,json_extract(json,'$.receivedAt') receivedAt,json_extract(json,'$.payload.reason') reason,json_extract(json,'$._query.requiresCorrection') quarantined,json_extract(json,'$.history') history FROM query_sessions WHERE source=? AND session=?").get(input.sourceId,input.sessionId);
    const history=JSON.parse(row.history),race=head.body?.race||head.body?.payload,participants=race?.participants||[];
    if(input.participantId&&!participants.some(p=>p.id===input.participantId))fail('PARTICIPANT_NOT_FOUND','This participant is no longer in the session.');
    const resolved=p=>p?.carId?r.merges.contribution(input.sourceId,input.sessionId,p.id,p.carId,head.body?.format||'timing-v1'):null;
    const matches=p=>{const v=resolved(p);return v?.status==='included'&&v.canonicalCarId===input.carId;};
    const p=participants.find(p=>p.id===input.participantId)||participants.find(matches)||participants[0],ownership=resolved(p),car=p?.kind==='physical'?linked(r,ownership?.status==='included'?ownership.canonicalCarId:p.carId):null;
    if(input.driverId&&!p?.drivers.some(d=>d.id===input.driverId))fail('INVALID_QUERY','Unknown driver.');
    const filter={sourceId:input.sourceId,sessionId:input.sessionId,lane:input.lane,...(input.driverId?{participantId:p.id,driverId:input.driverId}:{})};
    const statistics=car?H.statistics(r,new URL(url('cars/'+car.id+'/statistics',filter)),car.id,{sessionScope:true}):null;
    value={...head,...row,history:history.slice(-20),historyCount:history.length,participantId:p?.id||null,requestedCarAbsent:!!input.carId&&!participants.some(matches),linkedCars:Object.fromEntries(participants.filter(p=>p.carId).map(p=>[p.carId,linked(r,resolved(p)?.status==='included'?resolved(p).canonicalCarId:p.carId)])),statistics,consistency:car?consistency(r,car.id,filter):null};
   }
  }
  if(Buffer.byteLength(JSON.stringify(value))>8388608)fail('RESPONSE_TOO_LARGE','This history view exceeds the display limit.');return value;
 }).value;
}
module.exports={read,consistency};
