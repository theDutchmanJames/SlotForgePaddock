'use strict';
// Synthetic local benchmark: never opens a user collection or a network port.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {Store}=require('../src/store.cjs'),T=require('../src/timing-integration.cjs'),{fixtures}=require('../tests/support/timing-fixtures.cjs');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-result-worker-')),results=[];
 try{for(const count of [1000,10000])for(const mode of ['synchronous','background']){
  const f=fixtures(),seed=new Store(path.join(dir,count+'-'+mode+'.sqlite'));seed.replace(f.store.snapshot());const s=new Store(seed.file,{deferred:true}),p=structuredClone(f.normal),duration=count*1000;
  p.heats[0].endedAtMs=duration;p.endedAt=new Date(Date.parse(p.startedAt)+duration).toISOString();p.participants[0].stints[0].endedAtMs=duration;
  const lap=p.participants[0].laps[0];p.participants[0].laps=Array.from({length:count},(_,i)=>({...lap,id:'lap-'+i,number:i+1,durationMs:1000,endedAtMs:(i+1)*1000}));p.standings[0].classifiedLaps=count;p.standings[0].classifiedElapsedMs=duration;
  const input=Buffer.from(JSON.stringify(p));let firstTick,maxGap=0,last=performance.now(),ticks=0;const started=last;
  const timer=setInterval(()=>{const now=performance.now();firstTick??=now-started;maxGap=Math.max(maxGap,now-last);last=now;ticks++;},5);
  try{const result=mode==='background'?await T.receiveAsync(s,input):T.receive(s,p),elapsed=performance.now()-started;await new Promise(r=>setTimeout(r,10));results.push({laps:count,mode,bytes:input.length,elapsedMs:Math.round(elapsed),firstTimerMs:Math.round(firstTick),maxTimerGapMs:Math.round(maxGap),timerTicks:ticks,accepted:result.ok,deferred:!!s.deferredState});}finally{clearInterval(timer);}
 }
 console.log(JSON.stringify({node:process.version,results},null,2));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
