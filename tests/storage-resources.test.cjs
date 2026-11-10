const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),S=require('../src/sqlite-storage.cjs'),lazy=require('../src/lazy-assets.cjs'),R=require('../src/storage-resources.cjs'),{view}=require('../src/view-query.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-resources-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));s.mutate('car.save',{data:{name:'First',picture:'data:image/png;base64,AAAA'}});return {dir,s};}
test('low disk preflight preserves committed data, previous revision, notifications and retry',t=>{
 const {s}=fixture(t),before=JSON.stringify(s.data),previous=JSON.stringify(s.previousSnapshot());let signals=0;s.subscribe(()=>signals++);
 const mock=t.mock.method(fs,'statfsSync',()=>({bavail:0,bsize:4096}));assert.throws(()=>s.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{name:'Pending'}}),/free disk space/);assert.equal(JSON.stringify(s.data),before);assert.equal(JSON.stringify(new Store(s.file).data),before);assert.equal(JSON.stringify(s.previousSnapshot()),previous);assert.equal(signals,0);
 mock.mock.restore();s.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{name:'Saved'}});assert.equal(new Store(s.file).data.cars[0].name,'Saved');assert.equal(signals,1);
});
test('disk estimates include new lazy external assets without reading their bodies',t=>{
 const {s,dir}=fixture(t),source=new Store(path.join(dir,'source.sqlite'));source.mutate('car.save',{data:{name:'Source',picture:'data:image/png;base64,'+'A'.repeat(1024*1024)}});
 const reopened=new Store(source.file),packed=S.pack(reopened.data);lazy.clearCache();t.mock.method(fs,'statfsSync',()=>({bavail:R.RESERVE+1024*1024,bsize:1}));assert.throws(()=>S.write(s.file,packed,s.expectedIdentity),/free disk space/);assert.equal(lazy.stats().reads,0);assert.equal(new Store(s.file).data.cars[0].name,'First');
});
test('Settings usage deduplicates originals, separates retained assets and never hydrates them',t=>{
 const {s}=fixture(t);s.mutate('car.save',{data:{name:'Second',picture:'data:image/png;base64,AAAA'}});lazy.clearCache();let u=view(s,{page:'Settings'})._view.storage;
 assert.equal(u.mediaCount,1);assert.equal(u.mediaBytes,26);assert.equal(u.logicalLimit,null);assert.equal(u.metadataLimit,R.METADATA_LIMIT);assert.ok(u.fileBytes>u.mediaBytes);assert.equal(u.logicalBytes,require('../src/json-encoding.cjs').byteLength(s.data));assert.equal(lazy.stats().reads,0);
 s.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{picture:'data:image/png;base64,AQAB'}});u=view(s,{page:'Settings'})._view.storage;assert.equal(u.mediaCount,2);
 s.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{picture:''}});u=view(s,{page:'Settings'})._view.storage;assert.equal(u.mediaCount,1);assert.ok(u.retainedMediaBytes>=26);
 assert.equal(view(s,{page:'Cars'})._view.storage,undefined);
 t.mock.method(fs,'statfsSync',()=>{throw Error('Unavailable');});assert.equal(view(s,{page:'Settings'})._view.storage.freeBytes,null);
});
test('oversized JSON export refuses lazy content before hydration and preserves destination',t=>{
 const {dir}=fixture(t),value={};lazy.attach(value,'picture',{meta:{chars:257*1024*1024},read(){throw Error('Must not read original');}});const destination=path.join(dir,'export.json');fs.writeFileSync(destination,'keep');assert.throws(()=>require('../src/files.cjs').exportJSON(destination,value),/256 MiB/);assert.equal(fs.readFileSync(destination,'utf8'),'keep');
});
test('legacy catalogue and outgoing package size guards reject without hydrating oversized originals',async t=>{
 const {s}=fixture(t),{Network}=require('../src/network.cjs'),network=new Network(s);t.after(()=>network.close());const info=await network.start(),a=lazy.property(s.data.cars[0],'picture');
 // Synthetic lazy handles exercise the size boundary without a huge allocation.
 lazy.attach(s.data.cars[0],'picture',{meta:{...a.meta,chars:33*1024*1024},read(){throw Error('Must not hydrate');}});
 const response=await fetch('http://127.0.0.1:'+info.port+'/v1/collection',{headers:{Authorization:'Bearer '+info.code}});assert.equal(response.status,413);assert.match((await response.json()).error,/paged transfers/);
 const input={};lazy.attach(input,'picture',{meta:{chars:33*1024*1024},read(){throw Error('Must not hydrate');}});await assert.rejects(network.request('http://127.0.0.1:'+info.port,'code','/unused',input),/32 MB/);
});
test('query-view save acknowledgements skip whole snapshots while legacy callers retain them',async t=>{
 const {s,dir}=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),network=new Network(s),club=new Club(s,network,path.join(dir,'club'));t.after(()=>{club.close();network.close();});
 const snapshot=t.mock.method(s,'snapshot',()=>{throw Error('Whole snapshot requested');});const payload=name=>({id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{name}});
 assert.equal((await club.mutate('car.save',payload('Personal'),{snapshot:false})).data,undefined);assert.equal(view(s,{page:'Cars'}).cars[0].name,'Personal');
 snapshot.mock.restore();club.enable('Dealership','1234');const again=t.mock.method(s,'snapshot',()=>{throw Error('Whole snapshot requested');});const result=await club.propose('car.save',payload('Proposal'),{snapshot:false});assert.equal(result.queued,true);assert.equal(result.data,undefined);assert.equal(s.data.cars[0].name,'Personal');
 await club.propose('car.save',payload('Personal'),{snapshot:false});again.mock.restore();assert.ok((await club.propose('car.save',payload('Personal'))).data.cars.length);
});
test('maintenance indexes are added to existing format-3 files without changing data or replay',t=>{
 const {s}=fixture(t),{DatabaseSync}=require('node:sqlite'),before=JSON.stringify(s.data),cursor=S.syncState(s.file),db=new DatabaseSync(s.file);db.exec('DROP INDEX field_versions_revision; DROP INDEX change_log_sizes;');db.close();
 const reopened=new Store(s.file);assert.equal(JSON.stringify(reopened.data),before);assert.deepEqual(S.syncState(s.file),cursor);const check=new DatabaseSync(s.file);try{
  assert.ok(check.prepare('EXPLAIN QUERY PLAN SELECT sequence,bytes FROM change_log ORDER BY sequence DESC').all().some(r=>r.detail.includes('COVERING INDEX change_log_sizes')));
  assert.ok(check.prepare('EXPLAIN QUERY PLAN SELECT record FROM field_versions WHERE revision<1').all().some(r=>r.detail.includes('field_versions_revision')));
 }finally{check.close();}
});
test('oversized legacy Dealership snapshots direct clients to sync v2 before reading originals',async t=>{
 const {s,dir}=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),network=new Network(s),club=new Club(s,network,path.join(dir,'club'));t.after(()=>{club.close();network.close();});club.enable('Host','1234');const info=await network.start(),a=lazy.property(s.data.cars[0],'picture');
 lazy.attach(s.data.cars[0],'picture',{meta:{...a.meta,chars:221*1024*1024},read(){throw Error('Must not hydrate');}});
 const response=await fetch('http://127.0.0.1:'+info.port+'/v1/club/snapshot',{headers:{Authorization:'Bearer 1234','X-SlotForge-Database':s.data.id}});assert.equal(response.status,413);assert.equal((await response.json()).code,'CLUB_SNAPSHOT_TOO_LARGE');
});
