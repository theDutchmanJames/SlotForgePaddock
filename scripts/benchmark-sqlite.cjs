'use strict';
// Synthetic collections only. Reports backend timings, not desktop startup time.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {Store,migrate}=require('../src/store.cjs'),{RendererMedia}=require('../src/renderer-media.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-sqlite-benchmark-'));
const measure=fn=>{const start=performance.now(),value=fn();return {ms:Math.round(performance.now()-start),value};};
async function run(count){
 const seed=new Store(),id=seed.mutate('car.save',{data:{name:'Synthetic car',technical:{motor:'21.5k',pinion:'9',gear:'27'}}}).result;
 seed.mutate('setup.save',{carId:id,name:'Baseline'});const data=seed.snapshot(),car=data.cars[0],setup=data.setups[0];data.cars=[];data.setups=[];data.events=[];
 const image=fs.readFileSync(path.join(__dirname,'../assets/icon.png'));
 for(let i=0;i<count;i++){
  // Valid PNG plus distinct trailing bytes to prevent unrealistic deduplication.
  const bytes=Buffer.alloc(128*1024,i%251);image.copy(bytes);bytes.writeUInt32LE(i,bytes.length-4);
  data.cars.push({...structuredClone(car),id:'benchmark-'+i,name:'Benchmark car '+i,picture:'data:image/png;base64,'+bytes.toString('base64')});
  data.setups.push({...structuredClone(setup),id:'setup-'+i,carId:'benchmark-'+i});
 }
 const file=path.join(dir,count+'.json'),json=JSON.stringify(data);fs.writeFileSync(file,json);
 const legacy=measure(()=>migrate(JSON.parse(fs.readFileSync(file,'utf8'))));legacy.value=null;
 const migration=measure(()=>new Store(file));migration.value=null;
 const lazy=require('../src/lazy-assets.cjs');lazy.clearCache();const reopen=measure(()=>new Store(file)),store=reopen.value;reopen.value=null;const originalsReadOnOpen=lazy.stats().reads;
 const media=new RendererMedia(),projection=measure(()=>media.project(store.snapshot())),payloadBytes=Buffer.byteLength(JSON.stringify(projection.value));projection.value=null;
 const start=performance.now();await store.transactAsync(db=>{db.cars[0].livery='Benchmark edit';db.cars[0].revision++;});
 const report={cars:count,logicalMiB:+(Buffer.byteLength(json)/1048576).toFixed(1),legacyReadAndValidateMs:legacy.ms,oneTimeMigrationMs:migration.ms,sqliteReadAndValidateMs:reopen.ms,originalsReadOnOpen,rendererProjectionMs:projection.ms,rendererPayloadKiB:Math.round(payloadBytes/1024),asyncEditMs:Math.round(performance.now()-start),...store.lastWrite};
 if(new Store(file).data.cars[0].livery!=='Benchmark edit')throw Error('Saved edit missing');
 if(process.env.SLOTFORGE_TRANSACTION_BENCHMARK==='1'){
  const edits=[];for(let n=0;n<5;n++){const started=performance.now();await store.mutateAsync('car.save',{id:store.data.cars[0].id,revision:store.data.cars[0].revision,data:{livery:'Targeted '+n}});edits.push(Math.round(performance.now()-started));}
  edits.sort((a,b)=>a-b);report.commandEditP50Ms=edits[2];report.commandEditP95Ms=edits[4];
  const {Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),network=new Network(store),club=new Club(store,network,path.join(dir,'club-'+count));
  try{club.enable('Benchmark dealership','Benchmark password');let started=performance.now();await club.mutate('car.save',{id:store.data.cars[0].id,revision:store.data.cars[0].revision,data:{livery:'Reviewed change'}});report.localProposalMs=Math.round(performance.now()-started);const proposal=store.data.club.proposals[0];report.proposalBytes=Buffer.byteLength(JSON.stringify(proposal));const view=club.preview(proposal.id);started=performance.now();await club.reviewAsync({id:proposal.id,token:view.token,decision:'accept'});report.approvalMs=Math.round(performance.now()-started);}finally{club.close();network.close();}
 }
 console.log(JSON.stringify(report));
}
(async()=>{try{const counts=process.argv.length>2?process.argv.slice(2).map(Number):[500,1000];if(counts.some(n=>!Number.isInteger(n)||n<1||n>1000))throw Error('Choose collection sizes between 1 and 1,000 cars.');for(const count of counts)await run(count);}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
