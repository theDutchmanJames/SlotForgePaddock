'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {open}=require('../packages/shared-library/index.cjs'),L=require('../src/shared-library-location.cjs'),B=require('../src/portable-backup.cjs');
async function fixture(t){const root=require('./support/temp-dir.cjs')('common-restore-'),handles=[];t.after(async()=>{await Promise.all(handles.map(h=>h.close()));fs.rmSync(root,{recursive:true,force:true});});const start=async(name='Timing')=>{const h=await open({application:name,installationId:name,sharedRoot:root});handles.push(h);return h;};return {root,start};}
const identity=s=>({databaseId:s.databaseId,recoveryId:s.recoveryId});

test('shared restore rotates recovery identity, retains a recovery backup and resolves lost replies without reapplying',async t=>{
 const {root,start}=await fixture(t),a=await start(),s=await a.status(),created=await a.carWrite({...identity(s),operationId:'first',action:'create',set:{name:'Before edit'}}),atBackup=await a.status(),source=path.join(root,'snapshot.sfpbackup');await a.backup({...identity(atBackup),revision:atBackup.revision,destination:source});
 await a.carWrite({...identity(s),operationId:'edit',action:'patch',carId:created.car.id,expectedRevision:created.car.revision,set:{name:'After edit'}});const before=await a.status(),peer=await start('Paddock');
 const input={...identity(before),revision:before.revision,operationId:'restore-once',source},restored=await a.restore(input);assert.notEqual(restored.recoveryId,before.recoveryId);assert.equal(restored.revision,before.revision+1);assert.equal(restored.sourceDigest,B.verify(source).digest);assert.equal((await peer.car(created.car.id)).fields.name,'Before edit');
 assert.deepEqual(B.verify(restored.recoveryBackup).identity,[before.databaseId,before.revision]);await assert.rejects(peer.carWrite({...identity(before),operationId:'late-write',action:'create',set:{name:'Must not return'}}),e=>e.code==='RECOVERY_CHANGED');
 await a.close();const reopened=await start(),current=await reopened.car(created.car.id);await reopened.carWrite({...identity(restored),operationId:'post-restore',action:'patch',carId:current.id,expectedRevision:current.revision,set:{name:'Keep newer work'}});
 const retry=await reopened.restore(input);assert.equal(retry.duplicate,true);assert.equal(retry.revision,restored.revision);assert.equal((await reopened.car(current.id)).fields.name,'Keep newer work');await assert.rejects(reopened.restore({...input,source:restored.recoveryBackup}),e=>e.code==='OPERATION_CONFLICT');
 assert.equal(fs.existsSync(path.join(root,'replacement.json')),false);assert.equal(fs.readdirSync(path.join(root,'recovery')).some(n=>n.startsWith('s-')),false);
});

test('restoring another collection rebinds the registration and rejects old peer handles',async t=>{
 const {root,start}=await fixture(t),a=await start(),s=await a.status(),peer=await start('Paddock'),{Store}=require('../src/store.cjs'),other=new Store(path.join(root,'other.sqlite'));other.mutate('car.save',{data:{name:'Restored foreign collection'}});const source=path.join(root,'other.sfpbackup');B.exportBackup(other.file,source);
 const input={...identity(s),revision:s.revision,operationId:'restore-other',source},result=await a.restore(input);assert.equal(result.databaseId,other.data.id);await assert.rejects(peer.catalogue(),e=>e.code==='DATABASE_MISMATCH');await a.close();
 const fresh=await start();assert.equal((await fresh.status()).databaseId,other.data.id);assert.equal((await fresh.catalogue()).cars[0].fields.name,'Restored foreign collection');assert.equal((await fresh.restore(input)).duplicate,true);assert.equal(L.read(root).databaseId,other.data.id);
});

test('invalid or stale restores preserve the current collection and concurrent restore ownership',async t=>{
 const {root,start}=await fixture(t),a=await start(),s=await a.status(),source=path.join(root,'broken.sfpbackup');fs.writeFileSync(source,'not a backup');
 await assert.rejects(a.restore({...identity(s),revision:s.revision,operationId:'invalid',source}));assert.deepEqual(await a.status(),s);assert.equal(fs.existsSync(path.join(root,'replacement.json')),false);
 const good=path.join(root,'good.sfpbackup');await a.backup({...identity(s),revision:s.revision,destination:good});const ticket=await L.beginReplacement(root,s.file,s.databaseId);
 await assert.rejects(a.restore({...identity(s),revision:s.revision,operationId:'concurrent',source:good}),e=>e.code==='LIBRARY_BUSY');assert.equal(JSON.parse(fs.readFileSync(path.join(root,'replacement.json'))).nonce,ticket.nonce);await L.finishReplacement(root,ticket);
 await a.carWrite({...identity(s),operationId:'new',action:'create',set:{name:'Newer work'}});await assert.rejects(a.restore({...identity(s),revision:s.revision,operationId:'stale',source:good}),e=>e.code==='REVISION_CONFLICT');assert.equal((await a.catalogue()).total,1);
});

test('worker death after commit recovers registration while its parent process remains alive',async t=>{
 const {root,start}=await fixture(t),a=await start(),s=await a.status(),{Worker}=require('node:worker_threads');
 const worker=new Worker(`const {parentPort,workerData:d}=require('node:worker_threads');const L=require(d.location),{Store,initial}=require(d.store);L.withReplacement(d.root,d.file,d.id,async()=>{const s=await Store.open(d.file);await s.restoreAsync(initial(),s.data.revision);parentPort.postMessage('committed');await new Promise(()=>{});}).catch(e=>{throw e;});`,{eval:true,workerData:{location:require.resolve('../src/shared-library-location.cjs'),store:require.resolve('../src/store.cjs'),root,file:s.file,id:s.databaseId}});
 try{await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});}finally{await worker.terminate();}
 const next=await start('Paddock');assert.notEqual((await next.status()).databaseId,s.databaseId);assert.equal(fs.existsSync(path.join(root,'replacement.json')),false);
});

test('lost acknowledgement after registration publication retries without restoring again',async t=>{
 const {root,start}=await fixture(t),a=await start(),s=await a.status(),{Store}=require('../src/store.cjs'),other=new Store(path.join(root,'another.sqlite'));other.mutate('car.save',{data:{name:'Other collection'}});const source=path.join(root,'another.sfpbackup');B.exportBackup(other.file,source);
 const input={...identity(s),revision:s.revision,operationId:'ack-lost',source},unlink=fs.unlinkSync;let injected=false;
 fs.unlinkSync=function(file){if(!injected&&file===path.join(root,'replacement.json')){injected=true;throw Object.assign(Error('Simulated acknowledgement interruption'),{code:'EIO'});}return unlink.apply(this,arguments);};
 try{await assert.rejects(require('../src/shared-library-restore.cjs').restore(s.file,{sharedRoot:root,openedDatabaseId:s.databaseId,installationId:'Timing'},input),e=>e.code==='RESTORE_UNCERTAIN');}finally{fs.unlinkSync=unlink;}
 assert.equal(L.read(root).databaseId,other.data.id);assert.equal(fs.existsSync(path.join(root,'replacement.json')),true);
 const retried=await a.restore(input);assert.equal(retried.duplicate,true);assert.equal(retried.databaseId,other.data.id);assert.equal(fs.existsSync(path.join(root,'replacement.json')),false);
});
