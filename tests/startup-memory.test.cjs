const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {Store,migrate}=require('../src/store.cjs'),storage=require('../src/sqlite-storage.cjs'),query=require('../src/sqlite-query.cjs'),encoding=require('../src/json-encoding.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-startup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(path.join(dir,'db.sqlite'));store.mutate('car.save',{data:{name:'A',picture:'data:image/png;base64,AAAA'}});return {dir,store};}
test('verified startup reuses persisted descriptors without repacking or hydrating media',t=>{
 const {store}=fixture(t),lazy=require('../src/lazy-assets.cjs');lazy.clearCache();
 const repack=t.mock.method(storage,'pack',()=>{throw Error('Startup repacked the collection');});const opened=new Store(store.file);repack.mock.restore();
 assert.equal(lazy.stats().reads,0);assert.equal(opened.persistedReferences.size,1);assert.equal(opened.data.cars[0].name,'A');
 opened.mutate('car.save',{id:opened.data.cars[0].id,revision:opened.data.cars[0].revision,data:{name:'B',picture:''}});
 assert.equal(opened.persistedReferences.size,0);assert.equal(new Store(store.file).data.cars[0].name,'B');assert.equal(storage.read(store.file,true).cars[0].picture,'data:image/png;base64,AAAA');
});
test('default migration still isolates caller data and owned migration validates corrupted records',t=>{
 const {store}=fixture(t),input=store.snapshot(),copy=migrate(input);assert.notEqual(copy,input);copy.cars[0].name='Changed';assert.equal(input.cars[0].name,'A');
 input.cars[0].id='bad id';assert.throws(()=>migrate(input,{owned:true}),/Invalid/);
});
test('duplicate and orphaned manifest records fail rather than returning a partial collection',t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);const original=db.prepare("SELECT value FROM state WHERE key='manifest'").get().value,tree=JSON.parse(original),cars=tree.object.find(([key])=>key==='cars')[1];cars.array.push(cars.array[0]);db.prepare("UPDATE state SET value=? WHERE key='manifest'").run(JSON.stringify(tree));db.close();assert.throws(()=>new Store(store.file),/duplicate record reference/);
 const fix=new DatabaseSync(store.file);fix.prepare("UPDATE state SET value=? WHERE key='manifest'").run(original);const removed=JSON.parse(original);removed.object.find(([key])=>key==='cars')[1].array=[];fix.prepare("UPDATE state SET value=? WHERE key='manifest'").run(JSON.stringify(removed));fix.close();assert.throws(()=>new Store(store.file),/unreferenced records/);
});
test('summary counters agree with full indexed rows through updates, deletes, rollback and rebuild',t=>{
 const {store}=fixture(t),file=store.file,expected=()=>{const db=new DatabaseSync(file);try{return db.prepare(`SELECT bucket,status,archived,count(*) n,sum(coalesce(json_extract(aux,'$.quantity'),0)) quantity,sum(CASE WHEN json_extract(aux,'$.quantity')>0 THEN 1 ELSE 0 END) owned,sum(coalesce(json_extract(aux,'$.reserved'),0)) reserved,sum(coalesce(json_extract(aux,'$.incoming'),0)) incoming,sum(CASE WHEN bucket='["installations"]' AND json_extract(aux,'$.removed')=0 THEN coalesce(json_extract(aux,'$.quantity'),0) ELSE 0 END) fitted FROM query_records GROUP BY bucket,status,archived ORDER BY bucket,status,archived`).all().map(r=>({...r}));}finally{db.close();}},check=()=>{const db=new DatabaseSync(file);try{assert.deepEqual(db.prepare('SELECT * FROM query_totals ORDER BY bucket,status,archived').all().map(r=>({...r})),expected());}finally{db.close();}};
 check();const part=store.mutate('part.save',{data:{name:'Motor',category:'Motor',quantity:4,tracking:'quantity'}}).result;check();store.mutate('part.install',{carId:store.data.cars[0].id,partId:part,quantity:1,field:'motor'});check();
 store.transact(db=>{db.cars[0].archived=true;db.parts[0].quantity=5;db.events=[];});check();const db=new DatabaseSync(file);db.exec('BEGIN; DELETE FROM records; ROLLBACK;');db.close();check();
 const before=query.read(store,null,r=>r.summary()).value,old=new DatabaseSync(file);old.exec("DROP TABLE query_totals; UPDATE state SET value='6' WHERE key='query_index_version'");old.close();const reopened=new Store(file);check();assert.deepEqual(query.read(reopened,null,r=>r.summary()).value,before);
});
test('connection status does not load an inactive remembered Dealership replica',t=>{
 const {store,dir}=fixture(t),{Club}=require('../src/club.cjs'),{Network}=require('../src/network.cjs'),folder=path.join(dir,'connection');fs.mkdirSync(folder);
 const cache=new Store(path.join(folder,'club-copy.json'));cache.replace({...store.snapshot(),club:{id:'club-fixture',replica:true,proposals:[]}});
 fs.writeFileSync(path.join(folder,'club-device.json'),JSON.stringify({version:1,id:'device-fixture',name:'Laptop',pair:{databaseId:cache.data.id,clubId:'club-fixture',password:'1234'},outbox:[]}));const net=new Network(store),club=new Club(store,net,folder);t.after(()=>{club.close();net.close();});
 assert.equal(club._cache,null);assert.ok(club.protectedFiles().includes(cache.file));assert.equal(club.loadedCache,null);assert.equal(club.status().hasCopy,true);assert.equal(club._cache,null);assert.equal(club.store,store);assert.equal(club.cache.data.id,cache.data.id);assert.ok(club._cache);
});
test('direct JSON measurement matches native encoding for escapes, Unicode, holes and toJSON',()=>{
 const values=[null,true,NaN,Infinity,-0,0,'', 'a\n\t\r"\\\u0000','é漢字😀\ud800',[,undefined,()=>{},Symbol('x'),null],{a:undefined,b:Symbol('x'),c:null},new Date('2026-11-03T00:00:00Z'),new Number(2),new String('ABC'),new Boolean(false),{toJSON(){return {text:'replacement'};}},{a:{toJSON(key){return key;}}}];
 let seed=17;const next=()=>seed=(seed*16807)%2147483647;for(let i=0;i<250;i++)values.push({['key'+next()]:[String.fromCharCode(next()%65536),next()/71,!!(next()%2),{nested:values[next()%values.length]}]});
 for(const value of values)assert.equal(encoding.byteLength(value),Buffer.byteLength(JSON.stringify(value)));
 const cycle={};cycle.self=cycle;assert.throws(()=>encoding.byteLength(cycle),/circular/);assert.throws(()=>encoding.byteLength(1n),/BigInt/);assert.throws(()=>encoding.byteLength(undefined),/no JSON/);
});
test('Timing reports collection capacity separately from ordinary storage failures',()=>{
 const {fixtures}=require('./support/timing-fixtures.cjs'),timing=require('../src/timing-integration.cjs'),f=fixtures();
 f.store.transact=()=>require('../src/storage-resources.cjs').checkCollectionSize(201*1024*1024);assert.throws(()=>timing.receive(f.store,f.normal),e=>e.apiCode==='CAPACITY_EXCEEDED'&&e.httpStatus===507);
 f.store.transact=()=>{throw Error('disk failure');};assert.throws(()=>timing.receive(f.store,f.normal),e=>e.apiCode==='STORAGE_FAILED'&&e.httpStatus===500);
});


test('counter upgrade preserves existing lap and car indexes instead of rebuilding every record',t=>{
 const {store}=fixture(t),db=new DatabaseSync(store.file);
 db.exec("UPDATE state SET value='6' WHERE key='query_index_version'; CREATE TRIGGER forbid_rebuild BEFORE INSERT ON query_records BEGIN SELECT RAISE(ABORT,'Rebuilt record projection'); END");db.close();
 const reopened=new Store(store.file);assert.equal(query.read(reopened,null,r=>r.summary()).value.cars,1);
 const check=new DatabaseSync(store.file);assert.equal(check.prepare("SELECT value FROM state WHERE key='query_index_version'").get().value,'7');assert.ok(check.prepare("SELECT 1 FROM sqlite_master WHERE name='forbid_rebuild'").get());check.close();
});
