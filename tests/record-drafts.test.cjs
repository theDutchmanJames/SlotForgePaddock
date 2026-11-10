'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {produce}=require('../src/record-draft.cjs'),{cloneJSON}=require('../src/json-data.cjs'),{Store}=require('../src/store.cjs'),S=require('../src/sqlite-storage.cjs'),lazy=require('../src/lazy-assets.cjs'),E=require('../src/json-encoding.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-record-drafts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));s.mutate('car.save',{data:{name:'A',picture:'data:image/png;base64,AAAA'}});s.mutate('car.save',{data:{name:'B'}});return {s,dir};}
test('drafts isolate nested edits, preserve untouched identities and return detached draft results',()=>{
 const base={cars:[{id:'a',tech:{motor:'old'}},{id:'b',tech:{motor:'keep'}}],settings:{theme:'dark'}},before=JSON.stringify(base);
 const {data,result}=produce(base,d=>{d.cars[0].tech.motor='new';return {car:d.cars[0]};});assert.equal(JSON.stringify(base),before);assert.notEqual(data.cars[0],base.cars[0]);assert.equal(data.cars[1],base.cars[1]);assert.equal(data.settings,base.settings);assert.equal(result.car,data.cars[0]);assert.doesNotThrow(()=>structuredClone(result));const accessor={};Object.defineProperty(accessor,'value',{enumerable:true,configurable:true,get(){throw Error('Do not read');}});const cleared=produce(accessor,d=>{d.value=undefined;});assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(cleared.data,'value'),'value'),true);assert.equal(cleared.data.value,undefined);
 assert.throws(()=>produce(base,d=>{d.cars[0].tech.motor='bad';throw Error('abort');}),/abort/);assert.equal(JSON.stringify(base),before);
});
test('new records, mixed local references, reorder, truncation and deletion match ordinary JSON mutation',()=>{
 const base={rows:[{id:'a',values:[1,2]},{id:'b',values:[3]}],flags:{one:true,two:false}};
 for(let i=0;i<40;i++){const action=d=>{const fresh={id:'new',values:[]};d.rows.push(fresh);d.rows.find(r=>r.id==='new').values.push(i);fresh.values.push(i+1);d.rows[0].values.splice(0,1,i);if(i%2)d.rows.reverse();if(i%3===0)d.rows.length=2;delete d.flags.two;Object.defineProperty(d.flags,'custom',{value:i,writable:true,configurable:true,enumerable:true});return d.rows;};const expected=cloneJSON(base);action(expected);const actual=produce(base,action);assert.deepEqual(actual.data,expected);assert.deepEqual(actual.result,expected.rows);assert.deepEqual(base.rows[0].values,[1,2]);}
});

test('fast array insertion retains accessed children, local new records and rollback isolation',()=>{
 const base={rows:[{id:'a',value:1},{id:'b',value:2}],other:{value:3}},before=JSON.stringify(base);
 const action=d=>{const first=d.rows[0],second=d.rows[1],fresh={id:'fresh',value:0};d.rows.unshift(fresh);first.value=10;d.rows.push({id:'last',value:4});second.value=20;fresh.value=30;d.rows.unshift({id:'head',value:5});d.rows[2].value++;return {first,second,rows:d.rows};};
 const expected=cloneJSON(base);action(expected);const actual=produce(base,action);assert.deepEqual(actual.data,expected);assert.equal(actual.result.first,actual.data.rows[2]);assert.equal(actual.result.second,actual.data.rows[3]);assert.equal(actual.data.other,base.other);assert.equal(JSON.stringify(base),before);
 assert.throws(()=>produce(base,d=>{action(d);throw Error('abort');}),/abort/);assert.equal(JSON.stringify(base),before);
 const borrowed=[];produce(base,d=>{assert.equal(d.rows.push.call(borrowed,'ok'),1);});assert.deepEqual(borrowed,['ok']);
});

test('read-only drafts do not enumerate untouched records or hydrate lazy properties',()=>{
 let enumerations=0,reads=0;const row=new Proxy({id:'a',value:1},{ownKeys(target){enumerations++;return Reflect.ownKeys(target);}}),base={rows:[row],picture:''};Object.defineProperty(base,'picture',{enumerable:true,configurable:true,get(){reads++;throw Error('Original read');}});
 const result=produce(base,d=>d.rows.find(r=>r.id==='a').value);assert.equal(result.data,base);assert.equal(result.result,1);assert.equal(enumerations,0);assert.equal(reads,0);
 const changed=produce(base,d=>{d.rows.unshift({id:'b',value:2});});assert.equal(changed.data.rows[1],row);assert.equal(reads,0);
});

test('committed manifest reuse matches full packing through inserts, removals, reorder and shape changes',()=>{
 const base={id:'db',revision:1,cars:[{id:'a',name:'A'},{id:'b',name:'B'}],parts:[{id:'p',quantity:2}],events:[{id:'e',title:'Old'}],timing:{sessions:[],key:'secret'},extra:{text:'before'}};
 const actions=[d=>{d.events.unshift({id:'new',title:'New'});},d=>{d.cars.reverse();d.cars[0].name='Changed';},d=>{d.parts.splice(0,1);delete d.extra;},d=>{d.timing.sessions.push({id:'session',laps:[]});d.timing.key='changed';},d=>{delete d.timing;d.extra=[{id:'extra',text:'after'}];},d=>{d.events={value:'new shape'};d.parts.push({id:'q',quantity:1});}];
 for(const action of actions){const prior=S.pack(base),after=produce(base,d=>{action(d);d.revision++;}).data,delta=S.packChanges(base,after,undefined,prior.manifest),full=S.pack(after),merged=new Map(prior.records.map(r=>[r.key,r.json]));for(const key of delta.removed)merged.delete(key);for(const r of delta.records)merged.set(r.key,r.json);assert.equal(delta.manifest,full.manifest);assert.deepEqual([...merged].sort(),full.records.map(r=>[r.key,r.json]).sort());}
});

test('incremental packing does not read records in unchanged inventory lists',()=>{
 let reads=0;const parts=new Proxy([{id:'p',quantity:2}],{get(target,key,receiver){if(key==='0')reads++;return Reflect.get(target,key,receiver);}}),before={id:'db',revision:1,parts,events:[]},manifest=S.pack(before).manifest;reads=0;
 const delta=S.packChanges(before,{...before,revision:2,events:[{id:'e',title:'New'}]},undefined,manifest);assert.equal(reads,0);assert.deepEqual(delta.removed,[]);assert.equal(delta.records.length,2);
});
test('drafts preserve lazy originals and do not rewrite unrelated parts on general commands',async t=>{
 const {s}=fixture(t),id=s.mutate('part.save',{data:{name:'Motor',quantity:3,tracking:'quantity'}}).result,unchanged=s.data.cars[1];lazy.clearCache();
 await s.mutateAsync('part.install',{carId:s.data.cars[0].id,partId:id,quantity:1,field:'motor'},{snapshot:false});assert.equal(s.data.cars[1],unchanged);assert.ok(s.lastWrite.submittedRecords<10);assert.equal(s.lastWrite.assetWrites,0);assert.equal(lazy.stats().reads,0);
 const before=JSON.stringify(s.data),db=new DatabaseSync(s.file);db.exec("CREATE TRIGGER fail_draft BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'disk failed'); END");db.close();assert.throws(()=>s.mutate('work.add',{carId:s.data.cars[0].id,type:'modification',title:'Must roll back'}),/disk failed/);assert.equal(JSON.stringify(s.data),before);
});
test('aggregate media above 200 MiB stays lazy and metadata accounting remains exact after edits',()=>{
 const s=new Store();s.mutate('car.save',{data:{name:'Seed'}});const seed=s.data.cars[0],db=s.snapshot();db.cars=Array.from({length:30},(_,i)=>({...cloneJSON(seed),id:i?'car-'+i:seed.id}));
 for(const c of db.cars)lazy.attach(c,'picture',{file:'synthetic',meta:{hash:'a'.repeat(64),photo:true,chars:8*1024*1024},read(){throw Error('Original hydrated');}});
 s.replace(db);assert.ok(E.byteLength(s.data)>200*1024*1024);assert.ok(E.metadataByteLength(s.data)<100000);
 s.mutate('car.save',{id:seed.id,revision:seed.revision,data:{name:'Above old limit'}},{snapshot:false});s.mutate('work.add',{carId:seed.id,type:'maintenance',title:'Service'},{snapshot:false});assert.equal(s.data.cars[0].name,'Above old limit');
});
test('metadata-only baseline matches a replica, ignores review bookkeeping and detects physical changes without originals',t=>{
 const {s,dir}=fixture(t),D=require('../src/review-baseline.cjs'),M=require('../src/club-model.cjs');s.transact(db=>{db.club={id:'club-1',proposals:[]};db.timing.key='1'.repeat(64);});const copy=new Store(path.join(dir,'copy.sqlite'));copy.replace(M.shared(s.data));lazy.clearCache();assert.equal(D.digest(s),D.digest(copy));const baseline=D.digest(s);s.transact(db=>{db.timing.key='2'.repeat(64);});assert.equal(D.digest(s),baseline);s.mutate('work.add',{carId:s.data.cars[0].id,type:'modification',title:'A physical change'});assert.notEqual(D.digest(s),baseline);assert.equal(lazy.stats().reads,0);
});
test('streamed shared snapshots exclude credentials, preserve originals lazily and never overwrite an existing file',t=>{
 const {s,dir}=fixture(t);s.transact(db=>{db.club={id:'club-1',proposals:[]};db.timing.key='1'.repeat(64);});const file=path.join(dir,'snapshot');lazy.clearCache();const info=S.sharedSnapshot(s,file,1024*1024),content=fs.readFileSync(file),p=JSON.parse(content);assert.equal(info.size,content.length);assert.ok(!p.rows.some(([key])=>key==='["timing","key"]'));assert.equal(info.hashes.size,1);assert.equal(lazy.stats().reads,0);assert.throws(()=>S.sharedSnapshot(s,file,1024*1024),/exist/i);assert.deepEqual(fs.readFileSync(file),content);assert.throws(()=>S.sharedSnapshot(s,path.join(dir,'too-small'),10),/transfer limit/);assert.equal(fs.existsSync(path.join(dir,'too-small')),false);
});
test('metadata usage equals complete measurement after both targeted and general writes',t=>{
 const {s}=fixture(t);const check=()=>{const db=new DatabaseSync(s.file,{readOnly:true});try{const usage=s.storageUsage(db);assert.equal(usage.logicalBytes,E.byteLength(s.data));assert.equal(usage.metadataBytes,E.metadataByteLength(s.data));assert.equal(usage.logicalLimit,null);}finally{db.close();}};
 check();s.mutate('car.save',{id:s.data.cars[0].id,revision:s.data.cars[0].revision,data:{picture:'',name:'Changed'}});check();s.mutate('work.add',{carId:s.data.cars[0].id,type:'maintenance',title:'Check'});check();const reopened=new Store(s.file),db=new DatabaseSync(s.file,{readOnly:true});try{assert.equal(reopened.storageUsage(db).metadataBytes,E.metadataByteLength(reopened.data));}finally{db.close();}
});

test('extension scalar images remain lazy through open, general writes and sync decoding',t=>{
 const {s,dir}=fixture(t),picture='data:image/png;base64,AAAA';s.transact(db=>{db.futurePicture=picture;db.futurePictures=[picture];db.club={id:'club-1',proposals:[]};});lazy.clearCache();const next=new Store(s.file);assert.equal(lazy.stats().reads,0);assert.ok(lazy.property(next.data,'futurePicture'));assert.ok(lazy.property(next.data.futurePictures,0));next.mutate('car.save',{id:next.data.cars[0].id,revision:next.data.cars[0].revision,data:{name:'Lazy extension edit'}},{snapshot:false});assert.equal(lazy.stats().reads,0);next.mutate('work.add',{carId:next.data.cars[0].id,type:'maintenance',title:'Extension check'});assert.equal(lazy.stats().reads,0);
 const packed=S.pack(next.data),assets=new Map(S.availableAssetMetadata(next.file,[...new Set(packed.records.flatMap(r=>r.refs))]).map(m=>[m.hash,lazy.asset(next.file,m)]));const decoded=require('../src/club-sync.cjs').decode(JSON.parse(packed.manifest),new Map(packed.records.map(r=>[r.key,r.json])),assets);assert.ok(lazy.property(decoded,'futurePicture'));assert.ok(lazy.property(decoded.futurePictures,0));assert.equal(lazy.stats().reads,0);assert.equal(decoded.futurePicture,picture);assert.equal(decoded.futurePictures[0],picture);
});

test('published review baseline fixture matches the production digest',()=>{const dir=path.join(__dirname,'./fixtures/contracts/dealership-sync-v2'),sample=JSON.parse(fs.readFileSync(path.join(dir,'review-baseline.json'))),snapshot=JSON.parse(fs.readFileSync(path.join(dir,sample.snapshot)));const data=require('../src/club-sync.cjs').decode(JSON.parse(snapshot.manifest),new Map(snapshot.rows),new Map());assert.equal(require('../src/review-baseline.cjs').digest({data}),sample.digest);});

test('copy-on-write validation skips unchanged lap bodies but revalidates altered payloads, keys and stock',()=>{
 const timing=require('../src/timing-integration.cjs'),schema=require('../src/timing-schema.cjs'),f=require('./support/timing-fixtures.cjs').fixtures(),s=f.store;timing.receive(s,f.normal);const validate=schema.validate;let calls=0;schema.validate=(...args)=>{calls++;return validate(...args);};
 try{s.mutate('work.add',{carId:'car-a',type:'maintenance',title:'No lap rescan'},{snapshot:false});assert.equal(calls,0);const before=JSON.stringify(s.data);assert.throws(()=>s.transact(d=>{d.timing.sessions[0].payload.participants[0].laps[0].durationMs=-1;}));assert.equal(JSON.stringify(s.data),before);assert.ok(calls>0);assert.throws(()=>s.transact(d=>{d.timing.key='0'.repeat(64);}));assert.equal(JSON.stringify(s.data),before);assert.throws(()=>s.transact(d=>{d.cars[0].name='';}),/name/i);assert.equal(JSON.stringify(s.data),before);
 const part=s.mutate('part.save',{data:{name:'Stock check',quantity:2,tracking:'quantity'}}).result;s.mutate('part.install',{carId:'car-a',partId:part,quantity:2,field:'motor'});assert.throws(()=>s.transact(d=>{d.parts.find(p=>p.id===part).quantity=1;}),/stock|quantity/i);
 }finally{schema.validate=validate;}
});

test('snapshot progress renews an idle timeout without allowing an abandoned offer to live forever',t=>{
 const {s,dir}=fixture(t),snapshots=new (require('../src/club-sync.cjs').Snapshots)({main:s,folder:dir}),originalNow=Date.now;try{const offer=snapshots.create(),first=snapshots.sessions.get(offer.id).expires;Date.now=()=>first-1000;assert.ok(snapshots.get(offer.id));Date.now=()=>first+1000;assert.ok(snapshots.get(offer.id));const expiry=snapshots.sessions.get(offer.id).expires;Date.now=()=>expiry+1;assert.throws(()=>snapshots.get(offer.id),/expired/);assert.equal(snapshots.sessions.size,0);}finally{Date.now=originalNow;snapshots.close();}
});
