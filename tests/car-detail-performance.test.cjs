'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
const png='data:image/png;base64,AAAA',other='data:image/png;base64,BBBB';
const pdf=()=>{const b=Buffer.from('%PDF-1.4\n%%EOF');return {name:'manual.pdf',mime:'application/pdf',size:b.length,data:b.toString('base64')};};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-car-detail-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));
 const car=act(s,'car.save',{data:{name:'Target',picture:png,photos:[{id:'detail',name:'Detail',data:other}],technical:{weight:'80'}}});
 const part=act(s,'part.save',{data:{name:'Motor',quantity:3,tracking:'quantity'}});act(s,'part.install',{carId:car,partId:part,quantity:1,field:'motor'});
 act(s,'setup.save',{carId:car,name:'Original'});const setup=s.data.setups[0].id,job=act(s,'job.start',{kind:'general',carId:car,name:'Service'});
 const guide=act(s,'guide.add',{title:'Original guide',carId:car,document:pdf()});
 s.transact(d=>{for(let i=0;i<80;i++){d.cars.push({...d.cars[0],id:'car-'+i,name:'Other '+i});d.parts.push({...d.parts[0],id:'part-'+i});d.setups.push({...d.setups[0],id:'setup-'+i,carId:'car-'+i});d.documents.push({...d.documents[0],id:'doc-'+i,carId:'car-'+i});d.jobs.push({...d.jobs[0],id:'job-'+i,carId:'car-'+i});}d.planning.futureOption={keep:true};});
 return {s,car,part,setup,job,guide,open:()=>new Store(s.file,{deferred:true}),read:()=>new Store(s.file).snapshot()};
}
function cold(state){for(const k of ['cars','parts','supplies','installations','assemblies','setups','tests','jobs','events','documents','buildDrafts','timing.sessions','planning.focus'])assert.ok(!state.stats.loadedSections.includes(k),k+JSON.stringify(state.stats));assert.ok(state.stats.recordReads<25,JSON.stringify(state.stats));}
const revision=(s,id)=>s.deferredState.read(r=>r.one('cars',id).revision);

test('technical edits enforce installed fields while leaving unrelated history and stock cold',t=>{
 const f=fixture(t),before=f.read(),d=f.open(),state=d.deferredState;
 act(d,'car.save',{id:f.car,revision:revision(d,f.car),data:{technical:{weight:'82'}}});cold(state);
 const after=f.read();validateDatabase(after);assert.equal(after.cars[0].technical.weight,'82');for(const k of ['parts','installations','jobs','setups','documents'])assert.deepEqual(after[k],before[k]);assert.deepEqual(after.cars.slice(1),before.cars.slice(1));
 const bad=f.open();assert.throws(()=>act(bad,'car.save',{id:f.car,revision:revision(bad,f.car),data:{technical:{motor:'Invented replacement'}}}),/installed component/);cold(bad.deferredState);assert.deepEqual(f.read(),after);
});

test('manual tests capture selected or current configurations without loading other cars or history',t=>{
 const f=fixture(t);for(const setupId of ['',f.setup]){const d=f.open(),state=d.deferredState;act(d,'test.add',{carId:f.car,setupId,track:'Circuit',lane:'2',driver:'James',laps:'10',best:'6.5'});cold(state);const after=f.read(),record=after.tests[0];validateDatabase(after);assert.equal(record.installations[0].partId,f.part);assert.equal(record.configurationSource,setupId?'saved':'current');assert.equal(record.jobId,setupId?undefined:f.job);}
 const before=f.read();assert.throws(()=>act(f.open(),'test.add',{carId:f.car,setupId:'setup-0'}),/belong/);assert.deepEqual(f.read(),before);
});

test('photo replacement and sparse framing changes retain other cars and original full-size assets',t=>{
 const f=fixture(t);for(const [carId,photoKey]of [['car-0','main'],[f.car,'main'],['car-1','main'],[f.car,'detail']])act(f.s,'planning.focus',{carId,photoKey,x:20,y:40});
 const untouched=f.read().planning.focus.filter(v=>v.carId!==f.car);
 let d=f.open(),state=d.deferredState;act(d,'car.save',{id:f.car,revision:revision(d,f.car),data:{picture:other}});cold(state);
 let after=f.read();assert.deepEqual(after.planning.focus.filter(v=>v.carId!==f.car),untouched);assert.equal(after.planning.focus.filter(v=>v.carId===f.car).length,1);assert.equal(after.cars[0].photos[0].data,other);
 for(const key of ['main','detail','main']){d=f.open();state=d.deferredState;act(d,'planning.focus',{carId:f.car,photoKey:key,x:70,y:60});cold(state);validateDatabase(f.read());}
 d=f.open();state=d.deferredState;act(d,'car.save',{id:f.car,revision:revision(d,f.car),data:{photos:[]}});cold(state);after=f.read();validateDatabase(after);assert.deepEqual(after.planning.focus.filter(v=>v.carId!==f.car),untouched);assert.equal(after.planning.focus.find(v=>v.carId===f.car).photoKey,'main');assert.deepEqual(after.planning.futureOption,{keep:true});
});

test('guides move between cars and documents delete without loading attachment collections',t=>{
 const f=fixture(t),before=f.read();let d=f.open(),state=d.deferredState;
 act(d,'guide.edit',{id:f.guide,title:'Renamed',carId:'car-0'});cold(state);let after=f.read();validateDatabase(after);assert.equal(after.documents[0].data,before.documents[0].data);assert.equal(after.documents[0].carId,'car-0');assert.equal(after.cars[0].revision,before.cars[0].revision+1);assert.equal(after.cars[1].revision,before.cars[1].revision+1);
 d=f.open();state=d.deferredState;act(d,'document.add',{carId:f.car,revision:revision(d,f.car),title:'Receipt',document:pdf()});cold(state);after=f.read();const id=after.documents.at(-1).id;
 d=f.open();state=d.deferredState;act(d,'document.remove',{id,revision:revision(d,f.car)});cold(state);assert.equal(f.read().documents.length,before.documents.length);
 d=f.open();state=d.deferredState;act(d,'guide.remove',{id:f.guide});cold(state);after=f.read();validateDatabase(after);assert.deepEqual(after.documents,before.documents.slice(1));
});

test('new owned and Wishlist cars append without reading existing cars or stock',t=>{
 const f=fixture(t),before=f.read();for(const collectionStatus of ['collection','wishlist']){const d=f.open(),state=d.deferredState;const id=act(d,'car.save',{data:{name:'New '+collectionStatus,collectionStatus}});cold(state);const after=f.read();validateDatabase(after);assert.equal(after.cars.find(c=>c.id===id).collectionStatus,collectionStatus);if(collectionStatus==='wishlist')assert.throws(()=>act(f.open(),'test.add',{carId:id,track:'No'}),/Wishlist/);}
 const after=f.read();assert.deepEqual(after.cars.slice(0,before.cars.length),before.cars);assert.deepEqual(after.parts,before.parts);
});

test('technical and media editors, manual selectors and lane records leave unrelated collections cold',t=>{
 const f=fixture(t);act(f.s,'test.add',{carId:f.car,track:'Circuit',lane:'2',best:'6.5'});f.s.transact(d=>{d.customFields.push({id:'paint',label:'Paint finish',type:'choice'});d.cars.at(-1).custom={paint:'Metallic'};});
 for(const action of ['edit-car','add-car','main-photo','add-photo','delete-photo','photo-focus','add-test','attach-document','guide-add','guide-edit','guide-remove','remove-document']){
  const d=f.open(),state=d.deferredState,data=view(d,{page:'Cars',carId:f.car,section:'Performance',editor:{action,id:action.includes('guide')||action==='remove-document'?f.guide:action==='add-car'?undefined:action==='delete-photo'?'detail':f.car}});cold(state);
  if(action==='add-test'){assert.equal(data.setups.length,1);assert.equal(data.setups[0].id,f.setup);assert.equal(data.setups[0].installations,undefined);}
  if(action==='edit-car'||action==='add-car')assert.deepEqual(data._view.carCustomChoices.paint,['Metallic']);
  if(action==='guide-edit'){assert.equal(data.documents.length,1);assert.equal(data.documents[0].data,undefined);assert.equal(data.cars.length,81);}
 }
 for(const section of ['Technical & parts','Performance']){const d=f.open(),state=d.deferredState,data=view(d,{page:'Cars',carId:f.car,section,historyView:true});cold(state);if(section==='Technical & parts'){assert.equal(data.installations.length,1);assert.equal(data.parts[0].id,f.part);}else{assert.equal(data._view.lanes[0].best,6500);assert.equal(data._view.lanes[0].lane,'2');}}
});

test('photo framing reuses hashes without reading unrelated or unchanged original image bytes',t=>{
 const f=fixture(t),lazy=require('../src/lazy-assets.cjs');act(f.s,'planning.focus',{carId:f.car,photoKey:'detail',x:20,y:30});lazy.clearCache();const d=f.open(),state=d.deferredState;
 const newPhoto='data:image/png;base64,CCCC';act(d,'car.save',{id:f.car,revision:revision(d,f.car),data:{picture:newPhoto}});cold(state);assert.equal(lazy.stats().reads,0);const after=f.read();assert.equal(after.cars[0].photos[0].data,other);assert.equal(after.planning.focus[0].photoKey,'detail');
});

test('technical edits notify only their car; manual records leave the racing-results feed intact',t=>{
 const f=fixture(t),api=require('../src/scalable-api.cjs');
 const get=(d,route)=>api.handle(d,'GET',new URL('http://localhost/v1/scalable'+route),{browse:true,timingResults:true},d.data.id);
 let d=f.open(),cursor=get(d,'/status').cursor;act(d,'car.save',{id:f.car,revision:revision(d,f.car),data:{technical:{weight:'82'}}});
 assert.deepEqual(get(d,'/changes?kind=cars&cursor='+cursor).entries,[{carId:f.car,operation:'invalidate'}]);assert.deepEqual(get(d,'/changes?kind=results&cursor='+cursor).entries,[]);
 d=f.open();cursor=get(d,'/status').cursor;act(d,'test.add',{carId:f.car,track:'Manual'});assert.deepEqual(get(d,'/changes?kind=results&cursor='+cursor).entries,[]);
});

test('saved assembly snapshots remain valid after the assembly moves to another car',t=>{
 const f=fixture(t),s=f.s,axle=act(s,'part.save',{data:{name:'Axle',quantity:1,tracking:'quantity'}}),wheel=act(s,'part.save',{data:{name:'Wheels',quantity:2,tracking:'quantity'}});
 const assembly=act(s,'assembly.create',{name:'Rear assembly',components:[{partId:axle,quantity:1,field:'rearAxle',position:'Rear'},{partId:wheel,quantity:2,position:'Wheels'}]});act(s,'assembly.install',{id:assembly,carId:f.car});act(s,'setup.save',{carId:f.car,name:'Assembly snapshot'});const setup=s.data.setups[0];
 act(s,'assembly.install',{id:assembly,carId:'car-0',allowTransfer:true});
 const d=f.open(),state=d.deferredState;act(d,'test.add',{carId:f.car,setupId:setup.id,track:'Historic'});cold(state);const after=f.read();validateDatabase(after);assert.deepEqual(after.tests[0].installations,setup.installations);assert.equal(after.assemblies[0].carId,'car-0');
 const edit=f.open();assert.throws(()=>act(edit,'car.save',{id:'car-0',revision:revision(edit,'car-0'),data:{technical:{rearAxle:'Wrong'}}}),/installed component/);cold(edit.deferredState);
});

test('document capacity counts include omitted records and failed moves leave both cars intact',t=>{
 const f=fixture(t);f.s.transact(d=>{for(let i=1;i<100;i++)d.documents.push({...d.documents[1],id:'capacity-'+i});});const before=f.read();
 assert.throws(()=>act(f.open(),'guide.edit',{id:f.guide,title:'Move',carId:'car-0'}),/100 documents/);
 const d=f.open();assert.throws(()=>act(d,'document.add',{carId:'car-0',revision:revision(d,'car-0'),title:'Over capacity',document:pdf()}),/100 documents/);assert.deepEqual(f.read(),before);cold(d.deferredState);
});

test('stale concurrent writes, disk failure and durable retries preserve car and media data',async t=>{
 const f=fixture(t),before=f.read(),broken=f.open();broken.persist=()=>{throw Error('disk full');};assert.throws(()=>act(broken,'car.save',{id:f.car,revision:revision(broken,f.car),data:{picture:other}}),/disk full/);assert.deepEqual(f.read(),before);
 const left=f.open(),right=f.open(),rev=revision(left,f.car);const settled=await Promise.allSettled([left.mutateAsync('car.save',{id:f.car,revision:rev,data:{technical:{weight:'82'}}},{snapshot:false}),right.mutateAsync('car.save',{id:f.car,revision:rev,data:{technical:{weight:'83'}}},{snapshot:false})]);assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal(settled.filter(r=>r.status==='rejected').length,1);
 const receipts=require('../src/command-receipts.cjs'),d=f.open(),command={id:'manual-once',databaseId:d.data.id,epoch:d.deferredState.token.epoch,action:'test.add',payload:{revision:d.data.revision,carId:f.car,track:'Only once'}};receipts.execute(d,command);receipts.execute(f.open(),command);const after=f.read();assert.equal(after.tests.length,1);validateDatabase(after);assert.equal(after.cars[0].picture,before.cars[0].picture);
});

test('Dealership photo approval commits sparse framing and the review receipt together',async t=>{
 const f=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),dir=path.dirname(f.s.file);let net=new Network(f.s),club=new Club(f.s,net,dir);club.enable('Host','Test password',false);club.close();net.close();
 for(const id of ['car-0',f.car,'car-1'])act(f.s,'planning.focus',{carId:id,photoKey:'main',x:10,y:20});const before=f.read();
 const d=f.open();net=new Network(d);club=new Club(d,net,dir);
 try{
  const queued=await club.propose('car.save',{id:f.car,revision:revision(d,f.car),data:{picture:other}},{snapshot:false});assert.equal(queued.queued,true);
  const proposal=d.data.club.proposals[0],preview=club.preview(proposal.id);assert.equal(preview.error,'');await club.reviewAsync({id:proposal.id,token:preview.token,decision:'accept'});
  const after=f.read();validateDatabase(after);assert.equal(after.cars[0].picture,other);assert.deepEqual(after.planning.focus,before.planning.focus.filter(v=>v.carId!==f.car));assert.deepEqual(after.cars.slice(1),before.cars.slice(1));assert.equal(after.club.proposals[0].status,'accepted');
 }finally{club.close();await club.idle();net.close();}
});
