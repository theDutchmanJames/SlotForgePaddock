'use strict';
// Synthetic temporary data only; preparation and commit are measured separately.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),scoped=require('../src/scoped-write.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-car-detail-bench-'));
try{
 const file=path.join(dir,'db.sqlite'),s=new Store(file),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Benchmark car',picture:'data:image/png;base64,AAAA',technical:{weight:'80'}}});
 const part=act('part.save',{data:{name:'Motor',quantity:3,tracking:'quantity'}});act('part.install',{carId:car,partId:part,quantity:1,field:'motor'});act('setup.save',{carId:car,name:'Original'});act('test.add',{carId:car,track:'Circuit',lane:'1',best:'6'});
 s.transact(d=>{for(let i=1;i<500;i++)d.cars.push({...d.cars[0],id:'car-'+i});for(let i=1;i<3000;i++)d.parts.push({...d.parts[0],id:'part-'+i,notes:'Description '.repeat(80)});for(let i=1;i<2000;i++)d.tests.push({...d.tests[0],id:'test-'+i,carId:'car-'+(1+i%499)});});
 const cases=[['Technical edit','car.save',{id:car,revision:s.data.cars[0].revision,data:{technical:{weight:'81'}}}],['Main photo','car.save',{id:car,revision:s.data.cars[0].revision,data:{picture:'data:image/png;base64,BBBB'}}],['Manual test','test.add',{revision:s.data.revision,carId:car,track:'Circuit',best:'6.4'}],['New car','car.save',{data:{name:'New car'}}]];
 const reports=[];
 for(const [name,action,payload]of cases)for(const broad of [true,false]){const samples=[];for(let i=0;i<3;i++){const store=new Store(file,{deferred:true}),state=store.deferredState,start=performance.now();if(broad){const work=scoped.context(store,'@baseline'),before=work.data,result=work.mutate(action,payload,{snapshot:false}).result;scoped.prepare(store,before,work.data,result);}else scoped.command(store,action,payload);samples.push({ms:+(performance.now()-start).toFixed(1),...state.stats});}reports.push({name,mode:broad?'previous broad preparation':'targeted preparation',samples});}
 const store=new Store(file,{deferred:true}),start=performance.now();store.mutate('car.save',cases[0][2],{snapshot:false});
 console.log(JSON.stringify({collection:{cars:500,parts:3000,tests:2000},reports,technicalSaveIncludingCommitMs:+(performance.now()-start).toFixed(1)},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
