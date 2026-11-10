'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const L=require('../src/local-library-launcher.cjs'),{Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs');
test('protected registration persists at quit, selects the exact profile and is removed on disable',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-launch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profile=path.join(root,'profile'),folder=path.join(root,'discovery');fs.mkdirSync(profile);const store=new Store(path.join(profile,'database.sqlite'));store.persist(store.data);const command=L.command({packaged:false,appPath:path.resolve(__dirname,'..')});
 let service=new LocalLibrary({store,profile,folder,launcher:command});t.after(async()=>{service.quiesce();await service.idle();service.close();});await service.start();assert.equal(service.error,'');const file=service.launcher.file;const read=()=>L.readStart([L.PREFIX+L.key(profile)],{folder,command});assert.equal(read().profile,profile);assert.equal(read().databaseId,store.data.id);assert.deepEqual(read().args,[...command.args,L.PREFIX+L.key(profile)]);assert.equal(Object.hasOwn(read(),'token'),false);
 service.quiesce();await service.idle();service.close();assert.equal(fs.existsSync(file),true);assert.equal(fs.existsSync(service.file),false);
 service=new LocalLibrary({store,profile,folder,launcher:command});await service.start();assert.equal(service.error,'');await service.setEnabled(false);assert.equal(fs.existsSync(file),false);assert.throws(read);service.close();
});
test('launcher rejects moved executables, disabled access, missing data and malformed flags',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-launch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const profile=path.join(root,'profile'),folder=path.join(root,'discovery');fs.mkdirSync(profile);const store=new Store(path.join(profile,'database.sqlite'));store.persist(store.data);const command=L.command({packaged:false,appPath:path.resolve(__dirname,'..')}),launcher=new L.Launcher({profile,folder,command});await launcher.prepare();launcher.publish(store);const flag=L.PREFIX+launcher.key,read=()=>L.readStart([flag],{folder,command});
 assert.throws(()=>L.readStart([flag],{folder,command:{...command,args:['other-installation']}}),/another installation/);assert.throws(()=>L.readStart([flag,flag],{folder,command}),/Invalid/);assert.throws(()=>L.readStart([L.PREFIX+'../bad'],{folder,command}),/Invalid/);assert.equal(L.readStart([],{folder,command}),null);
 fs.writeFileSync(path.join(profile,'local-library-settings.json'),JSON.stringify({version:1,enabled:false}));assert.throws(read,/disabled/);fs.writeFileSync(path.join(profile,'local-library-settings.json'),JSON.stringify({version:1,enabled:true}));fs.unlinkSync(store.file);assert.throws(read,/missing/);assert.equal(fs.existsSync(store.file),false);
});
test('packaged launch commands preserve portable and AppImage locations without shell strings',()=>{
 for(const env of [{PORTABLE_EXECUTABLE_FILE:process.execPath},{APPIMAGE:process.execPath}])assert.deepEqual(L.command({packaged:true,env}),{executable:path.resolve(process.execPath),args:[]});assert.throws(()=>L.command({packaged:true,env:{APPIMAGE:'relative'}}),/unavailable/);
});

test('an unprotected launch record is refused before it can select a profile',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-launch-unprotected-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'unprotected.json');fs.writeFileSync(file,'{}',{mode:0o644});assert.throws(()=>L.privateFile(file));
});
