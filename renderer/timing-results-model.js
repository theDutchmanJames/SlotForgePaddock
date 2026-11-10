(function(root){
  function requiresCorrection(session){
    return session.state==='active'&&session.participants.some(participantRequiresCorrection);
  }
  function participantRequiresCorrection(p){
      let previousEnd=-1;
      return [...p.laps].sort((a,b)=>a.endedAtMs-b.endedAtMs).some(l=>{const overlap=l.endedAtMs-l.durationMs<previousEnd;previousEnd=l.endedAtMs;return overlap;});
  }
  function statistics(session,participant,safe=!requiresCorrection(session)){
    const included=session.state==='active'&&safe&&participant.kind==='physical'&&!!participant.carId;
    const laps=included?participant.laps:[],valid=laps.filter(l=>l.valid&&!l.pit),eligible=valid.filter(l=>l.recordEligible),distance=laps.filter(l=>l.countsForDistance);
    return {validLaps:valid.length,recordEligibleLaps:eligible.length,bestLapMs:eligible.length?Math.min(...eligible.map(l=>l.durationMs)):null,averageLapMs:valid.length?valid.reduce((n,l)=>n+l.durationMs,0)/valid.length:null,measuredTimeMs:valid.reduce((n,l)=>n+l.durationMs,0),distanceM:distance.reduce((n,l)=>n+(l.distanceM??0),0),distanceComplete:distance.every(l=>l.distanceM!==null),wins:included&&session.type!=='practice'&&session.type!=='qualifying'&&session.standings.some(s=>s.participantId===participant.id&&s.position===1&&s.status==='finished')?1:0};
  }
  function participantSummary(session,p,safe){return {participantId:p.id,carId:p.carId,included:safe&&p.kind==='physical'&&!!p.carId,statistics:statistics(session,p,safe)};}
  // Reuse callbacks belong to the internal projection builder, never an API input.
  function analyze(session,reuse={}){const participants=session.state==='active'?session.participants:[],overlaps=participants.map(reuse.correctionFor||participantRequiresCorrection),correction=overlaps.some(Boolean),safe=!correction;return {requiresCorrection:correction,overlaps,summaries:participants.map(p=>(reuse.summaryFor||participantSummary)(session,p,safe))};}
  function summaries(session){return analyze(session).summaries;}
  function aggregate(records,carId){
    const rows=records.filter(r=>r.format!=='history-v1').flatMap(r=>summaries(r.payload).filter(s=>s.carId===carId&&s.included).map(s=>s.statistics));
    return aggregateStatistics(rows);
  }
  function aggregateStatistics(rows){
    const result={sessions:rows.length,validLaps:0,recordEligibleLaps:0,bestLapMs:null,averageLapMs:null,measuredTimeMs:0,distanceM:0,distanceComplete:true,wins:0};
    for(const s of rows){for(const k of ['validLaps','recordEligibleLaps','measuredTimeMs','distanceM','wins'])result[k]+=s[k];if(s.bestLapMs!==null)result.bestLapMs=result.bestLapMs===null?s.bestLapMs:Math.min(result.bestLapMs,s.bestLapMs);result.distanceComplete&&=s.distanceComplete;}
    result.averageLapMs=result.validLaps?result.measuredTimeMs/result.validLaps:null;return result;
  }
  const api={statistics,summaries,aggregate,aggregateStatistics,analyze,requiresCorrection,participantRequiresCorrection,participantSummary};if(typeof module==='object'&&module.exports)module.exports=api;else root.TimingResultsModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
