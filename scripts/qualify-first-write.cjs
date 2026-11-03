'use strict';
// Compare the former full-load write boundary with scoped writes, using copies
// of a synthetic qualification collection. Never modifies the supplied file.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {Store}=require('../src/store.cjs'),queries=require('../src/sqlite-query.cjs');
async function measure(file,mode){
 const s=new Store(file,{deferred:true}),state=s.deferredState,car=queries.read(s,null,r=>r.one('cars','car-a')).value;
 const start=performance.now();if(mode==='full')await s.ensureLoadedAsync();
 await s.mutateAsync('car.save',{id:car.id,revision:car.revision,data:{livery:'First-write qualification'}},{snapshot:false});
 const editMs=performance.now()-start,readCount=state.stats.recordReads,sections=[...state.stats.loadedSections];
 const work=performance.now();await s.mutateAsync('work.add',{carId:car.id,type:'maintenance',title:'Qualification service'},{snapshot:false});
 console.log(JSON.stringify({mode,editMs:+editMs.toFixed(1),maintenanceMs:+(performance.now()-work).toFixed(1),recordReads:readCount,sections,deferred:!!s.deferredState,writes:s.lastWrite,peakRssMiB:+(process.resourceUsage().maxRSS/1024).toFixed(1)}));
}
if(process.argv[2]==='--measure')measure(process.argv[3],process.argv[4]).catch(e=>{console.error(e);process.exitCode=1;});
else{
 const source=path.resolve(process.argv[2]||'.qa/tuning/collection.sqlite'),root=path.resolve('.qa'),dir=fs.mkdtempSync(path.join(root,'first-write-')),results=[];
 try{
  for(const mode of ['full','scoped'])for(let run=0;run<3;run++){
   const file=path.join(dir,mode+'-'+run+'.sqlite');fs.copyFileSync(source,file);
   const child=spawnSync(process.execPath,[__filename,'--measure',file,mode],{encoding:'utf8',maxBuffer:1024*1024});if(child.status!==0)throw Error(child.stderr||child.stdout);
   results.push(JSON.parse(child.stdout.trim()));
  }
  const report={environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model},scope:'Fresh process per sample; warm OS cache; synthetic copied SQLite. Backend acknowledgement only, not physical LAN or renderer paint.',results};
  fs.writeFileSync(path.join(root,'first-write-qualification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{if(path.dirname(dir)!==root||!path.basename(dir).startsWith('first-write-'))throw Error('Unsafe qualification cleanup.');fs.rmSync(dir,{recursive:true,force:true});}
}
