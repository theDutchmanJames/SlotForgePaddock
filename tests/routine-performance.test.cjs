'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),receipts=require('../src/command-receipts.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-routine-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));
 const car=act(s,'car.save',{data:{name:'Car',picture:'data:image/png;base64,AAAA'}});
 const part=act(s,'part.save',{data:{name:'Motor',maker:'NSR',reference:'6530',category:'Motors & motor parts',partType:'Motor',material:'Steel',quantity:3,tracking:'quantity'}});
 act(s,'part.install',{carId:car,partId:part,quantity:1,field:'motor',position:'Motor'});
 const job=act(s,'job.start',{kind:'general',carId:car,name:'Service'});
 act(s,'planning.job.save',{jobId:job,priority:'Normal',targetDate:'',waiting:false,checklist:[{id:'step',text:'Inspect'}]});
 act(s,'planning.job.photo',{jobId:job,stage:'Before',name:'Original',data:'data:image/png;base64,AAAA'});
 const supply=act(s,'supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:2,remaining:10,minimum:1,unit:'ml'}});
 const line=act(s,'planning.shopping.add',{partId:part,quantity:1,jobId:job});
 const list=act(s,'planning.list.save',{name:'My list'});
 s.transact(d=>{for(let i=0;i<100;i++){d.cars.push({...d.cars[0],id:'car-'+i,name:'Other car '+i});d.parts.push({...d.parts[0],id:'part-'+i,name:'Other part '+i,maker:'Other maker',material:'Other material'});d.supplies.push({...d.supplies[0],id:'supply-'+i});d.jobs.push({...JSON.parse(JSON.stringify(d.jobs[0])),id:'job-'+i,carId:'car-'+i});d.planning.jobs.unshift({...JSON.parse(JSON.stringify(d.planning.jobs.at(-1))),jobId:'job-'+i});}d.planning.futureOption={keep:true};});
 return {s,car,part,job,supply,line,list,open:()=>new Store(s.file,{deferred:true})};
}
function save(d,action,p){const state=d.deferredState,start=performance.now(),result=act(d,action,p);return {result,stats:state.stats,ms:performance.now()-start};}
const cold=(stats,except=[])=>{for(const k of ['cars','parts','supplies','installations','assemblies','setups','jobs','events','buildDrafts','timing.sessions','planning.jobs','planning.focus','planning.shelves'])if(!except.includes(k))assert.ok(!stats.loadedSections.includes(k),k+' was loaded: '+JSON.stringify(stats));};
test('appearance and supply edits stay targeted and retain stock, media, catalogue and history',t=>{
 const {s,part,supply,open}=fixture(t),original=s.snapshot();
 for(const [action,p] of [['part.appearance',{id:part,data:{iconColour:'blue'}}],['supply.archive',{id:supply}],['supply.save',{id:supply,data:{...s.data.supplies[0],quantity:4,notes:'Changed'}}]]){const result=save(open(),action,p);cold(result.stats);assert.ok(result.stats.recordReads<20,JSON.stringify(result.stats));}
 const after=new Store(s.file).snapshot();validateDatabase(after);assert.deepEqual(after.cars,original.cars);assert.deepEqual(after.installations,original.installations);assert.deepEqual(after.jobs,original.jobs);assert.deepEqual(after.parts.slice(1),original.parts.slice(1));assert.equal(after.parts[0].quantity,3);assert.equal(after.supplies[0].archived,true);assert.equal(after.supplies[0].history.length,1);assert.deepEqual(after.supplies.slice(1),original.supplies.slice(1));
});
test('job plans retain their original index, untouched plans and photographs; new plans append safely',t=>{
 const {s,job,open}=fixture(t),before=s.snapshot();
 let result=save(open(),'planning.job.check',{jobId:job,id:'step',done:true});cold(result.stats);assert.ok(result.stats.recordReads<12,JSON.stringify(result.stats));
 result=save(open(),'planning.job.save',{jobId:job,priority:'High',targetDate:'2026-12-01',waiting:true,checklist:[{id:'step',text:'Inspect',done:true}]});cold(result.stats);
 let after=new Store(s.file).snapshot();validateDatabase(after);assert.deepEqual(after.planning.jobs.slice(0,-1),before.planning.jobs.slice(0,-1));assert.equal(after.planning.jobs.at(-1).jobId,job);assert.equal(after.planning.jobs.at(-1).priority,'High');assert.deepEqual(after.planning.jobs.at(-1).photos,before.planning.jobs.at(-1).photos);assert.deepEqual(after.planning.shopping,before.planning.shopping);assert.deepEqual(after.parts,before.parts);
 const current=new Store(s.file),newCar=act(current,'car.save',{data:{name:'New car'}}),newJob=act(current,'job.start',{kind:'general',carId:newCar,name:'New job'});
 save(open(),'planning.job.save',{jobId:newJob,priority:'Normal',targetDate:'',waiting:false,checklist:[]});after=new Store(s.file).snapshot();assert.equal(after.planning.jobs.at(-1).jobId,newJob);assert.equal(after.planning.jobs.length,before.planning.jobs.length+1);validateDatabase(after);
});
test('progress notes capture current installed parts without unrelated stock or history reads',t=>{
 const {s,job,car,part,open}=fixture(t),before=s.snapshot();const result=save(open(),'job.note',{id:job,note:'Checked the motor'});cold(result.stats);assert.ok(result.stats.recordReads<15,JSON.stringify(result.stats));
 const after=new Store(s.file).snapshot();validateDatabase(after);assert.deepEqual(after.cars,before.cars);assert.deepEqual(after.parts,before.parts);assert.deepEqual(after.jobs.slice(1),before.jobs.slice(1));assert.equal(after.jobs[0].log.at(-1).actual.installations[0].partId,part);assert.equal(after.events[0].carId,car);assert.equal(after.events[0].notes,'Checked the motor');assert.deepEqual(after.events.slice(1),before.events);
});
test('shopping list names, item notes and assignments preserve linked requirements and stock',t=>{
 const {s,list,line,open}=fixture(t),before=s.snapshot();
 for(const [a,p]of [['planning.list.save',{id:list,name:'Renamed'}],['planning.shopping.edit',{id:line,notes:'Please buy',listId:list}]])cold(save(open(),a,p).stats);
 const after=new Store(s.file).snapshot();validateDatabase(after);assert.equal(after.planning.shopping.find(l=>l.id===line).notes,'Please buy');assert.equal(after.planning.shopping.find(l=>l.id===line).purchase.listId,list);assert.deepEqual(after.parts,before.parts);assert.deepEqual(after.jobs,before.jobs);assert.deepEqual(after.planning.jobs,before.planning.jobs);assert.deepEqual(after.planning.futureOption,before.planning.futureOption);
});
test('targeted editors preserve complete suggestions without decoding unrelated records',t=>{
 const {s,part,supply,job,open}=fixture(t);
 for(const [action,id]of [['edit-part',part],['part-appearance',part],['edit-supply',supply],['archive-supply',supply],['job-plan',job],['job-note',job],['edit-job',job],['add-part',undefined],['add-supply',undefined]]){
  const d=open(),state=d.deferredState,result=view(d,{page:action.includes('supply')||action.includes('job')?'Workshop':'Parts',partsTab:'Stock',stockScope:'catalogue',editor:{action,id}});cold(state.stats);assert.ok(state.stats.recordReads<20,action+JSON.stringify(state.stats));
  if(action==='edit-part'){assert.equal(result.parts.length,1);assert.equal(result.parts[0].id,part);assert.ok(result._view.partSuggestions.material.includes('Other material'));assert.ok(result._view.partSuggestions.maker.includes('Other maker'));assert.ok(result._view.partSuggestions.typesByCategory.some(v=>v.category==='Motors & motor parts'&&v.partType==='Motor'));}
  if(action==='job-plan')assert.equal(result.planning.jobs[0].jobId,job);
 }
 assert.deepEqual(new Store(s.file).snapshot(),s.snapshot());
});
test('stale/invalid saves and persistence failures roll back; durable retries survive restart',t=>{
 const {s,job,part,line,open}=fixture(t),before=s.snapshot();
 for(const [action,p]of [['planning.job.check',{jobId:job,id:'missing',done:true}],['planning.job.save',{jobId:job,priority:'High',targetDate:'bad',waiting:false,checklist:[]}],['job.note',{id:job,note:''}],['part.appearance',{id:part,data:{iconColour:'not-a-colour'}}],['planning.shopping.edit',{id:line,listId:'absent'}]])assert.throws(()=>act(open(),action,p));
 assert.throws(()=>act(open(),'planning.job.check',{jobId:job,id:'step',done:true,revision:0}),/changed/);assert.deepEqual(new Store(s.file).snapshot(),before);
 const broken=open();broken.persist=()=>{throw Error('disk full');};assert.throws(()=>act(broken,'planning.job.check',{jobId:job,id:'step',done:true}),/disk full/);assert.deepEqual(new Store(s.file).snapshot(),before);
 const d=open(),command={id:'routine-retry',databaseId:d.data.id,epoch:d.deferredState.token.epoch,action:'job.note',payload:{revision:d.data.revision,id:job,note:'Only once'}};
 const first=receipts.execute(d,command);const retry=receipts.execute(open(),command);assert.equal(retry.result,first.result);assert.equal(new Store(s.file).data.jobs[0].log.length,1);
});

test('competing sparse plans reject the stale writer and preserve neighbouring plans',async t=>{
 const {s,job,open}=fixture(t),before=s.snapshot(),left=open(),right=open(),revision=left.data.revision;
 const results=await Promise.allSettled([left.mutateAsync('planning.job.check',{revision,jobId:job,id:'step',done:true},{snapshot:false,commandId:'check-first'}),right.mutateAsync('planning.job.save',{revision,jobId:job,priority:'High',targetDate:'',waiting:false,checklist:[{id:'step',text:'Changed by other writer'}]},{snapshot:false,commandId:'plan-second'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const after=new Store(s.file).snapshot();validateDatabase(after);assert.deepEqual(after.planning.jobs.slice(0,-1),before.planning.jobs.slice(0,-1));assert.deepEqual(after.planning.jobs.at(-1).photos,before.planning.jobs.at(-1).photos);assert.equal(after.revision,before.revision+1);
});
