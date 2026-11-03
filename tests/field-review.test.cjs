const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),M=require('../src/club-model.cjs'),F=require('../src/field-review.cjs');
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-field-review-')),s=new Store(path.join(folder,'db.json'));s.mutate('car.save',{data:{name:'Car',livery:'Original'}});const n=new Network(s),c=new Club(s,n,folder);c.enable('Host','Test password');t.after(async()=>{c.close();await n.stop();n.close();fs.rmSync(folder,{recursive:true,force:true});});return {s,n,c,folder,id:s.data.cars[0].id};}
async function propose(x,data){await x.c.mutate('car.save',{id:x.id,revision:x.s.data.cars[0].revision,data});return x.s.data.club.proposals[0];}
function edit(x,data){return x.s.mutate('car.save',{id:x.id,revision:x.s.data.cars[0].revision,data});}
test('unrelated edits coexist and a reviewed comparison remains usable after another field changes',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'Proposed'});assert.ok(p.conditions);const preview=x.c.preview(p.id);assert.equal(preview.conflict,false);
 edit(x,{maker:'Unrelated maker'});assert.equal(x.c.preview(p.id).conflict,false);assert.equal(x.c.preview(p.id).token,preview.token);
 await x.c.reviewAsync({id:p.id,token:preview.token,decision:'accept'});assert.equal(x.s.data.cars[0].livery,'Proposed');assert.equal(x.s.data.cars[0].maker,'Unrelated maker');assert.equal(new Store(x.s.file).data.club.proposals[0].status,'accepted');
 assert.equal(x.s.lastWrite.submittedRecords,7);assert.equal(x.s.lastWrite.assetWrites,0);assert.deepEqual(new Store(x.s.file).data,x.s.data);
});
test('proposal and rejection persistence submit only review metadata and preserve preceding recovery',async t=>{
 const x=fixture(t),before=x.s.snapshot(),p=await propose(x,{livery:'Proposed'});assert.equal(x.s.lastWrite.submittedRecords,2);assert.deepEqual(x.s.previousSnapshot(),before);
 const pending=x.s.snapshot(),v=x.c.preview(p.id);await x.c.reviewAsync({id:p.id,token:v.token,decision:'reject'});assert.equal(x.s.lastWrite.submittedRecords,2);assert.deepEqual(x.s.previousSnapshot(),pending);assert.deepEqual(new Store(x.s.file).data,x.s.data);
});
test('failed targeted approval leaves durable field versions and review receipt pending',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'Proposed'}),view=x.c.preview(p.id),before=x.s.snapshot(),{DatabaseSync}=require('node:sqlite');let db=new DatabaseSync(x.s.file);db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'review disk failure'); END");db.close();
 await assert.rejects(x.c.reviewAsync({id:p.id,token:view.token,decision:'accept'}),/review disk failure/);assert.deepEqual(x.s.data,before);assert.deepEqual(new Store(x.s.file).data,before);assert.equal(x.c.preview(p.id).token,view.token);
 db=new DatabaseSync(x.s.file);db.exec('DROP TRIGGER fail_review');db.close();await x.c.reviewAsync({id:p.id,token:view.token,decision:'accept'});assert.equal(new Store(x.s.file).data.cars[0].livery,'Proposed');
});
test('same-field ABA changes survive restart and require an explicit override',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'Proposed'}),before=x.c.preview(p.id);edit(x,{livery:'Intermediate'});edit(x,{livery:'Original'});
 assert.equal(F.inspect(new Store(x.s.file),p).conflict,true);const view=x.c.preview(p.id);assert.equal(view.conflict,true);assert.notEqual(view.token,before.token);
 assert.throws(()=>x.c.review({id:p.id,token:view.token,decision:'accept'}),/confirm/);x.c.review({id:p.id,token:view.token,decision:'accept',confirmConflict:true});assert.equal(x.s.data.cars[0].livery,'Proposed');
});
test('removed and restored fields, including extracted image strings, retain ABA evidence',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'Proposed'});x.s.transact(db=>delete db.cars[0].livery);edit(x,{livery:'Original'});assert.equal(F.inspect(new Store(x.s.file),p).conflict,true);
 edit(x,{livery:'data:image/png;base64,AAAA'});const image=await propose(x,{livery:'Text'});edit(x,{livery:'data:image/png;base64,BBBB'});edit(x,{livery:'data:image/png;base64,AAAA'});assert.equal(F.inspect(new Store(x.s.file),image).conflict,true);
});
test('pruned deletion history forces a conflict instead of trusting an ancient proposal',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'Proposed'});x.s.transact(db=>{delete db.cars[0].livery;db.revision+=10001;});edit(x,{livery:'Original'});assert.equal(F.inspect(new Store(x.s.file),p).conflict,true);
});
test('conditions cannot omit fields, cover stock dependencies or fake their digest',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'A',maker:'B'});for(const change of [q=>q.conditions.fields.pop(),q=>q.conditions.fields[0].present='yes',q=>q.conditions.revision=-1,q=>q.conditions.epoch='wrong',q=>q.payload.data.technical={motor:'Bypass'}]){const bad=structuredClone(p);change(bad);bad.base=M.hash(bad.conditions);assert.throws(()=>M.command(bad),/conditions|fields/);}
 const bad=structuredClone(p);bad.base='0'.repeat(64);assert.throws(()=>M.command(bad),/digest/);
 assert.equal(F.capture(x.s.data,'car.save',{id:x.id,data:{technical:{motor:'Other'}}},p.conditions.epoch),null);
});
test('missing, replaced, archived and expired starting states conflict conservatively',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'A'});x.s.mutate('car.archive',{id:x.id,revision:x.s.data.cars[0].revision});assert.equal(F.inspect(x.s,p).conflict,true);
 const restored=x.s.snapshot();restored.revision=0;x.s.replace(restored);assert.equal(F.inspect(x.s,p).conflict,true);
 const bad=structuredClone(p);bad.conditions.epoch=F.capability(x.s).epoch;bad.conditions.revision=100000;bad.base=M.hash(bad.conditions);assert.equal(F.inspect(x.s,bad).conflict,true);
});
test('old pending proposals retain their original whole-state comparison behaviour',async t=>{
 const x=fixture(t),p=await propose(x,{livery:'A'}),legacy={...p,id:'legacy',base:M.digest(x.s.data)};delete legacy.conditions;delete legacy.receiptHash;delete legacy.status;delete legacy.received;x.c.receive(legacy);assert.equal(x.c.preview('legacy').conflict,false);edit(x,{maker:'Changed'});assert.equal(x.c.preview('legacy').conflict,true);
});
test('host advertises the additive contract and paired clients use it without changing Timing permissions',async t=>{
 const x=fixture(t);await x.n.start();const address='127.0.0.1:'+x.n.port,status=await x.n.request(address,x.n.clubCode,'/v1/status');assert.equal(status.capabilities.clubFieldReview,1);assert.equal(status.clubFieldReview.version,1);assert.equal(status.permissions.timingResults,true);
 const folder=path.join(x.folder,'client'),s=new Store(path.join(folder,'db.json')),n=new Network(s),c=new Club(s,n,folder);t.after(async()=>{c.close();await n.stop();n.close();});
 await c.connect({address,code:x.n.clubCode,name:'Client'});assert.equal(c.device.pair.fieldReview.epoch,status.clubFieldReview.epoch);await c.mutate('car.save',{id:x.id,revision:c.store.data.cars[0].revision,data:{livery:'Remote'}});assert.ok(x.s.data.club.proposals[0].conditions);assert.equal(x.c.preview(x.s.data.club.proposals[0].id).conflict,false);
});
