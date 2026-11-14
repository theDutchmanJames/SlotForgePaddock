'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,makePackage}=require('../src/store.cjs'),C=require('../src/shopping-checklist.cjs'),R=require('../src/shopping-requirements.cjs'),M=require('../renderer/build-model.js'),{view}=require('../src/view-query.cjs');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-checklist-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));const part=act(s,'part.save',{data:{name:'King motor',maker:'NSR',reference:'M1',quantity:0,tracking:'quantity'}}),line=act(s,'planning.shopping.add',{partId:part,quantity:3});return {s,part,line};}
test('Done is independent of stock; explicit stock addition is atomic and reopening never reverses or duplicates it',t=>{
 const {s,part,line}=fixture(t);act(s,'planning.checklist.done',{id:line,done:true});assert.equal(s.data.parts[0].quantity,0);assert.equal(C.done(s.data.planning.shopping[0]),true);
 act(s,'planning.checklist.done',{id:line,done:false});act(s,'planning.checklist.done',{id:line,done:true,addStock:true,quantity:3,confirmed:true});assert.equal(s.data.parts[0].quantity,3);
 let before=s.snapshot();assert.throws(()=>act(s,'planning.checklist.done',{id:line,done:true,addStock:true,quantity:3,confirmed:true}),/already done/);assert.deepEqual(s.snapshot(),before);
 act(s,'planning.checklist.done',{id:line,done:false});assert.equal(s.data.parts[0].quantity,3);before=s.snapshot();assert.throws(()=>act(s,'planning.checklist.done',{id:line,done:true,addStock:true,quantity:1,confirmed:true}),/exceeds/);assert.deepEqual(s.snapshot(),before);
 act(s,'planning.checklist.done',{id:line,done:true});const saved=new Store(s.file);assert.equal(saved.data.parts[0].quantity,3);assert.equal(saved.data.planning.shopping[0].purchase.receipts.length,1);assert.equal(C.done(saved.data.planning.shopping[0]),true);
});
test('checklist quantities and deletion preserve original orders, receipts and links, including Undo',t=>{
 const {s,part,line}=fixture(t);act(s,'planning.order.place',{entries:[{id:line,quantity:3}],confirmed:true});act(s,'planning.receive',{partId:part,shoppingId:line,quantity:2,confirmed:true});const history=structuredClone(s.data.planning.shopping[0].purchase);
 act(s,'planning.checklist.edit',{id:line,quantity:1});act(s,'planning.checklist.delete',{id:line});let projected=view(s,{page:'Shopping List',shopping:{status:'all'}});assert.equal(projected.planning.shopping.length,0);assert.equal(s.data.parts[0].quantity,2);assert.deepEqual(s.data.planning.shopping[0].purchase.receipts,history.receipts);assert.deepEqual(s.data.planning.shopping[0].purchase.orderLog,history.orderLog);
 act(s,'planning.checklist.restore',{id:line});projected=view(s,{page:'Shopping List',shopping:{status:'all'}});assert.equal(C.quantity(projected.planning.shopping[0]),1);assert.equal(projected.planning.shopping[0].received,2);
});
test('free text must link explicitly; supply completion changes containers without changing consumable amounts',t=>{
 const {s}=fixture(t),free=act(s,'planning.shopping.add',{item:{kind:'free',name:'Oil',maker:'',reference:''},quantity:2}),supply=act(s,'supply.save',{data:{name:'Oil bottle',category:'Cleaning & lubrication',kind:'Consumable',quantity:0,remaining:10,minimum:2,unit:'ml'}});
 const before=s.snapshot();assert.throws(()=>act(s,'planning.checklist.done',{id:free,done:true,addStock:true,confirmed:true,quantity:2}),/stock record/);assert.deepEqual(s.snapshot(),before);
 act(s,'planning.shopping.edit',{id:free,item:{kind:'supply',id:supply}});act(s,'planning.checklist.done',{id:free,done:true,addStock:true,confirmed:true,quantity:2});assert.equal(s.data.supplies[0].quantity,2);assert.equal(s.data.supplies[0].remaining,10);assert.equal(s.data.planning.shopping.find(l=>l.id===free).purchase.originalItem.name,'Oil');
});
test('lost acknowledgements and simultaneous completions cannot add stock twice',async t=>{
 const {s,line}=fixture(t),receipts=require('../src/command-receipts.cjs'),sql=require('../src/sqlite-storage.cjs'),payload={revision:s.data.revision,id:line,done:true,addStock:true,quantity:3,confirmed:true},command={id:'complete-once',databaseId:s.data.id,epoch:sql.syncState(s.file).epoch,action:'planning.checklist.done',payload};
 receipts.execute(new Store(s.file,{deferred:true}),command);assert.equal(receipts.execute(new Store(s.file,{deferred:true}),command).duplicate,true);assert.equal(new Store(s.file).data.parts[0].quantity,3);
 assert.throws(()=>receipts.execute(new Store(s.file,{deferred:true}),{...command,id:'competing'}),/changed/);
});
test('failed stock save rolls back completion, stock, and receipts; invalid fields are rejected',t=>{
 const {s,line}=fixture(t);for(const values of [{quantity:0},{quantity:true},{quantity:1.5},{quantity:1000001},{listId:'missing'}]){const before=s.snapshot();assert.throws(()=>act(s,'planning.checklist.edit',{id:line,...values}));assert.deepEqual(s.snapshot(),before);}
 const before=s.snapshot();s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'planning.checklist.done',{id:line,done:true,addStock:true,confirmed:true,quantity:2}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('build changes are offered, not applied; manual quantities, moved lists, Done and deleted entries survive',t=>{
 const {s,part}=fixture(t),data={...M.blank(),name:'Rebuild',parts:[{key:'motor',partId:part,name:'Motor',quantity:4,slot:'motor',position:'Motor'}]},draft=act(s,'build.draft.save',{data}),line=s.data.planning.shopping.find(l=>l.buildId===draft).id,list=act(s,'planning.list.save',{name:'Weekend'});
 act(s,'planning.checklist.edit',{id:line,quantity:6,listId:list});data.parts[0].quantity=8;act(s,'build.draft.save',{id:draft,data});assert.equal(C.quantity(s.data.planning.shopping.find(l=>l.id===line)),6);const proposal=R.preview(s.data,'build',draft);assert.equal(proposal.rows[0].proposed,8);assert.equal(proposal.rows[0].manual,true);
 act(s,'planning.shopping.applyRequirements',{kind:'build',sourceId:draft,partIds:[part]});let l=s.data.planning.shopping.find(l=>l.id===line);assert.equal(C.quantity(l),8);assert.equal(l.purchase.listId,list);
 act(s,'planning.checklist.done',{id:line,done:true});data.parts[0].quantity=12;act(s,'build.draft.save',{id:draft,data});assert.deepEqual(R.preview(s.data,'build',draft).rows,[]);assert.equal(C.done(s.data.planning.shopping.find(l=>l.id===line)),true);
 act(s,'planning.checklist.done',{id:line,done:false});act(s,'planning.checklist.delete',{id:line});act(s,'build.draft.save',{id:draft,data});assert.deepEqual(R.preview(s.data,'build',draft).rows,[]);assert.equal(s.data.planning.shopping.filter(l=>l.buildId===draft).length,1);
});
test('new build parts require selection after initial save and cancelled builds preserve checklist entries',t=>{
 const {s,part}=fixture(t),data={...M.blank(),name:'Plan',parts:[]},draft=act(s,'build.draft.save',{data});data.parts=[{key:'motor',partId:part,name:'Motor',quantity:2,position:'Motor',slot:'motor'}];act(s,'build.draft.save',{id:draft,data});assert.equal(s.data.planning.shopping.filter(l=>l.buildId===draft).length,0);
 const d=new Store(s.file,{deferred:true});act(d,'planning.shopping.applyRequirements',{kind:'build',sourceId:draft,partIds:[part]});let saved=new Store(s.file),l=saved.data.planning.shopping.find(l=>l.buildId===draft);assert.equal(C.quantity(l),2);act(saved,'build.draft.delete',{id:draft});l=saved.data.planning.shopping.find(l=>l.buildId===draft);assert.equal(C.quantity(l),2);assert.equal(l.purchase.requirement.state,'cancelled');assert.equal(saved.data.parts[0].quantity,0);
});
test('finder is bounded, matches references, retains all-list visibility and never transfers racing history',t=>{
 const {s,part,line}=fixture(t);s.transact(db=>{const p=db.parts[0];for(let i=0;i<100;i++)db.parts.push({...p,id:'extra-'+i,name:'Motor '+i,reference:'REF'+i});});const before=s.snapshot();const d=new Store(s.file,{deferred:true});
 let v=view(d,{page:'Shopping List',shoppingFinder:{query:'Motor',maker:'NSR'}});assert.equal(v._view.shoppingFinder.items.length,20);assert.deepEqual(v.planning.shopping,[]);assert.ok(!d.deferredState.stats.loadedSections.includes('planning.shopping'));
 const list=view(d,{page:'Shopping List',shopping:{status:'all'}});assert.equal(list.planning.shopping[0].id,line);assert.equal(list._view.shopping.listCounts[''],1);assert.deepEqual(list.timing.sessions,[]);assert.ok(!d.deferredState.stats.loadedSections.includes('timing.sessions'));
 v=view(d,{page:'Shopping List',shopping:{status:'all'},shoppingFinder:{query:'NSR REF99'}});assert.equal(v._view.shoppingFinder.items.length,1);assert.equal(v._view.shoppingFinder.items[0].reference,'REF99');assert.deepEqual(s.snapshot(),before);
 for(const f of [[],{query:{}},{kind:'unknown'}])assert.throws(()=>view(d,{page:'Shopping List',shoppingFinder:f}),{code:'INVALID_QUERY'});
});
test('backup and unrelated car writes preserve checklist data while public car packages exclude it',t=>{
 const {s,line}=fixture(t),car=act(s,'car.save',{data:{name:'Car'}});act(s,'planning.checklist.done',{id:line,done:true});const planning=structuredClone(s.data.planning),deferred=new Store(s.file,{deferred:true});deferred.mutate('car.save',{id:car,revision:s.data.cars[0].revision,data:{technical:{motor:'Different'}}},{snapshot:false});assert.deepEqual(new Store(s.file).data.planning,planning);
 const backup=path.join(path.dirname(s.file),'copy.sfpbackup');require('../src/portable-backup.cjs').exportBackup(s.file,backup);const target=path.join(path.dirname(s.file),'restored.sqlite');require('../src/portable-backup.cjs').stageBackup(backup,target);assert.deepEqual(new Store(target).data.planning,planning);assert.ok(!JSON.stringify(makePackage(s.data,[car])).includes('checklist'));
});

test('new additions appear on the first All Items page, while Done entries remain last',t=>{
 const {s,part}=fixture(t);for(let i=0;i<35;i++)act(s,'planning.shopping.add',{partId:part,quantity:1,notes:'Older '+i});
 const newest=act(s,'planning.shopping.add',{partId:part,quantity:2,notes:'Just added'});let projected=view(s,{page:'Shopping List',shopping:{status:'all'}});assert.equal(projected.planning.shopping[0].id,newest);assert.equal(projected.planning.shopping.length,30);
 act(s,'planning.checklist.done',{id:newest,done:true});projected=view(s,{page:'Shopping List',shopping:{status:'all'}});assert.ok(!projected.planning.shopping.some(l=>l.id===newest));projected=view(s,{page:'Shopping List',shopping:{status:'all'},offset:30});assert.equal(projected.planning.shopping.at(-1).id,newest);
});

test('supply and part finder filters compose and exclude archived or assembled stock',t=>{
 const {s,part}=fixture(t),supply=act(s,'supply.save',{data:{name:'Oil',maker:'NSR',reference:'O1',category:'Cleaning & lubrication',partType:'Bearing oil',kind:'Consumable',quantity:0}});
 let projected=view(s,{page:'Shopping List',shoppingFinder:{kind:'supply',maker:'NSR',category:'Cleaning & lubrication',partType:'Bearing oil',query:'O1'}});assert.deepEqual(projected._view.shoppingFinder.items.map(p=>p.id),[supply]);
 act(s,'supply.archive',{id:supply,archived:true});projected=view(s,{page:'Shopping List',shoppingFinder:{kind:'supply',query:'O1'}});assert.equal(projected._view.shoppingFinder.items.length,0);
 act(s,'planning.receive',{partId:part,quantity:1,confirmed:true});const assembly=act(s,'assembly.create',{name:'Motor assembly',components:[{partId:part,quantity:1,field:'motor',position:'Motor'}]});const component=s.data.assemblies.find(a=>a.id===assembly).components[0].partId;
 projected=view(s,{page:'Shopping List',shoppingFinder:{query:'King'}});assert.ok(!projected._view.shoppingFinder.items.some(p=>p.id===component));
});

test('stale requirement approvals and persistence failures preserve manual decisions and stock',t=>{
 const {s,part}=fixture(t),data={...M.blank(),name:'Pending build',parts:[{key:'m',partId:part,name:'Motor',quantity:4,slot:'motor',position:'Motor'}]},draft=act(s,'build.draft.save',{data});data.parts[0].quantity=8;act(s,'build.draft.save',{id:draft,data});const revision=s.data.revision,line=s.data.planning.shopping.find(l=>l.buildId===draft);
 act(s,'planning.checklist.edit',{id:line.id,quantity:7});let before=s.snapshot();assert.throws(()=>s.mutate('planning.shopping.applyRequirements',{revision,kind:'build',sourceId:draft,partIds:[part]}),/changed/);assert.deepEqual(s.snapshot(),before);
 s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'planning.shopping.applyRequirements',{kind:'build',sourceId:draft,partIds:[part]}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
