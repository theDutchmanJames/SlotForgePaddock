'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),Model=require('../renderer/build-model.js');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-routine-dealership-')),instances=[];
 const make=name=>{const dir=path.join(root,name),store=new Store(path.join(dir,'db.sqlite'));store.mutate('car.save',{data:{name:'Original car'}});const net=new Network(store),club=new Club(store,net,dir),x={store,net,club};instances.push(x);return x;};
 t.after(async()=>{for(const x of instances){x.club.close();await x.club.idle();await x.net.stop();x.net.close();}fs.rmSync(root,{recursive:true,force:true});});
 const h=make('host'),c=make('member');h.club.enable('Host','test password');await h.net.start();await c.club.connect({address:'127.0.0.1:'+h.net.port,code:h.net.clubCode,name:'Member'});return {h,c};
}

test('reviewed car deletion preserves neighboring plans through approval and replica restart',async t=>{
 const {h,c}=await fixture(t),s=h.store,act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const first=s.data.cars[0].id,second=act('car.save',{data:{name:'Retained car'}});
 for(const carId of [first,second]){const jobId=act('job.start',{carId,kind:'general',name:'Work'});act('planning.job.save',{jobId,priority:'Normal',targetDate:'',waiting:false,checklist:[]});}
 const surviving=s.data.planning.jobs[1];await c.club.catchUp(s.data.revision,true);
 const result=await c.club.mutate('car.delete',{id:first,revision:c.club.store.data.revision,confirmed:true,confirmName:'Original car'});assert.equal(result.queued,true);assert.ok(s.data.cars.some(x=>x.id===first));
 const proposal=s.data.club.proposals[0],preview=h.club.preview(proposal.id);assert.equal(preview.error,'');
 await h.club.reviewAsync({id:proposal.id,token:preview.token,decision:'accept'});await c.club.catchUp(s.data.revision,true);
 for(const db of [s.data,c.club.store.data,new Store(s.file).data,new Store(c.club.store.file).data]){assert.ok(!db.cars.some(x=>x.id===first));assert.deepEqual(db.planning.jobs,[surviving]);assert.equal(db.club.proposals.find(p=>p.id===proposal.id).status,'accepted');}
 await c.club.mutate('planning.job.save',{revision:c.club.store.data.revision,jobId:surviving.jobId,priority:'High',targetDate:'',waiting:false,checklist:[]});assert.equal(s.data.planning.jobs[0].priority,'High');
});

test('sparse job plans and progress notes replicate without replacing another plan or duplicating retries',async t=>{
 const {h,c}=await fixture(t),s=h.store,act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const first=act('job.start',{carId:s.data.cars[0].id,kind:'general',name:'First plan'});
 act('planning.job.save',{jobId:first,priority:'Normal',targetDate:'',waiting:false,checklist:[{id:'first-step',text:'Keep me'}]});
 const car=act('car.save',{data:{name:'Second car'}}),job=act('job.start',{carId:car,kind:'general',name:'Second plan'});
 act('planning.job.save',{jobId:job,priority:'Normal',targetDate:'',waiting:false,checklist:[{id:'second-step',text:'Inspect'}]});
 const original=JSON.parse(JSON.stringify(s.data.planning.jobs[0]));await c.club.catchUp(s.data.revision,true);
 await c.club.mutate('planning.job.check',{revision:c.club.store.data.revision,jobId:job,id:'second-step',done:true});
 await c.club.mutate('job.note',{revision:c.club.store.data.revision,id:job,note:'Inspection recorded'});
 assert.deepEqual(s.data.planning.jobs[0],original);assert.equal(s.data.planning.jobs[1].checklist[0].done,true);assert.equal(s.data.jobs.find(j=>j.id===job).log.length,1);
 assert.deepEqual(c.club.store.data.planning.jobs,s.data.planning.jobs);assert.equal(s.data.club.proposals.length,0);
 assert.deepEqual(new Store(s.file).data.planning.jobs,s.data.planning.jobs);
});

test('Wishlist additions and edits replicate directly without becoming owned cars',async t=>{
 const {h,c}=await fixture(t);assert.equal(c.club.device.pair.wishlist,1);
 const added=await c.club.mutate('car.save',{data:{name:'Wanted GT',collectionStatus:'wishlist',price:'50'}});assert.equal(added.queued,false);
 const id=added.result;assert.equal(h.store.data.cars.find(x=>x.id===id).collectionStatus,'wishlist');assert.equal(c.club.store.data.cars.find(x=>x.id===id).collectionStatus,'wishlist');
 await c.club.mutate('car.save',{id,revision:1,data:{price:'55',ownership:'Ordered'}});assert.equal(h.store.data.cars.find(x=>x.id===id).price,'55');
 assert.equal(h.store.data.club.proposals.length,0);assert.equal(require('../src/store.cjs').publicCatalogue(h.store.data).cars.length,1);
 const before=h.store.snapshot();await assert.rejects(c.club.mutate('car.save',{id,revision:2,data:{collectionStatus:'collection'}}),/membership cannot/);assert.deepEqual(h.store.snapshot(),before);
});

test('an older dealership host cannot silently turn a Wishlist addition into an owned car',async t=>{
 const {h,c}=await fixture(t);delete c.club.device.pair.wishlist;const before=h.store.snapshot(),pending=c.club.device.outbox.length;
 await assert.rejects(c.club.mutate('car.save',{data:{name:'Wanted GT',collectionStatus:'wishlist'}}),/Update the dealership host/);
 assert.deepEqual(h.store.snapshot(),before);assert.equal(c.club.device.outbox.length,pending);
 await c.club.reconnect();assert.equal(c.club.device.pair.wishlist,1);
 const created=await c.club.mutate('car.save',{data:{name:'Wanted GT',collectionStatus:'wishlist'}});assert.equal(created.queued,false);assert.equal(h.store.data.cars.find(x=>x.id===created.result).collectionStatus,'wishlist');
});

test('Wishlist purchases stay pending until atomic approval and replicate the same identity',async t=>{
 const {h,c}=await fixture(t),id=(await c.club.mutate('car.save',{data:{name:'Wanted GT',collectionStatus:'wishlist',price:'50',technical:{motor:'Original'}}})).result;
 assert.equal(c.club.device.pair.wishlistPurchases,1);
 const payload={id,revision:1,confirmed:true,details:{price:'45',seller:'Shop'}},r=await c.club.mutate('car.purchase',payload);
 assert.equal(r.queued,true);const p=h.store.data.club.proposals[0];assert.equal(p.action,'car.purchase');assert.equal(h.store.data.cars.find(x=>x.id===id).collectionStatus,'wishlist');assert.equal(require('../src/view-query.cjs').view(h.store,{page:'Cars',carId:id})._view.wishlistPurchasePending,true);
 await c.club.catchUp(h.store.data.revision,true);await c.club.mutate('car.purchase',payload);assert.equal(h.store.data.club.proposals.length,1);
 await assert.rejects(c.club.request('/v1/club/commands',{...p,id:'direct-purchase',direct:true}),/needs Review/);
 await h.club.mutate('settings.save',{name:'Unrelated update'});
 const preview=h.club.preview(p.id);assert.equal(preview.error,'');h.club.review({id:p.id,token:preview.token,decision:'accept',confirmConflict:true});await c.club.catchUp(h.store.data.revision,true);
 const car=h.store.data.cars.find(x=>x.id===id);assert.equal(car.collectionStatus,'collection');assert.equal(car.price,'45');assert.equal(car.ownership,'Owned');assert.deepEqual(car.technical,{motor:'Original'});assert.deepEqual(c.club.store.data.cars.find(x=>x.id===id),car);
 assert.equal(h.store.data.events.filter(e=>e.carId===id&&e.type==='purchase').length,1);assert.equal(require('../src/view-query.cjs').view(h.store,{page:'Cars',carId:id})._view.wishlistPurchasePending,false);
 const original={...p};for(const key of ['status','received','receiptHash','reviewed','reviewer'])delete original[key];const receipt=await h.club.receiveAsync(original);assert.equal(receipt.status,'accepted');assert.equal(receipt.duplicate,true);
});

test('rejected and stale Wishlist purchases leave the car untouched, including after restart',async t=>{
 const {h,c}=await fixture(t),id=(await c.club.mutate('car.save',{data:{name:'Wanted GT',collectionStatus:'wishlist',price:'50'}})).result;
 await h.club.mutate('car.purchase',{id,revision:1,confirmed:true,details:{price:'45'}});let p=h.store.data.club.proposals[0],preview=h.club.preview(p.id);
 h.club.review({id:p.id,token:preview.token,decision:'reject'});assert.equal(h.store.data.cars.find(x=>x.id===id).price,'50');assert.equal(h.store.data.cars.find(x=>x.id===id).collectionStatus,'wishlist');
 await h.club.mutate('car.purchase',{id,revision:1,confirmed:true});p=h.store.data.club.proposals[0];await h.club.mutate('car.save',{id,revision:1,data:{price:'60'}});
 preview=h.club.preview(p.id);assert.match(preview.error,/car changed/);const before=h.store.snapshot();assert.throws(()=>h.club.review({id:p.id,token:preview.token,decision:'accept',confirmConflict:true}),/car changed/);assert.deepEqual(h.store.snapshot(),before);
 assert.equal(new Store(h.store.file).data.cars.find(x=>x.id===id).collectionStatus,'wishlist');assert.equal(h.store.data.events.filter(e=>e.type==='purchase').length,0);
});

test('older hosts are rejected before purchase queuing and reconnect refreshes capability',async t=>{
 const {h,c}=await fixture(t),id=(await c.club.mutate('car.save',{data:{name:'Wanted',collectionStatus:'wishlist'}})).result;delete c.club.device.pair.wishlistPurchases;
 await assert.rejects(c.club.mutate('car.purchase',{id,revision:1,confirmed:true}),/Update the dealership host/);assert.equal(c.club.device.outbox.length,0);assert.equal(h.store.data.club.proposals.length,0);
 await c.club.reconnect();assert.equal(c.club.device.pair.wishlistPurchases,1);assert.equal((await c.club.mutate('car.purchase',{id,revision:1,confirmed:true})).queued,true);
});

test('member lists, free-text and supply purchases save directly and retain their links',async t=>{
 const {h,c}=await fixture(t),act=async(action,p={})=>(await c.club.mutate(action,{revision:c.club.store.data.revision,...p})).result;
 const list=await act('planning.list.save',{name:'Club shopping'}),supply=await act('supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:0}});
 const id=await act('planning.shopping.add',{item:{kind:'free',name:'Bearing oil',maker:'',reference:''},listId:list,quantity:2});
 await act('planning.shopping.edit',{id,item:{kind:'supply',id:supply},supplier:'Local shop'});await act('planning.receive',{shoppingId:id,quantity:1,confirmed:true});
 assert.equal(h.store.data.club.proposals.length,0);assert.equal(h.store.data.supplies[0].quantity,1);assert.equal(h.store.data.planning.shopping[0].purchase.listId,list);assert.deepEqual(c.club.store.data.planning,h.store.data.planning);
});

test('member assembly photographs are routine, preserve stock and catch conflicting host edits',async t=>{
 const {h,c}=await fixture(t),picture=require('./support/thumbnail-images.cjs')(10,10,200),other=require('./support/thumbnail-images.cjs')(11,10,60);
 const part=(await c.club.mutate('part.save',{data:{name:'Axle',quantity:1,tracking:'individual'}})).result;
 const id=(await c.club.mutate('assembly.create',{name:'Rear assembly',revision:c.club.store.data.revision,picture,components:[{partId:part,quantity:1,position:'Rear',field:''}]})).result;
 const expected=c.club.store.plan('assembly.photo',{id}),before=JSON.stringify(h.store.data.parts);
 await h.club.mutate('settings.save',{name:'Unrelated host edit'});
 const saved=await c.club.mutate('assembly.photo',{id,expected,picture:other,replaceExisting:true});assert.equal(saved.queued,false);assert.equal(h.store.data.assemblies.find(a=>a.id===id).picture,other);assert.equal(c.club.store.data.assemblies.find(a=>a.id===id).picture,other);assert.equal(JSON.stringify(h.store.data.parts),before);assert.equal(h.store.data.club.proposals.length,0);
 await assert.rejects(c.club.mutate('assembly.photo',{id,expected,picture:'',removeConfirmed:true}),/photograph changed/);
});

test('an older host cannot silently discard a photo during assembly creation',async t=>{
 const {h,c}=await fixture(t);delete c.club.device.pair.assemblyPhotos;const before=h.store.data.revision;
 await assert.rejects(c.club.mutate('assembly.create',{revision:c.club.store.data.revision,name:'Photo assembly',picture:require('./support/thumbnail-images.cjs')(2,2,100),components:[]}),/Update the dealership host/);
 assert.equal(h.store.data.revision,before);assert.equal(c.club.device.outbox.length,0);
});
test('routine owner preferences, car fields, inventory and jobs save without a proposal',async t=>{
 const {h}=await fixture(t),s=h.store,id=s.data.cars[0].id;
 await h.club.mutate('settings.save',{revision:s.data.revision,name:'Updated library'});
 await h.club.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{raceClass:'GT3'}});
 const part=(await h.club.mutate('part.save',{revision:s.data.revision,data:{name:'Catalogue motor',quantity:0,tracking:'quantity'}})).result;
 const job=(await h.club.mutate('job.start',{revision:s.data.revision,carId:id,kind:'general',name:'Routine work'})).result;
 await h.club.mutate('planning.shopping.add',{revision:s.data.revision,partId:part,jobId:job,quantity:1});
 assert.equal(s.data.cars[0].raceClass,'GT3');assert.equal(s.data.settings.name,'Updated library');assert.equal(s.data.club.proposals.length,0);assert.equal(s.data.planning.shopping.length,1);
});
test('member saves shared fields directly and receives generated rebuild draft IDs',async t=>{
 const {h,c}=await fixture(t),s=c.club.store,car=s.data.cars[0];
 const saved=await c.club.mutate('car.save',{id:car.id,revision:car.revision,data:{raceClass:'Touring'}});assert.equal(saved.queued,false);assert.equal(h.store.data.cars[0].raceClass,'Touring');assert.equal(c.club.store.data.cars[0].raceClass,'Touring');
 const r=await c.club.mutate('rebuild.start',{revision:s.data.revision,carId:car.id});assert.equal(typeof r.result,'string');assert.equal(c.club.store.plan('rebuild.draft',{carId:car.id}).id,r.result);
 const revision=h.store.data.revision;for(let i=0;i<3;i++)assert.equal(c.club.store.plan('rebuild.draft',{carId:car.id}).id,r.result);
 assert.equal(h.store.data.revision,revision);assert.equal(h.store.data.club.proposals.length,0);assert.equal(h.store.data.buildDrafts.length,1);
});
test('completed work categories replicate with reminders without changing car or inventory',async t=>{
 const {h,c}=await fixture(t),s=c.club.store,car=s.data.cars[0],before=structuredClone(h.store.data.cars[0]);
 await c.club.mutate('work.add',{revision:s.data.revision,carId:car.id,type:'modification',category:'motor',title:'Cleaned motor',performedDate:'2026-11-14',nextDue:'2026-12-01',task:'Motor service'});
 await c.club.catchUp(h.store.data.revision,true);
 for(const store of [h.store,c.club.store]){const e=store.data.events.find(e=>e.title==='Cleaned motor');assert.equal(e.workCategory,'motor');assert.equal(e.type,'maintenance');assert.equal(e.nextDue,'2026-12-01');assert.equal(store.data.jobs.length,0);assert.equal(store.data.parts.length,0);assert.deepEqual(store.data.cars[0],before);}
});
test('new cars and saved setups still require approval; direct endpoint cannot bypass it',async t=>{
 const {h,c}=await fixture(t);const saved=await c.club.mutate('car.save',{data:{name:'Proposed car'}});assert.equal(saved.queued,true);assert.equal(h.store.data.cars.length,1);const proposal=h.store.data.club.proposals[0];
 await assert.rejects(c.club.request('/v1/club/commands',{...proposal,id:'bypass',direct:true}),/needs Review/);
 assert.equal(h.store.data.cars.length,1);assert.equal(h.store.data.club.proposals.length,1);
 assert.equal(require('../src/dealership-policy.cjs').requiresReview('setup.save'),true);assert.equal(require('../src/dealership-policy.cjs').requiresReview('build.create'),true);
});
test('lost direct acknowledgements retry one durable command and recover its generated ID',async t=>{
 const {h,c}=await fixture(t),payload={revision:c.club.store.data.revision,data:{...Model.blank(),name:'Planned build'}},request=c.club.request.bind(c.club);let first=true;
 c.club.request=async(...args)=>{const r=await request(...args);if(args[0]==='/v1/club/commands'&&first){first=false;throw Object.assign(Error('Lost response'),{retryable:true});}return r;};
 await assert.rejects(c.club.mutate('build.draft.save',payload),/Lost response/);assert.equal(h.store.data.buildDrafts.length,1);assert.equal(c.club.device.outbox.length,1);
 const id=h.store.data.buildDrafts[0].id,result=await c.club.mutate('build.draft.save',payload);assert.equal(result.result,id);assert.equal(h.store.data.buildDrafts.length,1);assert.equal(c.club.device.outbox.length,0);assert.equal(h.store.data.club.proposals.length,0);
});
test('stale routine edits fail instead of overwriting newer car fields',async t=>{
 const {h,c}=await fixture(t),old=c.club.store.data.cars[0];await h.club.mutate('car.save',{id:old.id,revision:old.revision,data:{raceClass:'Newer'}});
 await assert.rejects(c.club.mutate('car.save',{id:old.id,revision:old.revision,data:{raceClass:'Stale'}}),/changed|stale/i);assert.equal(h.store.data.cars[0].raceClass,'Newer');assert.equal(c.club.device.outbox.length,0);
});

test('background receipt reconciliation preserves a later renderer retry after compaction changes',async t=>{
 const {h,c}=await fixture(t),car=c.club.store.data.cars[0],payload={id:car.id,revision:car.revision,data:{raceClass:'GT3'}},options={commandId:require('node:crypto').randomUUID()},request=c.club.request.bind(c.club);let first=true;
 c.club.request=async(...args)=>{const result=await request(...args);if(args[0]==='/v1/club/commands'&&first){first=false;throw Object.assign(Error('Lost acknowledgement'),{retryable:true});}return result;};
 await assert.rejects(c.club.mutate('car.save',payload,options),/Lost/);await c.club.sendOutbox();assert.equal(c.club.device.outbox.length,0);const revision=h.store.data.revision;await c.club.catchUp(revision,true);await c.club.mutate('car.save',payload,options);assert.equal(h.store.data.revision,revision);assert.equal(h.store.data.cars[0].raceClass,'GT3');
 await assert.rejects(c.club.mutate('car.save',{...payload,data:{raceClass:'Other'}},options),/different content/);
});

test('routine commands enforce authentication, database identity, recovery epoch and durable content identity',async t=>{
 const {h,c}=await fixture(t),id='durable-command',car=c.club.store.data.cars[0],input={id,direct:true,databaseId:h.store.data.id,clubId:h.store.data.club.id,sourceId:c.club.device.id,device:'Member',deliveryEpoch:require('../src/club-sync.cjs').cursor(h.store).epoch,action:'car.save',payload:{id:car.id,revision:car.revision,data:{raceClass:'GT'}},base:require('../src/club-model.cjs').hash({}),original:[]};
 await assert.rejects(c.club.request('/v1/club/commands',input,{pair:c.club.device.pair,code:'wrong password'}));
 await assert.rejects(c.club.request('/v1/club/commands',{...input,databaseId:'wrong'}),/collection/);
 await assert.rejects(c.club.request('/v1/club/commands',{...input,deliveryEpoch:'old'}),/restored/);
 const response=await c.club.request('/v1/club/commands',input),revision=h.store.data.revision;assert.equal(response.status,'accepted');assert.equal((await c.club.request('/v1/club/commands',input)).duplicate,true);assert.equal(h.store.data.revision,revision);
 const reopened=new Store(h.store.file);assert.equal((await reopened.mutateAsync(input.action,input.payload,{snapshot:false,commandId:'club-'+require('../src/club-model.cjs').hash([input.sourceId,input.id]),databaseId:input.databaseId,epoch:input.deliveryEpoch})).duplicate,true);
 await assert.rejects(c.club.request('/v1/club/commands',{...input,payload:{...input.payload,data:{raceClass:'Other'}}}),/different content/);
 assert.equal(h.store.data.cars[0].raceClass,'GT');
});

test('an unreadable successful response retains the original command for safe retry',async t=>{
 const {h,c}=await fixture(t),payload={revision:c.club.store.data.revision,data:{...Model.blank(),name:'Uncertain plan'}},options={commandId:require('node:crypto').randomUUID()},request=c.club.request.bind(c.club);let first=true;
 c.club.request=async(...args)=>{const result=await request(...args);if(args[0]==='/v1/club/commands'&&first){first=false;throw SyntaxError('Unreadable response');}return result;};
 await assert.rejects(c.club.mutate('build.draft.save',payload,options),/Unreadable/);assert.equal(c.club.device.outbox.length,1);const id=h.store.data.buildDrafts[0].id;assert.equal((await c.club.mutate('build.draft.save',payload,options)).result,id);assert.equal(h.store.data.buildDrafts.length,1);
});
test('overlapping notification and save catch-ups serialize replica writes',async t=>{
 const {h,c}=await fixture(t),car=h.store.data.cars[0];await h.club.mutate('car.save',{id:car.id,revision:car.revision,data:{raceClass:'Parallel refresh'}});const revision=h.store.data.revision;await Promise.all(Array.from({length:6},()=>c.club.catchUp(revision,true)));assert.equal(c.club.state,'connected');assert.equal(c.club.store.data.cars[0].raceClass,'Parallel refresh');assert.equal(c.club.store.data.revision,revision);
});

test('member catalogue plans and purchases replicate before the completed car goes to Review',async t=>{
 const {h,c}=await fixture(t),part=(await h.club.mutate('part.save',{revision:h.store.data.revision,data:{name:'Future motor',tracking:'quantity',quantity:0,partType:'Motor'}})).result;await c.club.catchUp(h.store.data.revision,true);
 const data={...Model.blank(),name:'Future racer',parts:[{key:'motor',partId:part,name:'Future motor',slot:'motor',position:'Motor',quantity:1}]},draft=(await c.club.mutate('build.draft.save',{revision:c.club.store.data.revision,data})).result;
 assert.equal(h.store.data.planning.shopping[0].buildId,draft);assert.equal(c.club.store.data.planning.shopping[0].buildId,draft);assert.equal(h.store.data.club.proposals.length,0);const shoppingId=c.club.store.data.planning.shopping[0].id;
 await c.club.mutate('planning.receive',{revision:c.club.store.data.revision,shoppingId,partId:part,quantity:1,confirmed:true});
 assert.equal(h.store.data.parts[0].quantity,1);const result=await c.club.mutate('build.create',{revision:c.club.store.data.revision,draftId:draft,data,confirmed:true});assert.equal(result.queued,true);assert.equal(h.store.data.cars.length,1);
 const proposal=h.store.data.club.proposals[0],preview=h.club.preview(proposal.id);await h.club.reviewAsync({id:proposal.id,token:preview.token,decision:'accept'});await c.club.catchUp(h.store.data.revision,true);
 const built=c.club.store.data.cars.find(x=>x.name==='Future racer');assert.ok(built);assert.equal(c.club.store.data.planning.shopping[0].buildCarId,built.id);assert.equal(c.club.store.data.buildDrafts.length,0);assert.equal(c.club.store.data.installations[0].partId,part);
});

test('member setup requirement updates and cancellation are routine and preserve receipts on host',async t=>{
 const {h,c}=await fixture(t),s=h.store,act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result,carId=s.data.cars[0].id;
 const partId=act('part.save',{data:{name:'Target wheels',tracking:'quantity',quantity:2}});act('part.install',{carId,partId,quantity:2,field:'',position:'Rear'});act('setup.save',{carId,name:'Target'});const setupId=s.data.setups[0].id;act('part.remove',{id:s.data.installations[0].id,destination:'discarded'});const jobId=act('job.start',{setupId});await c.club.catchUp(s.data.revision,true);
 const member=async(a,p={})=>(await c.club.mutate(a,{revision:c.club.store.data.revision,...p})).result;
 await member('job.shopping',{id:jobId});const id=c.club.store.data.planning.shopping[0].id;await member('job.shopping',{id:jobId});assert.equal(s.data.planning.shopping.length,1);
 await member('planning.receive',{partId,shoppingId:id,quantity:1,confirmed:true});await member('planning.shopping.reconcile');await member('job.cancel',{id:jobId,confirmed:true});
 assert.equal(s.data.club.proposals.length,0);assert.equal(s.data.planning.shopping[0].quantity,2);assert.equal(s.data.planning.shopping[0].received,1);assert.equal(s.data.planning.shopping[0].purchase.requirement.state,'cancelled');assert.deepEqual(c.club.store.data.planning,s.data.planning);
});

test('member bulk orders, split delivery and receipt correction stay routine and replicate intact',async t=>{
 const {h,c}=await fixture(t),s=h.store,act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const part=act('part.save',{data:{name:'Purchased tyres',quantity:0,tracking:'quantity'}}),a=act('planning.shopping.add',{partId:part,quantity:3,supplier:'Shop',unitPrice:'2.50',currency:'EUR'}),b=act('planning.shopping.add',{partId:part,quantity:2});await c.club.catchUp(s.data.revision,true);
 const member=async(a,p={})=>(await c.club.mutate(a,{revision:c.club.store.data.revision,...p})).result;
 await member('planning.order.place',{confirmed:true,entries:[{id:a,quantity:3},{id:b,quantity:2}]});await member('planning.delivery.receive',{confirmed:true,entries:[{id:a,quantity:2},{id:b,quantity:1}]});
 const receiptId=s.data.planning.shopping.find(l=>l.id===a).purchase.receipts[0].id;
 await member('planning.receipt.correct',{id:a,receiptId,quantity:1,restoreOrdered:true,reason:'One too many counted',confirmed:true});await member('planning.order.cancel',{confirmed:true,entries:[{id:a,quantity:2}]});
 assert.equal(s.data.parts.find(p=>p.id===part).quantity,2);assert.equal(s.data.club.proposals.length,0);assert.deepEqual(c.club.store.data.planning,s.data.planning);assert.equal(s.data.planning.shopping.find(l=>l.id===a).purchase.orderLog.length,2);
});


test('Wishlist car-file imports need a capable host and remain pending until host Review',async t=>{
 const {h,c}=await fixture(t),F=require('../src/car-file.cjs'),source=new Store();const id=source.mutate('car.save',{data:{name:'Imported wish',collectionStatus:'wishlist'}}).result;
 const input=F.read(F.write(source.data,[id]));assert.equal(c.club.device.pair.wishlistCarFiles,1);delete c.club.device.pair.wishlistCarFiles;const before=h.store.snapshot();await assert.rejects(c.club.mutate('submission.add',input),/Update the dealership host/);assert.deepEqual(h.store.snapshot(),before);
 await c.club.reconnect();assert.equal(c.club.device.pair.wishlistCarFiles,1);await c.club.mutate('submission.add',input);const sub=h.store.data.submissions.find(s=>s.package.packageId===input.package.packageId);assert.ok(sub);assert.equal(sub.status,'pending');assert.deepEqual(sub.wishlistImport,input.wishlistImport);assert.equal(h.store.data.cars.some(c=>c.id===id),false);
 await h.club.mutate('submission.review',{id:sub.id,carId:id,decision:'accept',revision:0});assert.equal(h.store.data.cars.find(c=>c.id===id).collectionStatus,'wishlist');await c.club.reconnect();assert.equal(c.club.store.data.cars.find(c=>c.id===id).collectionStatus,'wishlist');
});

test('checklist edits and stock completion replicate directly; older hosts are blocked explicitly',async t=>{
 const {h,c}=await fixture(t);assert.equal(c.club.device.pair.shoppingChecklist,1);
 const member=async(a,p={})=>(await c.club.mutate(a,{revision:c.club.store.data.revision,...p})).result;
 const part=h.store.mutate('part.save',{data:{name:'Checklist motor',quantity:0,tracking:'quantity'}}).result;await c.club.catchUp(h.store.data.revision,true);
 const id=await member('planning.shopping.add',{partId:part,quantity:2});await member('planning.checklist.edit',{id,quantity:3});await member('planning.checklist.done',{id,done:true,addStock:true,quantity:3,confirmed:true});
 assert.equal(h.store.data.parts.find(p=>p.id===part).quantity,3);assert.equal(h.store.data.planning.shopping[0].purchase.checklist.done,true);assert.equal(h.store.data.club.proposals.length,0);assert.deepEqual(c.club.store.data.planning,h.store.data.planning);
 await member('planning.checklist.delete',{id});await member('planning.checklist.restore',{id});assert.equal(h.store.data.planning.shopping[0].purchase.checklist.deleted,false);
 delete c.club.device.pair.shoppingChecklist;const before=h.store.snapshot();
 await assert.rejects(member('planning.checklist.edit',{id,quantity:4}),/Update the dealership host/);await assert.rejects(member('planning.shopping.edit',{id,checklistQuantity:4}),/Update the dealership host/);assert.deepEqual(h.store.snapshot(),before);
 await c.club.reconnect();assert.equal(c.club.device.pair.shoppingChecklist,1);
});
