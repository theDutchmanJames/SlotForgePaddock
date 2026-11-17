'use strict';
// Desktop side of "Move library…": folder checks, the saved request and the startup run.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../src/shared-library-move.cjs');

function fixture(t){
 const base=require('./support/temp-dir.cjs')('library-move-'),old=path.join(base,'old'),profile=path.join(base,'profile');
 fs.mkdirSync(old,{recursive:true});fs.mkdirSync(profile,{recursive:true});const file=path.join(old,'library.sqlite');fs.writeFileSync(file,Buffer.alloc(4096));
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return {base,old,profile,file};
}
const ok=()=>{};

test('a normal folder is accepted and reports the target, size and no warnings',t=>{
 const f=fixture(t),info=M.inspect(path.join(f.base,'Slotcars','Library'),{file:f.file,requireSpace:ok});
 assert.equal(info.target,path.join(f.base,'Slotcars','Library','library.sqlite'));assert.equal(info.size,4096);assert.deepEqual(info.warnings,[]);
 // Checking must not leave new folders behind (the user may still cancel); an existing folder stays.
 assert.equal(fs.existsSync(path.join(f.base,'Slotcars')),false);
 fs.mkdirSync(path.join(f.base,'Existing'));M.inspect(path.join(f.base,'Existing'),{file:f.file,requireSpace:ok});assert.deepEqual(fs.readdirSync(path.join(f.base,'Existing')),[],'write probe is removed');
});

test('cloud-synced folders are allowed with a clear warning',t=>{
 const f=fixture(t);
 for(const name of ['OneDrive','OneDrive - Racing Club','Dropbox','Google Drive','iCloudDrive'])assert.equal(M.inspect(path.join(f.base,name,'Paddock'),{file:f.file,requireSpace:ok}).warnings.length,1,name);
 assert.equal(M.inspect(path.join(f.base,'OneDriveless'),{file:f.file,requireSpace:ok}).warnings.length,0);
});

test('unsafe or impossible destinations are refused with plain reasons',t=>{
 const f=fixture(t),go=(folder,extra={})=>()=>M.inspect(folder,{file:f.file,requireSpace:ok,...extra});
 assert.throws(go('relative'),e=>e.code==='INVALID_LOCATION');
 assert.throws(go(f.old),e=>e.code==='INVALID_LOCATION'&&/already in this folder/.test(e.message));
 assert.throws(go('\\\\server\\share\\paddock',{platform:'win32'}),e=>e.code==='NETWORK_LOCATION');
 assert.throws(go('//server/share/paddock',{platform:'win32'}),e=>e.code==='NETWORK_LOCATION');
 assert.throws(go(path.join(f.base,'Program','resources'),{appFolder:path.join(f.base,'Program')}),e=>e.code==='INVALID_LOCATION'&&/program folder/.test(e.message));
 fs.mkdirSync(path.join(f.base,'taken'));fs.writeFileSync(path.join(f.base,'taken','library.sqlite'),'x');assert.throws(go(path.join(f.base,'taken')),e=>e.code==='TARGET_EXISTS');
 assert.throws(go(path.join(f.base,'full'),{requireSpace:()=>{throw Error('no space');}}),e=>e.code==='NOT_ENOUGH_SPACE');assert.equal(fs.existsSync(path.join(f.base,'full')),false);
 fs.writeFileSync(path.join(f.base,'a-file'),'x');assert.throws(go(path.join(f.base,'a-file')),e=>e.code==='INVALID_LOCATION'&&/file, not a folder/.test(e.message));
 assert.throws(go(path.join(f.base,'x'.repeat(240)),{platform:'win32'}),e=>e.code==='LOCATION_TOO_LONG');
});

test('the move request survives a restart and invalid requests are ignored',t=>{
 const f=fixture(t);assert.equal(M.pending(f.profile),null);
 M.request(f.profile,{folder:path.join(f.base,'new'),file:f.file,databaseId:'db-1'});assert.equal(M.pending(f.profile).databaseId,'db-1');
 fs.writeFileSync(path.join(f.profile,'library-move-request.json'),'{"version":1,"folder":"relative","file":"x","databaseId":"y"}');assert.equal(M.pending(f.profile),null);
 M.clear(f.profile);assert.equal(fs.existsSync(path.join(f.profile,'library-move-request.json')),false);
});

function fakeLocation(f,{inUse=0,databaseId='db-1',file}={}){
 const calls=[];let busy=inUse;
 return {calls,location:{recover:async()=>{calls.push('recover');},read:()=>({file:file||f.file,databaseId}),relocate:async(root,input)=>{calls.push(['relocate',input.folder]);if(busy-->0)throw Object.assign(Error('in use'),{code:'LIBRARY_IN_USE'});return {file:path.join(input.folder,'library.sqlite'),from:f.file,databaseId};}}};
}
const dialog=answers=>{const asked=[];return {asked,showMessageBox:async o=>{asked.push(o.title);return {response:answers.shift()};}};};

test('startup runs a pending move once, and asks to close Timing when the file is in use',async t=>{
 const f=fixture(t),target=path.join(f.base,'new');
 assert.equal(await M.runPending({profile:f.profile,root:f.base,dialog:dialog([]),location:fakeLocation(f).location}),null,'no request, nothing happens');
 M.request(f.profile,{folder:target,file:f.file,databaseId:'db-1'});
 const fake=fakeLocation(f,{inUse:1}),d=dialog([0]),result=await M.runPending({profile:f.profile,root:f.base,dialog:d,location:fake.location});
 assert.equal(result.status,'moved');assert.equal(result.file,path.join(target,'library.sqlite'));assert.deepEqual(d.asked,['Close SlotForge Timing first']);
 assert.equal(fake.calls.filter(c=>c[0]==='relocate').length,2);assert.equal(M.pending(f.profile),null);
});

test('a request from a restart that never happened expires instead of moving later',async t=>{
 const f=fixture(t);M.request(f.profile,{folder:path.join(f.base,'new'),file:f.file,databaseId:'db-1'});
 const fake=fakeLocation(f),result=await M.runPending({profile:f.profile,root:f.base,dialog:dialog([]),location:fake.location,now:Date.now()+16*60*1000});
 assert.equal(result.status,'error');assert.match(result.error,/not moved/);assert.equal(fake.calls.length,0);assert.equal(M.pending(f.profile),null);
});

test('cancelling, a changed library or an error leave the library in place and clear the request',async t=>{
 const f=fixture(t),target=path.join(f.base,'new'),again=()=>M.request(f.profile,{folder:target,file:f.file,databaseId:'db-1'});
 again();assert.deepEqual(await M.runPending({profile:f.profile,root:f.base,dialog:dialog([1]),location:fakeLocation(f,{inUse:5}).location}),{status:'cancelled'});assert.equal(M.pending(f.profile),null);
 again();const changed=fakeLocation(f,{databaseId:'other-library'});assert.match((await M.runPending({profile:f.profile,root:f.base,dialog:dialog([]),location:changed.location})).error,/changed/);assert.equal(changed.calls.some(c=>c[0]==='relocate'),false);
 again();const failing={recover:async()=>{},read:()=>({file:f.file,databaseId:'db-1'}),relocate:async()=>{throw Object.assign(Error('The copied library failed its integrity check.'),{code:'LIBRARY_COPY_INVALID'});}};
 assert.match((await M.runPending({profile:f.profile,root:f.base,dialog:dialog([]),location:failing})).error,/integrity/);assert.equal(M.pending(f.profile),null);
});

test('end to end with the real engine: request, restart, moved',async t=>{
 const base=require('./support/temp-dir.cjs')('library-move-real-'),root=path.join(base,'registration'),profile=path.join(base,'profile');fs.mkdirSync(profile);
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const {open}=require('../packages/shared-library/index.cjs'),h=await open({application:'Paddock',installationId:'Paddock',sharedRoot:root,legacyProfiles:[]}),s=await h.status();
 await h.carWrite({databaseId:s.databaseId,recoveryId:s.recoveryId,operationId:'c',action:'create',set:{name:'Travelling car'}});await h.close();
 const info=M.inspect(path.join(base,'D drive','SlotForge'),{file:s.file});M.request(profile,{folder:info.folder,file:s.file,databaseId:s.databaseId});
 const result=await M.runPending({profile,root,dialog:dialog([])});assert.equal(result.status,'moved',JSON.stringify(result));
 const again=await open({application:'Timing',installationId:'Timing',sharedRoot:root,legacyProfiles:[]});try{const now=await again.status();assert.equal(now.file,result.file);assert.deepEqual((await again.catalogue()).cars.map(c=>c.fields.name),['Travelling car']);}finally{await again.close();}
});
