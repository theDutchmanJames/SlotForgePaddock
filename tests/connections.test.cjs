const test=require('node:test');
const assert=require('node:assert/strict');
const {Store,makePackage}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
const {advertisement,scan}=require('../src/discovery.cjs');
async function pair(t){const hs=new Store(),cs=new Store(),host=new Network(hs),client=new Network(cs);const status=await host.start();t.after(()=>host.stop());return {hs,cs,host,client,status,address:'127.0.0.1:'+status.port};}
test('browse-only access can read public cars but cannot submit, including direct HTTP requests',async t=>{
  const {hs,cs,client,status,address}=await pair(t);hs.mutate('car.save',{data:{name:'Club car',privateNotes:'Never share'}});const id=cs.mutate('car.save',{data:{name:'Member'}}).result;
  await client.connect(address,status.browseCode);assert.equal(client.status().remote.permissions.submit,false);assert.equal(client.cached.cars[0].privateNotes,undefined);
  await assert.rejects(client.submit([id],{}),/browse-only/);await assert.rejects(client.request(address,status.browseCode,'/v1/submissions',makePackage(cs.data,[id])),e=>e.httpStatus===403);assert.equal(hs.data.submissions.length,0);
  assert.equal(JSON.stringify(client.status()).includes(status.browseCode),false);
});
test('host can pause submissions, retain browsing, resume, and revoke both codes',async t=>{
  const {host,client,status,address,cs,hs}=await pair(t),id=cs.mutate('car.save',{data:{name:'Member'}}).result;await client.connect(address,status.code);
  host.controls({allowSubmissions:false});client.nextPoll=0;await client.poll();assert.equal(client.remote.permissions.submit,false);assert.equal(client.remote.state,'connected');
  host.controls({allowSubmissions:true});client.nextPoll=0;await client.poll();assert.equal(client.remote.permissions.submit,true);await client.submit([id]);assert.equal(hs.data.submissions.length,1);
  host.controls({rotate:true});client.nextPoll=0;await client.poll();assert.equal(client.remote.state,'access-required');const last=client.cached;await assert.rejects(client.refresh(),/Incorrect/);assert.equal(client.cached,last);
  await assert.rejects(client.connect(address,status.browseCode),/Incorrect/);await client.connect(address,host.status().code);assert.equal(client.remote.state,'connected');
});
test('polling checks revisions cheaply and refreshes changes without touching the personal collection',async t=>{
  const {hs,cs,client,status,address}=await pair(t);await client.connect(address,status.code);const before=cs.snapshot(),request=client.request.bind(client),routes=[];client.request=(...args)=>{routes.push(args[2]);return request(...args);};
  client.nextPoll=0;await client.poll();assert.deepEqual(routes,['/v1/status']);routes.length=0;
  hs.mutate('car.save',{data:{name:'New approved car'}});client.nextPoll=0;await client.poll();assert.equal(client.cached.cars[0].name,'New approved car');assert.deepEqual(cs.snapshot(),before);assert.deepEqual(routes,['/v1/status','/v1/collection']);
  client.autoRefresh(false);routes.length=0;await client.poll();assert.deepEqual(routes,[]);
});
test('temporary outages retain the public cache, back off, and recover without a new pairing',async t=>{
  const {client,status,address}=await pair(t);await client.connect(address,status.code);const snapshot=client.cached,request=client.request.bind(client);client.request=async()=>{throw Error('fetch failed');};
  client.nextPoll=0;await client.poll();assert.equal(client.remote.state,'offline');assert.equal(client.cached,snapshot);assert.ok(client.nextPoll>Date.now());const first=client.nextPoll;await client.poll();assert.equal(client.nextPoll,first);
  client.request=request;client.nextPoll=0;await client.poll();assert.equal(client.remote.state,'connected');assert.equal(client.remote.lastError,'');
});
test('disconnect during a status read cannot reinstate a connection',async t=>{
  const {client,status,address}=await pair(t);await client.connect(address,status.code);const request=client.request.bind(client);client.request=async(...args)=>{const response=await request(...args);client.disconnect();return response;};client.nextPoll=0;await client.poll();assert.equal(client.remote,null);assert.equal(client.cached,null);
});
test('unacknowledged submissions retry the identical package even if the car changes afterwards',async t=>{
  const {client,status,address,cs,hs}=await pair(t),id=cs.mutate('car.save',{data:{name:'Original entry'}}).result;await client.connect(address,status.code);const request=client.request.bind(client);
  client.request=async(...args)=>{await request(...args);throw Error('Connection dropped after the host saved');};await assert.rejects(client.submit([id]),/retry copy/);assert.equal(hs.data.submissions.length,1);const packageId=client.pending.bundle.packageId;
  cs.mutate('car.save',{id,revision:cs.data.cars[0].revision,data:{name:'Edited later'}});await assert.rejects(client.submit([id]),/previous submission/);client.request=request;
  const result=await client.retrySubmission();assert.equal(result.duplicate,true);assert.equal(hs.data.submissions.length,1);assert.equal(hs.data.submissions[0].package.packageId,packageId);assert.equal(hs.data.submissions[0].package.cars[0].name,'Original entry');assert.equal(client.pending,null);
});
test('pending submissions cannot move to another host and cannot be discarded during transmission',async t=>{
  const {client,status,address,cs}=await pair(t),other=await pair(t),id=cs.mutate('car.save',{data:{name:'Member'}}).result;await client.connect(address,status.code);const request=client.request.bind(client);client.request=async()=>{throw Error('Offline');};await assert.rejects(client.submit([id]));client.request=request;await client.connect(other.address,other.status.code);await assert.rejects(client.retrySubmission(),/original host/);
  await client.connect(address,status.code);let release;client.request=()=>new Promise(resolve=>{release=()=>resolve({ok:true,duplicate:false});});const sending=client.retrySubmission();assert.throws(()=>client.discardSubmission(),/Wait/);await assert.rejects(client.retrySubmission(),/already being sent/);release();await sending;
});
test('a changed database at the same address cannot receive retries or replace the old cache',async t=>{
  const {client,host,status,address,cs}=await pair(t),id=cs.mutate('car.save',{data:{name:'Member'}}).result;await client.connect(address,status.code);const original=client.cached,other=new Store();host.store=other;
  await assert.rejects(client.refresh(),/different database/);assert.equal(client.cached,original);
  await assert.rejects(client.request(address,status.code,'/v1/submissions',makePackage(cs.data,[id]),original.id),e=>e.httpStatus===409);assert.equal(other.data.submissions.length,0);
});
test('failed pairing preserves the existing connection and old hosts still support refresh',async t=>{
  const {client,status,address}=await pair(t);await client.connect(address,status.code);const old=client.remote,snapshot=client.cached;await assert.rejects(client.connect(address,'wrong'));assert.equal(client.remote,old);assert.equal(client.cached,snapshot);
  const request=client.request.bind(client);client.request=async(...args)=>{if(args[2]==='/v1/status'){const e=Error('Unknown operation');e.httpStatus=404;throw e;}const result=await request(...args);delete result.permissions;return result;};client.nextPoll=0;await client.poll();assert.equal(client.remote.state,'connected');assert.equal(client.remote.permissions.submit,true);
});
test('discovery validation rejects unsolicited, oversized, external and malformed advertisements',()=>{
  const nonce='a'.repeat(32),base={type:'slotforge-host',version:1,nonce,id:'host-id',name:'Club',port:1234},bytes=x=>Buffer.from(JSON.stringify(x));
  assert.deepEqual(advertisement(bytes(base),{address:'192.168.1.10'},nonce),{id:'host-id',name:'Club',address:'192.168.1.10:1234'});
  for(const p of [{...base,nonce:'b'.repeat(32)},{...base,port:0},{...base,name:'x'.repeat(2100)},{...base,id:'../file'},{...base,type:'other'}])assert.equal(advertisement(bytes(p),{address:'192.168.1.10'},nonce),null);
  assert.equal(advertisement(bytes(base),{address:'8.8.8.8'},nonce),null);
});
test('local multicast discovery finds a sharing host without publishing codes or car records',async t=>{
  const {host,hs,status}=await pair(t);assert.equal(status.discoverable,true,status.discoveryError);hs.mutate('settings.save',{name:'Discovery club'});hs.mutate('car.save',{data:{name:'Private fixture'}});
  const results=await scan({duration:500}),found=results.find(h=>h.id===hs.data.id);assert.ok(found,'Host should answer local multicast discovery');assert.equal(found.name,'Discovery club');assert.deepEqual(Object.keys(found).sort(),['address','id','name']);assert.equal(JSON.stringify(results).includes(status.code),false);await host.stop();assert.equal(host.advertiser,null);
});
test('disconnect aborts an in-flight read and a fresh connection can refresh immediately',async t=>{
  const {client,status,address}=await pair(t);await client.connect(address,status.code);const request=client.request.bind(client);
  client.request=(...args)=>new Promise((_resolve,reject)=>args[5].addEventListener('abort',()=>reject(Error('Read aborted')),{once:true}));const pending=client.refresh();client.disconnect();await assert.rejects(pending,/aborted/);assert.equal(client.cached,null);
  client.request=request;await client.connect(address,status.code);await client.refresh();assert.equal(client.remote.state,'connected');
});
test('simultaneous refreshes share one transfer and stopping during startup closes discovery too',async t=>{
  const {client,status,address}=await pair(t);await client.connect(address,status.code);let count=0;const request=client.request.bind(client);client.request=async(...args)=>{count++;return request(...args);};await Promise.all([client.refresh(),client.refresh()]);assert.equal(count,1);
  const extra=new Network(new Store()),starting=extra.start(),stopping=extra.stop();await Promise.all([starting,stopping]);assert.equal(extra.status().sharing,false);assert.equal(extra.advertiser,null);
});
test('host rechecks submission permission after receiving a partially uploaded package',async t=>{
  const http=require('node:http'),{host,hs,cs,status}=await pair(t),id=cs.mutate('car.save',{data:{name:'Slow upload'}}).result,body=JSON.stringify(makePackage(cs.data,[id]));
  host.server.once('request',req=>req.once('data',()=>host.controls({allowSubmissions:false})));
  const result=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:status.port,path:'/v1/submissions',method:'POST',headers:{Authorization:'Bearer '+status.code,'Content-Length':Buffer.byteLength(body)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(body.slice(0,20));setTimeout(()=>req.end(body.slice(20)),30);});
  assert.equal(result,403);assert.equal(hs.data.submissions.length,0);
});
