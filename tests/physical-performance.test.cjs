'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),W=require('../src/workshop.cjs'),M=require('../renderer/build-model.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
const part=(s,name='Motor',quantity=5)=>act(s,'part.save',{data:{name,quantity,tracking:'quantity'}});
const build=(id,name='Plan',quantity=1)=>({...M.blank(),name,parts:[{key:'motor',partId:id,quantity,slot:'motor',position:'Motor',name:'Motor'}]});
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-physical-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=new Store(),car=act(s,'car.save',{data:{name:'Car',picture:'data:image/png;base64,AAAA'}}),other=act(s,'car.save',{data:{name:'Other car'}}),p=part(s),spare=part(s,'Spare');
 act(s,'part.install',{carId:car,partId:p,quantity:1,field:'motor'});act(s,'part.install',{carId:other,partId:p,quantity:1,field:'motor'});act(s,'setup.save',{carId:car,name:'Target'});const setup=s.data.setups[0].id;
 s.transact(d=>{for(let i=0;i<120;i++){d.cars.push({...d.cars[0],id:'unrelated-car-'+i});d.parts.push({...d.parts[0],id:'unrelated-part-'+i});}d.planning.futureOption={keep:true};});
 const file=path.join(dir,'db.sqlite');new Store(file).replace(s.snapshot());
 const read=()=>new Store(file).snapshot(),open=()=>new Store(file,{deferred:true});
 const run=(a,p={})=>{const d=open(),state=d.deferredState,result=act(d,a,p);for(const k of ['cars','parts','assemblies','installations','setups','jobs','buildDrafts','planning.shopping','timing.sessions'])assert.ok(!state.stats.loadedSections.includes(k),k+JSON.stringify(state.stats));assert.ok(state.stats.recordReads<70,JSON.stringify(state.stats));validateDatabase(read());return result;};
 return {file,car,other,p,spare,setup,read,open,run};
}
test('quantity reductions check competing use; descriptive edits and renames preserve history',t=>{
 const f=fixture(t),before=f.read();assert.throws(()=>f.run('part.save',{id:f.p,data:{name:'Motor',quantity:1,tracking:'quantity'}}),/stock/);assert.deepEqual(f.read(),before);
 let d=f.open(),state=d.deferredState;act(d,'part.save',{id:f.p,data:{name:'Motor',quantity:5,tracking:'quantity',notes:'Description only'}});assert.ok(state.stats.recordReads<10,JSON.stringify(state.stats));
 f.run('part.save',{id:f.p,data:{name:'Renamed',quantity:5,tracking:'quantity'}});const after=f.read();assert.equal(after.cars[0].technical.motor,'Renamed');assert.equal(after.cars[1].technical.motor,'Renamed');assert.equal(after.setups[0].installations[0].name,'Motor');assert.deepEqual(after.cars.slice(2),before.cars.slice(2));assert.deepEqual(after.parts.slice(2),before.parts.slice(2));
});
test('fit and remove preserve other users, return used lots and reject occupied slots',t=>{
 const f=fixture(t),before=f.read();assert.throws(()=>f.run('part.install',{carId:f.car,partId:f.spare,quantity:1,field:'motor'}),/existing tracked/);assert.deepEqual(f.read(),before);
 f.run('part.remove',{id:before.installations[0].id,destination:'spares'});let d=f.read();assert.equal(d.parts.find(p=>p.id===f.p).quantity,4);assert.equal(d.parts.at(-1).quantity,1);assert.equal(d.cars[1].technical.motor,'Motor');
 f.run('part.install',{carId:f.car,partId:f.spare,quantity:1,field:'motor'});d=f.read();assert.equal(d.cars[0].technical.motor,'Spare');assert.equal(W.available(d,d.parts.find(p=>p.id===f.spare)),4);
});
test('assembly creation, transfer, replacement, storage and dismantling retain dedicated stock',t=>{
 const f=fixture(t),a=f.run('assembly.create',{name:'Rear',components:[{partId:f.spare,quantity:2,field:'rearTyres',position:'Rear'}]});
 f.run('assembly.install',{id:a,carId:f.car});f.run('assembly.install',{id:a,carId:f.other,allowTransfer:true});
 let d=f.read(),old=d.assemblies[0].components[0].partId;assert.throws(()=>f.run('part.save',{id:old,data:{name:'Illegal',quantity:2,tracking:'quantity'}}),/Dismantle/);
 f.run('assembly.replace',{id:a,componentId:old,partId:f.spare,confirmed:true});d=f.read();assert.equal(d.assemblies[0].history[0].before[0].partId,old);assert.equal(W.available(d,d.parts.find(p=>p.id===old)),2);
 f.run('assembly.remove',{id:a});f.run('assembly.dismantle',{id:a});d=f.read();assert.ok(d.assemblies[0].dismantled);assert.equal(d.cars[1].technical.rearTyres,'');
});
test('setup application transfers selected parts and returns replaced stock atomically',t=>{
 const f=fixture(t),before=f.read(),source=before.installations.find(i=>i.carId===f.other);
 assert.throws(()=>f.run('setup.apply',{id:f.setup,selections:{0:'i:'+source.id},confirmed:true}),/transfer/);assert.deepEqual(f.read(),before);
 f.run('setup.apply',{id:f.setup,selections:{0:'i:'+source.id},confirmed:true,allowTransfers:true});const d=f.read();assert.equal(d.cars[1].technical.motor,'');assert.equal(d.installations.filter(i=>!i.removed).length,1);assert.equal(d.parts.at(-1).condition,'Used');assert.deepEqual(d.setups,before.setups);
});
test('setup job substitution, snapshots and completion retain checklist and immutable target',t=>{
 const f=fixture(t),j=f.run('job.start',{setupId:f.setup});f.run('job.remove',{id:j,installationId:f.read().installations[0].id,confirmed:true});f.run('job.fit',{id:j,key:'0',selection:'p:'+f.spare,confirmed:true});
 const check=f.open();act(check,'planning.job.save',{jobId:j,priority:'Normal',targetDate:'',waiting:false,checklist:[{text:'Check mesh',done:false}]});assert.throws(()=>f.run('job.complete',{id:j,confirmed:true}),/checklist/);
 const p=f.read().planning.jobs[0];act(f.open(),'planning.job.check',{jobId:j,id:p.checklist[0].id,done:true});f.run('job.complete',{id:j,confirmed:true});const d=f.read();assert.equal(d.jobs[0].status,'completed');assert.equal(d.jobs[0].actual.installations[0].partId,f.spare);assert.equal(d.jobs[0].target.installations[0].partId,f.p);
});
test('draft edits, requirements and receipts preserve manual decisions and keep stock unreserved',t=>{
 const f=fixture(t),catalogue=f.run('part.save',{data:{name:'Catalogue',quantity:0,tracking:'quantity'}}),draft=f.run('build.draft.save',{data:build(catalogue,'Planned',2)}),line=f.read().planning.shopping[0];
 act(f.open(),'planning.checklist.edit',{id:line.id,quantity:7});f.run('build.draft.save',{id:draft,data:build(catalogue,'Renamed plan',4)});let d=f.read();assert.equal(d.planning.shopping[0].purchase.checklist.quantity,7);assert.equal(d.parts.find(p=>p.id===catalogue).quantity,0);
 f.run('planning.shopping.applyRequirements',{kind:'build',sourceId:draft,partIds:[catalogue]});assert.equal(f.read().planning.shopping[0].purchase.checklist.quantity,4);
 act(f.open(),'planning.checklist.done',{id:line.id,done:true,addStock:false});f.run('part.save',{id:catalogue,data:{name:'Catalogue',quantity:1,tracking:'quantity'}});d=f.read();assert.equal(d.planning.shopping[0].purchase.checklist.done,true);
 f.run('build.draft.delete',{id:draft});d=f.read();assert.equal(d.planning.shopping[0].purchase.requirement.state,'cancelled');assert.equal(d.planning.shopping[0].purchase.checklist.done,true);
});
test('build completion and rebuild preserve old photos and history while committing a linked successor',t=>{
 const f=fixture(t),ordinary=f.run('build.draft.save',{data:build(f.spare)}),newCar=f.run('build.create',{draftId:ordinary,data:build(f.spare),confirmed:true});assert.equal(f.read().cars.find(c=>c.id===newCar).technical.motor,'Spare');
 const draft=f.run('rebuild.start',{carId:f.car}),before=f.read(),data=structuredClone(before.buildDrafts.find(d=>d.id===draft).data);data.rebuild.reuse=before.installations.filter(i=>i.carId===f.car&&!i.removed).map(i=>i.id);
 const successor=f.run('build.create',{draftId:draft,data,confirmed:true}),after=f.read();assert.equal(after.cars[0].rebuild.to.id,successor);assert.equal(after.cars.find(c=>c.id===successor).picture,before.cars[0].picture);assert.equal(after.jobs[0].status,'completed');assert.deepEqual(after.setups.find(s=>s.id===f.setup),before.setups.find(s=>s.id===f.setup));assert.equal(after.buildDrafts.length,0);
});
test('split deliveries and corrections retain source allocations; competing stock blocks reversal',t=>{
 const f=fixture(t),a=act(f.open(),'planning.shopping.add',{partId:f.spare,quantity:3}),b=act(f.open(),'planning.shopping.add',{partId:f.spare,quantity:4});
 f.run('planning.order.place',{confirmed:true,entries:[{id:a,quantity:3},{id:b,quantity:4}]});f.run('planning.delivery.receive',{confirmed:true,entries:[{id:a,quantity:2},{id:b,quantity:3}]});let d=f.read();assert.equal(d.parts.find(p=>p.id===f.spare).quantity,10);
 const receipt=d.planning.shopping.find(l=>l.id===a).purchase.receipts[0];f.run('planning.receipt.correct',{id:a,receiptId:receipt.id,quantity:1,confirmed:true,reason:'Correction',restoreOrdered:true});d=f.read();assert.equal(d.parts.find(p=>p.id===f.spare).quantity,9);assert.equal(d.planning.shopping.find(l=>l.id===a).received,1);
 const before=f.read();assert.throws(()=>f.run('planning.delivery.receive',{confirmed:true,entries:[{id:a,quantity:1},{id:b,quantity:99}]}),/exceeds/);assert.deepEqual(f.read(),before);
});
test('global draft limits, missing stock, competing jobs and stale writes remain protected',t=>{
 const f=fixture(t),j=f.run('job.start',{kind:'general',carId:f.car,name:'First'});assert.throws(()=>f.run('job.start',{kind:'general',carId:f.car,name:'Second'}),/active workshop/);f.run('job.cancel',{id:j,confirmed:true});
 const d=f.open(),stale=d.data.revision;f.run('part.install',{carId:f.other,partId:f.spare,quantity:1});assert.throws(()=>d.mutate('part.install',{revision:stale,carId:f.other,partId:f.spare,quantity:1}),/changed/);
 const full=new Store(f.file);full.transact(db=>{db.buildDrafts=Array.from({length:100},(_,i)=>({id:'draft-'+i,created:'now',updated:'now',data:build(f.spare,'Other')}));});assert.throws(()=>act(f.open(),'build.draft.save',{data:build(f.p,'Over limit')}),/buildDrafts|build drafts/);assert.equal(f.read().buildDrafts.length,100);
 assert.throws(()=>act(f.open(),'build.draft.save',{id:'draft-0',data:build('missing')}),/no longer exists/);
});
test('failed persistence and durable retry preserve atomic stock and rebuild writes',t=>{
 const f=fixture(t),before=f.read(),broken=f.open();broken.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(broken,'setup.apply',{id:f.setup,selections:{0:'p:'+f.spare},confirmed:true}),/Disk full/);assert.deepEqual(f.read(),before);
 const R=require('../src/command-receipts.cjs'),d=f.open(),command={id:'fit-once',databaseId:d.data.id,epoch:d.deferredState.token.epoch,action:'part.install',payload:{revision:d.data.revision,carId:f.car,partId:f.spare,quantity:1,field:'rearTyres'}};R.execute(d,command);R.execute(f.open(),command);assert.equal(f.read().installations.filter(i=>i.partId===f.spare).length,1);
});
test('sparse saves preserve legacy active installations and reject historical tracking changes',t=>{
 const f=fixture(t),full=new Store(f.file);full.transact(db=>{db.installations[0].removed='';});
 assert.throws(()=>f.run('part.save',{id:f.p,data:{name:'Motor',quantity:1,tracking:'quantity'}}),/stock/);
 f.run('part.remove',{id:f.read().installations[0].id,destination:'discarded'});f.run('part.remove',{id:f.read().installations[1].id,destination:'discarded'});
 assert.throws(()=>f.run('part.save',{id:f.p,data:{name:'Motor',quantity:1,tracking:'individual'}}),/tracking after/);
 const a=f.run('assembly.create',{name:'Historic assembly',components:[{partId:f.spare,quantity:1,position:'Rear'}]}),component=f.read().assemblies[0].components[0].partId;
 f.run('assembly.replace',{id:a,componentId:component,partId:f.spare,confirmed:true});f.run('assembly.dismantle',{id:a});
 assert.throws(()=>f.run('part.save',{id:component,data:{name:'Spare',quantity:1,tracking:'individual'}}),/tracking after/);
});
test('legacy shopping upgrade preserves every old line and deleted requirements never regenerate',t=>{
 const f=fixture(t),full=new Store(f.file);full.transact(db=>{db.planning.shopping=[{id:'legacy-a',partId:f.p,jobId:'',quantity:2,received:1,notes:'Keep legacy receipt',supplier:'Shop',date:'',created:'then',updated:'then'},{id:'legacy-b',partId:f.spare,jobId:'',quantity:2,received:0,notes:'Other legacy line',supplier:'Other shop',date:'',created:'then',updated:'then'}];});
 f.run('planning.delivery.receive',{confirmed:true,entries:[{id:'legacy-b',quantity:1}]});let db=f.read();assert.equal(db.planning.purchasingVersion,1);assert.equal(db.planning.shopping[0].purchase.legacyReceived,1);assert.equal(db.planning.shopping[0].notes,'Keep legacy receipt');
 const p=f.run('part.save',{data:{name:'Wanted',quantity:0,tracking:'quantity'}}),draft=f.run('build.draft.save',{data:build(p)}),line=f.read().planning.shopping.find(l=>l.buildId===draft);
 act(f.open(),'planning.checklist.delete',{id:line.id});f.run('build.draft.save',{id:draft,data:build(p,'Changed',3)});f.run('part.save',{id:p,data:{name:'Wanted',quantity:1,tracking:'quantity'}});db=f.read();assert.equal(db.planning.shopping.filter(l=>l.buildId===draft).length,1);assert.equal(db.planning.shopping.find(l=>l.id===line.id).purchase.checklist.deleted,true);
});
test('stock cannot be double-fitted by concurrent deferred writers',async t=>{
 const f=fixture(t),single=f.run('part.save',{data:{name:'One motor',quantity:1,tracking:'individual'}}),left=f.open(),right=f.open();
 const settled=await Promise.allSettled([left,right].map((s,i)=>s.mutateAsync('part.install',{revision:s.data.revision,carId:i?f.other:f.car,partId:single,quantity:1},{snapshot:false})));
 assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal(settled.filter(r=>r.status==='rejected').length,1);const db=f.read();validateDatabase(db);assert.equal(db.installations.filter(i=>i.partId===single&&!i.removed).length,1);
});
test('physical car changes precisely invalidate catalogue cars without changing racing results',t=>{
 const f=fixture(t),api=require('../src/scalable-api.cjs'),d=f.open(),get=route=>api.handle(d,'GET',new URL('http://localhost/v1/scalable'+route),{browse:true,timingResults:true},d.data.id);
 let cursor=get('/status').cursor;act(d,'part.save',{id:f.p,data:{name:'Motor',quantity:6,tracking:'quantity'}});assert.deepEqual(get('/changes?kind=cars&cursor='+cursor).entries,[]);
 cursor=get('/status').cursor;act(d,'part.install',{carId:f.car,partId:f.spare,quantity:1,field:'rearTyres'});assert.deepEqual(get('/changes?kind=cars&cursor='+cursor).entries,[{carId:f.car,operation:'invalidate'}]);assert.deepEqual(get('/changes?kind=results&cursor='+cursor).entries,[]);
});
test('sparse creation retains newest-first job and build-draft ordering',t=>{
 const f=fixture(t),first=f.run('job.start',{kind:'general',carId:f.car,name:'Older'});f.run('job.cancel',{id:first,confirmed:true});
 const next=f.run('job.start',{kind:'general',carId:f.car,name:'Newest'});assert.deepEqual(f.read().jobs.map(j=>j.id),[next,first]);
 const oldDraft=f.run('build.draft.save',{data:build(f.p,'Older draft')}),newDraft=f.run('build.draft.save',{data:build(f.spare,'Newest draft')});assert.deepEqual(f.read().buildDrafts.map(d=>d.id),[newDraft,oldDraft]);
});
