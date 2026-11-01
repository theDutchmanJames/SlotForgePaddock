// Synthetic local benchmark: 40 cars, 512 KiB photo payload each.
// Creates and removes a temporary test collection; never opens a user database.
// Timings include durable synchronous saves and depend on CPU/storage load.

const {performance}=require('node:perf_hooks'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.resolve(__dirname,'..'),{Store}=require(path.join(root,'src/store.cjs')),{Club}=require(path.join(root,'src/club.cjs')),{Network}=require(path.join(root,'src/network.cjs')),timing=require(path.join(root,'src/timing-integration.cjs')),M=require(path.join(root,'src/club-model.cjs'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-benchmark-')),s=new Store(path.join(dir,'database.json')),report={};let club,net;
const measure=(name,fn)=>{const start=performance.now(),v=fn();report[name]=Math.round(performance.now()-start);return v;};
(async()=>{try{
 for(let i=0;i<40;i++)s.mutate('car.save',{data:{name:'Benchmark car '+i}});
 const picture='data:image/jpeg;base64,'+Buffer.alloc(512*1024,72).toString('base64');
 s.transact(db=>{for(const car of db.cars)car.picture=picture;});report.databaseMiB=Math.round(Buffer.byteLength(JSON.stringify(s.data))/1024/1024);
 net=new Network(s);club=new Club(s,net,dir);club.enable('Benchmark');
 measure('snapshot',()=>s.snapshot());measure('sharedSnapshot',()=>M.shared(s.data));measure('conflictDigest',()=>M.digest(s.data));
 measure('firstTimingProfile',()=>timing.profile(s,s.data.cars[0].id));measure('nextTimingProfile',()=>timing.profile(s,s.data.cars[0].id));
 measure('privateTransaction',()=>s.mutate('work.add',{carId:s.data.cars[0].id,type:'maintenance',title:'Private work'}));
 measure('workshopSave',()=>s.mutate('job.start',{revision:s.data.revision,kind:'general',carId:s.data.cars[1].id,name:'Service motor'}));
 const start=performance.now();await club.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{name:'Proposed'}});report.propose=Math.round(performance.now()-start);
 const p=measure('reviewPreview',()=>club.preview(s.data.club.proposals[0].id));measure('reviewApproval',()=>club.review({id:p.id,token:p.token,decision:'accept'}));
 console.log(JSON.stringify(report,null,2));
}finally{club?.close();net?.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
