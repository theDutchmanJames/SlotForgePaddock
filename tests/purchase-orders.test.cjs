'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),O=require('../src/purchase-orders.cjs'),Model=require('../renderer/build-model.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(){const s=new Store(),part=act(s,'part.save',{data:{name:'Tyres',tracking:'quantity',quantity:0}}),a=act(s,'planning.shopping.add',{partId:part,quantity:6,supplier:'Shop A',unitPrice:'1.25',currency:'eur'}),b=act(s,'planning.shopping.add',{partId:part,quantity:4,supplier:'Shop B'});return {s,part,a,b};}
const row=(s,id)=>s.data.planning.shopping.find(l=>l.id===id);
const batch=(s,action,entries)=>act(s,'planning.'+action,{entries:entries.map(([id,quantity])=>({id,quantity})),confirmed:true});
const correct=(s,id,receiptId,quantity,restoreOrdered=true)=>act(s,'planning.receipt.correct',{id,receiptId,quantity,restoreOrdered,reason:'Wrong intake quantity',confirmed:true});
function disk(t,s){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-orders-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'db.sqlite');new Store(file).replace(s.snapshot());return new Store(file,{deferred:true});}

test('bulk partial deliveries retain each source, capture prices and never reserve stock',()=>{
 const {s,part,a,b}=fixture();batch(s,'order.place',[[a,5],[b,4]]);assert.equal(s.data.parts[0].quantity,0);batch(s,'delivery.receive',[[a,2],[b,3]]);
 assert.equal(s.data.parts[0].quantity,5);assert.equal(require('../src/workshop.cjs').available(s.data,s.data.parts[0]),5);assert.equal(s.data.installations.length,0);
 assert.equal(row(s,a).purchase.ordered,3);assert.equal(row(s,b).purchase.ordered,1);assert.equal(row(s,a).purchase.receipts[0].quantity,2);assert.deepEqual(row(s,a).purchase.receipts[0].price,{minor:125,currency:'EUR'});
 act(s,'planning.shopping.edit',{id:a,unitPrice:'9.00',currency:'USD',supplier:'Changed supplier'});assert.equal(row(s,a).purchase.orderLog[0].supplier,'Shop A');assert.equal(row(s,a).purchase.receipts[0].price.currency,'EUR');assert.equal(row(s,a).partId,part);validateDatabase(s.snapshot());
});
test('whole delivery rolls back when a later line fails, including duplicated and stale requests',()=>{
 const {s,a,b}=fixture();const before=s.snapshot();for(const entries of [[[a,2],[b,5]],[[a,2],[a,1]],[[a,2],['missing',1]],[[a,1.2]],[[a,-1]]])assert.throws(()=>batch(s,'delivery.receive',entries));assert.deepEqual(s.snapshot(),before);
 assert.throws(()=>s.mutate('planning.order.place',{revision:-1,confirmed:true,entries:[{id:a,quantity:1}]}),/changed/);assert.throws(()=>act(s,'planning.order.place',{entries:[{id:a,quantity:1}]}),/confirm/i);assert.deepEqual(s.snapshot(),before);
});
test('split delivery reconciles only after all build allocations, retaining both build IDs',()=>{
 const s=new Store(),part=act(s,'part.save',{data:{name:'Axle',quantity:0,tracking:'quantity'}});
 const draft=name=>act(s,'build.draft.save',{data:{...Model.blank(),name,parts:[{key:'axle',partId:part,name:'Axle',quantity:2,slot:'',position:'Rear'}]}});
 const first=draft('Build one'),second=draft('Build two'),[a,b]=s.data.planning.shopping.map(l=>l.id);batch(s,'delivery.receive',[[a,2],[b,2]]);
 assert.equal(s.data.parts[0].quantity,4);assert.deepEqual(s.data.planning.shopping.map(l=>l.buildId),[first,second]);assert.deepEqual(s.data.planning.shopping.map(l=>l.received),[2,2]);assert.equal(s.data.buildDrafts.length,2);assert.equal(s.data.cars.length,0);
});
test('cancelling outstanding orders returns active needs to buy, without touching received stock',()=>{
 const {s,a}=fixture();batch(s,'order.place',[[a,6]]);batch(s,'delivery.receive',[[a,2]]);batch(s,'order.cancel',[[a,3]]);assert.equal(row(s,a).purchase.ordered,1);assert.equal(row(s,a).received,2);assert.equal(require('../src/purchasing.cjs').counts(row(s,a)).toBuy,3);assert.equal(s.data.parts[0].quantity,2);assert.equal(row(s,a).purchase.orderLog[1].quantity,3);assert.throws(()=>batch(s,'order.cancel',[[a,2]]),/exceeds/);
});
test('cancelled plans retain zero-quantity order/correction history across refresh',()=>{
 const s=new Store(),part=act(s,'part.save',{data:{name:'Axle',quantity:0,tracking:'quantity'}}),draft=act(s,'build.draft.save',{data:{...Model.blank(),name:'Retired plan',parts:[{key:'a',partId:part,name:'Axle',quantity:2,slot:'',position:'Rear'}]}}),id=s.data.planning.shopping[0].id;
 batch(s,'order.place',[[id,2]]);batch(s,'delivery.receive',[[id,1]]);act(s,'build.draft.delete',{id:draft});batch(s,'order.cancel',[[id,1]]);correct(s,id,row(s,id).purchase.receipts[0].id,1,false);act(s,'planning.shopping.reconcile');assert.equal(row(s,id).quantity,0);assert.equal(row(s,id).received,0);assert.equal(row(s,id).purchase.requirement.state,'cancelled');assert.throws(()=>act(s,'planning.shopping.remove',{id}),/history/);validateDatabase(s.snapshot());
});
test('correction preserves original receipts, restores only eligible ordered portions and prevents repeated reversal',()=>{
 const {s,a}=fixture();batch(s,'order.place',[[a,2]]);batch(s,'delivery.receive',[[a,5]]);const r=structuredClone(row(s,a).purchase.receipts[0]);correct(s,a,r.id,2,false);correct(s,a,r.id,2,true);
 assert.equal(row(s,a).purchase.ordered,0);assert.equal(row(s,a).received,1);assert.deepEqual(row(s,a).purchase.receipts[0],r);assert.equal(row(s,a).purchase.receiptCorrections.length,2);assert.throws(()=>correct(s,a,r.id,2),/exceeds/);assert.equal(s.data.parts[0].quantity,1);
});
test('receipt corrections cannot remove installed or assembly stock',()=>{
 const {s,part,a}=fixture();batch(s,'order.place',[[a,6]]);batch(s,'delivery.receive',[[a,6]]);const receiptId=row(s,a).purchase.receipts[0].id,carId=act(s,'car.save',{data:{name:'Protected car'}});act(s,'part.install',{carId,partId:part,quantity:5,field:'',position:'Other'});
 const before=s.snapshot();assert.throws(()=>correct(s,a,receiptId,2),/loose stock/);assert.deepEqual(s.snapshot(),before);correct(s,a,receiptId,1);assert.equal(row(s,a).purchase.ordered,1);assert.equal(s.data.parts[0].quantity,5);assert.equal(s.data.installations[0].quantity,5);
});
test('free-text purchases can be ordered but require explicit stock linking for delivery',()=>{
 const {s,part}=fixture(),id=act(s,'planning.shopping.add',{item:{kind:'free',name:'Special tyre',maker:'',reference:''},quantity:2});batch(s,'order.place',[[id,2]]);assert.throws(()=>batch(s,'delivery.receive',[[id,1]]),/stock record/);act(s,'planning.shopping.edit',{id,item:{kind:'part',id:part}});batch(s,'delivery.receive',[[id,1]]);assert.equal(row(s,id).purchase.ordered,1);assert.equal(row(s,id).purchase.originalItem.name,'Special tyre');
});
test('supply order, receipt and correction change container count, not remaining volume',()=>{
 const s=new Store(),supply=act(s,'supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:0,remaining:10,minimum:5,unit:'ml'}}),id=act(s,'planning.shopping.add',{item:{kind:'supply',id:supply},quantity:3});batch(s,'order.place',[[id,3]]);batch(s,'delivery.receive',[[id,2]]);correct(s,id,row(s,id).purchase.receipts[0].id,1);assert.equal(s.data.supplies[0].quantity,1);assert.equal(s.data.supplies[0].remaining,10);assert.equal(s.data.supplies[0].history.length,2);assert.equal(row(s,id).purchase.ordered,2);validateDatabase(s.snapshot());
});
test('prices are exact hundredths, currencies separate and unknown prices are not zero',()=>{
 const {s,a,b}=fixture();act(s,'planning.shopping.edit',{id:b,unitPrice:'2.10',currency:'USD'});act(s,'planning.shopping.add',{item:{kind:'free',name:'Unknown',maker:'',reference:''},quantity:1});const totals=O.totals(s.data.planning.shopping);assert.equal(totals.unknown,1);assert.deepEqual(totals.currencies,[{currency:'EUR',toBuy:'750',ordered:'0',received:'0'},{currency:'USD',toBuy:'840',ordered:'0',received:'0'}]);
 for(const value of ['NaN','Infinity','-1','1.001','1e2','1,25','10000001'])assert.throws(()=>O.price(value,'EUR'));assert.throws(()=>O.price('','EUR'));assert.throws(()=>O.price('1','EU'));assert.equal(O.price('',''),null);assert.deepEqual(O.price('0','eur'),{minor:0,currency:'EUR'});act(s,'planning.shopping.edit',{id:a,unitPrice:'',currency:''});assert.equal(row(s,a).purchase.price,undefined);
});
test('legacy aggregate receipts remain intact and old ordered balances seed a truthful audit baseline',()=>{
 const {s,a}=fixture();s.transact(db=>{const l=db.planning.shopping.find(l=>l.id===a);l.received=2;l.purchase.legacyReceived=2;l.purchase.ordered=2;});batch(s,'delivery.receive',[[a,1]]);batch(s,'order.cancel',[[a,1]]);assert.equal(row(s,a).purchase.orderBaseline,2);assert.equal(row(s,a).purchase.legacyReceived,2);assert.throws(()=>correct(s,a,'legacy',1),/Legacy/);validateDatabase(s.snapshot());
});
test('SQLite deferred writes and receipt retries survive restart without double receiving',t=>{
 const f=fixture(),s=disk(t,f.s),R=require('../src/command-receipts.cjs'),sql=require('../src/sqlite-storage.cjs');batch(s,'order.place',[[f.a,4],[f.b,3]]);
 const input={id:'delivery',databaseId:s.data.id,epoch:sql.syncState(s.file).epoch,action:'planning.delivery.receive',payload:{revision:s.data.revision,confirmed:true,entries:[{id:f.a,quantity:2},{id:f.b,quantity:1}]}};
 R.execute(s,input);const reopened=new Store(s.file,{deferred:true});assert.equal(R.execute(reopened,input).duplicate,true);const saved=new Store(s.file);assert.equal(saved.data.parts[0].quantity,3);assert.equal(row(saved,f.a).purchase.receipts.length,1);
 correct(reopened,f.a,row(saved,f.a).purchase.receipts[0].id,1);assert.equal(new Store(s.file).data.parts[0].quantity,2);assert.ok(!reopened.deferredState.stats.loadedSections.includes('timing.sessions'));
});
test('receipt storage failure rolls back the entire allocated delivery and sync cursor',t=>{
 const f=fixture(),s=disk(t,f.s),R=require('../src/command-receipts.cjs'),sql=require('../src/sqlite-storage.cjs'),cursor=sql.syncState(s.file),before=new Store(s.file).snapshot(),db=new(require('node:sqlite').DatabaseSync)(s.file);
 try{R.ensure(db);db.exec("CREATE TRIGGER fail_order_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'receipt failed'); END;");}finally{db.close();}
 const command={id:'failing-delivery',databaseId:s.data.id,epoch:cursor.epoch,action:'planning.delivery.receive',payload:{revision:s.data.revision,confirmed:true,entries:[{id:f.a,quantity:2},{id:f.b,quantity:2}]}};
 assert.throws(()=>R.execute(s,command),/receipt failed/);assert.deepEqual(new Store(s.file).snapshot(),before);assert.deepEqual(sql.syncState(s.file),cursor);
});
test('grouped query totals span pages and bulk editor loads only selected purchase context',t=>{
 const {s,a}=fixture();s.transact(db=>{const first=db.planning.shopping.find(l=>l.id===a);db.planning.shopping=Array.from({length:65},(_,i)=>({...JSON.parse(JSON.stringify(first)),id:'line-'+i,supplier:i%2?'B':'A'}));});const d=disk(t,s),{view}=require('../src/view-query.cjs');let v=view(d,{page:'Shopping List',shopping:{groupBySupplier:true}});assert.equal(v.planning.shopping.length,30);assert.equal(v._view.shopping.totals.currencies[0].toBuy,'48750');assert.ok(v.planning.shopping.every(l=>l.supplier==='A'));
 v=view(d,{page:'Shopping List',editor:{action:'shop-bulk-receive',selected:['line-0','line-64']}});assert.deepEqual(v.planning.shopping.map(l=>l.id),['line-0','line-64']);assert.equal(v.parts[0].name,'Tyres');assert.equal(v.timing.sessions.length,0);assert.throws(()=>view(d,{page:'Shopping List',shopping:{groupBySupplier:'yes'}}),/grouping/);
});
test('tampered audit quantities, IDs, prices and corrections fail database validation',()=>{
 const {s,a}=fixture();batch(s,'order.place',[[a,4]]);batch(s,'delivery.receive',[[a,3]]);correct(s,a,row(s,a).purchase.receipts[0].id,1);
 for(const change of [p=>p.receiptCorrections=null,p=>p.receiptCorrections=false,p=>p.orderLog[0].id='prototype',p=>p.orderLog[0].quantity=5,p=>p.receiptCorrections[0].fromOrdered=0,p=>p.receiptCorrections[0].quantity=4,p=>p.receiptCorrections[0]=null,p=>p.price.minor=1.5,p=>p.orderLog[0].id=p.receipts[0].id]){const db=s.snapshot();change(db.planning.shopping.find(l=>l.id===a).purchase);assert.throws(()=>validateDatabase(db));}
});

test('correction protects stored assembly components and invalid individual bulk intake is atomic',()=>{
 const {s,part,a}=fixture();batch(s,'delivery.receive',[[a,2]]);const receiptId=row(s,a).purchase.receipts[0].id;
 act(s,'assembly.create',{name:'Rear axle',components:[{partId:part,quantity:2,field:'',position:'Rear'}]});const before=s.snapshot();assert.throws(()=>correct(s,a,receiptId,1),/loose stock/);assert.deepEqual(s.snapshot(),before);
 const single=act(s,'part.save',{data:{name:'Individual motor',tracking:'individual',quantity:0}}),line=act(s,'planning.shopping.add',{partId:single,quantity:1});act(s,'part.save',{id:single,data:{name:'Individual motor',tracking:'individual',quantity:1}});
 const next=s.snapshot();assert.throws(()=>batch(s,'delivery.receive',[[line,1]]),/individual/i);assert.deepEqual(s.snapshot(),next);
});

test('correction recovery fences and competing orders reject uncertain writes without changing receipts',async t=>{
 const f=fixture(),s=disk(t,f.s),sql=require('../src/sqlite-storage.cjs'),R=require('../src/command-receipts.cjs');batch(s,'delivery.receive',[[f.a,2]]);
 const input={id:'correction',databaseId:s.data.id,epoch:sql.syncState(s.file).epoch,action:'planning.receipt.correct',payload:{revision:s.data.revision,id:f.a,receiptId:row(s,f.a).purchase.receipts[0].id,quantity:1,restoreOrdered:false,reason:'Count corrected',confirmed:true}};
 R.execute(s,input);assert.equal(R.execute(new Store(s.file,{deferred:true}),input).duplicate,true);assert.throws(()=>R.execute(new Store(s.file,{deferred:true}),{...input,payload:{...input.payload,quantity:2}}),/different content/);
 assert.throws(()=>R.execute(new Store(s.file,{deferred:true}),{...input,id:'old-epoch',epoch:'old-generation'}),/replaced/);
 const current=new Store(s.file),payload={revision:current.data.revision,confirmed:true,entries:[{id:f.b,quantity:4}]};const results=await Promise.allSettled(['a','b'].map(commandId=>new Store(s.file,{deferred:true}).mutateAsync('planning.order.place',payload,{snapshot:false,commandId})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(new Store(s.file).data.parts[0].quantity,1);assert.equal(row(new Store(s.file),f.b).purchase.ordered,4);
});
