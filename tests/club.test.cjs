const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),M=require('../src/club-model.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-club-'));const instances=[];t.after(async()=>{for(const x of instances){x.club.close();await x.net.stop();x.net.close();}fs.rmSync(root,{recursive:true,force:true});});return function instance(name){const dir=path.join(root,name),store=new Store(path.join(dir,'database.json'));store.mutate('car.save',{data:{name:name+' car',technical:{motor:'21.5k'}}});const net=new Network(store),club=new Club(store,net,dir);const out={dir,store,net,club};instances.push(out);return out;};}
async function host(t){const make=fixture(t),h=make('Club');h.club.enable('Club PC');await h.net.start();h.address='127.0.0.1:'+h.net.port;return {h,make};}
async function join(h,c){await c.club.connect({address:h.address,code:h.net.clubCode,name:'Laptop'});}
async function until(fn){for(let n=0;n<150;n++){if(fn())return;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected club state was not reached');}
function approve(c,id,confirmConflict=false){const p=c.preview(id);c.review({id,token:p.token,decision:'accept',confirmConflict});}
test('schema 10 migrates safely; club proposals remain private in public exports',()=>{const old=new Store().snapshot();old.schema=10;delete old.club;const next=migrate(old);assert.equal(next.schema,11);assert.equal(next.club,null);assert.equal(old.club,undefined);});
test('dealership computer edits queue; approval is atomic, durable and cannot be replayed',async t=>{const {h}=await host(t),id=h.store.data.cars[0].id;const result=await h.club.mutate('car.save',{id,revision:1,data:{technical:{motor:'25k'}}});assert.equal(result.queued,true);assert.equal(h.store.data.cars[0].technical.motor,'21.5k');const q=h.store.data.club.proposals[0];approve(h.club,q.id);assert.equal(h.store.data.cars[0].technical.motor,'25k');assert.equal(new Store(h.store.file).data.club.proposals[0].status,'accepted');assert.throws(()=>approve(h.club,q.id),/already/);});
test('simultaneous edits need a new current comparison and explicit conflict confirmation',async t=>{const {h}=await host(t),id=h.store.data.cars[0].id;await h.club.mutate('car.save',{id,revision:1,data:{technical:{motor:'25k'}}});const a=h.store.data.club.proposals[0].id;await h.club.mutate('car.save',{id,revision:1,data:{technical:{motor:'30k'}}});const b=h.store.data.club.proposals[0].id,old=h.club.preview(b);approve(h.club,a);assert.throws(()=>h.club.review({id:b,token:old.token,decision:'accept',confirmConflict:true}),/changed again/);const p=h.club.preview(b);assert.equal(p.conflict,true);assert.ok(p.changes.some(r=>r.before==='25k'&&r.after==='30k'));assert.throws(()=>approve(h.club,b),/confirm/);approve(h.club,b,true);assert.equal(h.store.data.cars[0].technical.motor,'30k');});
test('approval revalidates stock and never partially installs unavailable inventory',async t=>{const {h}=await host(t);h.store.mutate('part.save',{data:{name:'Only motor',quantity:1,tracking:'quantity'}});h.store.mutate('car.save',{data:{name:'Second'}});const partId=h.store.data.parts[0].id;for(const c of h.store.data.cars)await h.club.mutate('part.install',{carId:c.id,partId,quantity:1,field:'motor'});const [a,b]=h.store.data.club.proposals;approve(h.club,a.id);const before=h.store.snapshot(),p=h.club.preview(b.id);assert.match(p.error,/stock|quantity/i);assert.throws(()=>approve(h.club,b.id,true),/stock|quantity/i);assert.deepEqual(h.store.data,before);});
test('save failure leaves proposal pending and car unchanged',async t=>{const {h}=await host(t);await h.club.mutate('car.save',{id:h.store.data.cars[0].id,revision:1,data:{name:'Changed'}});const before=h.store.snapshot(),save=h.store.persist;h.store.persist=()=>{throw Error('disk full');};assert.throws(()=>approve(h.club,h.store.data.club.proposals[0].id),/disk full/);assert.deepEqual(h.store.data,before);h.store.persist=save;});
test('three computers share approved changes by push; personal collections remain separate',async t=>{const {h,make}=await host(t),a=make('Personal'),b=make('Laptop');const personal=a.store.snapshot();await join(h,a);await join(h,b);assert.equal(a.club.state,'connected');assert.equal(a.club.cache.data.club.replica,true);assert.equal(a.club.cache.data.timing.key,null);const n=h.store.data.catalogueRevision;assert.equal(a.club.cache.data.catalogueRevision,n);const id=a.club.cache.data.cars[0].id;await a.club.mutate('car.save',{id,revision:1,data:{name:'Shared Lexus'}});await until(()=>b.club.cache.data.club.proposals.length===1);assert.equal(b.club.cache.data.catalogueRevision,n);assert.equal(b.club.cache.data.cars[0].name,'Club car');approve(h.club,h.store.data.club.proposals[0].id);await until(()=>b.club.cache.data.cars[0].name==='Shared Lexus');await until(()=>a.club.cache.data.cars[0].name==='Shared Lexus');assert.equal(h.store.data.catalogueRevision,n+1);assert.equal(a.club.cache.data.catalogueRevision,n+1);assert.equal(b.club.cache.data.catalogueRevision,n+1);assert.deepEqual(a.store.data,personal);assert.throws(()=>a.club.assertHost(),/cannot host/);assert.throws(()=>a.club.preview(h.store.data.club.proposals[0].id),/dealership computer/);});
test('outdated reconnect requires confirmed replacement with a recoverable backup',async t=>{const {h,make}=await host(t),a=make('Personal');await join(h,a);a.club.disconnect();const old=a.club.cache.snapshot();h.store.mutate('car.save',{id:h.store.data.cars[0].id,revision:1,data:{name:'Latest'}});await join(h,a);assert.equal(a.club.state,'outdated');assert.deepEqual(a.club.cache.data,old);await assert.rejects(a.club.mutate('car.save',{data:{name:'Offline'}}),/out of date/);await assert.rejects(a.club.update(old.revision),/changed while/);await a.club.update(h.store.data.revision);assert.equal(a.club.cache.data.cars[0].name,'Latest');assert.deepEqual(JSON.parse(fs.readFileSync(a.club.backupPath)).database,old);assert.equal(a.store.data.cars[0].name,'Personal car');});
test('distinct club permission, database identity and Origin checks protect private snapshots',async t=>{const {h}=await host(t);async function get(code,headers={}){return fetch('http://'+h.address+'/v1/club/snapshot',{headers:{Authorization:'Bearer '+code,'X-SlotForge-Database':h.store.data.id,...headers}});}assert.equal((await get(h.net.code)).status,403);assert.equal((await get(h.net.browseCode)).status,403);assert.equal((await get(h.net.timingCode)).status,403);assert.equal((await get(h.net.clubCode,{'X-SlotForge-Database':'wrong'})).status,409);assert.equal((await get(h.net.clubCode,{Origin:'http://example.test'})).status,403);const data=await (await get(h.net.clubCode)).json();assert.equal(data.id,h.store.data.id);assert.equal(data.timing.key,null);});
test('uncertain delivery retries the same durable proposal without duplicates across restart',async t=>{const {h,make}=await host(t),a=make('Personal');await join(h,a);const request=a.club.request.bind(a.club);a.club.request=async(route,body)=>{const r=await request(route,body);if(route.endsWith('/proposals'))throw Error('lost acknowledgement');return r;};await a.club.mutate('car.save',{id:a.club.cache.data.cars[0].id,revision:1,data:{name:'Once'}});assert.equal(a.club.device.outbox.length,1);assert.equal(h.store.data.club.proposals.length,1);const saved=readOutbox(a);assert.equal(saved.length,1);a.club.request=request;await a.club.sendOutbox();assert.equal(a.club.device.outbox.length,0);assert.equal(h.store.data.club.proposals.length,1);const input=saved[0];const original=h.club.receive(input);assert.equal(original.duplicate,true);assert.throws(()=>h.club.receive({...input,device:'Other'}),/different content/);approve(h.club,input.id);assert.equal(h.club.receive(input).status,'accepted');assert.equal(new Store(h.store.file).data.club.proposals[0].status,'accepted');});
function readOutbox(a){return JSON.parse(fs.readFileSync(a.club.file)).outbox;}

test('approving an already received car package still advances and replicates the review decision',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);
 const donor=new Store(),id=donor.mutate('car.save',{data:{name:'Imported once'}}).result;
 const pack=require('../src/store.cjs').makePackage(donor.data,[id]);
 await h.club.mutate('submission.add',{package:pack});await h.club.mutate('submission.add',{package:pack});
 const [first,second]=h.store.data.club.proposals;approve(h.club,first.id);
 const revision=h.store.data.revision;approve(h.club,second.id,true);
 assert.equal(h.store.data.revision,revision+1);assert.equal(h.store.data.submissions.length,1);
 await until(()=>a.club.cache.data.club.proposals.every(p=>p.status==='accepted'));
 assert.equal(new Store(h.store.file).data.revision,h.store.data.revision);
});

test('failed outbox saves cannot enqueue an unpersisted proposal or forget an acknowledged one',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);
 const save=a.club.saveDevice.bind(a.club);a.club.saveDevice=()=>{throw Error('disk full');};
 await assert.rejects(a.club.mutate('car.save',{data:{name:'Not durable'}}),/disk full/);
 assert.equal(a.club.device.outbox.length,0);assert.equal(h.store.data.club.proposals.length,0);
 a.club.saveDevice=save;const request=a.club.request.bind(a.club);
 a.club.request=async()=>{throw Error('offline');};await a.club.mutate('car.save',{data:{name:'Keep retry'}});
 assert.equal(readOutbox(a).length,1);a.club.request=request;a.club.saveDevice=()=>{throw Error('disk full');};
 await a.club.sendOutbox();assert.equal(h.store.data.club.proposals.length,1);
 assert.equal(a.club.device.outbox.length,1);assert.equal(readOutbox(a).length,1);
 a.club.saveDevice=save;await a.club.sendOutbox();assert.equal(a.club.device.outbox.length,0);assert.equal(h.store.data.club.proposals.length,1);
});

test('an unrelated or malformed successful response cannot acknowledge an outbox proposal',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);const request=a.club.request.bind(a.club);
 a.club.request=async()=>({});await a.club.mutate('car.save',{data:{name:'Needs receipt'}});
 assert.equal(a.club.device.outbox.length,1);
 for(const reply of [{id:'wrong',status:'pending'},{id:a.club.device.outbox[0].id,status:'unknown'}]){
  a.club.request=async()=>reply;await a.club.sendOutbox();assert.equal(a.club.device.outbox.length,1);
 }
 a.club.request=request;await a.club.sendOutbox();assert.equal(a.club.device.outbox.length,0);
});

test('quiet reconnection notifies the UI and clears the old connection error',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);a.club.disconnect();
 a.club.lastError='Temporary network failure';const states=[];a.club.notify=()=>states.push(a.club.status());
 await a.club.reconnect();assert.equal(a.club.state,'connected');assert.equal(a.club.lastError,'');
 assert.ok(states.some(s=>s.state==='connected'&&!s.lastError));
});

test('a failed initial snapshot does not strand the computer paired with an unusable dealership',async t=>{
 const {h,make}=await host(t),a=make('Personal'),before=structuredClone(a.club.device),request=a.club.request.bind(a.club);
 a.club.request=async()=>{throw Error('Snapshot interrupted');};
 await assert.rejects(join(h,a),/Snapshot interrupted/);
 assert.deepEqual(a.club.device,before);assert.deepEqual(JSON.parse(fs.readFileSync(a.club.file)),before);
 assert.equal(a.club.active,false);assert.equal(a.club.code,undefined);
 a.club.request=request;await join(h,a);assert.equal(a.club.state,'connected');
});

test('a failed explicit outbox discard keeps the retry list in memory and on disk',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);
 a.club.request=async()=>{throw Error('offline');};await a.club.mutate('car.save',{data:{name:'Retain on failure'}});
 a.club.saveDevice=()=>{throw Error('disk full');};assert.throws(()=>a.club.discardOutbox(),/disk full/);
 assert.equal(a.club.device.outbox.length,1);assert.equal(readOutbox(a).length,1);
 assert.equal(JSON.parse(fs.readFileSync(a.club.backupPath)).proposals.length,1);
});

test('leaving stays paired on a settings save failure and handles a failed copy cleanup safely',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);
 const save=a.club.saveDevice.bind(a.club),pair=structuredClone(a.club.device.pair);
 a.club.saveDevice=()=>{throw Error('disk full');};assert.throws(()=>a.club.leave(),/disk full/);
 assert.deepEqual(a.club.device.pair,pair);assert.equal(a.club.active,true);
 a.club.saveDevice=save;const persist=a.club.cache.persist.bind(a.club.cache);
 a.club.cache.persist=()=>{throw Error('copy locked');};a.club.leave();
 assert.equal(a.club.active,false);assert.equal(a.club.device.pair,null);assert.equal(a.club.status().hasCopy,false);
 assert.equal(JSON.parse(fs.readFileSync(a.club.file)).pair,null);assert.match(a.club.lastError,/copy locked/);
 a.club.cache.persist=persist;
 const other=make('Other dealership');other.club.enable('Other');await other.net.start();other.address='127.0.0.1:'+other.net.port;
 await join(other,a);assert.equal(a.club.cache.data.id,other.store.data.id);assert.equal(a.club.state,'connected');
});
test('small text deltas do not resend an unchanged photograph and reject unsafe paths',()=>{const a={revision:1,cars:[{name:'Old',picture:'data:image/jpeg;base64,'+'A'.repeat(100000)}]},b=structuredClone(a);b.revision=2;b.cars[0].name='New';const delta=M.delta(a,b);assert.ok(JSON.stringify(delta).length<300);assert.deepEqual(M.apply(a,delta),b);assert.throws(()=>M.apply(a,[{path:['__proto__','polluted'],value:true}]),/key/);});
test('outdated copies cannot re-host even if restored as a local database',async t=>{const {h,make}=await host(t),a=make('Personal');await join(h,a);const db=a.club.cache.snapshot();a.club.active=false;a.store.replace(db);a.club.device.coordinator=db.club.id;assert.equal(a.club.coordinator,false);await assert.rejects(a.net.start(),/cannot host/);});


test('complete car forms keep only changed fields and omit unchanged photographs',async t=>{
 const {h}=await host(t),car=h.store.data.cars[0];car.picture='data:image/png;base64,iVBORw0KGgo=';
 const full={name:car.name,picture:car.picture,technical:{...car.technical,gear:'27'}};
 await h.club.mutate('car.save',{id:car.id,revision:car.revision,data:full});
 const proposal=h.store.data.club.proposals[0];assert.deepEqual(proposal.payload.data,{technical:{gear:'27'}});
 h.store.mutate('car.save',{id:car.id,revision:car.revision,data:{name:'Latest name'}});approve(h.club,proposal.id,true);
 assert.equal(h.store.data.cars[0].name,'Latest name');assert.equal(h.store.data.cars[0].technical.gear,'27');
});

test('record insertion does not resend attachments in older review items',()=>{
 const a={revision:1,items:[{id:'old',picture:'data:'+ 'A'.repeat(100000),status:'pending'}]},b=structuredClone(a);
 b.revision++;b.items.unshift({id:'new',name:'Small proposal'});
 const changes=M.delta(a,b);assert.ok(JSON.stringify(changes).length<400);assert.deepEqual(M.apply(a,changes),b);
 b.items[1].status='accepted';const again=M.delta(M.apply(a,changes),b);assert.ok(JSON.stringify(again).length<400);assert.deepEqual(M.apply(M.apply(a,changes),again),b);
 b.items.reverse();assert.deepEqual(M.apply(a,M.delta(a,b)),b);b.items=[];assert.deepEqual(M.apply(a,M.delta(a,b)),b);
});

test('an older queued push is ignored after catching up to a newer revision',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);a.club.abort.abort();clearTimeout(a.club.watchdog);
 h.store.mutate('car.save',{data:{name:'Second'}});const first=h.store.data.revision;
 h.store.mutate('car.save',{data:{name:'Third'}});await a.club.catchUp(first);await a.club.catchUp(first);
 assert.equal(a.club.state,'connected');assert.equal(a.club.cache.data.revision,h.store.data.revision);
});

test('full refresh invalidates an in-flight delta before replacing the cache',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);a.club.abort.abort();clearTimeout(a.club.watchdog);
 h.store.mutate('car.save',{data:{name:'Second'}});
 const request=a.club.request.bind(a.club);let release,entered;const ready=new Promise(r=>entered=r);
 a.club.request=async(route,body)=>{const value=await request(route,body);if(route.includes('/changes')){entered();await new Promise(r=>release=r);}return value;};
 const caught=a.club.catchUp(h.store.data.revision);await ready;
 h.store.mutate('car.save',{data:{name:'Third'}});await a.club.update(h.store.data.revision);release();await caught;
 assert.equal(a.club.cache.data.revision,h.store.data.revision);assert.equal(a.club.cache.data.cars.length,3);
});

test('club copy and unsent outbox survive an app restart without storing the password',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);
 const request=a.club.request.bind(a.club);a.club.request=async(route,body)=>{const value=await request(route,body);if(route.endsWith('/proposals'))throw Error('lost response');return value;};
 await a.club.mutate('car.save',{id:a.club.cache.data.cars[0].id,revision:1,data:{name:'Retry after restart'}});
 a.club.close();a.club=new Club(a.store,a.net,a.dir);assert.equal(a.club.device.outbox.length,1);assert.equal(a.club.code,undefined);
 assert.ok(!fs.readFileSync(a.club.file,'utf8').includes(h.net.clubCode));assert.equal(a.club.active,false);
 a.club.switch(true);assert.equal(a.club.state,'offline');await join(h,a);await a.club.sendOutbox();assert.equal(h.store.data.club.proposals.length,1);
 assert.equal(a.club.device.outbox.length,0);
});

test('discarding unsent proposals saves a recovery copy without withdrawing a received proposal',async t=>{
 const {h,make}=await host(t),a=make('Personal');await join(h,a);const request=a.club.request.bind(a.club);
 a.club.request=async(route,body)=>{const r=await request(route,body);if(route.endsWith('/proposals'))throw Error('lost response');return r;};
 await a.club.mutate('car.save',{data:{name:'Possibly received'}});assert.throws(()=>a.club.leave(),/Retry/);
 a.club.discardOutbox();assert.equal(JSON.parse(fs.readFileSync(a.club.backupPath)).proposals.length,1);assert.equal(h.store.data.club.proposals[0].status,'pending');
 a.club.leave();assert.equal(a.club.active,false);assert.equal(a.store.data.cars[0].name,'Personal car');
});

test('Timing sessions remain readable in protected copies without leaking the capture signing key',async t=>{
 const {fixtures}=require('./support/timing-fixtures.cjs'),timing=require('../src/timing-integration.cjs');
 const {h,make}=await host(t),f=fixtures();h.store.replace({...f.store.snapshot(),club:h.store.data.club});h.address='127.0.0.1:'+h.net.port;
 timing.receive(h.store,f.normal);const a=make('Personal');await join(h,a);
 assert.equal(a.club.cache.data.timing.sessions.length,1);assert.equal(a.club.cache.data.timing.key,null);
 assert.ok(!JSON.stringify(a.club.cache.data).includes(h.store.data.timing.key));
 assert.equal(new Store(a.club.cache.file).data.timing.sessions.length,1);
 const exported=require('../src/store.cjs').makePackage(h.store.data,['car-a']);assert.equal(exported.club,undefined);
 const response=await fetch('http://'+h.address+'/v1/collection',{headers:{Authorization:'Bearer '+h.net.browseCode}});const publicData=await response.json();assert.equal(publicData.club,undefined);
});

test('club access can be revoked independently and malformed proposals never alter records',async t=>{
 const {h}=await host(t),before=h.store.snapshot(),base='http://'+h.address;
 const headers={Authorization:'Bearer '+h.net.clubCode,'X-SlotForge-Database':h.store.data.id,'Content-Type':'application/json'};
 for(const body of ['{',JSON.stringify({action:'car.save',payload:{}})]){const r=await fetch(base+'/v1/club/proposals',{method:'POST',headers,body});assert.equal(r.status,400);}
 assert.deepEqual(h.store.data,before);const oldCode=h.net.clubCode;h.net.controls({access:'club',password:'new club password'});
 assert.equal((await fetch(base+'/v1/club/snapshot',{headers})).status,401);assert.ok(h.net.access(h.net.code)?.submit);assert.equal(h.net.access(oldCode),null);
});
