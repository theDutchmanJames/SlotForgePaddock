'use strict';
// Synthetic, disposable collection. Does not access an installed app profile.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),scoped=require('../src/scoped-write.cjs'),M=require('../renderer/build-model.js');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-physical-bench-'));
try{
 const file=path.join(dir,'db.sqlite'),s=new Store(file),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Benchmark car'}}),part=act('part.save',{data:{name:'Motor',quantity:3,tracking:'quantity'}}),spare=act('part.save',{data:{name:'Spare',quantity:4,tracking:'quantity'}});
 act('part.install',{carId:car,partId:part,quantity:1,field:'motor'});act('setup.save',{carId:car,name:'Target'});const setup=s.data.setups[0].id;
 const row=id=>({key:'motor',partId:id,name:'Motor',slot:'motor',position:'Motor',quantity:1});
 const build={...M.blank(),name:'Benchmark draft',parts:[row(spare)]};
 const draft=act('build.draft.save',{data:build});
 s.transact(d=>{for(let i=1;i<500;i++)d.cars.push({...d.cars[0],id:'car-'+i});for(let i=2;i<3000;i++)d.parts.push({...d.parts[0],id:'part-'+i,notes:'Description '.repeat(80)});for(let i=1;i<100;i++)d.buildDrafts.push({...d.buildDrafts[0],id:'build-'+i,data:{...build,parts:[row('part-'+(i+1))]}});});
 const payloads=[['Part description','part.save',{id:part,data:{name:'Motor',quantity:3,tracking:'quantity',notes:'Edited'}}],['Stock quantity','part.save',{id:part,data:{name:'Motor',quantity:4,tracking:'quantity'}}],['Fit part','part.install',{carId:car,partId:spare,quantity:1,field:'rearTyres'}],['Apply setup','setup.apply',{id:setup,confirmed:true,selections:{0:'p:'+spare}}],['Save build draft','build.draft.save',{id:draft,data:{...build,name:'Updated draft'}}],['Complete build','build.create',{draftId:draft,data:build,confirmed:true}]];
 const reports=[];
 for(const [name,action,input]of payloads)for(const broad of [true,false]){const samples=[];for(let i=0;i<3;i++){const store=new Store(file,{deferred:true}),state=store.deferredState,p={revision:store.data.revision,...input},start=performance.now();if(broad){const work=scoped.context(store,action,p),before=work.data,result=work.mutate(action,p,{snapshot:false}).result;scoped.prepare(store,before,work.data,result);}else scoped.command(store,action,p);samples.push({ms:+(performance.now()-start).toFixed(1),...state.stats});}reports.push({name,mode:broad?'previous broad preparation':'targeted preparation',samples});}
 const store=new Store(file,{deferred:true}),start=performance.now();// Measure one complete save separately.
 store.mutate('part.install',{revision:store.data.revision,...payloads[2][2]},{snapshot:false});
 console.log(JSON.stringify({collection:{cars:500,parts:3000,buildDrafts:100},reports,fitIncludingCommitMs:+(performance.now()-start).toFixed(1)},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
