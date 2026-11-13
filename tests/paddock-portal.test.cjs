'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http');
const {Store}=require('../src/store.cjs'),{PaddockPortal,privateIP,MAX_BODY}=require('../src/paddock-portal.cjs');
const bytes=fs.readFileSync(path.join(__dirname,'../assets/icon.png')),picture=require('../src/photo-import.cjs').originalPhoto(bytes);
async function fixture(t){
 const root=require('./support/temp-dir.cjs')('portal-'),store=new Store(path.join(root,'collection.sqlite'));store.persist(store.data);let available=true,changes=0;
 const portal=new PaddockPortal({getStore:()=>store,available:()=>available,validatePhoto:b=>{assert.deepEqual(b,bytes);},onChange:()=>changes++,interfaces:()=>['127.0.0.1'],host:'127.0.0.1'});
 t.after(async()=>{await portal.stop();await store.whenIdle();fs.rmSync(root,{recursive:true,force:true});});
 await portal.start();let base=`http://127.0.0.1:${portal.active.port}`,token='';
 const call=async(route,body,headers={})=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,value:await response.json()};};
 const auth=async input=>{const r=await call('/api/session',input||{code:portal.status().code});if(r.status===200)token=r.value.token;return r;};
 const car=extra=>({operationId:crypto.randomUUID(),manufacturer:'NSR',model:'Mosler MT900R',reference:'001',picture,...extra});
 return {store,portal,call,auth,car,get base(){return base;},get changes(){return changes;},unavailable:()=>{available=false;},restart:async()=>{await portal.stop();await portal.start();base=`http://127.0.0.1:${portal.active.port}`;token='';}};
}
test('Portal authenticates QR and short-code access independently; exposes no general database API',async t=>{
 const f=await fixture(t);assert.equal(f.portal.status().enabled,true);assert.match(f.portal.status().addresses[0].qr,/<svg/);
 assert.equal((await f.call('/api/info')).status,401);assert.equal((await f.call('/api/session',{code:'000000'})).status,401);
 const info=await f.auth({token:f.portal.active.join});assert.equal(info.status,200);assert.equal(info.value.databaseId,f.store.data.id);assert.equal((await f.call('/api/info')).value.collectionName,'My collection');
 assert.equal((await f.call('/v1/collection')).status,404);assert.equal((await f.call('/api/cars',f.car(),{Origin:'http://evil.example'})).status,403);
 assert.equal((await f.call('/api/cars',f.car(),{'Sec-Fetch-Site':'cross-site'})).status,403);
 const invalidHost=await new Promise((resolve,reject)=>{const req=http.get(f.base+'/api/info',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(invalidHost,403);
 const html=await fetch(f.base);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(html.headers.get('cache-control'),'no-store');assert.doesNotMatch(await html.text(),new RegExp(f.portal.status().code));
});
test('Portal saves one complete car, preserves original bytes and choices, with durable retry receipts after restart',async t=>{
 const f=await fixture(t);await f.auth();const input=f.car();const responses=await Promise.all([f.call('/api/cars',input),f.call('/api/cars',input)]);for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(responses[0].value.carId,responses[1].value.carId);
 assert.equal(f.store.data.cars.length,1);const c=f.store.data.cars[0];assert.equal(c.maker,'NSR');assert.equal(c.model,'Mosler MT900R');assert.equal(c.name,c.model);assert.equal(c.reference,'001');assert.equal(c.picture,picture);assert.equal(f.store.data.submissions.length,0);
 assert.equal((await f.call('/api/receipts/'+input.operationId)).value.carId,c.id);
 const reader=await Store.open(f.store.file);assert.equal(reader.data.cars[0].id,c.id);assert.equal(reader.data.cars[0].picture,picture);
 const oldCode=f.portal.status().code,oldJoin=f.portal.active.join;await f.restart();assert.notEqual(f.portal.active.join,oldJoin);await f.auth();assert.equal((await f.call('/api/receipts/'+input.operationId)).value.carId,c.id);
 assert.equal((await f.call('/api/cars',input)).value.duplicate,true);assert.equal(f.store.data.cars.length,1);
 assert.equal((await f.call('/api/cars',{...input,model:'Other car'})).status,409);assert.equal(f.store.data.cars[0].name,'Mosler MT900R');assert.ok(oldCode);
});
test('Portal validates fields, photos and upload bounds before creating anything',async t=>{
 const f=await fixture(t);await f.auth();for(const change of [{manufacturer:''},{model:' '},{model:'a'.repeat(201)},{reference:'bad\nvalue'},{owner:'Not allowed'},{picture:'data:image/heic;base64,AAAA'},{picture:picture.replace('image/png','image/jpeg')},{operationId:'../bad'}]){
  const result=await f.call('/api/cars',f.car(change));assert.ok(result.status>=400,JSON.stringify(change));
 }
 assert.equal(f.store.data.cars.length,0);assert.equal((await f.call('/api/receipts/'+crypto.randomUUID())).value.found,false);
 const result=await fetch(f.base+'/api/cars',{method:'POST',headers:{Origin:f.base,'Content-Type':'text/plain'},body:'hi'});assert.equal(result.status,401);
 assert.ok(MAX_BODY<13*1024*1024);
});
test('stopping revokes sessions; restart starts fresh and saved originals remain',async t=>{
 const f=await fixture(t);const auth=await f.auth();const initial=f.portal.status();await f.portal.stop();assert.equal(f.portal.status().enabled,false);assert.equal(f.portal.status().code,undefined);await assert.rejects(fetch(f.base));await f.restart();assert.equal((await f.call('/api/info',null,{Authorization:'Bearer '+auth.value.token})).status,401);assert.ok(initial.port);
});
test('collection changes and restoration block uploads and receipt replay',async t=>{
 const f=await fixture(t);await f.auth();const input=f.car();assert.equal((await f.call('/api/cars',input)).status,200);const original=f.store.snapshot();f.store.replace(original);
 const response=await f.call('/api/cars',input);assert.equal(response.status,409);assert.equal(response.value.code,'PORTAL_COLLECTION_CHANGED');assert.equal(f.store.data.cars.length,1);
});
test('Portal stops a partial upload promptly and does not create a partial car',async t=>{
 const f=await fixture(t);const auth=await f.auth();let req;
 const opened=new Promise(resolve=>{req=http.request(f.base+'/api/cars',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json',Authorization:'Bearer '+auth.value.token,'Content-Length':100000}},()=>{});req.on('error',()=>{});req.write('{');setTimeout(resolve,80);});
 await opened;await f.portal.stop();req.destroy();assert.equal(f.store.data.cars.length,0);
});
test('short-code guessing is rate limited, and public network addresses are not accepted',async t=>{
 const f=await fixture(t);for(let i=0;i<8;i++)assert.equal((await f.auth({code:'000000'})).status,401);assert.equal((await f.auth()).status,429);
 for(const ip of ['8.8.8.8','192.0.2.3','169.1.2.3','::1'])assert.equal(privateIP(ip),false);for(const ip of ['127.0.0.1','192.168.1.4','10.0.0.2','172.16.1.2','::ffff:192.168.1.5'])assert.equal(privateIP(ip),true);
});
test('original photo dimension guard rejects malformed and huge image headers',()=>{
 const photo=require('../src/portal-photo.cjs');assert.ok(photo.check(bytes).width);const large=Buffer.from(bytes);large.writeUInt32BE(100000,16);assert.throws(()=>photo.check(large),e=>e.code==='PHOTO_DIMENSIONS');assert.throws(()=>photo.check(Buffer.from([255,216,255])),e=>e.code==='INVALID_PHOTO');
});
test('Portal writes coexist with another shared-file writer and remain direct on a Dealership authority',async t=>{
 const f=await fixture(t),{Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');const network=new Network(f.store),club=new Club(f.store,network,path.dirname(f.store.file));club.enable('My dealership','portal test password');t.after(()=>{club.close();network.close();});
 await f.auth();const other=await Store.open(f.store.file),epoch=other.deferredState.token.epoch;
 const [upload]=await Promise.all([f.call('/api/cars',f.car()),other.mutateAsync('car.save',{data:{name:'Another app car'}},{snapshot:false,commandId:'portal-companion-test',databaseId:other.data.id,epoch})]);assert.equal(upload.status,200,JSON.stringify(upload.value));
 const read=await Store.open(f.store.file);assert.deepEqual(read.data.cars.map(c=>c.name).sort(),['Another app car','Mosler MT900R']);assert.equal(read.data.club.proposals.length,0);assert.equal(read.data.submissions.length,0);
});
test('Portal rejects an over-limit HTTP body and unsupported request types before saving',async t=>{
 const f=await fixture(t),auth=await f.auth();
 const request=options=>new Promise((resolve,reject)=>{const req=http.request(f.base+'/api/cars',{method:'POST',headers:{Origin:f.base,Authorization:'Bearer '+auth.value.token,...options}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('x');});
 assert.equal(await request({'Content-Type':'text/plain'}),415);assert.equal(await request({'Content-Type':'application/json','Content-Length':MAX_BODY+1}),413);assert.equal(await request({'Content-Type':'application/json','Content-Encoding':'gzip'}),413);assert.equal(f.store.data.cars.length,0);
});
test('a stopped Portal cannot finish a photo validation into a new car',async t=>{
 const f=await fixture(t);await f.auth();let release,entered;const ready=new Promise(r=>{entered=r;});f.portal.validatePhoto=()=>new Promise(r=>{release=r;entered();});
 const upload=f.call('/api/cars',f.car());await ready;const stopped=f.portal.stop();release();const response=await upload;await stopped;assert.equal(response.status,409);assert.equal(f.store.data.cars.length,0);
});
test('a lost response is recovered through its receipt without duplicating the car',async t=>{
 const f=await fixture(t),auth=await f.auth(),input=f.car();let release,entered;const ready=new Promise(r=>{entered=r;});f.portal.validatePhoto=()=>new Promise(r=>{release=r;entered();});
 const req=http.request(f.base+'/api/cars',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json',Authorization:'Bearer '+auth.value.token}},res=>res.resume());req.on('error',()=>{});req.end(JSON.stringify(input));await ready;req.destroy();release();
 await f.portal.active.work.idle();assert.equal(f.store.data.cars.length,1);assert.equal((await f.call('/api/receipts/'+input.operationId)).value.carId,f.store.data.cars[0].id);
 f.portal.validatePhoto=()=>{};const retry=await f.call('/api/cars',input);assert.equal(retry.status,200);assert.equal(retry.value.duplicate,true);assert.equal(f.store.data.cars.length,1);
});

const appendInput=(c,extra={})=>({operationId:crypto.randomUUID(),carId:c.id,revision:c.revision,photos:[{name:'Front.png',data:picture},{name:'Rear.png',data:picture}],...extra});
async function existing(f,data={}){const r=await f.call('/api/cars',f.car());assert.equal(r.status,200,JSON.stringify(r.value));if(Object.keys(data).length)f.store.mutate('car.save',{id:r.value.carId,revision:1,data});return f.store.data.cars.find(c=>c.id===r.value.carId);}
test('existing-car list is paged, searchable only by public identification, and omits private fields and full photos',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f,{owner:'SecretOwner',location:'SecretLocation',notes:'Private secret',reference:'FindRef'});
 const page=await f.call('/api/car-list',{query:'findref'});assert.equal(page.status,200,JSON.stringify(page.value));assert.equal(page.value.cars[0].id,c.id);assert.equal(page.value.cars[0].remaining,40);assert.equal(page.value.cars[0].hasPicture,true);assert.doesNotMatch(JSON.stringify(page.value),/Secret|base64|owner|notes|location/);
 for(const query of ['SecretOwner','SecretLocation'])assert.equal((await f.call('/api/car-list',{query})).value.total,0);
 for(let i=0;i<22;i++)f.store.mutate('car.save',{data:{name:'Extra '+i}});
 const first=(await f.call('/api/car-list',{})).value,second=(await f.call('/api/car-list',{offset:first.nextOffset,revision:first.revision})).value;assert.equal(first.cars.length,20);assert.equal(second.cars.length,3);assert.equal(new Set([...first.cars,...second.cars].map(c=>c.id)).size,23);
 f.store.mutate('car.save',{data:{name:'New'}});assert.equal((await f.call('/api/car-list',{offset:first.nextOffset,revision:first.revision})).value.code,'LIST_CHANGED');
});
test('gallery batch is atomic, preserves main and existing photos, and receipts survive restart and later edits',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f,{photos:[{id:'old-photo',name:'Original',data:picture}],owner:'Private owner',technical:{motor:'Original motor'}}),input=appendInput(c);
 const result=await f.call('/api/photos',input);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.count,2);
 const saved=f.store.data.cars[0];assert.equal(saved.photos.length,3);assert.equal(saved.photos[0].id,'old-photo');assert.equal(saved.picture,picture);assert.equal(saved.owner,'Private owner');assert.equal(saved.technical.motor,'Original motor');assert.ok(saved.photos.every(p=>p.data===picture));assert.equal(new Set(saved.photos.map(p=>p.id)).size,3);assert.equal(saved.revision,c.revision+1);assert.equal(f.store.data.submissions.length,0);
 f.store.mutate('car.save',{id:saved.id,revision:saved.revision,data:{name:'Renamed afterwards'}});await f.restart();await f.auth();const retry=await f.call('/api/photos',input);assert.equal(retry.status,200);assert.equal(retry.value.duplicate,true);assert.equal(f.store.data.cars[0].photos.length,3);const receipt=(await f.call('/api/receipts/'+input.operationId)).value;assert.equal(receipt.count,2);assert.equal(receipt.carId,c.id);
 assert.equal((await f.call('/api/photos',{...input,photos:[{name:'Changed',data:picture}]})).status,409);
});
test('gallery validation, capacity and stale car rejection never partially save',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f),originalRevision=c.revision;
 for(const photos of [[],Array.from({length:6},()=>({name:'x',data:picture})),[{name:'ok',data:picture},{name:'bad',data:'data:image/heic;base64,AAAA'}]])assert.ok((await f.call('/api/photos',appendInput(c,{photos}))).status>=400);
 assert.equal(f.store.data.cars[0].revision,originalRevision);assert.equal(f.store.data.cars[0].photos.length,0);
 f.store.mutate('car.save',{id:c.id,revision:c.revision,data:{photos:Array.from({length:39},(_,i)=>({id:'existing-'+i,name:'Photo',data:picture}))}});const full=f.store.data.cars[0];assert.equal((await f.call('/api/photos',appendInput(full))).value.code,'PHOTO_CAPACITY');assert.equal(f.store.data.cars[0].photos.length,39);
 assert.equal((await f.call('/api/photos',appendInput(c))).value.code,'CAR_CHANGED');assert.equal((await f.call('/api/photos',appendInput(full,{carId:'missing-car'}))).value.code,'CAR_NOT_FOUND');
 f.store.mutate('car.archive',{id:full.id,revision:full.revision});assert.equal((await f.call('/api/photos',appendInput(full))).value.code,'CAR_ARCHIVED');assert.equal((await f.call('/api/car-list',{})).value.total,0);
});
test('a decoder failure on the final photo rolls the entire batch back',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f);let n=0;f.portal.validatePhoto=()=>{if(++n===2)throw Object.assign(Error('Bad photo'),{httpStatus:400,code:'INVALID_PHOTO'});};const input=appendInput(c),result=await f.call('/api/photos',input);assert.equal(result.status,400);assert.equal(f.store.data.cars[0].photos.length,0);assert.equal((await f.call('/api/receipts/'+input.operationId)).value.found,false);
});
test('competing desktop edits are retained and stop a stale pending gallery upload',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f);let entered,release;const ready=new Promise(r=>entered=r);f.portal.validatePhoto=()=>new Promise(r=>{release=r;entered();});const input=appendInput(c,{photos:[{name:'Photo',data:picture}]}),upload=f.call('/api/photos',input);await ready;
 const other=await Store.open(f.store.file);other.mutate('car.save',{id:c.id,revision:c.revision,data:{reference:'Changed on desktop'}});release();const result=await upload;assert.equal(result.value.code,'CAR_CHANGED');const fresh=await Store.open(f.store.file);assert.equal(fresh.data.cars[0].reference,'Changed on desktop');assert.equal(fresh.data.cars[0].photos.length,0);
});

test('merged cars reject gallery uploads instead of redirecting to the main car',async t=>{
 const f=await fixture(t);await f.auth();const old=await existing(f),main=await existing(f);const repo=require('../src/car-merge-storage.cjs').openHost(f.store.file);let n=0;const send=(action,payload)=>repo.command({databaseId:repo.read().id,recoveryId:repo.state().recoveryId,sourceId:'portal-test',operationId:'merge-'+ ++n,action,payload}).result;
 const proposal=send('create',{mainCarId:main.id,retiredCarId:old.id});send('approve',{id:proposal.id,expectedRevision:proposal.revision});const priorPhotos=repo.read().cars.find(c=>c.id===main.id).photos.length;const result=await f.call('/api/photos',appendInput(old));assert.equal(result.value.code,'CAR_MERGED');assert.equal(f.store.data.cars.find(c=>c.id===main.id).photos.length,priorPhotos);const list=(await f.call('/api/car-list',{})).value;assert.deepEqual(list.cars.map(c=>c.id),[main.id]);
});
test('gallery receipt failure rolls back every photo, revision and new attachment',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f),input=appendInput(c),{DatabaseSync}=require('node:sqlite'),sql=new DatabaseSync(f.store.file);const count=()=>sql.prepare('SELECT count(*) n FROM assets').get().n,before=count();
 sql.exec("CREATE TRIGGER portal_receipt_failure BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'test receipt failure'); END");
 try{const result=await f.call('/api/photos',input);assert.equal(result.status,500);const fresh=await Store.open(f.store.file);assert.equal(fresh.data.cars[0].revision,c.revision);assert.equal(fresh.data.cars[0].photos.length,0);assert.equal(count(),before);assert.equal((await f.call('/api/receipts/'+input.operationId)).value.found,false);}finally{sql.exec('DROP TRIGGER portal_receipt_failure');sql.close();}
 assert.equal((await f.call('/api/photos',input)).status,200);
});
test('five-photo maximum is accepted and partial uploads/restore cannot create a partial gallery',async t=>{
 const f=await fixture(t);await f.auth();const c=await existing(f),input=appendInput(c,{photos:Array.from({length:5},(_,i)=>({name:'Photo '+i,data:picture}))});assert.equal((await f.call('/api/photos',input)).status,200);assert.equal(f.store.data.cars[0].photos.length,5);
 const auth=await f.auth(),req=http.request(f.base+'/api/photos',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json',Authorization:'Bearer '+auth.value.token,'Content-Length':100000}},res=>res.resume());req.on('error',()=>{});req.write('{');await new Promise(r=>setTimeout(r,50));await f.portal.stop();req.destroy();assert.equal(f.store.data.cars[0].photos.length,5);
 await f.restart();await f.auth();f.store.replace(f.store.snapshot());assert.equal((await f.call('/api/photos',input)).status,409);assert.equal(f.store.data.cars[0].photos.length,5);
});
