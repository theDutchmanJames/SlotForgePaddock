'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function build(s,id){const draftId=act(s,'rebuild.start',{carId:id}),data=structuredClone(s.data.buildDrafts.find(d=>d.id===draftId).data);data.rebuild.reuse=s.data.installations.filter(i=>i.carId===id&&!i.removed).map(i=>i.id);return {data,draftId,confirmed:true};}
test('authenticated lifecycle lookup is additive, identity-scoped and safe for legacy clients',async t=>{
 const s=new Store(),old=act(s,'car.save',{data:{name:'Original',owner:'Private owner'}}),part=act(s,'part.save',{data:{name:'Motor',quantity:1,tracking:'individual'}});act(s,'part.install',{carId:old,partId:part,quantity:1,field:'motor'});const next=act(s,'build.create',build(s,old));const network=new Network(s);t.after(()=>network.stop());const status=await network.start(),base='http://127.0.0.1:'+status.port;
 const get=(route,extra={})=>fetch(base+route,{headers:{Authorization:'Bearer '+status.code,'X-SlotForge-Database':s.data.id,...extra}});
 assert.equal((await fetch(base+'/v1/rebuilds/cars/'+old)).status,401);
 assert.equal((await get('/v1/rebuilds/cars/'+old,{'X-SlotForge-Database':'wrong'})).status,409);
 assert.equal((await get('/v1/rebuilds/cars/'+old,{Origin:'https://example.com'})).status,403);
 const response=await get('/v1/rebuilds/cars/'+old),body=await response.json();assert.equal(response.status,200);assert.equal(body.successor.id,next);assert.equal(body.archived,true);assert.ok(!JSON.stringify(body).includes('Private'));
 assert.equal((await (await get('/v1/rebuilds/cars/'+next)).json()).predecessor.id,old);
 assert.equal((await get('/v1/rebuilds/cars/missing')).status,404);
 const legacy=await (await get('/v1/status')).json();assert.equal(legacy.capabilities.rebuilds,undefined);
 const modern=await (await get('/v1/status',{'X-SlotForge-Extensions':'scalable-v1'})).json();assert.equal(modern.capabilities.rebuilds.version,1);
});
test('Dealership approval creates one successor and preserves the original until approval',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-rebuild-review-')),s=new Store(path.join(root,'database.sqlite')),old=act(s,'car.save',{data:{name:'Original'}}),part=act(s,'part.save',{data:{name:'Chassis',quantity:1,tracking:'individual'}});act(s,'part.install',{carId:old,partId:part,quantity:1,field:'chassis'});
 const network=new Network(s),club=new Club(s,network,root);t.after(async()=>{club.close();await network.stop();network.close();fs.rmSync(root,{recursive:true,force:true});});club.enable('Dealership','rebuild password');
 const approve=async()=>{const p=s.data.club.proposals.find(p=>p.status==='pending'),view=club.preview(p.id);assert.equal(view.error,'');await club.reviewAsync({id:p.id,token:view.token,decision:'accept',confirmConflict:true});};
 assert.notEqual((await club.mutate('rebuild.start',{carId:old,revision:s.data.revision})).queued,true);assert.equal(s.data.buildDrafts.length,1);assert.equal(s.data.club.proposals.length,0);
 const d=s.data.buildDrafts[0],data=structuredClone(d.data);data.rebuild.reuse=[s.data.installations.find(i=>!i.removed).id];await club.mutate('build.create',{data,draftId:d.id,confirmed:true,revision:s.data.revision});assert.equal(s.data.cars.length,1);assert.equal(s.data.cars[0].archived,undefined);await approve();assert.equal(s.data.cars.length,2);assert.equal(s.data.cars[0].rebuild.to.id,s.data.cars[1].id);assert.equal(s.data.jobs[0].status,'completed');assert.equal(s.data.installations.filter(i=>!i.removed).length,1);
 const reopened=await Store.open(s.file);assert.equal(reopened.data.cars[0].rebuild.to.id,s.data.cars[1].id);
});
