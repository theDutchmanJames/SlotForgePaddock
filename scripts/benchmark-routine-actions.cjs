'use strict';
// Synthetic temporary collection only. Measures preparation separately from
// SQLite commit; these are not renderer-to-screen latency measurements.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),scoped=require('../src/scoped-write.cjs'),{view}=require('../src/view-query.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-routine-bench-'));
try{
 const file=path.join(dir,'db.sqlite'),s=new Store(file),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Benchmark car'}}),part=act('part.save',{data:{name:'Benchmark motor',tracking:'quantity',quantity:3,maker:'NSR',category:'Motors & motor parts',partType:'Motor'}});
 const job=act('job.start',{kind:'general',carId:car,name:'Benchmark job'});
 act('planning.job.save',{jobId:job,priority:'Normal',waiting:false,targetDate:'',checklist:[{id:'step',text:'Inspect'}]});
 const supply=act('supply.save',{data:{name:'Oil',kind:'Consumable',category:'Cleaning & lubrication',quantity:2}});
 s.transact(d=>{
  for(let i=1;i<500;i++)d.cars.push({...d.cars[0],id:'car-'+i});
  for(let i=1;i<3000;i++)d.parts.push({...d.parts[0],id:'part-'+i,name:'Part '+i,notes:'Catalogue description. '.repeat(50)});
  for(let i=1;i<100;i++){d.supplies.push({...d.supplies[0],id:'supply-'+i});d.jobs.push({...JSON.parse(JSON.stringify(d.jobs[0])),id:'job-'+i,carId:'car-'+i});d.planning.jobs.unshift({...JSON.parse(JSON.stringify(d.planning.jobs.at(-1))),jobId:'job-'+i});}
 });
 const reports=[];
 function measure(name,fn){const samples=[];for(let i=0;i<3;i++){const store=new Store(file,{deferred:true}),state=store.deferredState,start=performance.now();fn(store);samples.push({ms:Number((performance.now()-start).toFixed(1)),...state.stats});}reports.push({name,samples});}
 const payload={jobId:job,id:'step',done:true,revision:s.data.revision};
 measure('Previous broad job-plan preparation',store=>{const c=scoped.context(store,'@baseline'),before=c.data,result=c.mutate('planning.job.check',payload,{snapshot:false}).result;scoped.prepare(store,before,c.data,result);});
 measure('Targeted job-plan preparation',store=>scoped.command(store,'planning.job.check',payload));
 measure('Targeted part appearance preparation',store=>scoped.command(store,'part.appearance',{id:part,data:{iconColour:'blue'},revision:store.data.revision}));
 measure('Targeted supply archive preparation',store=>scoped.command(store,'supply.archive',{id:supply,revision:store.data.revision}));
 measure('Targeted progress note preparation',store=>scoped.command(store,'job.note',{id:job,note:'Checked',revision:store.data.revision}));
 measure('Part editor with catalogue suggestions',store=>view(store,{page:'Parts',partsTab:'Stock',partId:part,editor:{action:'edit-part',id:part}}));
 const store=new Store(file,{deferred:true}),start=performance.now();store.mutate('planning.job.check',{...payload,revision:store.data.revision},{snapshot:false});
 console.log(JSON.stringify({collection:{cars:500,parts:3000,supplies:100,jobs:100},reports,checklistSaveIncludingCommitMs:Number((performance.now()-start).toFixed(1)),lastWrite:store.lastWrite},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
