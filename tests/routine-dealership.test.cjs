'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),Model=require('../renderer/build-model.js');
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-routine-dealership-')),instances=[];
 const make=name=>{const dir=path.join(root,name),store=new Store(path.join(dir,'db.sqlite'));store.mutate('car.save',{data:{name:'Original car'}});const net=new Network(store),club=new Club(store,net,dir),x={store,net,club};instances.push(x);return x;};
 t.after(async()=>{for(const x of instances){x.club.close();await x.club.idle();await x.net.stop();x.net.close();}fs.rmSync(root,{recursive:true,force:true});});
 const h=make('host'),c=make('member');h.club.enable('Host','test password');await h.net.start();await c.club.connect({address:'127.0.0.1:'+h.net.port,code:h.net.clubCode,name:'Member'});return {h,c};
}
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
