'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,validateDatabase}=require('../src/store.cjs'),receipts=require('../src/command-receipts.cjs'),M=require('../renderer/build-model.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-stock-write-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));return {s,open:()=>new Store(s.file,{deferred:true}),read:()=>new Store(s.file).snapshot()};}
const part=(s,name='Motor',quantity=0,tracking='quantity')=>act(s,'part.save',{data:{name,quantity,tracking}});
const buy=(s,id,quantity=2)=>act(s,'planning.shopping.add',{partId:id,quantity});
const done=(s,id,quantity=2)=>act(s,'planning.checklist.done',{id,done:true,addStock:true,quantity,confirmed:true});
const build=(s,ids,name)=>act(s,'build.draft.save',{data:{...M.blank(),name,parts:ids.map((id,i)=>({key:'p'+i,partId:id,name:'Part',quantity:4,slot:'',position:'Position '+i}))}});
test('stock receipt reads only target dependencies in a large catalogue and preserves unrelated records',t=>{
 const {s,open,read}=fixture(t),id=part(s),line=buy(s,id),other=part(s,'Other');build(s,[other],'Unrelated build');
 s.transact(db=>{for(let i=0;i<3000;i++)db.parts.push({...db.parts[1],id:'unrelated-'+i});for(let i=0;i<199;i++)db.planning.shopping.push({...JSON.parse(JSON.stringify(db.planning.shopping.find(l=>l.id===line))),id:'row-'+i});});
 const before=read(),d=open(),state=d.deferredState,start=performance.now();done(d,line);
 t.diagnostic(JSON.stringify({ms:Math.round(performance.now()-start),stats:state.stats,recordWrites:d.lastWrite.recordWrites}));
 for(const section of ['cars','parts','supplies','assemblies','installations','jobs','setups','buildDrafts','timing.sessions','planning.jobs'])assert.ok(!state.stats.loadedSections.includes(section),section);
 assert.ok(state.stats.recordReads<240,JSON.stringify(state.stats));assert.equal(d.lastWrite.recordWrites,3);
 const after=read();validateDatabase(after);assert.equal(after.parts.find(p=>p.id===id).quantity,2);
 for(const key of Object.keys(before))if(!['revision','planning','parts'].includes(key))assert.deepEqual(after[key],before[key],key);
 assert.deepEqual(after.parts.filter(p=>p.id!==id),before.parts.filter(p=>p.id!==id));
 assert.deepEqual(after.planning.shopping.filter(l=>l.id!==line),before.planning.shopping.filter(l=>l.id!==line));
});
test('linked builds retain manual edits and done/deleted ticks; legacy refresh touches only related sources',t=>{
 const {s,open,read}=fixture(t),id=part(s),other=part(s,'Tyres'),unused=part(s,'Unrelated');
 const b=build(s,[id,other],'Related'),unrelated=build(s,[unused],'Unrelated');
 const lines=s.data.planning.shopping.filter(l=>l.buildId===b),first=lines.find(l=>l.partId===id),second=lines.find(l=>l.partId===other);
 act(s,'planning.checklist.edit',{id:first.id,quantity:7});act(s,'planning.checklist.delete',{id:second.id});
 const before=read();done(open(),first.id,2);let after=read();validateDatabase(after);
 assert.equal(after.planning.shopping.find(l=>l.id===first.id).purchase.checklist.quantity,7);
 assert.deepEqual(after.planning.shopping.find(l=>l.id===second.id),before.planning.shopping.find(l=>l.id===second.id));
 assert.deepEqual(after.buildDrafts,before.buildDrafts);
 // Simulate pre-checklist plans without generated rows. Only the affected plan
 // may be initialised; receipt must not generate an unrelated shopping list.
 const legacy=new Store(s.file);legacy.transact(db=>{db.planning.shopping=[];db.planning.shoppingChecklistSources=[];});
 act(open(),'planning.receive',{partId:id,quantity:1,confirmed:true});after=read();validateDatabase(after);
 assert.ok(after.planning.shopping.some(l=>l.buildId===b&&l.partId===other));assert.ok(!after.planning.shopping.some(l=>l.buildId===unrelated));
 assert.deepEqual(after.planning.shoppingChecklistSources,[{kind:'build',id:b}]);
});
test('installed stock and accepted workshop substitutes stay intact during a receipt',t=>{
 const {s,open,read}=fixture(t),id=part(s,'Target',4),car=act(s,'car.save',{data:{name:'Workshop car'}});
 act(s,'part.install',{carId:car,partId:id,quantity:2,field:'',position:'Front'});act(s,'part.install',{carId:car,partId:id,quantity:2,field:'',position:'Rear'});
 act(s,'setup.save',{carId:car,name:'Two axles'});const setupId=s.data.setups[0].id;
 for(const i of [...s.data.installations])act(s,'part.remove',{id:i.id,destination:'discarded'});
 const job=act(s,'job.start',{setupId});act(s,'job.shopping',{id:job});const sub=part(s,'Substitute',2);act(s,'job.fit',{id:job,key:'0',selection:'p:'+sub,confirmed:true});
 const line=s.data.planning.shopping.find(l=>l.partId===id).id,before=read();done(open(),line,2);const after=read();validateDatabase(after);
 assert.deepEqual(after.installations,before.installations);assert.deepEqual(after.jobs,before.jobs);assert.deepEqual(after.setups,before.setups);assert.equal(after.parts.find(p=>p.id===sub).quantity,2);
 assert.deepEqual(require('../src/shopping-requirements.cjs').preview(after,'job',job).rows,[]);assert.equal(require('../src/shopping-requirements.cjs').jobDemand(after,after.jobs[0]).get(id),2);
});
test('target quantity, assembly ownership, supply and free-text safeguards roll back failed receipts',t=>{
 const {s,open,read}=fixture(t),id=part(s),line=buy(s,id),individual=part(s,'Unique',0,'individual'),one=buy(s,individual,1),free=act(s,'planning.shopping.add',{item:{kind:'free',name:'Unknown',maker:'',reference:''},quantity:1});
 const supply=act(s,'supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:999999,remaining:10,minimum:1,unit:'ml'}}),oil=act(s,'planning.shopping.add',{item:{kind:'supply',id:supply},quantity:2});
 for(const [which,qty]of [[line,3],[line,0],[line,1.5],[one,2],[free,1],[oil,2]]){const before=read();assert.throws(()=>done(open(),which,qty));assert.deepEqual(read(),before);}
 done(open(),oil,1);let after=read();assert.equal(after.supplies[0].quantity,1000000);assert.equal(after.supplies[0].remaining,10);assert.equal(after.supplies[0].history.at(-1).after.quantity,1000000);
 const stock=new Store(s.file),component=part(stock,'Assembly component',2);act(stock,'assembly.create',{name:'Complete axle',components:[{partId:component,quantity:1}]});const reserved=stock.data.assemblies[0].components[0].partId;
 const before=read();assert.throws(()=>act(open(),'planning.receive',{partId:reserved,quantity:1,confirmed:true}),/assembly/);assert.deepEqual(read(),before);
 const huge=new Store(s.file),overflow=part(huge,'Maximum stock',Number.MAX_SAFE_INTEGER);assert.throws(()=>act(open(),'planning.receive',{partId:overflow,quantity:1,confirmed:true}),/stock quantity/);
});
test('durable retries, competing writes and persistence failure cannot double-add or lose stock',t=>{
 const {s,open,read}=fixture(t),id=part(s),line=buy(s,id),d=open();
 const command={id:'receipt-command',action:'planning.checklist.done',payload:{revision:d.data.revision,id:line,done:true,addStock:true,quantity:2,confirmed:true},databaseId:d.data.id,epoch:d.deferredState.token.epoch};
 const before=read(),failed=open();failed.persist=()=>{throw Error('Disk full');};assert.throws(()=>receipts.execute(failed,command),/Disk full/);assert.deepEqual(read(),before);
 const rival=open();receipts.execute(d,command);assert.equal(receipts.execute(open(),command).duplicate,true);assert.throws(()=>receipts.execute(rival,{...command,id:'competing'}),/changed|stale/i);assert.equal(read().parts[0].quantity,2);
 assert.throws(()=>done(open(),line),/already|Reopen/);assert.equal(read().planning.shopping[0].purchase.receipts.length,1);
});
