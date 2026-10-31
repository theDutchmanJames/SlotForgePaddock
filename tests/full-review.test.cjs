const test=require('node:test'),assert=require('node:assert/strict');
const {Store,makePackage,validatePackage,publicCar}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
const car=s=>s.mutate('car.save',{data:{name:'Review car'}}).result;
const part=(s,n=2)=>s.mutate('part.save',{data:{name:'Screws',tracking:'quantity',quantity:n,category:'Fasteners'}}).result;
const act=(s,a,p={})=>s.mutate(a,{...p,revision:s.data.revision}).result;
test('public car projection excludes unknown restored technical fields',async t=>{
  const s=new Store();car(s);const backup=s.snapshot();backup.cars[0].technical={motor:'Approved public value',privateServiceCode:'Do not share'};s.restore(backup,s.data.revision);
  assert.equal(publicCar(s.data.cars[0]).technical.privateServiceCode,undefined);
  const host=new Network(s);t.after(()=>host.stop());const status=await host.start();const response=await fetch('http://127.0.0.1:'+status.port+'/v1/collection',{headers:{Authorization:'Bearer '+status.browseCode}});assert.equal(JSON.stringify(await response.json()).includes('Do not share'),false);
});
test('duplicate photo identities are rejected before a package reaches the review inbox',()=>{
  const s=new Store(),id=car(s),pack=makePackage(s.data,[id]);pack.cars[0].photos=[{id:'duplicate-photo',name:'A',data:''},{id:'duplicate-photo',name:'B',data:''}];assert.throws(()=>validatePackage(pack),/Duplicate.*photo/);const host=new Store();assert.throws(()=>host.mutate('submission.add',{package:pack}));assert.equal(host.data.submissions.length,0);
});
test('identical inventory-only requirements can be fulfilled in either order without double counting',()=>{
  const s=new Store(),c=car(s),p=part(s,4);for(let n=0;n<2;n++)s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'',position:'Body screws'});s.mutate('setup.save',{carId:c,name:'Four mounts'});const j=act(s,'job.start',{setupId:s.data.setups[0].id});for(const i of s.data.installations.slice())act(s,'job.remove',{id:j,installationId:i.id,confirmed:true});
  act(s,'job.fit',{id:j,key:'1',selection:'p:'+p,confirmed:true});let m=s.plan('job.view',{id:j});assert.equal(m.rows.find(r=>r.key==='1').done,true);assert.equal(m.rows.find(r=>r.key==='0').done,false);
  act(s,'job.fit',{id:j,key:'0',selection:'p:'+p,confirmed:true});m=s.plan('job.view',{id:j});assert.equal(m.remaining,0);assert.equal(new Set(m.rows.flatMap(r=>r.installationIds)).size,2);
});
test('a valid long technical note can be changed in a staged job without overflowing its journal',()=>{
  const s=new Store(),c=car(s),target='A'.repeat(15000),before='B'.repeat(15000);s.mutate('car.save',{id:c,revision:s.data.cars[0].revision,data:{technical:{technicalNotes:target}}});s.mutate('setup.save',{carId:c,name:'Long notes'});s.mutate('car.save',{id:c,revision:s.data.cars[0].revision,data:{technical:{technicalNotes:before}}});const j=act(s,'job.start',{setupId:s.data.setups[0].id});
  act(s,'job.setting',{id:j,key:'technicalNotes',confirmed:true});assert.equal(s.data.cars[0].technical.technicalNotes,target);assert.deepEqual(s.data.jobs[0].log[0].change,{key:'technicalNotes',before,after:target});
});
test('a detected database identity change halts automatic retries until explicit pairing',async t=>{
  const host=new Network(new Store()),client=new Network(new Store());t.after(()=>host.stop());const status=await host.start(),address='127.0.0.1:'+status.port;await client.connect(address,status.code);host.store=new Store();client.nextPoll=0;await client.poll();assert.equal(client.status().remote.state,'access-required');const request=client.request.bind(client);let calls=0;client.request=(...args)=>{calls++;return request(...args);};client.nextPoll=0;await client.poll();assert.equal(calls,0);
});
test('changed content cannot masquerade as a duplicate package acknowledgement',()=>{
  const s=new Store(),id=car(s),pack=makePackage(s.data,[id]),host=new Store();host.mutate('submission.add',{package:pack});const changed=structuredClone(pack);changed.cars[0].name='Different entry';assert.throws(()=>host.mutate('submission.add',{package:changed}),/identity.*different|different.*identity/i);assert.equal(host.data.submissions[0].package.cars[0].name,'Review car');
});
test('choice corrections preserve full values when the generated journal summary is long',()=>{
  const s=new Store(),c=car(s),before='M'.repeat(20000);s.mutate('car.save',{id:c,revision:s.data.cars[0].revision,data:{technical:{motor:before}}});act(s,'choice.rename',{field:'tech_motor',from:before,to:'Corrected motor',updateCars:true,confirmed:true});assert.equal(s.data.cars[0].technical.motor,'Corrected motor');assert.equal(s.data.events[0].changes[0].before,before);
});
test('large valid setup movement lists do not overflow the journal or lose their full audit data',()=>{
  const s=new Store(),c=car(s),p=s.mutate('part.save',{data:{name:'N'.repeat(200),reference:'R'.repeat(200),quantity:60,tracking:'quantity'}}).result;
  for(let n=0;n<60;n++)s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'',position:'Mount '+n});s.mutate('setup.save',{carId:c,name:'Many small fittings'});const id=s.data.setups[0].id,options=s.plan('setup.options',{id});act(s,'setup.apply',{id,selections:Object.fromEntries(options.rows.map(r=>[r.key,r.selected])),confirmed:true});assert.equal(s.data.events[0].movements.length,60);assert.ok(s.data.events[0].notes.length<=20000);
});
test('a multi-page read has an overall deadline as well as individual request timeouts',async()=>{
  const client=new Network(new Store());client.transferTimeoutMs=30;
  client.request=(_a,_c,_r,_b,_d,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve({}),500);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
  await assert.rejects(client.connect('127.0.0.1:1234','test-code'),/timeout|timed out|too long/i);assert.equal(client.remote,null);
});
test('setup defaults assign distinct installed parts to identical inventory-only rows',()=>{
  const s=new Store(),c=car(s),p=part(s,2);for(let n=0;n<2;n++)s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'',position:'Body screws'});s.mutate('setup.save',{carId:c,name:'Matching screws'});const id=s.data.setups[0].id,options=s.plan('setup.options',{id});assert.equal(new Set(options.rows.map(r=>r.selected)).size,2);act(s,'setup.apply',{id,selections:Object.fromEntries(options.rows.map(r=>[r.key,r.selected])),confirmed:true});assert.equal(s.data.installations.filter(i=>!i.removed).length,2);
});
test('applying an old setup captures current stock names in its new audit snapshot',()=>{
  const s=new Store(),c=car(s),p=part(s,2);s.mutate('part.install',{carId:c,partId:p,quantity:1,field:'',position:'Mount'});s.mutate('setup.save',{carId:c,name:'Before correction'});const id=s.data.setups[0].id;s.mutate('part.save',{id:p,revision:s.data.revision,data:{...s.data.parts.find(p2=>p2.id===p),name:'Corrected screws'}});const options=s.plan('setup.options',{id});act(s,'setup.apply',{id,selections:Object.fromEntries(options.rows.map(r=>[r.key,r.selected])),confirmed:true});assert.equal(s.data.events[0].installations[0].name,'Corrected screws');assert.equal(s.data.setups[0].installations[0].name,'Screws');
});
