'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WorkGate}=require('../src/work-gate.cjs'),{Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs');
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Expected work did not start.');}
test('closing rejects new work and waits for every accepted operation, including failures',async()=>{
 const gate=new WorkGate(),first=pause(),second=pause();let done=false;
 const a=gate.run(()=>first.promise),b=gate.run(async()=>{await second.promise;throw Error('Expected rejection');});const results=Promise.allSettled([a,b]);gate.stop();await assert.rejects(gate.run(()=>assert.fail()),e=>e.code==='APP_CLOSING');
 const idle=gate.idle().then(()=>done=true);first.resolve();await a;assert.equal(done,false);second.resolve();await results;await idle;assert.equal(done,true);assert.equal(gate.tasks.size,0);
});
async function host(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-shutdown-')),f=require('./support/timing-fixtures.cjs').fixtures(),store=new Store(path.join(dir,'db.sqlite'));store.replace(f.store.snapshot());
 t.mock.method(require('../src/discovery.cjs'),'advertise',async()=>({close(){}}));const network=new Network(store);await network.start();t.after(async()=>{network.close();await network.idle();fs.rmSync(dir,{recursive:true,force:true});});
 const address='http://127.0.0.1:'+network.port,headers={Authorization:'Bearer '+network.timingCode,'Content-Type':'application/json','X-SlotForge-Database':store.data.id};return {store,network,f,address,headers};
}
test('Timing result accepted before shutdown is committed and acknowledged; later work receives retryable 503',async t=>{
 const {store,network,f,address,headers}=await host(t),held=pause();store.pendingWrite=held.promise;
 const result=fetch(address+'/v1/timing/sessions',{method:'POST',headers,body:JSON.stringify(f.normal)});await until(()=>store.domainPending===1);network.quiesce();
 const refused=await fetch(address+'/v1/timing/sessions',{method:'POST',headers,body:JSON.stringify(f.multi)});assert.equal(refused.status,503);assert.equal(refused.headers.get('retry-after'),'2');assert.equal((await refused.json()).code,'HOST_CLOSING');assert.equal(store.domainPending,1);
 let drained=false;const draining=network.idle().then(()=>drained=true);await new Promise(r=>setImmediate(r));assert.equal(drained,false);
 store.pendingWrite=null;held.resolve();const response=await result;assert.equal(response.status,200);assert.equal((await response.json()).ok,true);await draining;assert.equal(store.data.timing.sessions.length,1);
 await assert.rejects(network.start(),e=>e.code==='APP_CLOSING');
});
test('client disconnect cannot release an accepted write from the shutdown drain',async t=>{
 const {store,network,f,address,headers}=await host(t),held=pause(),abort=new AbortController();store.pendingWrite=held.promise;
 const request=fetch(address+'/v1/timing/sessions',{method:'POST',headers,body:JSON.stringify(f.normal),signal:abort.signal}).catch(()=>null);await until(()=>store.domainPending===1);abort.abort();await request;network.quiesce();let drained=false;const draining=network.idle().then(()=>drained=true);await new Promise(r=>setTimeout(r,20));assert.equal(drained,false);
 store.pendingWrite=null;held.resolve();await draining;assert.equal(new Store(store.file).data.timing.sessions.length,1);
});
test('notification streams close during shutdown without waiting for their heartbeat',async t=>{
 const {network,address,headers}=await host(t),response=await fetch(address+'/v1/telemetry/events',{headers});assert.equal(response.status,200);const reader=response.body.getReader();assert.equal((await reader.read()).done,false);network.quiesce();let ended=false;while(!ended)ended=(await reader.read()).done;await network.idle();assert.equal(network.work.tasks.size,0);
});
test('closing while discovery starts cannot restart advertising or admit requests',async t=>{
 const held=pause();let closed=0;t.mock.method(require('../src/discovery.cjs'),'advertise',async()=>{await held.promise;return {close(){closed++;}};});const network=new Network(new Store());t.after(()=>network.close());const starting=network.start();await until(()=>network.port>0);network.quiesce();held.resolve();await starting;await network.idle();assert.equal(closed,1);assert.equal(network.advertiser,null);assert.equal(network.work.closing,true);
});

test('a stalled response has bounded shutdown grace only after its handler finishes',async()=>{
 const {EventEmitter}=require('node:events'),gate=new WorkGate(),held=pause();const res=new EventEmitter();res.destroyed=false;res.writableFinished=false;res.destroy=()=>{res.destroyed=true;res.emit('close');};
 require('../src/work-gate.cjs').http(gate,()=>held.promise,{drainTimeoutMs:20})({},res);gate.stop();
 await new Promise(r=>setTimeout(r,40));assert.equal(res.destroyed,false);held.resolve();
 let deadline;try{await Promise.race([gate.idle(),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('Response did not drain')),1000);})]);}finally{clearTimeout(deadline);}assert.equal(res.destroyed,true);assert.equal(gate.stopListeners.size,0);
});

test('closing an unacknowledged Dealership delivery retains its proposal and password for restart',async t=>{
 const {Club}=require('../src/club.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-outbox-close-')),store=new Store(path.join(dir,'db.sqlite'));store.mutate('car.save',{data:{name:'Local car'}});const network=new Network(store),club=new Club(store,network,dir);let restarted;
 t.after(()=>{club.close();restarted?.close();network.close();fs.rmSync(dir,{recursive:true,force:true});});
 const pair={address:'127.0.0.1:12345',databaseId:'remote-db',clubId:'remote-club',password:'My password'},input={id:'retained-proposal'};club.saveDevice({...club.device,pair,outbox:[input]});club.code=pair.password;club.state='connected';let started=false;
 t.mock.method(globalThis,'fetch',(_url,options)=>new Promise((resolve,reject)=>{started=true;options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});}));
 const delivery=club.sendOutbox();await until(()=>started);club.quiesce();await club.idle();await delivery;assert.deepEqual(club.device.outbox,[input]);assert.equal(club.sending,null);assert.ok(!club.outboxRetry);await club.sendOutbox();
 restarted=new Club(store,network,dir);assert.deepEqual(restarted.device.outbox,[input]);assert.equal(restarted.code,pair.password);
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:input.id,status:'pending'}),{headers:{'Content-Type':'application/json'}}));await restarted.sendOutbox();assert.deepEqual(restarted.device.outbox,[]);assert.deepEqual(JSON.parse(fs.readFileSync(restarted.file)).outbox,[]);
});
