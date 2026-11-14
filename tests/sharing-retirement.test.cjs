'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,makePackage}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
const {SharingRetirement}=require('../src/sharing-retirement.cjs'),R=require('../src/submission-recovery.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-retirement-')),all=[];
 t.after(async()=>{for(const x of all){x.club.close();await x.net.stop();x.net.close();await x.store.whenIdle();}fs.rmSync(root,{recursive:true,force:true});});
 return (name,seed=true)=>{const dir=path.join(root,name),store=new Store(path.join(dir,'database.json'));if(seed)store.mutate('car.save',{data:{name:name+' car'}});const net=new Network(store),club=new Club(store,net,dir),migration=net.retirement=new SharingRetirement(net,club,dir);const x={store,net,club,migration,dir};all.push(x);return x;};
}
const address=n=>'127.0.0.1:'+n.port;
const input=h=>({confirmed:true,databaseId:h.store.data.id,name:'Host PC',password:'new dealership password'});
const get=(n,code,route='/v1/status')=>fetch('http://'+address(n)+route,{headers:{Authorization:'Bearer '+code,'X-SlotForge-Database':n.store.data.id}});
function preserve(n){const bytes=R.encode(n.pending);n.recoveryProof=R.fingerprint(n.pending);n.recoveryPending=n.pending;return bytes;}

test('unconfirmed migration and failed backup preserve the original listener, credentials and permissions',async t=>{
 const h=fixture(t)('host');await h.net.start();h.net.controls({allowSubmissions:false});const port=h.net.port,code=h.net.code;
 await assert.rejects(h.migration.host({...input(h),confirmed:false}),/Confirm/);assert.equal(h.net.port,port);
 h.club.backupAsync=async()=>{throw Error('backup failed');};await assert.rejects(h.migration.host(input(h)),/backup failed/);
 assert.equal(h.net.port,port);assert.equal(h.net.code,code);assert.equal(h.net.allowSubmissions,false);assert.equal(h.store.data.club,null);assert.equal((await get(h.net,code)).status,200);assert(!h.net.intake.paused);
});

test('migration drains an admitted Timing write, rejects new requests temporarily and preserves results and identities',async t=>{
 const h=fixture(t)('host'),timing=require('../src/timing-integration.cjs'),f=require('./support/timing-fixtures.cjs').fixtures();h.store.replace(f.store.snapshot());await h.net.start();
 const oldCode=h.net.timingCode,id=h.store.data.id,key=h.store.data.timing.key,cars=h.store.data.cars.map(c=>c.id),receive=timing.receiveAsync;
 let entered,release;const seen=new Promise(r=>entered=r),hold=new Promise(r=>release=r);timing.receiveAsync=async(...args)=>{entered();await hold;return receive(...args);};
 try{
  const sent=fetch('http://'+address(h.net)+'/v1/timing/sessions',{method:'POST',headers:{Authorization:'Bearer '+oldCode,'X-SlotForge-Database':id,'Content-Type':'application/json'},body:JSON.stringify(f.normal)});await seen;
  const migrating=h.migration.host(input(h));assert(h.migration.busy);assert.throws(()=>h.net.controls({rotate:true}),/progress/);await assert.rejects(h.net.stop(),/progress/);
  const paused=await get(h.net,oldCode);assert.equal(paused.status,503);assert.equal((await paused.json()).code,'HOST_MIGRATING');assert.equal(h.store.data.club,null);
  release();assert.equal((await sent).status,200);await migrating;
  assert.equal(h.store.data.id,id);assert.equal(h.store.data.timing.key,key);assert.deepEqual(h.store.data.cars.map(c=>c.id),cars);assert.equal(h.store.data.timing.sessions.length,1);assert(fs.existsSync(h.club.backupPath));
  assert.equal((await get(h.net,oldCode)).status,401);const current=await (await get(h.net,input(h).password)).json();assert.equal(current.id,id);assert(current.permissions.club&&current.permissions.timingResults);assert(h.net.port>0);assert.equal(h.migration.status().state,'check-clients');
  const receipt=await get(h.net,input(h).password,`/v1/timing/sessions/${f.normal.source.id}/${f.normal.sessionId}`);assert.equal(receipt.status,200);
  const telemetry=await (await get(h.net,input(h).password,'/v1/telemetry/results')).json();assert.equal(telemetry.entries.length,1);
  const replay=await h.net.request(address(h.net),input(h).password,'/v1/timing/sessions',f.normal,id);assert.equal(replay.duplicate,true);assert.equal(h.store.data.timing.sessions.length,1);
 }finally{release();timing.receiveAsync=receive;}
});

test('corrupt migration guidance does not disable existing hosting or get silently acknowledged',async t=>{
 const h=fixture(t)('host');fs.writeFileSync(h.migration.file,'broken JSON');h.migration=h.net.retirement=new SharingRetirement(h.net,h.club,h.dir);await h.net.start();assert.equal((await get(h.net,h.net.code)).status,200);assert.equal(h.migration.status().state,'recovery-error');
 await assert.rejects(h.migration.host(input(h)),/could not be read/);assert.throws(()=>h.migration.acknowledge({confirmed:true,databaseId:h.store.data.id}),/Reopen/);assert.equal(fs.readFileSync(h.migration.file,'utf8'),'broken JSON');
});

test('failed new listener leaves the committed collection safe, with durable guidance and explicit retry',async t=>{
 const h=fixture(t)('host');await h.net.start();const original=h.net.startHost.bind(h.net),id=h.store.data.id;
 h.net.startHost=async()=>{throw Error('port failed');};await assert.rejects(h.migration.host(input(h)),/port failed/);assert(h.club.coordinator);assert.equal(h.store.data.id,id);assert.equal(h.net.server,null);
 h.store.mutate('car.save',{data:{name:'Written after migration'}});h.migration=h.net.retirement=new SharingRetirement(h.net,h.club,h.dir);assert.equal(h.migration.status().state,'check-clients');assert(h.migration.status().error);
 h.net.startHost=original;await h.net.start();assert(h.store.data.cars.some(c=>c.name==='Written after migration'));assert.throws(()=>h.migration.acknowledge({...h.migration.status(),confirmed:false}),/Reopen/);
 h.migration.acknowledge({...h.migration.status(),confirmed:true});assert.equal(new SharingRetirement(h.net,h.club,h.dir).status(),null);
});

test('pending submission must be preserved before migration; recovery contains no credentials or private fields',async t=>{
 const make=fixture(t),h=make('host'),c=make('client');await h.net.start();await c.net.connect(address(h.net),h.net.code);
 const bundle=makePackage(c.store.snapshot(),c.store.data.cars.map(c=>c.id));c.net.pending={hostId:h.store.data.id,name:'Host',bundle};
 await assert.rejects(c.migration.host(input(c)),/recovery file/);assert.equal(c.store.data.club,null);
 const bytes=preserve(c.net),parsed=JSON.parse(bytes);assert.equal(parsed.bundle.packageId,bundle.packageId);assert(!bytes.includes(h.net.code));assert.deepEqual(parsed.bundle,bundle);
 await c.migration.host(input(c));assert.deepEqual(c.net.pending.bundle,bundle);assert(R.saved(c.net));
});

test('recovery after lost acknowledgement/restart retries the same original package without duplicate cars in Review',async t=>{
 const make=fixture(t),h=make('host'),c=make('client'),fresh=make('restarted');await h.net.start();await c.net.connect(address(h.net),h.net.code);
 const request=c.net.request.bind(c.net);c.net.request=async(...args)=>{const r=await request(...args);if(args[2]==='/v1/submissions')throw Error('lost response');return r;};
 await assert.rejects(c.net.submit(c.store.data.cars.map(c=>c.id),{}),/retained/);assert.equal(h.store.data.submissions.length,1);const packageId=c.net.pending.bundle.packageId;
 const bytes=preserve(c.net);c.store.mutate('car.save',{id:c.store.data.cars[0].id,revision:c.store.data.cars[0].revision,data:{name:'Changed later'}});
 R.restore(fresh.net,JSON.parse(bytes));assert.equal(fresh.net.remote,null);assert.equal(fresh.net.pending.bundle.packageId,packageId);assert.notEqual(fresh.net.pending.bundle.cars[0].name,'Changed later');
 await fresh.net.connect(address(h.net),h.net.code);assert.equal((await fresh.net.retrySubmission()).duplicate,true);assert.equal(h.store.data.submissions.length,1);assert.equal(fresh.net.pending,null);assert.equal(fresh.net.recoveryPending,null);assert.equal(fresh.net.recoveryProof,null);
});

test('recovery rejects malformed, oversized, secret-bearing, conflicting and wrong-destination files without replacing pending work',async t=>{
 const c=fixture(t)('client'),bundle=makePackage(c.store.snapshot(),c.store.data.cars.map(c=>c.id)),v={format:'slotforge-submission-recovery',version:1,hostId:'original',name:'Host',bundle};
 for(const value of [{...v,password:'secret'},{...v,hostId:''},{...v,version:2},{...v,bundle:{...bundle,privateNotes:'secret'}},{...v,bundle:{...bundle,sender:'x'.repeat(R.MAX)}}])assert.throws(()=>R.restore(c.net,value));
 assert.equal(c.net.pending,null);c.net.remote={id:'different'};assert.throws(()=>R.restore(c.net,v),/another host/);c.net.remote=null;R.restore(c.net,v);const pending=c.net.pending;
 assert.throws(()=>R.restore(c.net,{...v,bundle:{...bundle,packageId:'different'}}),/Another submission/);assert.equal(c.net.pending,pending);
 c.net.sending=true;assert.throws(()=>R.restore(c.net,v),/Wait/);c.net.sending=false;
});

test('browser migration verifies original identity, keeps the public view, and downloads a separate protected copy',async t=>{
 const make=fixture(t),h=make('host'),other=make('wrong-host'),c=make('client');await h.net.start();await c.net.connect(address(h.net),h.net.browseCode);const view=c.net.cached,personal=c.store.snapshot();
 other.club.enable('Other','other password');await other.net.start();await h.migration.host(input(h));
 const p={confirmed:true,databaseId:h.store.data.id,address:address(other.net),code:'other password',name:'Client'};
 await assert.rejects(c.migration.browser(p),/original public host/);assert.equal(c.club.device.pair,null);assert.equal(c.net.cached,view);
 await c.migration.browser({...p,address:address(h.net),code:input(h).password});assert(c.club.active);assert.equal(c.club.cache.data.id,h.store.data.id);assert(c.club.cache.data.club.replica);assert.equal(c.net.cached,view);assert.deepEqual(c.store.snapshot(),personal);
});

test('migrating then restarting both sides preserves Review decisions and a lost-acknowledgement retry',async t=>{
 const make=fixture(t),h=make('host'),c=make('client');await h.net.start();
 const carId=c.store.data.cars[0].id;
 for(const decision of ['accept','reject']){
  const bundle=makePackage(c.store.snapshot(),[carId]);h.store.mutate('submission.add',{package:bundle});
  const submission=h.store.data.submissions.find(s=>s.package.packageId===bundle.packageId);
  h.store.mutate('submission.review',{id:submission.id,carId,decision,revision:h.store.data.cars.find(car=>car.id===carId)?.revision||0});
 }
 await c.net.connect(address(h.net),h.net.code);const request=c.net.request.bind(c.net);
 c.net.request=async(...args)=>{const reply=await request(...args);if(args[2]==='/v1/submissions')throw Error('Lost acknowledgement');return reply;};
 await assert.rejects(c.net.submit([carId],{}),/retained/);const recovery=preserve(c.net),before=structuredClone(h.store.data.submissions),id=h.store.data.id;
 await h.migration.host(input(h));h.club.close();await h.net.stop();h.net.close();
 const restarted=make('host',false),client=make('restarted-client');assert.equal(restarted.store.data.id,id);assert.deepEqual(restarted.store.data.submissions,before);
 assert.equal(restarted.migration.status().state,'check-clients');await restarted.net.start();assert.equal(restarted.net.hostingMode,'dealership');
 R.restore(client.net,JSON.parse(recovery));await client.net.connect(address(restarted.net),input(h).password);
 assert.equal((await client.net.retrySubmission()).duplicate,true);assert.deepEqual(restarted.store.data.submissions,before);
 restarted.migration.acknowledge({...restarted.migration.status(),confirmed:true});assert.deepEqual(restarted.store.data.submissions,before);
});

test('a partially uploaded Timing request finishes before the migration cuts over',async t=>{
 const h=fixture(t)('host'),f=require('./support/timing-fixtures.cjs').fixtures();h.store.replace(f.store.snapshot());await h.net.start();
 const bytes=Buffer.from(JSON.stringify(f.normal)),half=Math.floor(bytes.length/2),http=require('node:http');
 const admitted=new Promise(resolve=>h.net.server.once('request',resolve));let req;
 const response=new Promise((resolve,reject)=>{
  req=http.request({hostname:'127.0.0.1',port:h.net.port,path:'/v1/timing/sessions',method:'POST',headers:{Authorization:'Bearer '+h.net.timingCode,'X-SlotForge-Database':h.store.data.id,'Content-Type':'application/json','Content-Length':bytes.length}},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts))}));});
  req.on('error',reject);req.write(bytes.subarray(0,half));
 });
 t.after(()=>req.destroy());await admitted;assert(h.net.intake.tasks.size>0);
 const migrating=h.migration.host(input(h));assert.equal(h.store.data.club,null);assert(h.net.intake.paused);
 req.end(bytes.subarray(half));const accepted=await response;assert.equal(accepted.status,200);await migrating;
 const replay=await h.net.request(address(h.net),input(h).password,'/v1/timing/sessions',f.normal,h.store.data.id);
 assert.equal(replay.duplicate,true);assert.equal(h.store.data.timing.sessions.length,1);
});
