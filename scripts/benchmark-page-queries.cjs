'use strict';
// Synthetic, isolated collection. Counts full record decoding separately from
// lightweight SQL descriptors; no personal profiles or installed apps are used.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{Reader}=require('../src/sqlite-query.cjs'),{view}=require('../src/view-query.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-page-bench-'));
try{
 const file=path.join(dir,'db.sqlite'),s=new Store(file),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Benchmark car',privateNotes:'Private details. '.repeat(100)}});
 act('part.save',{data:{name:'Benchmark motor',tracking:'quantity',quantity:3,maker:'NSR',category:'Motors & motor parts',partType:'Motor'}});
 act('job.start',{kind:'general',carId:car,name:'Benchmark job'});
 act('supply.save',{data:{name:'Oil',kind:'Consumable',category:'Cleaning & lubrication',quantity:2}});
 s.transact(d=>{
  for(let i=1;i<500;i++)d.cars.push({...d.cars[0],id:'car-'+i,name:'Car '+i});
  for(let i=1;i<3000;i++)d.parts.push({...d.parts[0],id:'part-'+i,name:'Part '+i,reference:'REF-'+i,notes:'Catalogue description. '.repeat(50)});
  for(let i=1;i<100;i++){d.supplies.push({...d.supplies[0],id:'supply-'+i});d.jobs.push({...JSON.parse(JSON.stringify(d.jobs[0])),id:'job-'+i,carId:'car-'+i});}
 });
 const reports=[];
 for(const request of [{page:'Showroom'},{page:'Build from Scratch',build:{types:['Motor'],partIds:['part-2999']}},{page:'Workshop'},{page:'Workshop',toolboxTab:'Workshop supplies'},{page:'Shopping List',shoppingFinder:{query:'REF-2999'}},{page:'Shopping List'}]){
  const samples=[];for(let i=0;i<3;i++){
   const store=new Store(file,{deferred:true}),original=Reader.prototype.record;let reads=0;Reader.prototype.record=function(...args){reads++;return original.apply(this,args);};
   const start=performance.now();try{const d=view(store,request);samples.push({ms:+(performance.now()-start).toFixed(1),recordReads:reads,loadedSections:store.deferredState.stats.loadedSections,parts:d.parts.length,cars:d.cars.length});}finally{Reader.prototype.record=original;}
  }reports.push({request,samples});
 }
 console.log(JSON.stringify({collection:{cars:500,parts:3000,jobs:100,supplies:100},reports},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
