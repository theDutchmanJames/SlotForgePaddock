const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),encoding=require('../src/json-encoding.cjs');
const {Club}=require('../src/club.cjs'),M=require('../src/club-model.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-async-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,s:new Store(path.join(dir,'db.json'))};}
function gate(){let release;return {promise:new Promise(r=>release=r),release:()=>release()};}
test('idle callbacks cannot race a second queued write and run against the committed state',async()=>{
 const s=new Store(),hold=gate();let saves=0;const seen=[];
 s.persistAsync=async()=>{if(++saves===1)await hold.promise;};
 const first=s.transactAsync(db=>db.settings.name='First');
 const second=s.withIdle(()=>s.transactAsync(db=>db.settings.name='Second'));
 const third=s.withIdle(()=>{seen.push(s.data.settings.name);s.transact(db=>db.settings.name='Third');});
 hold.release();await Promise.all([first,second,third]);assert.deepEqual(seen,['Second']);assert.equal(s.data.settings.name,'Third');assert.equal(s.data.revision,3);
});
test('Timing profile capture waits for a proposal save and rechecks identity and credentials',async t=>{
 const {Network}=require('../src/network.cjs');
 for(const mode of ['normal','revoked','replaced'])await t.test(mode,async()=>{
  const s=new Store(),carId=s.mutate('car.save',{data:{name:'Race car'}}).result,net=new Network(s);
  const hold=gate(),entered=gate(),withIdle=s.withIdle.bind(s);s.persistAsync=async()=>hold.promise;
  try{
   const status=await net.start(),databaseId=s.data.id;
   const write=s.transactAsync(db=>{db.settings.name='Saved proposal';if(mode==='replaced')db.id='different-collection';});
   s.withIdle=fn=>{entered.release();return withIdle(fn);};
   const request=fetch(`http://127.0.0.1:${status.port}/v1/timing/cars/${carId}`,{headers:{Authorization:'Bearer '+status.code,'X-SlotForge-Database':databaseId},signal:AbortSignal.timeout(5000)});
   await entered.promise;assert.equal(s.data.timing.key,null);if(mode==='revoked')net.controls({rotate:true});hold.release();await write;
   const response=await request,body=await response.json();assert.equal(response.status,mode==='normal'?200:mode==='revoked'?401:409,JSON.stringify(body));
   if(mode==='normal'){assert.equal(body.car.id,carId);assert.ok(s.data.timing.key);}else assert.equal(s.data.timing.key,null);
  }finally{hold.release();await net.stop();net.close();}
 });
});
test('SQLite persistence preserves exact JSON exports, prior revision and restart state',async t=>{
 const {s}=fixture(t);s.mutate('car.save',{data:{name:'Before',picture:'data:image/jpeg;base64,'+'A'.repeat(80000)}});const before=s.snapshot();
 await s.transactAsync(db=>{db.cars[0].name='After 😀 " \\';});
 assert.equal(JSON.stringify(new Store(s.file).data),JSON.stringify(s.data));assert.deepEqual(s.previousSnapshot(),before);assert.deepEqual(new Store(s.file).data,s.data);
 const values={photo:s.data.cars[0].picture,notes:'😀\n"\\'.repeat(40000),invalidPhoto:'data:image/png;base64,AA"'};
 assert.equal(Buffer.concat([...encoding.buffers(values)]).toString(),JSON.stringify(values));
});
test('async commits serialize and publish only after durability; synchronous writers cannot overwrite them',async t=>{
 const {s}=fixture(t),hold=gate(),entered=gate(),persist=s.persistAsync.bind(s),before=s.snapshot();let events=0;s.subscribe(()=>events++);
 s.persistAsync=async db=>{entered.release();await hold.promise;return persist(db);};
 const first=s.transactAsync(db=>{db.settings.name='First';return 1;});await entered.promise;
 const second=s.transactAsync(db=>{assert.equal(db.settings.name,'First');db.settings.name='Second';return 2;});
 assert.deepEqual(s.data,before);assert.equal(events,0);
 assert.throws(()=>s.transact(()=>{}),/saving/);assert.throws(()=>s.replace(before),/saving/);assert.throws(()=>s.restore(before,before.revision),/saving/);
 hold.release();assert.deepEqual(await Promise.all([first,second]),[1,2]);assert.equal(events,2);assert.equal(s.data.revision,before.revision+2);assert.equal(new Store(s.file).data.settings.name,'Second');
});
test('failed asynchronous SQLite commit preserves committed data and releases the queue',async t=>{
 const {DatabaseSync}=require('node:sqlite'),{s}=fixture(t);s.mutate('settings.save',{name:'Committed'});const before=s.snapshot();
 let connection=new DatabaseSync(s.file);connection.exec("CREATE TRIGGER fail_write BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'injected storage failure'); END");connection.close();
 await assert.rejects(s.transactAsync(db=>db.settings.name='Lost'),/storage failure/);
 assert.deepEqual(s.data,before);assert.deepEqual(new Store(s.file).data,before);assert.equal(s.pendingWrite,null);
 connection=new DatabaseSync(s.file);connection.exec('DROP TRIGGER fail_write');connection.close();
 await s.transactAsync(db=>db.settings.name='Recovered');assert.equal(new Store(s.file).data.settings.name,'Recovered');
});
test('record, recovery and commit-marker failures roll back every SQLite change',async t=>{
 const {DatabaseSync}=require('node:sqlite'),{s}=fixture(t);s.mutate('settings.save',{name:'Committed'});
 for(const target of ['records','undo_records','state']){
  const before=s.snapshot(),previous=s.previousSnapshot();let notified=false;const unsubscribe=s.subscribe(()=>notified=true);
  let connection=new DatabaseSync(s.file);connection.exec(`CREATE TRIGGER fail_write BEFORE INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'injected ${target} failure'); END`);connection.close();
  await assert.rejects(s.transactAsync(db=>db.settings.name='Should not save'),/failure/);
  assert.deepEqual(s.data,before);assert.deepEqual(new Store(s.file).data,before);assert.deepEqual(s.previousSnapshot(),previous);assert.equal(notified,false);assert.equal(s.pendingWrite,null);unsubscribe();
  connection=new DatabaseSync(s.file);connection.exec('DROP TRIGGER fail_write');connection.close();
 }
});
test('a failed queued write does not discard the following successful transaction',async()=>{
 const s=new Store(),hold=gate();let calls=0;
 s.persistAsync=async()=>{if(++calls===1){await hold.promise;throw Error('disk full');}};
 const first=s.transactAsync(db=>db.settings.name='Failed'),rejected=assert.rejects(first,/disk full/);
 const second=s.transactAsync(db=>{assert.equal(db.revision,0);db.settings.name='Saved';});
 hold.release();await Promise.all([rejected,second]);assert.equal(s.data.revision,1);assert.equal(s.data.settings.name,'Saved');
});
test('concurrent duplicate proposals are acknowledged once, permissions rechecked after waiting, and receipts survive restart',async t=>{
 const {s,dir}=fixture(t),club=new Club(s,{},dir);t.after(()=>club.close());club.enable('Test','password');
 const input={id:'proposal',sourceId:'source',device:'Laptop',databaseId:s.data.id,clubId:s.data.club.id,base:M.digest(s.data),action:'car.save',payload:{data:{name:'Proposed'}},original:[]};
 const results=await Promise.all([club.receiveAsync(input),club.receiveAsync(input)]);assert.equal(results.filter(r=>r.duplicate).length,1);assert.equal(s.data.club.proposals.length,1);assert.equal(new Store(s.file).data.club.proposals.length,1);
 await assert.rejects(club.receiveAsync({...input,payload:{data:{name:'Different'}}}),/different content/);
 const hold=gate(),entered=gate(),persist=s.persistAsync.bind(s);s.persistAsync=async db=>{entered.release();await hold.promise;await persist(db);};
 const write=s.transactAsync(db=>db.settings.name='Saving');await entered.promise;
 let authorized=true;const denied=club.receiveAsync({...input,id:'denied'},()=>{assert.ok(authorized,'Permission revoked');});const rejection=assert.rejects(denied,/Permission revoked/);authorized=false;hold.release();await write;await rejection;assert.equal(s.data.club.proposals.length,1);
});
test('one history field produces a sparse proposal and approvals preserve other history and photos',async t=>{
 const {s,dir}=fixture(t),photo={id:'reference',name:'Reference',data:'data:image/png;base64,AAAA',caption:'',sourceUrl:''};
 s.mutate('car.save',{data:{name:'Car',realHistory:{team:'Original',classification:'Unverified',photos:[photo]}}});
 const club=new Club(s,{},dir);t.after(()=>club.close());club.enable('Test','password');const c=s.data.cars[0];let simulations=0;const simulate=club.simulation.bind(club);club.simulation=(...args)=>{simulations++;return simulate(...args);};
 await club.mutate('car.save',{id:c.id,revision:c.revision,data:{realHistory:{...c.realHistory,team:'New team'}}});assert.equal(simulations,1);
 const first=s.data.club.proposals[0];assert.deepEqual(first.payload.data.realHistory,{team:'New team'});assert.ok(JSON.stringify(first).length<2000);
 await club.mutate('car.save',{id:c.id,revision:c.revision,data:{realHistory:{...c.realHistory,classification:'Fantasy Livery'}}});const second=s.data.club.proposals[0];
 for(const proposal of [first,second]){const view=club.preview(proposal.id);club.review({id:proposal.id,token:view.token,decision:'accept',confirmConflict:true});}
 const saved=new Store(s.file).data.cars[0].realHistory;assert.equal(saved.team,'New team');assert.equal(saved.classification,'Fantasy Livery');assert.deepEqual(saved.photos,[photo]);
});
