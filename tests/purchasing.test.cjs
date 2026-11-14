'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase,makePackage}=require('../src/store.cjs'),P=require('../src/purchasing.cjs'),Model=require('../renderer/build-model.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
function fixture(){const s=new Store(),carId=act(s,'car.save',{data:{name:'Project car',privateNotes:'Keep private'}}),partId=act(s,'part.save',{data:{name:'Motor',tracking:'quantity',quantity:0}}),jobId=act(s,'job.start',{kind:'general',carId,name:'Motor service'});return {s,carId,partId,jobId};}
function legacy(x){const row=(id,extra={})=>({id,partId:x.partId,jobId:'',quantity:5,received:2,notes:'Original note',supplier:'Shop',date:'2026-12-01',created:'legacy-created',updated:'legacy-updated',...extra});x.s.transact(db=>{db.parts[0].quantity=6;db.planning.shopping=[row('general-line'),row('job-line',{jobId:x.jobId}),row('build-line',{buildId:'old-build',buildName:'Old build',buildCarId:x.carId})];delete db.planning.purchasingVersion;delete db.planning.shoppingLists;});return x;}
function disk(t,s){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-purchasing-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'db.sqlite'));store.replace(s.snapshot());return {dir,store};}

test('transactional legacy upgrade preserves identities, source links and unknown historic dates',()=>{
 const x=legacy(fixture()),before=x.s.snapshot();act(x.s,'planning.shopping.migrate');const after=x.s.snapshot();
 assert.equal(after.planning.purchasingVersion,1);assert.equal(after.planning.shoppingLists.length,3);
 for(let i=0;i<3;i++){const {purchase,...original}=after.planning.shopping[i];assert.deepEqual(original,before.planning.shopping[i]);assert.equal(purchase.ordered,0);assert.equal(purchase.legacyReceived,2);assert.deepEqual(purchase.receipts,[]);assert.deepEqual(P.counts(after.planning.shopping[i]),{toBuy:3,ordered:0,received:2});}
 for(const key of ['parts','cars','jobs','timing','supplies','buildDrafts'])assert.deepEqual(after[key],before[key]);
 const saved=structuredClone(after.planning);act(x.s,'planning.shopping.migrate');assert.deepEqual(x.s.data.planning,saved);
});
test('opening a legacy SQLite collection does not rewrite it or force a full-model migration',t=>{
 const x=legacy(fixture()),{store}=disk(t,x.s),bytes=fs.readFileSync(store.file),s=new Store(store.file,{deferred:true});
 assert.ok(s.deferredState);assert.deepEqual(fs.readFileSync(store.file),bytes);assert.equal(new Store(store.file).data.planning.purchasingVersion,undefined);
 const reads=s.deferredState.stats;s.mutate('planning.shopping.migrate',{revision:s.data.revision},{snapshot:false});assert.ok(s.deferredState);assert.ok(!reads.loadedSections.includes('timing.sessions'));assert.ok(!reads.loadedSections.includes('buildDrafts'));
 assert.equal(new Store(store.file).data.planning.purchasingVersion,1);
});
test('first legacy receipt migrates the baseline before recording the new delivery',()=>{
 const x=legacy(fixture());act(x.s,'planning.receive',{partId:x.partId,shoppingId:'job-line',quantity:1,confirmed:true});const line=x.s.data.planning.shopping[1];
 assert.equal(line.received,3);assert.equal(line.purchase.legacyReceived,2);assert.equal(line.purchase.receipts.length,1);assert.equal(line.purchase.receipts[0].quantity,1);assert.equal(line.purchase.receipts[0].fromOrdered,0);assert.equal(line.purchase.receipts[0].receivedAt,line.updated);assert.equal(x.s.data.parts[0].quantity,7);assert.equal(line.jobId,x.jobId);
});
test('ordered quantities are separate from stock and partial receipts consume orders first',()=>{
 const x=fixture(),id=act(x.s,'planning.shopping.add',{partId:x.partId,quantity:6});x.s.transact(db=>{db.planning.shopping[0].purchase.ordered=4;});
 assert.equal(x.s.data.parts[0].quantity,0);assert.deepEqual(P.counts(x.s.data.planning.shopping[0]),{toBuy:2,ordered:4,received:0});
 act(x.s,'planning.receive',{partId:x.partId,shoppingId:id,quantity:2,confirmed:true});assert.deepEqual(P.counts(x.s.data.planning.shopping[0]),{toBuy:2,ordered:2,received:2});
 act(x.s,'planning.receive',{partId:x.partId,shoppingId:id,quantity:3,confirmed:true});const line=x.s.data.planning.shopping[0];assert.deepEqual(P.counts(line),{toBuy:1,ordered:0,received:5});assert.deepEqual(line.purchase.receipts.map(r=>[r.quantity,r.fromOrdered]),[[2,2],[3,2]]);assert.equal(x.s.data.installations.length,0);
});
test('future item descriptors distinguish catalogue parts, supplies and free text without fake stock IDs',()=>{
 for(const item of [{kind:'part',id:'part'},{kind:'supply',id:'supply'},{kind:'free',name:'Tyre gauge',maker:'',reference:''}])assert.doesNotThrow(()=>P.validateItem(item));
 for(const item of [null,{},[],{kind:'free',name:'',maker:'',reference:''},{kind:'free',name:'Gauge',maker:'',reference:'',id:'invented'},{kind:'part',id:'constructor'},{kind:'supply',id:'../stock'},{kind:'unknown',id:'stock'}])assert.throws(()=>P.validateItem(item));
 const x=fixture();act(x.s,'planning.shopping.add',{partId:x.partId,quantity:1});const bad=x.s.snapshot();bad.planning.shopping[0].purchase.item={kind:'supply',id:x.partId};assert.throws(()=>validateDatabase(bad),/identity does not match/);
});
test('malformed metadata, totals, lists, receipts and future versions fail without mutation',()=>{
 const x=fixture();act(x.s,'planning.shopping.add',{partId:x.partId,quantity:4});act(x.s,'planning.receive',{partId:x.partId,shoppingId:x.s.data.planning.shopping[0].id,quantity:1,confirmed:true});
 const changes=[db=>{db.planning.purchasingVersion=2;},db=>{delete db.planning.purchasingVersion;},db=>{db.planning.shoppingLists=[];},db=>{db.planning.shoppingLists.push({...db.planning.shoppingLists[0]});},db=>{db.planning.shopping[0].purchase.listId='missing';},db=>{db.planning.shopping[0].purchase.item.id='another';},db=>{db.planning.shopping[0].purchase.ordered=4;},db=>{db.planning.shopping[0].purchase.ordered=true;},db=>{db.planning.shopping[0].purchase.legacyReceived=-1;},db=>{db.planning.shopping[0].purchase.receipts[0].quantity=2;},db=>{db.planning.shopping[0].purchase.receipts[0].fromOrdered=2;},db=>{db.planning.shopping[0].purchase.receipts[0].receivedAt='2026-02-30T00:00:00.000Z';},db=>{db.planning.shopping[0].purchase.receipts.push({...db.planning.shopping[0].purchase.receipts[0]});}];
 for(const mutate of changes){const before=x.s.snapshot();assert.throws(()=>x.s.transact(mutate));assert.deepEqual(x.s.snapshot(),before);}
});
test('a pre-upgrade client can add a legacy line without losing current purchase metadata',()=>{
 const x=fixture();act(x.s,'planning.shopping.add',{partId:x.partId,jobId:x.jobId,quantity:2});const before=structuredClone(x.s.data.planning.shopping[0]);
 x.s.transact(db=>{const row=structuredClone(before);delete row.purchase;row.id='older-client-line';db.planning.shopping.push(row);});
 act(x.s,'planning.shopping.migrate');assert.deepEqual(x.s.data.planning.shopping[0],before);assert.equal(x.s.data.planning.shopping[1].purchase.listId,before.purchase.listId);assert.equal(x.s.data.planning.shoppingLists.length,2);
});
test('purchase migration and new receipt roll back together on persistence failure',()=>{
 const x=legacy(fixture()),before=x.s.snapshot();x.s.persist=()=>{throw Error('Disk full');};
 assert.throws(()=>act(x.s,'planning.receive',{partId:x.partId,shoppingId:'general-line',quantity:1,confirmed:true}),/Disk full/);assert.deepEqual(x.s.snapshot(),before);
 assert.throws(()=>act(x.s,'planning.shopping.migrate'),/Disk full/);assert.deepEqual(x.s.snapshot(),before);
});
test('durable receipt retries survive restart and conflicting retries cannot add stock twice',t=>{
 const x=fixture(),line=act(x.s,'planning.shopping.add',{partId:x.partId,quantity:4}),{store}=disk(t,x.s),R=require('../src/command-receipts.cjs'),sql=require('../src/sqlite-storage.cjs');
 const command={id:'receipt-command',databaseId:store.data.id,epoch:sql.syncState(store.file).epoch,action:'planning.receive',payload:{revision:store.data.revision,partId:x.partId,shoppingId:line,quantity:2,confirmed:true}};
 const first=R.execute(new Store(store.file,{deferred:true}),command),second=R.execute(new Store(store.file,{deferred:true}),command);assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
 const saved=new Store(store.file);assert.equal(saved.data.parts[0].quantity,2);assert.equal(saved.data.planning.shopping[0].purchase.receipts.length,1);
 assert.throws(()=>R.execute(new Store(store.file,{deferred:true}),{...command,payload:{...command.payload,quantity:1}}),{code:'COMMAND_CONFLICT'});assert.equal(new Store(store.file).data.parts[0].quantity,2);
});
test('portable backup preserves purchasing and restore rejects an uncertain old receipt',t=>{
 const x=fixture(),line=act(x.s,'planning.shopping.add',{partId:x.partId,jobId:x.jobId,quantity:3});act(x.s,'planning.receive',{partId:x.partId,shoppingId:line,quantity:1,confirmed:true});
 const {store,dir}=disk(t,x.s),B=require('../src/portable-backup.cjs'),R=require('../src/command-receipts.cjs'),cmd={id:'uncertain-receipt',databaseId:store.data.id,epoch:require('../src/sqlite-storage.cjs').syncState(store.file).epoch,action:'planning.receive',payload:{revision:store.data.revision,partId:x.partId,shoppingId:line,quantity:1,confirmed:true}};
 B.exportBackup(store.file,path.join(dir,'purchase.sfpbackup'));const target=path.join(dir,'restored.sqlite');B.stageBackup(path.join(dir,'purchase.sfpbackup'),target);assert.deepEqual(new Store(target).data.planning,store.data.planning);assert.throws(()=>R.execute(new Store(target,{deferred:true}),cmd),{code:'COMMAND_EPOCH_CHANGED'});
});
test('build edits and deletion retain placed orders and keep one linked purchase identity',()=>{
 const x=fixture(),data={...Model.blank(),name:'Build',parts:[{key:'motor',partId:x.partId,name:'Motor',quantity:4,slot:'motor',position:'Motor'}]},draft=act(x.s,'build.draft.save',{data});
 const id=x.s.data.planning.shopping[0].id,list=x.s.data.planning.shopping[0].purchase.listId;x.s.transact(db=>{db.planning.shopping[0].purchase.ordered=3;});
 data.parts=[];act(x.s,'build.draft.save',{id:draft,data});let row=x.s.data.planning.shopping[0];assert.equal(row.id,id);assert.equal(row.quantity,4);assert.equal(row.purchase.listId,list);assert.deepEqual(P.counts(row),{toBuy:1,ordered:3,received:0});
 assert.throws(()=>act(x.s,'planning.shopping.remove',{id}),/Cancel/);act(x.s,'build.draft.delete',{id:draft});row=x.s.data.planning.shopping[0];assert.equal(row.quantity,4);assert.equal(row.buildId,draft);
 act(x.s,'planning.receive',{partId:x.partId,shoppingId:id,quantity:3,confirmed:true});assert.equal(x.s.data.parts[0].quantity,3);assert.equal(x.s.data.planning.shopping[0].purchase.receipts.length,1);
});
test('rebuild and job purchases share a list and cancellation preserves ordered stock',()=>{
 const x=fixture();act(x.s,'job.cancel',{id:x.jobId,confirmed:true});const draft=act(x.s,'rebuild.start',{carId:x.carId}),plan=structuredClone(x.s.data.buildDrafts[0].data);plan.parts=[{key:'motor',partId:x.partId,name:'Motor',quantity:2,slot:'motor',position:'Motor'}];act(x.s,'build.draft.save',{id:draft,data:plan});
 act(x.s,'planning.shopping.add',{partId:x.partId,jobId:plan.rebuild.jobId,quantity:1});assert.equal(x.s.data.planning.shopping[0].purchase.listId,x.s.data.planning.shopping[1].purchase.listId);
 x.s.transact(db=>{db.planning.shopping[0].purchase.ordered=2;});act(x.s,'job.cancel',{id:plan.rebuild.jobId,confirmed:true});assert.equal(x.s.data.planning.shopping[0].quantity,2);assert.equal(x.s.data.planning.shopping[0].jobId,plan.rebuild.jobId);
});
test('purchasing metadata remains private and unrelated car edits preserve it',t=>{
 const x=fixture(),before=makePackage(x.s.data,[x.carId]);act(x.s,'planning.shopping.add',{partId:x.partId,jobId:x.jobId,quantity:1,notes:'Private purchasing note'});
 const pack=makePackage(x.s.data,[x.carId]);assert.deepEqual(pack.cars,before.cars);assert.ok(!JSON.stringify(pack).includes('Private purchasing note'));
 const {store}=disk(t,x.s),d=new Store(store.file,{deferred:true}),planning=structuredClone(store.data.planning);act(d,'car.save',{id:x.carId,revision:store.data.cars[0].revision,data:{name:'Renamed'}});assert.deepEqual(new Store(store.file).data.planning,planning);
});
test('ten thousand legacy purchases upgrade deterministically without duplicate lists',()=>{
 const x=fixture(),base={partId:x.partId,jobId:x.jobId,quantity:2,received:0,notes:'',supplier:'',date:'',created:'',updated:''};
 x.s.transact(db=>{db.planning.shopping=Array.from({length:10000},(_,i)=>({id:'line-'+i,...base}));});act(x.s,'planning.shopping.migrate');
 assert.equal(x.s.data.planning.shoppingLists.length,2);assert.equal(x.s.data.planning.shopping.length,10000);assert.equal(new Set(x.s.data.planning.shopping.map(l=>l.purchase.listId)).size,1);assert.equal(x.s.data.parts[0].quantity,0);
});
test('deleting a car detaches its live job link but retains purchasing provenance and receipts',()=>{
 const x=fixture(),line=act(x.s,'planning.shopping.add',{partId:x.partId,jobId:x.jobId,quantity:2});act(x.s,'planning.receive',{partId:x.partId,shoppingId:line,quantity:1,confirmed:true});
 const old=structuredClone(x.s.data.planning.shopping[0].purchase),lists=structuredClone(x.s.data.planning.shoppingLists);
 act(x.s,'car.delete',{id:x.carId,confirmed:true,confirmName:'Project car'});
 assert.equal(x.s.data.cars.length,0);assert.equal(x.s.data.planning.shopping[0].jobId,null);assert.deepEqual(x.s.data.planning.shopping[0].purchase,old);assert.deepEqual(x.s.data.planning.shoppingLists,lists);
 act(x.s,'planning.receive',{partId:x.partId,shoppingId:line,quantity:1,confirmed:true});assert.equal(x.s.data.parts[0].quantity,2);
});
