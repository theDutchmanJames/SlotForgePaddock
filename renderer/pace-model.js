(function(root){
  const timing=typeof module==='object'&&module.exports?require('./timing-results-model.js'):root.TimingResultsModel;
  const unknown='Unknown',key=value=>JSON.stringify(value),positive=v=>v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
  function median(values){if(!values.length)return null;const a=[...values].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;}
  function measured(laps,recordsOnly=false){
    const ordered=recordsOnly?laps:[...laps].sort((a,b)=>a.endedAtMs-b.endedAtMs);
    let bestLap=null,validLaps=0,eligibleLaps=0;const durations=[];
    for(const lap of ordered)if(lap.valid&&!lap.pit){validLaps++;if(!recordsOnly)durations.push(lap.durationMs);if(lap.recordEligible){eligibleLaps++;if(!bestLap||lap.durationMs<bestLap.durationMs||lap.durationMs===bestLap.durationMs&&lap.endedAtMs<bestLap.endedAtMs)bestLap=lap;}}
    function sustained(n){let window=[],best=null,previous=null;for(const lap of ordered){
      if(!lap.valid||lap.pit){window=[];previous=null;continue;}
      // Do not bridge missing laps, pauses, driver changes, lanes or heats.
      if(previous&&(lap.number!==previous.number+1||Math.abs(lap.endedAtMs-lap.durationMs-previous.endedAtMs)>1))window=[];
      window.push(lap.durationMs);if(window.length>n)window.shift();
      if(window.length===n){const mean=window.reduce((a,b)=>a+b,0)/n;best=best===null?mean:Math.min(best,mean);}previous=lap;
    }return best;}
    return {best:bestLap?.durationMs??null,bestLap:bestLap?{id:bestLap.id,number:bestLap.number,durationMs:bestLap.durationMs,endedAtMs:bestLap.endedAtMs}:null,median:recordsOnly?null:median(durations),sustained5:recordsOnly?null:sustained(5),sustained10:recordsOnly?null:sustained(10),validLaps,totalLaps:ordered.length,eligibleLaps};
  }
  // A caller building one session projection can reuse its checked eligibility.
  // This argument is calculated internally, never accepted from an API payload.
  function sessionRuns(s,carId,recordsOnly=false,safe,cachedMeasurements){const out=[];
    if(s.state!=='active'||carId&&!s.participants.some(p=>p.kind==='physical'&&p.carId===carId))return out;
    if(safe===undefined)safe=!timing.requiresCorrection(s);
    if(!safe)return out;
      for(const p of s.participants){if(p.kind!=='physical'||!p.carId||!p.configuration||carId&&p.carId!==carId)continue;
        const cached=cachedMeasurements?.get(p.id),lapsByStint=new Map();if(!cached)for(const lap of p.laps){if(!lapsByStint.has(lap.stintId))lapsByStint.set(lap.stintId,[]);lapsByStint.get(lap.stintId).push(lap);}
        for(const stint of p.stints){const laps=lapsByStint.get(stint.id)||[],metrics=cached?cached.get(stint.id):laps.length?measured(laps,recordsOnly):null;if(!metrics)continue;
          out.push({id:key(['timing',s.source.id,s.sessionId,p.id,stint.id]),carId:p.carId,kind:'timing',session:s.name,date:s.startedAt,trackKey:key(['timing',s.source.id,s.track.id]),track:s.track.name,sourceName:s.source.name,sourceId:s.source.id,trackId:s.track.id,sessionId:s.sessionId,driver:p.drivers.find(d=>d.id===stint.driverId)?.name||unknown,lane:String(stint.lane),heat:s.heats.find(h=>h.id===stint.heatId)?.name||'',direction:unknown,voltage:unknown,magnetStatus:unknown,technical:p.configuration.technical,components:p.configuration.components,configuration:p.configuration.revision,recordKey:s.source.id+':'+s.sessionId,...metrics});
        }
      }
    return out;
  }
  function runs(db,carId,recordsOnly=false){const out=[];
    for(const record of db.timing?.sessions||[])if(record.format!=='history-v1')for(const run of sessionRuns(record.payload,carId,recordsOnly))out.push(run);
    for(const t of db.tests||[]){const track=(t.track||'').trim();if(!track||carId&&t.carId!==carId)continue;const voltage=positive(t.voltage),bestSeconds=positive(t.best),best=bestSeconds!==null&&Number.isFinite(bestSeconds*1000)?bestSeconds*1000:null;
      out.push({id:key(['manual',t.id]),carId:t.carId,kind:'manual',session:'Manual test',date:t.date,trackKey:key(['manual',track.toLocaleLowerCase('en-GB')]),track,driver:t.driver?.trim()||unknown,lane:t.lane?.trim()||unknown,heat:'',direction:t.direction||unknown,voltage:voltage===null?unknown:String(voltage),magnetStatus:t.magnetStatus||unknown,technical:t.technical,configuration:t.setupId||'Recorded current configuration',testId:t.id,best,median:null,sustained5:null,sustained10:null,validLaps:null,totalLaps:positive(t.laps)||0,eligibleLaps:null});
    }
    return out;
  }
  function compatible(reference,candidate,{sameLane=true,sameDriver=true}={}){
    return ['trackKey','direction','voltage','magnetStatus'].every(k=>reference[k]===candidate[k])&&(!sameLane||reference.lane===candidate.lane)&&(!sameDriver||reference.driver===candidate.driver);
  }
  function laneRecords(db,carId){
    if(!db.cars.some(c=>c.id===carId))return [];
    return laneRecordsFromRuns(runs(db,carId,true));
  }
  function laneRecordsFromRuns(all){
    const fastest=new Map();
    for(const run of all){
      if(run.best===null||run.best<=0||run.lane===unknown)continue;
      const laneKey=key([run.trackKey,run.lane.toLocaleLowerCase('en-GB')]);
      const recordedAt=run.bestLap?new Date(Date.parse(run.date)+run.bestLap.endedAtMs).toISOString():run.date;
      const candidate={...run,recordedAt},old=fastest.get(laneKey);
      if(!old||run.best<old.best||run.best===old.best&&(recordedAt<old.recordedAt||recordedAt===old.recordedAt&&run.id<old.id))fastest.set(laneKey,candidate);
    }
    return [...fastest.values()].sort((a,b)=>a.kind.localeCompare(b.kind)||a.track.localeCompare(b.track)||a.trackKey.localeCompare(b.trackKey)||a.lane.localeCompare(b.lane,undefined,{numeric:true}));
  }
  function compare(all,cars,referenceId,{metric='best',tolerance=.2,sameLane=true,sameDriver=true}={}){
    if(!['best','median','sustained5','sustained10'].includes(metric)||!Number.isFinite(tolerance)||tolerance<0||tolerance>60)throw Error('Choose a valid pace metric and tolerance between 0 and 60 seconds.');
    const reference=all.find(r=>r.id===referenceId),carMap=new Map(cars.filter(c=>!c.archived).map(c=>[c.id,c]));
    if(!reference||!carMap.has(reference.carId)||reference[metric]===null)return {reference,rows:[],unavailable:true};
    const fastest=new Map();for(const run of all){if(run.carId===reference.carId||!carMap.has(run.carId)||run[metric]===null||!compatible(reference,run,{sameLane,sameDriver}))continue;const old=fastest.get(run.carId);if(!old||run[metric]<old[metric]||run[metric]===old[metric]&&run.date>old.date)fastest.set(run.carId,run);}
    const rows=[...fastest.values()].filter(run=>Math.abs(run[metric]-reference[metric])<=tolerance*1000+1e-8).map(run=>({run,car:carMap.get(run.carId),deltaMs:run[metric]-reference[metric]})).sort((a,b)=>Math.abs(a.deltaMs)-Math.abs(b.deltaMs)||a.car.name.localeCompare(b.car.name));
    return {reference,rows,unavailable:false};
  }
  const api={median,measured,runs,sessionRuns,compatible,compare,laneRecords,laneRecordsFromRuns};if(typeof module==='object'&&module.exports)module.exports=api;else root.PaceModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
