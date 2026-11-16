'use strict';
// Moving the shared library to another folder (shared-library-location relocate).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const {open}=require('../packages/shared-library/index.cjs'),L=require('../src/shared-library-location.cjs');
const identity=s=>({databaseId:s.databaseId,recoveryId:s.recoveryId});

async function fixture(t){
 const base=require('./support/temp-dir.cjs')('relocate-'),root=path.join(base,'registration'),handles=[];
 t.after(async()=>{await Promise.all(handles.map(h=>h.close().catch(()=>{})));fs.rmSync(base,{recursive:true,force:true});});
 const start=async(name='Timing')=>{const h=await open({application:name,installationId:name,sharedRoot:root,legacyProfiles:[]});handles.push(h);return h;};
 // A library with one car, closed again so nothing holds the file.
 const first=await start(),s=await first.status(),car=await first.carWrite({...identity(s),operationId:'seed',action:'create',set:{name:'Before the move'}});await first.close();
 const dest=path.join(base,'new folder with spaces');
 return {base,root,start,file:s.file,databaseId:s.databaseId,carId:car.car.id,dest,target:path.join(dest,'library.sqlite'),registered:()=>JSON.parse(fs.readFileSync(path.join(root,'library.json'),'utf8')).file};
}
const names=async h=>(await h.catalogue()).cars.map(c=>c.fields.name).sort();
const files=folder=>fs.existsSync(folder)?fs.readdirSync(folder).sort():[];
const receipt=f=>fs.existsSync(path.join(f.root,'relocation.json'));
function rawWrite(file){const db=new DatabaseSync(file,{timeout:2000});try{db.exec("UPDATE state SET value=value WHERE key='identity'");}finally{db.close();}}
function triggers(file){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'library_moved%'").all().length;}finally{db.close();}}
function unlocked(file,databaseId){assert.equal(L.identity(file),databaseId);assert.equal(triggers(file),0);rawWrite(file);}
// Runs relocate in a separate Node process that dies (exit 9) at a chosen point,
// so the coordination lock is released exactly as in a real crash or power cut.
function crashDuring(root,input,when){
 const code=`const fs=require('node:fs'),path=require('node:path'),[loc,root,input,when]=JSON.parse(process.argv[1]),rename=fs.renameSync,link=fs.linkSync;
fs.linkSync=function(){if(when==='before-link')process.exit(9);return link.apply(this,arguments);};
fs.renameSync=function(from,to){if(when==='before-publish'&&path.basename(String(to))==='library.json')process.exit(9);return rename.apply(this,arguments);};
require(loc).relocate(root,input).then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});`;
 return spawnSync(process.execPath,['-e',code,JSON.stringify([require.resolve('../src/shared-library-location.cjs'),root,input,when])],{encoding:'utf8',timeout:60000});
}

test('moving copies the library, repoints library.json and locks the old file where it is',async t=>{
 const f=await fixture(t),result=await L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest});
 assert.equal(result.file,fs.realpathSync(f.target));assert.equal(result.from,f.file);assert.equal(L.read(f.root).file,fs.realpathSync(f.target));assert.equal(L.read(f.root).databaseId,f.databaseId);
 assert.equal(receipt(f),false);assert.deepEqual(files(f.dest),['library.sqlite']);
 assert.match(fs.readFileSync(path.join(path.dirname(f.file),'MOVED-TO.txt'),'utf8'),new RegExp(f.target.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')));
 // New copy: same identity, no marker, no triggers, writable through a fresh handle.
 unlocked(f.target,f.databaseId);
 const h=await f.start('Paddock'),s=await h.status();assert.equal(s.databaseId,f.databaseId);assert.equal(s.file,fs.realpathSync(f.target));assert.deepEqual(await names(h),['Before the move']);
 await h.carWrite({...identity(s),operationId:'after',action:'create',set:{name:'After the move'}});assert.deepEqual(await names(h),['After the move','Before the move']);
 // Old file: still at its path (so nothing can recreate an empty library there), says where the library went, refuses every write.
 assert.equal(fs.existsSync(f.file),true);
 assert.throws(()=>L.identity(f.file),e=>e.code==='LIBRARY_MOVED'&&path.resolve(e.details.movedTo)===path.resolve(f.target));
 assert.throws(()=>rawWrite(f.file),/LIBRARY_MOVED/);
 const old=new DatabaseSync(f.file,{readOnly:true});try{
  const tables=old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name).sort();
  const covered=old.prepare("SELECT tbl_name AS t,count(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'library_moved%' GROUP BY tbl_name").all();
  assert.deepEqual(covered.map(r=>r.t).sort(),tables);assert.ok(covered.every(r=>r.n===3),'insert, update and delete are blocked on every table');
 }finally{old.close();}
});

test('a handle opened before the move gets LIBRARY_MOVED and a reopened handle continues',async t=>{
 const f=await fixture(t),stale=await f.start('Timing'),before=await stale.status();
 await L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest});
 await assert.rejects(stale.catalogue(),e=>e.code==='LIBRARY_MOVED'&&path.resolve(e.details.movedTo)===path.resolve(f.target));
 await assert.rejects(stale.carWrite({...identity(before),operationId:'lost',action:'create',set:{name:'Must not be lost'}}),e=>e.code==='LIBRARY_MOVED');
 await assert.rejects(stale.restore({...identity(before),revision:before.revision,operationId:'stale-restore',source:path.join(f.base,'none.sfpbackup')}),e=>e.code==='LIBRARY_MOVED');
 assert.throws(()=>L.assertCurrent(f.root,f.file,f.databaseId),e=>e.code==='LIBRARY_MOVED');
 const fresh=await f.start('Timing');assert.deepEqual(await names(fresh),['Before the move']);
 const s=await fresh.status();await fresh.carWrite({...identity(s),operationId:'lost',action:'create',set:{name:'Retried after reopening'}});
 assert.deepEqual(await names(fresh),['Before the move','Retried after reopening']);
});

test('an idle connection to the old file does not block the move, and cannot write afterwards',async t=>{
 const f=await fixture(t),idle=new DatabaseSync(f.file,{timeout:2000});idle.prepare('SELECT count(*) FROM state').get();
 try{await L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest});assert.throws(()=>idle.exec("UPDATE state SET value=value WHERE key='identity'"),/LIBRARY_MOVED/);}finally{idle.close();}
 assert.equal(L.read(f.root).file,fs.realpathSync(f.target));
});

test('while another app is in the middle of saving, the move waits and then gives up without changing anything',async t=>{
 const f=await fixture(t),writer=new DatabaseSync(f.file,{timeout:2000});writer.exec('BEGIN IMMEDIATE');
 try{await assert.rejects(L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest,lockWaitMs:300}),e=>e.code==='LIBRARY_IN_USE');}finally{writer.exec('ROLLBACK');writer.close();}
 assert.equal(L.read(f.root).file,fs.realpathSync(f.file));assert.equal(receipt(f),false);assert.deepEqual(files(f.dest),[]);unlocked(f.file,f.databaseId);
});

test('invalid destinations are rejected before anything is touched',async t=>{
 const f=await fixture(t),before=files(path.dirname(f.file)),go=folder=>L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder});
 await assert.rejects(go(path.dirname(f.file)),e=>e.code==='INVALID_LOCATION');
 await assert.rejects(go('relative/folder'),e=>e.code==='INVALID_LOCATION');
 fs.mkdirSync(f.dest,{recursive:true});fs.writeFileSync(f.target,'someone else');
 await assert.rejects(go(f.dest),e=>e.code==='TARGET_EXISTS');assert.equal(fs.readFileSync(f.target,'utf8'),'someone else');
 await assert.rejects(L.relocate(f.root,{file:f.file,databaseId:'another-library',folder:path.join(f.base,'x')}),e=>e.code==='DATABASE_MISMATCH');
 assert.deepEqual(files(path.dirname(f.file)),before);assert.equal(L.read(f.root).file,fs.realpathSync(f.file));unlocked(f.file,f.databaseId);
});

test('a failure while placing the copy unlocks the original and removes the copy',async t=>{
 const f=await fixture(t),real=fs.linkSync;
 fs.linkSync=function(){throw Object.assign(Error('Simulated disk failure'),{code:'EIO'});};
 try{await assert.rejects(L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest}),/Simulated disk failure/);}finally{fs.linkSync=real;}
 unlocked(f.file,f.databaseId);assert.deepEqual(files(f.dest),[]);assert.equal(receipt(f),false);assert.equal(L.read(f.root).file,fs.realpathSync(f.file));
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);
});

test('a cleanup failure after publishing never undoes the move',async t=>{
 const f=await fixture(t),real=fs.unlinkSync;let failed=false;
 fs.unlinkSync=function(file){if(!failed&&path.basename(String(file))==='relocation.json'){failed=true;throw Object.assign(Error('Simulated virus scanner lock'),{code:'EPERM'});}return real.apply(this,arguments);};
 let result;try{result=await L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest});}finally{fs.unlinkSync=real;}
 assert.equal(failed,true);assert.equal(result.file,fs.realpathSync(f.target));assert.equal(L.read(f.root).file,fs.realpathSync(f.target));assert.equal(fs.existsSync(f.target),true);
 assert.equal(receipt(f),true,'the leftover receipt is finished later');
 assert.throws(()=>L.checkOpen(f.root,f.file,f.databaseId),e=>e.code==='LIBRARY_MOVED','published, so stale handles reopen instead of waiting');
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);assert.equal((await h.status()).file,fs.realpathSync(f.target));assert.equal(receipt(f),false);
 assert.throws(()=>L.identity(f.file),e=>e.code==='LIBRARY_MOVED');
});

test('a crash after locking but before the copy is placed is undone on next open',async t=>{
 const f=await fixture(t),run=crashDuring(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest},'before-link');
 assert.equal(run.status,9,run.stderr);assert.equal(receipt(f),true);assert.ok(triggers(f.file)>0,'old file was locked before the crash');
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);
 assert.equal(L.read(f.root).file,fs.realpathSync(f.file));unlocked(f.file,f.databaseId);assert.equal(receipt(f),false);assert.deepEqual(files(f.dest),[]);
});

test('a crash after the verified copy is in place but before publishing finishes the move on next open',async t=>{
 const f=await fixture(t),before=f.registered(),run=crashDuring(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest},'before-publish');
 assert.equal(run.status,9,run.stderr);assert.equal(fs.existsSync(f.target),true);assert.equal(f.registered(),before,'library.json not yet repointed');
 // Meanwhile an already-open handle is told to wait, not that the library is gone.
 assert.throws(()=>L.checkOpen(f.root,f.file,f.databaseId),e=>e.code==='LIBRARY_BUSY');
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);
 assert.equal(L.read(f.root).file,fs.realpathSync(f.target));assert.equal(receipt(f),false);
 assert.throws(()=>L.checkOpen(f.root,f.file,f.databaseId),e=>e.code==='LIBRARY_MOVED');assert.ok(files(path.dirname(f.file)).includes('MOVED-TO.txt'));
});

test('a leftover receipt for a different library is discarded without touching files',async t=>{
 const f=await fixture(t);
 fs.writeFileSync(path.join(f.root,'relocation.json'),JSON.stringify({version:2,databaseId:'some-other-library',from:path.join(f.base,'elsewhere.sqlite'),to:f.target,temp:f.target+'.x.tmp'}));
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);assert.equal(receipt(f),false);unlocked(f.file,f.databaseId);
});

test('drives without hard links (USB sticks, SD cards) get a verified copy instead',async t=>{
 const f=await fixture(t),real=fs.linkSync;let tried=0;
 fs.linkSync=function(){tried++;throw Object.assign(Error('EISDIR: illegal operation on a directory, link'),{code:'EISDIR'});};
 let result;try{result=await L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest});}finally{fs.linkSync=real;}
 assert.equal(tried,1);assert.equal(result.file,fs.realpathSync(f.target));assert.deepEqual(files(f.dest),['library.sqlite']);unlocked(f.target,f.databaseId);
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);
});

test('recovery never discards its receipt because library.json could not be read for a moment',async t=>{
 const f=await fixture(t),run=crashDuring(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest},'before-link');assert.equal(run.status,9,run.stderr);
 const real=fs.readFileSync;let blocked=0;
 fs.readFileSync=function(file){if(path.basename(String(file))==='library.json'){blocked++;throw Object.assign(Error('Simulated scanner lock'),{code:'EBUSY'});}return real.apply(this,arguments);};
 try{await assert.rejects(L.recover(f.root),e=>e.code==='EBUSY');}finally{fs.readFileSync=real;}
 assert.equal(receipt(f),true,'receipt kept for the next attempt');
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);unlocked(f.file,f.databaseId);assert.equal(receipt(f),false);
});

test('a locked library with no receipt (never published) is unlocked on open',async t=>{
 const f=await fixture(t),run=crashDuring(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest},'before-link');assert.equal(run.status,9,run.stderr);
 fs.rmSync(path.join(f.root,'relocation.json'));assert.ok(triggers(f.file)>0);
 const h=await f.start();assert.deepEqual(await names(h),['Before the move']);unlocked(f.file,f.databaseId);
});

test('if library.json is lost after a move, the old file leads to the new location',async t=>{
 const f=await fixture(t);await L.relocate(f.root,{file:f.file,databaseId:f.databaseId,folder:f.dest});
 fs.rmSync(path.join(f.root,'library.json'));
 const found=await L.resolve({sharedRoot:f.root,legacyPaddockPath:f.file});
 assert.equal(found.file,fs.realpathSync(f.target));assert.equal(found.databaseId,f.databaseId);assert.equal(L.read(f.root).file,fs.realpathSync(f.target));
});

test('a missing library file is reported as missing, never recreated',async t=>{
 const f=await fixture(t);fs.renameSync(f.file,f.file+'.aside');
 assert.throws(()=>L.checkOpen(f.root,f.file,f.databaseId),e=>e.code==='LIBRARY_MISSING');
 await assert.rejects(f.start(),e=>e.code==='LIBRARY_MISSING');assert.equal(fs.existsSync(f.file),false);
 fs.renameSync(f.file+'.aside',f.file);assert.equal(L.checkOpen(f.root,f.file,f.databaseId),f.databaseId);
});
