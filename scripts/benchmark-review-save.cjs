const fs=require('fs'),path=require('path'),{performance}=require('perf_hooks');
const {Store}=require('../src/store.cjs'),{Club}=require('../src/club.cjs'),{Network}=require('../src/network.cjs'),M=require('../src/club-model.cjs');
async function main(){
 const count=Number(process.env.PERF_CARS??28),size=Number(process.env.PERF_KIB??3072);
 if(!Number.isSafeInteger(count)||count<1||count>1000||!Number.isSafeInteger(size)||size<1||size>8192||count*size*1024*4/3>190*1024*1024)throw Error('Use 1–1,000 cars and 1–8,192 KiB per photo, with total encoded photos below 190 MiB.');
 const qa=path.resolve(__dirname,'../.qa');fs.mkdirSync(qa,{recursive:true});
 const dir=fs.mkdtempSync(path.join(qa,'review-perf-')),report={};let net,club,heartbeat;
 try{
  const s=new Store(path.join(dir,'database.json'));
  for(let i=0;i<count;i++)s.data.cars.push({id:'car-'+i,revision:1,name:'Car '+i,technical:{},factory:{},usage:[],tags:[],photos:[],custom:{},picture:'data:image/jpeg;base64,'+Buffer.alloc(size*1024,65+i%26).toString('base64')});
  net=new Network(s);club=new Club(s,net,dir);club.enable('Benchmark','test-password');report.databaseMiB=Math.round(fs.statSync(s.file).size/1024/1024);
  function wrap(object,key){const fn=object[key];object[key]=function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const slot=report[key]??={ms:0,calls:0};slot.ms+=performance.now()-start;slot.calls++;}};}
  for(const k of ['simulation','changed'])wrap(club,k);for(const k of ['digest','hash','summary','delta','shared'])wrap(M,k);
  let ticks=0,lag=0,last=performance.now();heartbeat=setInterval(()=>{const now=performance.now();lag=Math.max(lag,now-last-10);last=now;ticks++;},10);
  const start=performance.now();await club.mutate('car.save',{id:'car-0',revision:1,data:{realHistory:{classification:'Fantasy Livery'}}});report.totalMs=Math.round(performance.now()-start);
  await new Promise(r=>setTimeout(r,20));clearInterval(heartbeat);report.eventLoopMaxDelayMs=Math.round(lag);report.heartbeatTicks=ticks;report.proposalBytes=Buffer.byteLength(JSON.stringify(s.data.club.proposals[0]));
  for(const value of Object.values(report))if(value&&typeof value==='object')value.ms=Math.round(value.ms);console.log(JSON.stringify(report,null,2));
 }finally{
  clearInterval(heartbeat);club?.close();net?.close();
  if(!path.resolve(dir).startsWith(qa+path.sep))throw Error('Unexpected benchmark directory');fs.rmSync(dir,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
