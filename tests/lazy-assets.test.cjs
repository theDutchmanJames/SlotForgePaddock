const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store,makePackage}=require('../src/store.cjs'),storage=require('../src/sqlite-storage.cjs'),lazy=require('../src/lazy-assets.cjs'),{RendererMedia}=require('../src/renderer-media.cjs');
const photo='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-lazy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.json'));s.mutate('car.save',{data:{name:'Original',picture:photo,photos:[{id:'extra',name:'Extra',data:photo}],realHistory:{classification:'Real Racing Car',photos:[{id:'reference',name:'Reference',data:photo}]}}});s.mutate('planning.focus',{revision:s.data.revision,carId:s.data.cars[0].id,photoKey:'main',x:50,y:50});return {s,dir};}
test('opening, validation, snapshot copying and renderer projection do not load originals',t=>{
 const {s}=fixture(t);lazy.clearCache();const reopened=new Store(s.file),media=new RendererMedia(),snapshot=reopened.snapshot(),projected=media.project(snapshot);
 assert.equal(lazy.stats().reads,0);assert.match(projected.cars[0].picture,/^paddock-media:/);assert.equal(lazy.stats().reads,0);
 assert.deepEqual(media.response(projected.cars[0].picture).bytes,Buffer.from(photo.split(',')[1],'base64'));assert.equal(lazy.stats().reads,1);
 assert.equal(JSON.stringify(snapshot),JSON.stringify(storage.read(s.file)));assert.equal(makePackage(reopened.data,[reopened.data.cars[0].id],{photos:true}).cars[0].picture,photo);
});
test('byte measurements preserve exact JSON sizes without loading photo bytes',t=>{
 const {s}=fixture(t);lazy.clearCache();const reopened=new Store(s.file),n=require('../src/json-encoding.cjs').byteLength(reopened.data);assert.equal(lazy.stats().reads,0);assert.equal(n,Buffer.byteLength(JSON.stringify(storage.read(s.file))));
});
test('ordinary text saves and renderer patches leave unrelated originals cold',async t=>{
 const {s}=fixture(t),reopened=new Store(s.file),transfer=new (require('../src/snapshot-transfer.cjs').SnapshotTransfer)(),media=new RendererMedia();const before=reopened.snapshot();transfer.encode({data:before},null,reopened.file);lazy.clearCache();
 const result=await reopened.mutateAsync('car.save',{id:before.cars[0].id,revision:before.cars[0].revision,data:{livery:'After'}});const out=transfer.encode(result,{databaseId:before.id,revision:before.revision,dataPath:reopened.file},reopened.file);media.project(out);assert.equal(lazy.stats().reads,0);assert.equal(reopened.lastWrite.assetWrites,0);
});
test('background media reader returns exact bytes without filling the main-thread original cache',async t=>{
 const {s}=fixture(t),reopened=new Store(s.file),media=new RendererMedia(),url=media.project(reopened.snapshot()).cars[0].picture;lazy.clearCache();const out=await media.responseAsync(url);assert.deepEqual(Buffer.from(out.bytes),Buffer.from(photo.split(',')[1],'base64'));assert.equal(lazy.stats().reads,0);
});
test('leased photos survive removal and repeated writes while stale URLs are collected after release',t=>{
 const {s}=fixture(t),reopened=new Store(s.file);let now=0;const media=new RendererMedia({clock:()=>now,grace:10}),url=media.project(reopened.snapshot()).cars[0].picture;media.leaseOpen(true);
 reopened.mutate('car.save',{id:reopened.data.cars[0].id,revision:reopened.data.cars[0].revision,data:{picture:'',photos:[],realHistory:{photos:[]}}});for(let i=0;i<3;i++)reopened.mutate('settings.save',{name:'After '+i});now=100;media.retain([reopened.data]);assert.ok(media.response(url));media.leaseOpen(false);now=200;media.retain([reopened.data]);assert.equal(media.response(url),null);
});
test('temporary imported images use files and are removed after the editor lease closes',t=>{
 const {dir}=fixture(t);let now=0;const media=new RendererMedia({folder:path.join(dir,'staged'),clock:()=>now,grace:10});media.leaseOpen(true);const url=media.project(photo);assert.equal(media.byUrl.get(url).value,null);now=100;media.retain([]);assert.equal(media.expand(url),photo);assert.equal(fs.readdirSync(media.folder).length,1);media.leaseOpen(false);now=200;media.retain([]);assert.equal(fs.readdirSync(media.folder).length,0);assert.equal(media.stats().stagedBytes,0);
});

test('format 2 migration preserves both revisions and protects its recovery file',t=>{
 const {s}=fixture(t),before=JSON.stringify(s.snapshot()),previous=JSON.stringify(s.previousSnapshot()),{DatabaseSync}=require('node:sqlite');
 let db=new DatabaseSync(s.file);db.exec('ALTER TABLE assets DROP COLUMN meta; ALTER TABLE assets DROP COLUMN meta_digest; PRAGMA user_version=2');db.close();
 const reopened=new Store(s.file);assert.equal(JSON.stringify(reopened.snapshot()),before);assert.equal(JSON.stringify(reopened.previousSnapshot()),previous);assert.ok(reopened.storageRecoveryFile.includes('.format2-'));assert.ok(reopened.protectedFiles().includes(reopened.storageRecoveryFile));assert.equal(JSON.stringify(storage.read(reopened.storageRecoveryFile)),before);
 lazy.clearCache();new Store(s.file).snapshot();assert.equal(lazy.stats().reads,0);
});

test('failed metadata migration leaves format 2 and both revisions intact',t=>{
 const {s}=fixture(t),before=JSON.stringify(s.snapshot()),previous=JSON.stringify(s.previousSnapshot()),{DatabaseSync}=require('node:sqlite');let db=new DatabaseSync(s.file);
 db.exec("ALTER TABLE assets DROP COLUMN meta; ALTER TABLE assets DROP COLUMN meta_digest; PRAGMA user_version=2; CREATE TRIGGER fail_meta BEFORE UPDATE ON assets BEGIN SELECT RAISE(ABORT,'metadata failure'); END");db.close();assert.throws(()=>new Store(s.file),/metadata failure/);
 db=new DatabaseSync(s.file);assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);assert.equal(db.prepare('PRAGMA table_info(assets)').all().some(x=>x.name==='meta'),false);db.close();assert.equal(JSON.stringify(storage.read(s.file)),before);assert.equal(JSON.stringify(storage.read(s.file,true)),previous);
});

test('metadata corruption fails on opening; body corruption fails before a photo is returned',t=>{
 const {s}=fixture(t),{DatabaseSync}=require('node:sqlite');let db=new DatabaseSync(s.file);db.exec("UPDATE assets SET meta_digest='invalid'");db.close();assert.throws(()=>new Store(s.file),/metadata integrity/);
 db=new DatabaseSync(s.file);for(const row of db.prepare('SELECT hash,meta FROM assets').all())db.prepare('UPDATE assets SET meta_digest=? WHERE hash=?').run(lazy.digest(row.meta),row.hash);db.exec('UPDATE assets SET value=zeroblob(length(value))');db.close();lazy.clearCache();const reopened=new Store(s.file);assert.equal(lazy.stats().reads,0);assert.throws(()=>reopened.data.cars[0].picture,/attachment integrity/);assert.throws(()=>storage.read(s.file),/attachment integrity/);
});

test('saving identical photo bytes preserves focus across lazy and ordinary representations',t=>{
 const {s}=fixture(t),reopened=new Store(s.file),car=reopened.data.cars[0];reopened.mutate('car.save',{id:car.id,revision:car.revision,data:{picture:photo}});assert.equal(reopened.data.planning.focus.length,1);
 reopened.mutate('car.save',{id:car.id,revision:reopened.data.cars[0].revision,data:{picture:''}});assert.equal(reopened.data.planning.focus.length,0);
});

test('truncated JPEG marker sequences cannot crash metadata extraction',()=>{
 for(const bytes of [Buffer.from([255,216,255,255,255,255,255,255]),Buffer.from([255,216,255,192,0,20,0,1])])assert.doesNotThrow(()=>lazy.metadata('data:image/jpeg;base64,'+bytes.toString('base64')));
});

test('Dealership saves defer legacy photo checksums but retain exact immutable wire digests',async t=>{
 const {s,dir}=fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs'),M=require('../src/club-model.cjs'),network=new Network(s),club=new Club(s,network,path.join(dir,'club'));t.after(()=>{club.close();network.close();});club.enable('Media test','Media password');lazy.clearCache();
 club.legacyRequested=true;await club.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{livery:'Proposed'}});assert.equal(lazy.stats().reads,0);const entry=club.journal.at(-1),expected=JSON.stringify(M.shared(s.data));const proposal=s.data.club.proposals[0],view=club.preview(proposal.id);await club.reviewAsync({id:proposal.id,token:view.token,decision:'accept'});assert.equal(lazy.stats().reads,1); // Only the explicit expected-value serialization read the photo.
 assert.equal(JSON.parse(JSON.stringify(entry)).digest,lazy.digest(expected));assert.equal(Object.keys(entry).includes('retainedBytes'),false);assert.ok(club.journalBytes<=32*1024*1024);
});

test('original cache and cancelled editor staging stay bounded over repeated browsing cycles',t=>{
 const {s,dir}=fixture(t);s.transact(data=>{for(let i=0;i<20;i++)data.cars.push({...data.cars[0],id:'cache-'+i,picture:'data:image/png;base64,'+Buffer.alloc(1024*1024,i).toString('base64')});});const reopened=new Store(s.file);lazy.clearCache();
 for(let cycle=0;cycle<3;cycle++)for(const car of reopened.data.cars){assert.ok(car.picture);assert.ok(lazy.stats().cacheBytes<=lazy.stats().cacheLimit);}assert.ok(lazy.stats().reads>40);
 let now=0;const media=new RendererMedia({folder:path.join(dir,'cycles'),clock:()=>now,grace:1});for(let i=0;i<20;i++){media.leaseOpen(true);media.project('data:image/png;base64,'+Buffer.alloc(2048,i).toString('base64'));media.leaseOpen(false);now+=2;media.retain([]);assert.deepEqual(media.stats(),{entries:0,leased:0,stagedBytes:0});}assert.deepEqual(fs.readdirSync(media.folder),[]);
});
