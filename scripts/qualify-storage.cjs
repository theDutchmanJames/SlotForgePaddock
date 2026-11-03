'use strict';
// Synthetic fixtures only. Separate measurement processes avoid counting the
// fixture generator's allocations as application startup memory. OS cache is warm.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),lazy=require('../src/lazy-assets.cjs');
const ms=start=>+(performance.now()-start).toFixed(1),percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
async function measure(file){
 const started=performance.now(),store=new Store(file),openMs=ms(started),first=performance.now(),overview=view(store,{page:'Overview'}),firstViewMs=ms(first),originalReadsOnOpen=lazy.stats().reads,projected=new (require('../src/renderer-media.cjs').RendererMedia)().project(overview),samples=[],sync=[];
 lazy.clearCache();
 for(let n=0;n<20;n++){
  const start=performance.now(),promise=store.mutateAsync('car.save',{id:store.data.cars[0].id,revision:store.data.cars[0].revision,data:{livery:'Qualification '+n}},{snapshot:false});sync.push(ms(start));await promise;view(store,{page:'Cars',carId:store.data.cars[0].id,section:'Overview'});samples.push(ms(start));
 }
 const local={p50Ms:percentile(samples,.5),p95Ms:percentile(samples,.95),maxSynchronousPrepareMs:Math.max(...sync),originalReads:lazy.stats().reads,writes:store.lastWrite};
 const generalTimes=[],generalSync=[];for(let n=0;n<5;n++){const start=performance.now(),promise=store.mutateAsync('work.add',{carId:store.data.cars[0].id,type:'maintenance',title:'Qualification service '+n},{snapshot:false});generalSync.push(ms(start));await promise;generalTimes.push(ms(start));}const general={p50Ms:percentile(generalTimes,.5),p95Ms:percentile(generalTimes,.95),maxSynchronousPrepareMs:Math.max(...generalSync),originalReads:lazy.stats().reads,writes:store.lastWrite};
 const {Club}=require('../src/club.cjs'),{Network}=require('../src/network.cjs'),net=new Network(store),club=new Club(store,net,path.join(path.dirname(file),'club'));const proposals=[];
 try{await club.enableAsync('Qualification','1234');for(let n=0;n<10;n++){const start=performance.now();await club.mutate('car.save',{id:store.data.cars[0].id,revision:store.data.cars[0].revision,data:{livery:'Review '+n}},{snapshot:false});proposals.push(ms(start));}const p=store.data.club.proposals[0],preview=club.preview(p.id),start=performance.now();await club.reviewAsync({id:p.id,token:preview.token,decision:'accept'});const approvalMs=ms(start),settings=view(store,{page:'Settings'})._view.storage;
  console.log(JSON.stringify({cars:store.data.cars.length,parts:store.data.parts.length,laps:store.data.timing.sessions.reduce((n,s)=>n+s.payload.participants.reduce((n,p)=>n+p.laps.length,0),0),openMs,firstViewMs,firstUsableBackendMs:+(openMs+firstViewMs).toFixed(1),originalReadsOnOpen,overviewBytes:Buffer.byteLength(JSON.stringify(projected)),local,general,proposal:{p50Ms:percentile(proposals,.5),p95Ms:percentile(proposals,.95),bytes:require('../src/json-encoding.cjs').byteLength(p),approvalMs},storage:settings,peakRssMiB:+(process.resourceUsage().maxRSS/1024).toFixed(1)}));
 }finally{club.close();net.close();}
}
function generate(file,count){
 const {fixtures}=require('../tests/support/timing-fixtures.cjs'),timing=require('../src/timing-integration.cjs'),f=fixtures(),seed=f.store;
 const payload=structuredClone(f.normal);payload.endedAt='2026-10-31T11:01:00.000Z';payload.heats[0].endedAtMs=3600000;payload.participants[0].stints[0].endedAtMs=3600000;payload.participants[0].laps=Array.from({length:205},(_,i)=>({...payload.participants[0].laps[0],id:'lap-'+i,number:i+1,endedAtMs:(i+1)*10000}));payload.standings[0].classifiedLaps=205;payload.standings[0].classifiedElapsedMs=2050000;
 for(let i=0;i<50;i++)timing.receive(seed,{...payload,sessionId:'bench-session-'+i});
 seed.mutate('part.save',{data:{name:'Inventory motor',category:'Motors & motor parts',partType:'Motor',tracking:'quantity',quantity:4}});
 seed.mutate('custom.add',{label:'Fixture detail',type:'text'});seed.mutate('work.add',{carId:'car-a',type:'modification',title:'Synthetic history'});
 const data=seed.snapshot(),template=data.cars[0],part=data.parts[0],event=data.events[0],photo=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));data.cars=[];data.parts=[];data.events=[];
 for(let i=0;i<count;i++){
  const id=i<2?'car-'+(i?'b':'a'):'bench-'+i,tail=Buffer.alloc(4);tail.writeUInt32BE(i);
  data.cars.push({...structuredClone(i===1?seed.data.cars[1]:template),id,name:'Car '+String(i).padStart(5,'0'),custom:{[data.customFields[0].id]:'Fixture '+i},picture:i%5?'':'data:image/png;base64,'+(i%10?photo:Buffer.concat([photo,tail])).toString('base64')});
  data.events.push({...event,id:'event-'+i,carId:id});
  for(let p=0;p<2;p++)data.parts.push({...part,id:'part-'+i+'-'+p,name:'Motor '+i+'-'+p,quantity:i%3?4:0});
 }
 const s=new Store(file);s.replace(data);assert.equal(new Store(file).data.cars.length,count);
}
if(require.main===module)(async()=>{
 if(process.argv[2]==='--measure'){await measure(process.argv[3]);return;}
 const counts=process.argv.slice(2).map(Number);if(!counts.length)counts.push(100,500,1000,5000);if(counts.some(n=>!Number.isSafeInteger(n)||n<2||n>5000))throw Error('Choose 2–5,000 cars.');
 const root=path.resolve(__dirname,'..','.qa');fs.mkdirSync(root,{recursive:true});const reports=[];
 for(const count of counts){const dir=fs.mkdtempSync(path.join(root,'qualification-'));try{const file=path.join(dir,'collection.sqlite');generate(file,count);const r=spawnSync(process.execPath,[__filename,'--measure',file],{encoding:'utf8',maxBuffer:1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout);const report=JSON.parse(r.stdout.trim());reports.push(report);console.log(JSON.stringify(report));}finally{if(path.dirname(dir)!==root||!path.basename(dir).startsWith('qualification-'))throw Error('Unsafe cleanup path');fs.rmSync(dir,{recursive:true,force:true});}}
 fs.writeFileSync(path.join(root,'phase8-qualification.json'),JSON.stringify({environment:{platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,ramGiB:os.totalmem()/1073741824},scope:'Warm OS cache; backend first usable view excludes Electron startup/paint. Proposals submitted on host, not physical LAN. 20 targeted edits, 5 general maintenance writes and 10 proposals per size.',reports},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

module.exports={generate,measure};
