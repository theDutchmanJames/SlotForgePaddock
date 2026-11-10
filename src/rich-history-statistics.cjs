'use strict';
// SQL over one participant's indexed laps; null timing/eligibility stays unknown.
function participant(db,key,id,{lane,driverId}={}){
 const valid="json_extract(json,'$.durationMs') IS NOT NULL AND json_extract(json,'$.valid')=1 AND json_extract(json,'$.pit')=0";
 const eligible=kind=>valid+" AND json_extract(json,'$."+kind+"RecordEligible')=1";
 const where=['key=?','participant=?'],args=[key,id];
 if(lane!==undefined){where.push("json_extract(json,'$.lane')=?");args.push(lane);}
 if(driverId!==undefined){where.push("json_extract(json,'$.driverId')=?");args.push(driverId);}
 const row=db.prepare(`SELECT count(*) n,
 coalesce(sum(json_extract(json,'$.durationMs') IS NOT NULL),0) measuredLaps,
 coalesce(sum(${valid}),0) validLaps,
 coalesce(sum(CASE WHEN ${valid} THEN json_extract(json,'$.durationMs') ELSE 0 END),0) measuredTimeMs,
 coalesce(sum(${eligible('personal')}),0) personalRecordLaps,
 coalesce(sum(${eligible('track')}),0) trackRecordLaps,
 min(CASE WHEN ${eligible('personal')} THEN json_extract(json,'$.durationMs') END) bestPersonalLapMs,
 min(CASE WHEN ${eligible('track')} THEN json_extract(json,'$.durationMs') END) bestTrackLapMs,
 coalesce(sum(CASE WHEN json_extract(json,'$.countsForDistance')=1 THEN coalesce(json_extract(json,'$.distanceM'),0) ELSE 0 END),0) distanceM,
 coalesce(sum(json_extract(json,'$.countsForDistance')=1 AND json_extract(json,'$.distanceM') IS NULL),0) unknownDistanceLaps
 FROM query_laps WHERE ${where.join(' AND ')}`).get(...args);
 return row;
}
module.exports={participant};
