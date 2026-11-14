'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{open}=require('../packages/shared-library/index.cjs');
test('Timing and Paddock workers retain purchase lists and receipts while editing the same car',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-purchase-shared-')),handles=[];
 t.after(async()=>{await Promise.all(handles.map(h=>h.close()));fs.rmSync(root,{recursive:true,force:true});});
 const start=async name=>{const h=await open({application:'SlotForge '+name,installationId:name,sharedRoot:root,legacyProfiles:[]});handles.push(h);return h;};
 const timing=await start('Timing'),paddock=await start('Paddock'),status=await timing.status(),identity={databaseId:status.databaseId,recoveryId:status.recoveryId};
 const created=await timing.carWrite({...identity,operationId:'create',action:'create',set:{name:'Shared purchase car'}});
 const store=new Store(status.file,{deferred:true}),act=(action,p={})=>store.mutate(action,{revision:store.data.revision,...p},{snapshot:false}).result;
 const part=act('part.save',{data:{name:'Shared motor',tracking:'quantity',quantity:0}}),job=act('job.start',{carId:created.car.id,kind:'general',name:'Motor work'}),line=act('planning.shopping.add',{partId:part,jobId:job,quantity:3});
 act('planning.shopping.edit',{id:line,unitPrice:'4.25',currency:'EUR',supplier:'Shared supplier'});act('planning.order.place',{entries:[{id:line,quantity:3}],confirmed:true});act('planning.delivery.receive',{entries:[{id:line,quantity:2}],confirmed:true});act('planning.receipt.correct',{id:line,receiptId:store.data.planning.shopping.find(l=>l.id===line).purchase.receipts[0].id,quantity:1,restoreOrdered:true,reason:'Correct shared intake',confirmed:true});
 const list=act('planning.list.save',{name:'Shared workshop purchases'}),supply=act('supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:0}});act('planning.shopping.add',{item:{kind:'supply',id:supply},quantity:2,listId:list});act('planning.shopping.add',{item:{kind:'free',name:'Gauge',maker:'',reference:''},quantity:1,listId:list});const data={...require('../renderer/build-model.js').blank(),name:'Shared build',parts:[{key:'motor',partId:part,name:'Shared motor',quantity:3,slot:'motor',position:'Motor'}]};act('build.draft.save',{data});act('planning.shopping.reconcile');act('planning.checklist.edit',{id:line,quantity:5});act('planning.checklist.done',{id:line,done:true});act('planning.checklist.delete',{id:line});const baseline=new Store(status.file).snapshot();
 const car=await timing.car(created.car.id);await timing.carWrite({...identity,operationId:'rename',action:'patch',carId:car.id,expectedRevision:car.revision,set:{name:'Timing edit after delivery'}});
 const seen=await paddock.car(car.id);assert.equal(seen.fields.name,'Timing edit after delivery');assert.deepEqual(new Store(status.file).data.planning,baseline.planning);assert.deepEqual(new Store(status.file).data.parts,baseline.parts);
 await paddock.carWrite({...identity,operationId:'class',action:'patch',carId:seen.id,expectedRevision:seen.revision,set:{raceClass:'GT3'}});
 assert.equal((await timing.car(car.id)).fields.raceClass,'GT3');assert.deepEqual(new Store(status.file).data.planning,baseline.planning);
});
test('SQL receipt failure leaves stock, purchase history and recovery cursor unchanged',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-purchase-failure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(path.join(root,'db.sqlite')),act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result;
 const part=act('part.save',{data:{name:'Motor',tracking:'quantity',quantity:0}}),line=act('planning.shopping.add',{partId:part,quantity:2}),before=store.snapshot();
 const R=require('../src/command-receipts.cjs'),sql=require('../src/sqlite-storage.cjs'),cursor=sql.syncState(store.file),db=new(require('node:sqlite').DatabaseSync)(store.file);
 try{R.ensure(db);db.exec("CREATE TRIGGER reject_purchase_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'receipt storage failed'); END;");}finally{db.close();}
 const command={id:'receipt-failure',databaseId:store.data.id,epoch:cursor.epoch,action:'planning.receive',payload:{revision:store.data.revision,partId:part,shoppingId:line,quantity:1,confirmed:true}};
 assert.throws(()=>R.execute(new Store(store.file,{deferred:true}),command),/receipt storage failed/);assert.deepEqual(new Store(store.file).snapshot(),before);assert.deepEqual(sql.syncState(store.file),cursor);assert.equal(R.lookupFile(store.file,command),null);
});
test('competing receipts from two open collections cannot over-receive stock',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-purchase-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(path.join(root,'db.sqlite')),act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result;
 const part=act('part.save',{data:{name:'Motor',tracking:'quantity',quantity:0}}),line=act('planning.shopping.add',{partId:part,quantity:3});
 const payload={revision:store.data.revision,partId:part,shoppingId:line,quantity:2,confirmed:true};
 const replies=await Promise.allSettled(['first','second'].map(commandId=>new Store(store.file,{deferred:true}).mutateAsync('planning.receive',payload,{snapshot:false,commandId})));
 assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);assert.equal(replies.filter(r=>r.status==='rejected').length,1);
 const saved=new Store(store.file).data;assert.equal(saved.parts[0].quantity,2);assert.equal(saved.planning.shopping[0].received,2);assert.equal(saved.planning.shopping[0].purchase.receipts.length,1);
});
