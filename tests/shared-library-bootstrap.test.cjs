'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{open}=require('../packages/shared-library/index.cjs'),{Store}=require('../src/store.cjs');
function fixture(t,backend='json',{longShared=false}={}){
 const root=require('./support/temp-dir.cjs')('bootstrap-'),appData=path.join(root,'profiles'),profile=path.join(appData,'slotforge-timing'),sharedRoot=path.join(root,longShared?'x'.repeat(Math.max(10,174-root.length-1)):'shared'),handles=[];fs.mkdirSync(profile,{recursive:true});
 const raw={version:1,paddock:{sourceId:'original-timing'},slotcars:[{id:'car-1',brand:'NSR',manufacturer:'Porsche',model:'917',reference:'123',unknown:{preserve:true}}],sessions:[{id:'session-1',sessionType:'race',date:'2017-01-01',setupName:'Old race',standings:[]},{id:'tokens-1',sessionType:'tokens',setupName:'Time tokens'}],laps:[1,2,3].map(n=>({id:'lap-'+n,sessionId:'session-1',carId:'car-1',lapNumber:n,lane:1,time:8000+n})),raceclasses:[],tracks:[],drivers:[],teams:[]};
 raw.laps.push({id:'token-lap',sessionId:'tokens-1',carId:'car-1',lapNumber:1,lane:2,time:4000});
 const json=path.join(profile,'slotforge-timing.json');fs.writeFileSync(json,JSON.stringify(raw));let file=json;
 if(backend==='sqlite'){
  const generation=crypto.randomUUID(),dir=path.join(profile,'sqlite',generation,'working');fs.mkdirSync(dir,{recursive:true});file=path.join(dir,'working.sqlite');const db=new DatabaseSync(file);
  try{db.exec('PRAGMA application_id=1397118029; PRAGMA user_version=1; CREATE TABLE info(key TEXT,value TEXT); INSERT INTO info VALUES(\'workingFormat\',\'6\'); CREATE TABLE records(entity TEXT,id TEXT,ordinal INTEGER,shape TEXT); CREATE TABLE fields(entity TEXT,id TEXT,path TEXT,json TEXT); CREATE TABLE assets(entity TEXT,id TEXT,path TEXT,mime TEXT,bytes BLOB,digest TEXT,original TEXT); CREATE TABLE lap_index(id TEXT,sessionId TEXT);');
   const put=(entity,id,ordinal,value)=>{const fields=[];const shape=['object',Object.entries(value).map(([k,v])=>{const p=JSON.stringify([k]);fields.push([entity,id,p,JSON.stringify(v)]);return [k,['field',p]];})];db.prepare('INSERT INTO records VALUES(?,?,?,?)').run(entity,id,ordinal,JSON.stringify(shape));for(const f of fields)db.prepare('INSERT INTO fields VALUES(?,?,?,?)').run(...f);};
   for(const [entity,rows]of Object.entries(raw)){if(Array.isArray(rows))rows.forEach((v,n)=>put(entity,v.id,n,v));else if(entity==='paddock')put('@meta',entity,0,rows);}
   for(const l of raw.laps)db.prepare('INSERT INTO lap_index VALUES(?,?)').run(l.id,l.sessionId);
  }finally{db.close();}
  fs.writeFileSync(path.join(profile,'storage-backend.json'),JSON.stringify({format:'slotforge-storage-selection',version:1,backend:'sqlite',generation}));
  // A stale JSON predecessor must never be selected over active SQLite.
  fs.writeFileSync(json,JSON.stringify({...raw,slotcars:[{id:'stale',model:'DO NOT IMPORT'}]}));
 }
 const original=fs.readFileSync(file);t.after(async()=>{await Promise.all(handles.map(h=>h.close()));assert.deepEqual(fs.readFileSync(file),original);fs.rmSync(root,{recursive:true,force:true});});
 const start=async(application,extra={})=>{const h=await open({application:'SlotForge '+application,installationId:application,appData,sharedRoot,...extra});handles.push(h);return h;};return {root,appData,sharedRoot,raw,start,file};
}
for(const backend of ['json','sqlite'])test('Timing installed first: '+backend+' cars and laps automatically adopted once, with exact originals',async t=>{
 const f=fixture(t,backend),p=await f.start('Paddock'),status=await p.status(),cars=(await p.catalogue()).cars;assert.equal(cars.length,1);assert.equal(cars[0].fields.reference,'123');
 const stats=await p.historyRead({kind:'statistics',carId:cars[0].id});assert.equal(stats.historicalSessions,1);
 const capture=await p.profile({carId:cars[0].id});assert.ok(capture.configuration.signature);require('../src/timing-integration.cjs').verifyConfiguration(new Store(status.file).data,cars[0].id,capture.configuration);
 assert.deepEqual((await p.extensionRead({namespace:'timing.carExtras',sourceId:'original-timing',originalId:'car-1'})).value,f.raw.slotcars[0]);
 assert.deepEqual((await p.extensionRead({namespace:'timing.historyOriginals',sourceId:'original-timing',originalId:'tokens-1'})).value,{session:f.raw.sessions[1],laps:f.raw.laps.filter(l=>l.sessionId==='tokens-1')});
 const origins=(await p.adoptionStatus({sourceId:'original-timing'})).rows;assert.equal(origins.length,3);assert.equal(origins.find(r=>r.originalId==='tokens-1').projectionStatus,'raw-only');
 const store=await Store.open(status.file),history=require('../src/history-view.cjs'),context={databaseId:status.databaseId,recoveryId:status.recoveryId,carId:cars[0].id};const originals=history.read(store,{...context,operation:'originals'});assert.equal(originals.total,1);const original=history.read(store,{...context,operation:'original',originId:originals.rows[0].id});assert.equal(original.laps[0].time,4000);assert.equal(original.laps[0].valid,null);
 await p.close();const timing=await f.start('Timing');assert.equal((await timing.status()).file,status.file);assert.equal((await timing.catalogue()).cars.length,1);assert.equal((await timing.adoptionStatus({sourceId:'original-timing'})).rows.length,3);
 assert.ok(fs.readdirSync(path.join(f.sharedRoot,'recovery')).some(n=>n.endsWith(backend==='json'?'.json':'.sqlite')));
});
test('Paddock installed first: its existing identity and cars are retained; separate Timing cars are added without name matching',async t=>{
 const f=fixture(t),profile=path.join(f.appData,'slotforge-database');fs.mkdirSync(profile);const store=await Store.open(path.join(profile,'database.json'));store.mutate('car.save',{data:{name:'917',maker:'NSR',reference:'123'}});const oldId=store.data.id,oldCar=store.data.cars[0].id;
 const timing=await f.start('Timing');assert.equal((await timing.status()).databaseId,oldId);assert.equal((await timing.car(oldCar)).fields.name,'917');assert.equal((await timing.catalogue()).cars.length,2);
 const p=await f.start('Paddock');assert.equal((await p.status()).file,store.file);assert.equal((await p.catalogue()).cars.length,2);
});
test('interruption after adopted records commit but before completion receipt resumes without duplicates',async t=>{
 const f=fixture(t),p=await f.start('Paddock'),first=await p.status(),receipt=(await p.bootstrapInfo()).adoption[0],carId=(await p.catalogue()).cars[0].id;await p.close();
 // Model the crash window between the last committed item and marker publication.
 fs.unlinkSync(path.join(f.sharedRoot,'adopted-timing-'+receipt.originKey+'.json'));
 const resumed=await f.start('Timing');assert.equal((await resumed.status()).databaseId,first.databaseId);assert.equal((await resumed.catalogue()).total,1);assert.equal((await resumed.catalogue()).cars[0].id,carId);assert.equal((await resumed.adoptionStatus({sourceId:receipt.sourceId})).total,3);assert.equal((await resumed.historyRead({kind:'sessions',carId})).entries.length,1);
});

test('long Windows profile paths reserve room for SQLite backup journals',async t=>{
 const f=fixture(t,'sqlite',{longShared:true}),p=await f.start('Paddock');assert.equal((await p.catalogue()).total,1);const receipt=(await p.bootstrapInfo()).adoption[0];assert.ok(receipt.originalBackup.length+8<260);assert.ok(fs.existsSync(receipt.originalBackup));
});
