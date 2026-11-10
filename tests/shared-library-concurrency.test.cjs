'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process');
const {open}=require('../packages/shared-library/index.cjs'),{Store}=require('../src/store.cjs');
const disposers=new WeakMap();
function fixture(t){const root=require('./support/temp-dir.cjs')('library-process-'),cleanup=[];disposers.set(t,cleanup);t.after(async()=>{for(const close of cleanup.reverse())await close();fs.rmSync(root,{recursive:true,force:true});});return root;}
function processClient(t,root,name){
 const child=fork(path.join(__dirname,'fixtures/shared-library-process.cjs'),[],{stdio:['ignore','ignore','pipe','ipc']}),pending=new Map();let seq=0,stderr='';child.stderr.on('data',b=>stderr+=b);child.on('message',m=>{const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(Object.assign(Error(m.error.message),m.error)):p.resolve(m.value);});
 child.on('exit',()=>{for(const p of pending.values())p.reject(Error('Child exited: '+stderr));pending.clear();});
 const exited=new Promise(r=>child.once('exit',r));disposers.get(t).push(async()=>{if(child.exitCode===null)child.kill();await exited;});
 const call=(method,input)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.send({id,method,input});});
 return {call,start:()=>call('open',{application:'SlotForge '+name,installationId:name,sharedRoot:root}),close:async()=>{await call('close');await exited;}};
}
test('separate OS processes create concurrently and reopen the same library without a running peer',async t=>{
 const root=fixture(t),a=processClient(t,root,'Timing'),b=processClient(t,root,'Paddock'),[sa,sb]=await Promise.all([a.start(),b.start()]);assert.notEqual(sa.pid,sb.pid);assert.equal(sa.databaseId,sb.databaseId);
 const identity={databaseId:sa.databaseId,recoveryId:sa.recoveryId};
 const saved=await Promise.all(Array.from({length:10},(_,i)=>(i%2?a:b).call('carWrite',{...identity,operationId:'create-'+i,action:'create',set:{name:'Car '+i}})));assert.equal(new Set(saved.map(r=>r.car.id)).size,10);assert.equal((await a.call('catalogue')).total,10);
 await a.close();const car=await b.call('car',saved[0].car.id);await b.call('carWrite',{...identity,operationId:'while-alone',action:'patch',carId:car.id,expectedRevision:car.revision,set:{reference:'Changed without Timing'}});await b.close();
 const later=await open({application:'SlotForge Timing',installationId:'Timing',sharedRoot:root});try{assert.equal((await later.car(car.id)).fields.reference,'Changed without Timing');}finally{await later.close();}
});
test('Paddock live observer refreshes external commits and idle checks do not emit refresh loops',async t=>{
 const root=fixture(t),timing=await open({application:'SlotForge Timing',installationId:'Timing',sharedRoot:root});disposers.get(t).push(()=>timing.close());const s=await timing.status(),store=await Store.open(s.file);let changed=0;
 const observer=require('../src/shared-library-observer.cjs').observe(store,()=>changed++,e=>{throw e;});disposers.get(t).push(()=>observer.close());assert.equal(await observer.refresh(),false);
 const result=await timing.carWrite({databaseId:s.databaseId,recoveryId:s.recoveryId,operationId:'external',action:'create',set:{name:'Visible immediately'}});await observer.refresh();assert.equal(require('../src/sqlite-query.cjs').read(store,null,r=>r.one('cars',result.car.id)).value.name,'Visible immediately');const count=changed;assert.ok(count>0);assert.equal(await observer.refresh(),false);assert.equal(changed,count);
});

test('Paddock observer adopts restored epochs and rejects foreign replacement without retargeting its store',async t=>{
 const root=fixture(t),timing=await open({application:'Timing',installationId:'Timing',sharedRoot:root});disposers.get(t).push(()=>timing.close());
 const s=await timing.status(),store=await Store.open(s.file),observer=require('../src/shared-library-observer.cjs').observe(store,()=>{},()=>{});disposers.get(t).push(()=>observer.close());
 const source=path.join(root,'before.sfpbackup');await timing.backup({databaseId:s.databaseId,recoveryId:s.recoveryId,revision:s.revision,destination:source});
 const restored=await timing.restore({databaseId:s.databaseId,recoveryId:s.recoveryId,revision:s.revision,source,operationId:'restore-observed'});
 await observer.refresh();assert.equal(store.deferredState.token.epoch,restored.recoveryId);assert.notEqual(store.deferredState.token.epoch,s.recoveryId);
 const foreign=new Store(s.file);await foreign.restoreAsync(require('../src/store.cjs').initial(),foreign.data.revision);await require('../src/shared-library-location.cjs').rebind(root,s.file,s.databaseId);
 await assert.rejects(observer.refresh(),e=>e.code==='DATABASE_MISMATCH'&&/Close and reopen/.test(e.message));assert.equal(store.data.id,s.databaseId);
 const reopened=await open({application:'Paddock',installationId:'Paddock',sharedRoot:root});try{assert.equal((await reopened.status()).databaseId,foreign.data.id);}finally{await reopened.close();}
});
