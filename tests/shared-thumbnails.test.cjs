'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {DatabaseSync}=require('node:sqlite'),engine=require('../packages/shared-library/index.cjs'),{Store}=require('../src/store.cjs'),cache=require('../src/shared-thumbnails.cjs');
function png(width,height,colour=37){
 const chunk=(type,body)=>{const name=Buffer.from(type),b=Buffer.alloc(body.length+12);b.writeUInt32BE(body.length);name.copy(b,4);body.copy(b,8);b.writeUInt32BE(zlib.crc32(Buffer.concat([name,body])),b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((width*4+1)*height,colour);for(let y=0;y<height;y++)pixels[y*(width*4+1)]=0;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const original=png(1400,800),preview=png(512,293),other=png(1400,800,66);
async function fixture(t){
 const root=fs.mkdtempSync(path.join(__dirname,'../.qa/thumb-')),handles=[];
 const options={application:'Thumbnail test',installationId:'Timing',sharedRoot:root,legacyProfiles:[]};
 const open=async more=>{const h=await engine.open({...options,...more});handles.push(h);return h;};
 t.after(async()=>{await Promise.all(handles.map(h=>h.close()));fs.rmSync(root,{recursive:true,force:true});});
 const handle=await open(),status=await handle.status(),identity={databaseId:status.databaseId,recoveryId:status.recoveryId};
 const adopted=await handle.adoptCar({...identity,operationId:'seed',sourceId:'Timing',originalId:'old-car',data:{name:'Original car',picture:original},rawOriginal:{id:'old-car',picture:original,extraPictures:[other],damageFactor:1.2,tyreCompound:'H'}});
 const carId=adopted.carId,store=()=>new Store(status.file,{deferred:true});
 const photo=value=>{const s=store(),car=s.data.cars.find(c=>c.id===carId);s.mutate('car.save',{id:carId,revision:car.revision,data:{picture:value}},{snapshot:false});};
 const cacheFile=path.join(root,'thumbnails/png-512-v1/cache.sqlite');
 const sql=fn=>{const db=new DatabaseSync(cacheFile);try{return fn(db);}finally{db.close();}};
 return {root,open,handle,status,identity,carId,store,photo,sql,cacheFile};
}
test('independent workers share one persisted preview, never rewrite originals/revisions, and reopen without an encoder',async t=>{
 const f=await fixture(t);let calls=0;
 const encode=async source=>{assert.equal(source,original);calls++;await new Promise(r=>setTimeout(r,30));return preview;};
 const a=await f.open({thumbnailEncoder:encode}),b=await f.open({installationId:'Paddock',thumbnailEncoder:encode}),before=await a.status();
 assert.deepEqual(await Promise.all([a.thumbnail({carId:f.carId}),a.thumbnail({carId:f.carId}),b.thumbnail({carId:f.carId})]),[preview,preview,preview]);assert.equal(calls,1);
 assert.deepEqual(await a.status(),before);assert.equal((await b.car(f.carId,{includeMedia:true})).picture,original);
 await a.close();await b.close();await assert.rejects(a.thumbnail({carId:f.carId}),e=>e.code==='LIBRARY_CLOSED');const reopened=await f.open();assert.equal(await reopened.thumbnail({carId:f.carId}),preview);
 assert.equal(f.sql(db=>db.prepare('SELECT count(*) n FROM thumbnails').get().n),1);
});
test('Paddock direct photo writes, removals and restoring earlier content select the correct derivative',async t=>{
 const f=await fixture(t);let calls=0;const a=await f.open({thumbnailEncoder:async source=>{calls++;return source===original?preview:png(512,293,66);}});
 assert.equal(await a.thumbnail({carId:f.carId}),preview);const page=await a.catalogue({limit:1});
 f.photo(other);assert.notEqual(await a.thumbnail({carId:f.carId}),preview);assert.equal(calls,2);
 await assert.rejects(a.thumbnail({carId:f.carId,token:page.token}),e=>e.code==='QUERY_CHANGED');
 f.photo('');assert.equal(await a.thumbnail({carId:f.carId}),null);assert.equal(calls,2);
 f.photo(original);assert.equal(await a.thumbnail({carId:f.carId}),preview);assert.equal(calls,2);
 await assert.rejects(a.thumbnail({carId:'missing'}),e=>e.code==='CAR_NOT_FOUND');
});

test('an expected photo hash protects old media URLs without generating or leasing newer content',async t=>{
 const f=await fixture(t);let calls=0;const h=await f.open({thumbnailEncoder:async()=>{calls++;return preview;}}),hash=require('../src/lazy-assets.cjs').digest(original);
 assert.equal(await h.thumbnail({carId:f.carId,expectedHash:hash}),preview);f.photo(other);const before=await h.status();
 assert.equal(await h.thumbnail({carId:f.carId,expectedHash:hash}),null);assert.equal(calls,1);assert.deepEqual(await h.status(),before);
 await assert.rejects(h.thumbnail({carId:f.carId,expectedHash:'invalid'}),/expected photograph hash/);
});
test('invalid, unavailable and failed encoders release leases, while damaged cached rows regenerate',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.handle.thumbnail({carId:f.carId}),/encoder is unavailable/);
 for(const encode of [async()=>{throw Error('Decode failed');},async()=>original]){
  const h=await f.open({thumbnailEncoder:encode});await assert.rejects(h.thumbnail({carId:f.carId}),/Decode failed|Invalid shared thumbnail/);await h.close();
  assert.equal(f.sql(db=>db.prepare('SELECT lease FROM thumbnails').get().lease),null);
 }
 let calls=0;const h=await f.open({thumbnailEncoder:async()=>{calls++;return preview;}});assert.equal(await h.thumbnail({carId:f.carId}),preview);
 f.sql(db=>db.exec("UPDATE thumbnails SET data='damaged'"));assert.equal(await h.thumbnail({carId:f.carId}),preview);assert.equal(calls,2);
 const before=await h.status();f.sql(db=>db.exec('DROP TABLE thumbnails; CREATE TABLE thumbnails(wrong TEXT)'));
 await assert.rejects(h.thumbnail({carId:f.carId}),/column/);assert.deepEqual(await h.status(),before);assert.equal((await h.car(f.carId,{includeMedia:true})).picture,original);
});
test('abandoned leases expire and an old encoder cannot overwrite a newer owner',async t=>{
 const f=await fixture(t),read=()=>cache.read(f.store(),f.root,{carId:f.carId}),first=read();assert.equal(first.source,original);assert.equal(read().pending,true);
 f.sql(db=>db.exec('UPDATE thumbnails SET expires=0'));const second=read();assert.notEqual(second.lease,first.lease);
 assert.equal(cache.storeResult(f.root,{...first,data:preview}).stored,false);assert.equal(cache.storeResult(f.root,{...second,data:preview}).stored,true);
 const hit=read();assert.equal(hit.data,preview);assert.equal(hit.source,undefined);
});
test('shutdown releases an in-flight generation lease even if the host encoder never returns',async t=>{
 const f=await fixture(t);let ready;const started=new Promise(r=>{ready=r;});
 const a=await f.open({thumbnailEncoder:()=>{ready();return new Promise(()=>{});}}),pending=a.thumbnail({carId:f.carId});
 const rejected=assert.rejects(pending,e=>e.code==='LIBRARY_CLOSED');await started;await a.close();await rejected;
 assert.equal(f.sql(db=>db.prepare('SELECT lease FROM thumbnails').get().lease),null);
 const b=await f.open({thumbnailEncoder:async()=>preview});assert.equal(await b.thumbnail({carId:f.carId}),preview);
});
test('compact pages preserve Timing settings and custom definitions without main photos or gallery bodies',async t=>{
 const f=await fixture(t),s=f.store();s.mutate('custom.add',{label:'Wheel width',type:'number'});const def=s.data.customFields[0];
 s.mutate('car.save',{id:f.carId,revision:s.data.cars[0].revision,data:{custom:{[def.id]:'22'}}},{snapshot:false});
 for(let i=0;i<49;i++)s.mutate('car.save',{data:{name:'Additional '+String(i).padStart(2,'0')}},{snapshot:false});
 const page=await f.handle.catalogueOverview({limit:48}),next=await f.handle.catalogueOverview({limit:48,offset:page.nextOffset,token:page.token});assert.equal(page.total,50);assert.equal(page.cars.length,48);assert.equal(next.cars.length,2);
 const car=[...page.cars,...next.cars].find(c=>c.id===f.carId);assert.equal(car.original.damageFactor,1.2);assert.equal(car.binding.localCarId,'old-car');assert.equal(car.binding.effective.damageFactor,1.2);assert.equal(car.custom[def.id],'22');assert.equal(car.hasPicture,true);assert.equal(page.definitions[0].label,'Wheel width');assert(!JSON.stringify([page,next]).includes('data:image'));
 const expected=await f.handle.serviceRead({carId:f.carId});assert.deepEqual(car.service,expected.service);
 assert.equal((await f.handle.car(f.carId,{includeMedia:true})).picture,original);
 await assert.rejects(f.handle.catalogueOverview({limit:49}),/overview/);await assert.rejects(f.handle.catalogueOverview({limit:2,offset:1}),/overview/);
 f.photo(other);await assert.rejects(f.handle.catalogueOverview({limit:48,offset:page.nextOffset,token:page.token}),e=>e.code==='QUERY_CHANGED');
});
test('bounded scheduling accepts bursts and rejects overflow without losing subsequent requests',async t=>{
 const f=await fixture(t);assert.equal((await Promise.all(Array.from({length:90},()=>f.handle.status()))).length,90);
 const results=await Promise.allSettled(Array.from({length:150},()=>f.handle.status()));assert(results.some(r=>r.status==='rejected'&&r.reason.code==='WORKER_BUSY'));assert(results.filter(r=>r.status==='fulfilled').length<=136);assert.equal((await f.handle.status()).databaseId,f.status.databaseId);
});
test('compact evidence cache preserves integrity checks and returns independent non-media values',()=>{
 const E=require('../src/shared-library-evidence.cjs'),row=E.encode({picture:original,extraPictures:[other],damageFactor:1.2,custom:{value:'keep'}}),first=E.summary(row);
 first.custom.value='mutated';assert.equal(E.summary(row).custom.value,'keep');assert.equal(first.picture,undefined);assert.equal(first.extraPictures,undefined);
 assert.equal(E.decode(row).picture,original);assert.throws(()=>E.summary({...row,hash:'0'.repeat(64)}),e=>e.code==='ORIGINAL_INTEGRITY');
 const overridden={...row,baseHash:row.hash,overrides:{damageFactor:2},hash:require('../src/timing-integration.cjs').digest({...E.decode(row),damageFactor:2})};assert.equal(E.summary(overridden).damageFactor,2);
 assert.throws(()=>E.summary({...overridden,overrides:{damageFactor:3}}),e=>e.code==='ORIGINAL_INTEGRITY');
});
test('shared preview validation enforces PNG, 512px maximum and valid cache keys',()=>{
 assert(cache.valid(preview));assert(cache.valid(png(1,1)));assert(!cache.valid(original));assert(!cache.valid(png(513,1)));assert(!cache.valid('data:image/jpeg;base64,AAAA'));assert(!cache.valid('not an image'));assert(!cache.valid('data:image/png;base64,'+'A'.repeat(3*1024*1024)));
 assert.throws(()=>cache.storeResult('unused',{key:'../outside',lease:'x',data:preview}));
});
test('thumbnail client bounds explicit requests, times out encoders and discards late results',async()=>{
 const make=require('../packages/shared-library/thumbnail-client.cjs');let late,stores=[];
 const client=make(async(method,input)=>method==='thumbnailRead'?{key:'key',lease:'lease',source:original}:(stores.push(input),{stored:true}),()=>new Promise(r=>{late=r;}),{timeout:15});
 await assert.rejects(client.get({carId:'x'}),e=>e.code==='THUMBNAIL_TIMEOUT');assert.equal(stores.length,1);assert.equal(stores[0].data,null);late(preview);await new Promise(r=>setImmediate(r));assert.equal(stores.length,1);await client.close();
 let ready;const started=new Promise(r=>{ready=r;});const blocked=make(async method=>method==='thumbnailRead'?{key:'key',lease:'lease',source:original}:{stored:true},()=>{ready();return new Promise(()=>{});});
 const pending=Array.from({length:128},(_,i)=>blocked.get({carId:String(i)}));const settled=Promise.allSettled(pending);await started;await assert.rejects(blocked.get({carId:'overflow'}),e=>e.code==='WORKER_BUSY');await blocked.close();assert.equal((await settled).length,128);
});
test('queued writes retain their call-time operation and fields; accepted writes drain on close',async t=>{
 const f=await fixture(t),reads=Array.from({length:40},()=>f.handle.status());
 const input={...f.identity,operationId:'queued-original',action:'create',set:{name:'Original queued value'}},write=f.handle.carWrite(input);
 input.operationId='changed-by-caller';input.set.name='Must not be written';
 const closing=f.handle.close();const result=await write;await Promise.all(reads);await closing;
 const peer=await f.open();assert.equal((await peer.car(result.car.id)).fields.name,'Original queued value');assert.equal((await peer.receipt({...f.identity,operationId:'queued-original'})).car.id,result.car.id);
});
for(const extension of ['json','sqlite'])test('existing '+extension+' collection supports previews without changing the opened canonical file',async t=>{
 const root=fs.mkdtempSync(path.join(__dirname,'../.qa/thumb-legacy-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'legacy.'+extension),s=new Store(extension==='json'?path.join(root,'seed.sqlite'):file),carId=s.mutate('car.save',{data:{name:'Existing car',picture:original}}).result;
 if(extension==='json')fs.writeFileSync(file,JSON.stringify(s.snapshot()));
 const h=await engine.open({application:'Paddock QA',installationId:'legacy-test',sharedRoot:path.join(root,'shared'),legacyProfiles:[],legacyPaddockPath:file,thumbnailEncoder:async()=>preview});
 try{const opened=await h.status(),before=fs.readFileSync(opened.file);assert.equal(await h.thumbnail({carId}),preview);assert.equal((await h.car(carId,{includeMedia:true})).picture,original);assert.deepEqual(fs.readFileSync(opened.file),before);}finally{await h.close();}
});
test('a real canonical restore reuses the restored photo hash while invalidating the old snapshot token',async t=>{
 const f=await fixture(t);let calls=0;const h=await f.open({thumbnailEncoder:async source=>{calls++;return source===original?preview:png(512,293,66);}});
 await h.thumbnail({carId:f.carId});const state=await h.status(),source=path.join(f.root,'photo.sfpbackup');
 await h.backup({...f.identity,revision:state.revision,destination:source});f.photo(other);await h.thumbnail({carId:f.carId});const page=await h.catalogue({limit:1}),changed=await h.status();
 const restored=await h.restore({...f.identity,revision:changed.revision,source,operationId:'restore-photo'});assert.notEqual(restored.recoveryId,state.recoveryId);
 await assert.rejects(h.thumbnail({carId:f.carId,token:page.token}),e=>e.code==='QUERY_CHANGED');const before=await h.status();
 assert.equal(await h.thumbnail({carId:f.carId}),preview);assert.equal(calls,2);assert.deepEqual(await h.status(),before);assert.equal((await h.car(f.carId,{includeMedia:true})).picture,original);
});
test('Timing local vendor and Paddock reuse derivatives in both directions and share generation leases',{skip:!process.env.SF_TIMING_ENGINE_ENTRY},async t=>{
 const f=await fixture(t),timing=require(path.resolve(process.env.SF_TIMING_ENGINE_ENTRY));let paddockEncodes=0,timingEncodes=0;
 const a=await f.open({thumbnailEncoder:async()=>{paddockEncodes++;return preview;}});
 const b=await timing.open({application:'Timing joint QA',installationId:'Timing',sharedRoot:f.root,legacyProfiles:[],thumbnailEncoder:async()=>{timingEncodes++;return preview;}});
 try{
  assert.equal(await a.thumbnail({carId:f.carId}),preview);assert.equal(await b.thumbnail({carId:f.carId}),preview);assert.equal(timingEncodes,0);
  f.photo(other);assert.equal(await b.thumbnail({carId:f.carId}),preview);assert.equal(await a.thumbnail({carId:f.carId}),preview);assert.equal(paddockEncodes,1);assert.equal(timingEncodes,1);
  f.photo(png(1400,800,99));assert.deepEqual(await Promise.all([a.thumbnail({carId:f.carId}),b.thumbnail({carId:f.carId})]),[preview,preview]);assert.equal(paddockEncodes+timingEncodes,3);
  assert.equal((await b.car(f.carId,{includeMedia:true})).picture,png(1400,800,99));assert.equal((await b.catalogueOverview({limit:48})).cars[0].id,f.carId);
 }finally{await b.close();}
});
