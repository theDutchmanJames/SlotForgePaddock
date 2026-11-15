'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),P=require('../src/catalogue-picture-requests.cjs');
const {PicturePreviews}=require('../src/catalogue-picture-previews.cjs'),{PictureBatches}=require('../src/catalogue-picture-batches.cjs'),{PictureApplication}=require('../src/catalogue-picture-application.cjs');
const picture=require('./support/thumbnail-images.cjs')(24,16,80),original=require('./support/thumbnail-images.cjs')(24,16,150),bytes=Buffer.from(picture.split(',')[1],'base64');
const product=(reference='M-01',extra={})=>({kind:'part',name:'King motor',manufacturer:'Example Racing',reference,category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'',sourceUrl:'https://example.com/product',checkedDate:'2026-11-15',reviewNotes:'',specifications:[],...extra});
function importParts(store,products){store.mutate('catalogue.apply',{revision:store.data.revision,input:{format:'slotforge-catalogue',version:1,products},selections:products.map((_,index)=>({index,create:true})),confirmed:true});}
function fixture(t,products=[product()]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-shared-pictures-')),source=new Store(path.join(dir,'source.sqlite')),store=new Store(path.join(dir,'destination.sqlite'));
 importParts(source,products);importParts(store,products);let calls=0;
 const options={profile:path.join(dir,'profile'),getStore:()=>store,decode:async()=>({bytes,mime:'image/png',width:24,height:16}),download:async()=>{calls++;return {picture,bytes,mime:'image/png'};}};
 const d=P.prepare(source,{expected:P.browse(source,{}),manufacturer:products[0].manufacturer,selected:[...source.snapshot().parts.map(r=>({kind:'part',id:r.id})),...source.snapshot().supplies.map(r=>({kind:'supply',id:r.id}))]})[0];
 const response=structuredClone(d.request);response.items.forEach(r=>r.imageUrl='https://images.example/'+r.itemId);
 let service,batch,app;const open=()=>{service=new PicturePreviews(options);app=new PictureApplication(service,null);batch=new PictureBatches(service);};open();
 t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {source,store,response,options,open,calls:()=>calls,get service(){return service;},get batch(){return batch;},get app(){return app;}};
}
const file=(response,name='shared.json')=>({name,bytes:Buffer.from(JSON.stringify(response))});
async function finish(f,id){await f.batch.work?.promise;return f.batch.view(id);}
async function applyAll(f,id){let v=await finish(f,id);await f.batch.command('select',id,{itemIds:v.rows.filter(r=>r.status==='ready').map(r=>r.itemId)});await f.batch.command('apply',id);return finish(f,id);}

test('independently imported catalogues match local IDs, preserve originals until confirmed, and reuse receipts after restart',async t=>{
 const f=fixture(t,[product(),product('M-02')]);assert.notEqual(f.source.snapshot().parts[0].id,f.store.snapshot().parts[0].id);
 const part=f.store.snapshot().parts[0];f.store.mutate('part.save',{id:part.id,data:{...part,picture:original}});const before=f.store.snapshot();
 let v=await f.batch.importFiles([file(f.response)]);v=await finish(f,v.requestId);const id=v.requestId;
 assert.equal(v.rows.length,2);assert.ok(v.rows.every(r=>r.status==='ready'&&!r.selected));assert.equal(v.rows.filter(r=>r.hasCurrent).length,1);assert.deepEqual(f.store.snapshot(),before);
 const descriptor=f.service.descriptor(id);assert.ok(descriptor.targets.every(target=>before.parts.some(p=>p.id===target.recordId)));assert.equal(descriptor.request.databaseId,before.id);
 await assert.rejects(f.batch.command('select',id,{itemIds:v.rows.map(r=>r.itemId),bulk:true}),/replacements/);
 v=await applyAll(f,id);assert.ok(v.rows.every(r=>r.status==='applied'));assert.ok(f.store.snapshot().parts.every(p=>p.picture===picture&&p.quantity===0));assert.equal(f.service.used(),0);
 await f.service.close();f.open();v=await f.batch.importFiles([file(f.response)]);v=await finish(f,v.requestId);assert.equal(v.requestId,id);assert.equal(f.calls(),2);assert.ok(v.rows.every(r=>r.status==='applied'));assert.equal(f.service.journal.list().length,1);
});

test('manufacturer and reference matching tolerates case and surrounding spaces but not punctuation or leading zero changes',async t=>{
 const f=fixture(t,[product('M-01'),product('002')]);f.response.manufacturer=' EXAMPLE RACING ';f.response.items.forEach(r=>{r.manufacturer=' example racing ';r.name='Different description';r.reference=' '+r.reference.toLowerCase()+' ';});
 let v=await f.batch.importFiles([file(f.response)]);v=await finish(f,v.requestId);assert.equal(v.rows.length,2);assert.ok(v.rows.every(r=>r.name==='King motor'));
 const changed=structuredClone(f.response);changed.items[0].reference='M01';changed.items[1].reference='2';await assert.rejects(f.batch.importFiles([file(changed)]),/No pictures matched/);assert.equal(f.calls(),2);
});

test('missing, ambiguous, reference-free and duplicated source products are skipped with reasons; valid matches still import',async t=>{
 const f=fixture(t,[product('GOOD'),product('DUP'),product(''),product('REPEATED')]);const duplicate=f.store.snapshot().parts.find(p=>p.reference==='DUP');
 f.store.mutate('part.save',{data:{...duplicate,id:undefined,name:'Second stock record'}});
 const repeated=structuredClone(f.response.items.find(r=>r.reference==='REPEATED'));repeated.itemId='second-row';f.response.items.push(repeated);
 const missing={...structuredClone(f.response.items[0]),itemId:'missing-row',reference:'ABSENT'};f.response.items.push(missing);
 let v=await f.batch.importFiles([file(f.response)]);v=await finish(f,v.requestId);assert.equal(v.rows.length,1);assert.equal(v.rows[0].reference,'GOOD');assert.equal(v.notices.length,5);assert.match(v.notices.join(' '),/no product reference/);assert.match(v.notices.join(' '),/multiple matching/);assert.match(v.notices.join(' '),/import the parts list first/);assert.match(v.notices.join(' '),/more than once/);assert.equal(f.calls(),1);
});

test('parts and workshop supplies with the same reference map to their respective kinds',async t=>{
 const f=fixture(t,[product('SAME'),product('SAME',{kind:'supply',name:'Workbench tool',category:'Hand tools',partType:'Hex driver',supplyKind:'Tool / equipment'})]);
 const v=await f.batch.importFiles([file(f.response)]);await applyAll(f,v.requestId);const saved=f.store.snapshot();assert.equal(saved.parts[0].picture,picture);assert.equal(saved.supplies[0].picture,picture);
});

test('invalid later input rolls back all new mappings and starts no downloads',async t=>{
 const f=fixture(t);const before=f.store.snapshot();await assert.rejects(f.batch.importFiles([file(f.response),{name:'broken.json',bytes:Buffer.from('{}')}]),/broken.json/);
 assert.equal(f.service.journal.list().length,0);assert.equal(f.service.all().length,0);assert.equal(f.calls(),0);assert.deepEqual(f.store.snapshot(),before);
});

test('a failed journal commit leaves no partial shared mappings or previews',async t=>{
 const f=fixture(t);f.service.journal.use(db=>db.exec("CREATE TRIGGER fail_job BEFORE INSERT ON picture_jobs BEGIN SELECT RAISE(ABORT,'test journal failure'); END"));
 await assert.rejects(f.batch.importFiles([file(f.response)]),/test journal failure/);assert.equal(f.service.journal.list().length,0);assert.equal(f.service.all().length,0);assert.equal(f.calls(),0);assert.equal(f.store.snapshot().parts[0].picture,'');
 f.service.journal.use(db=>db.exec('DROP TRIGGER fail_job'));const v=await f.batch.importFiles([file(f.response)]);assert.equal((await finish(f,v.requestId)).rows[0].status,'ready');
});

test('collection switching during matching cannot save targets into the new collection',async t=>{
 const f=fixture(t),read=f.service.read.bind(f.service);let switched=false;
 f.service.read=async(...args)=>{const result=await read(...args);if(!switched){switched=true;f.service.getStore=()=>f.source;}return result;};
 await assert.rejects(f.batch.importFiles([file(f.response)]),{code:'COLLECTION_CHANGED'});assert.equal(f.service.journal.list().length,0);assert.equal(f.calls(),0);
});

test('multiple shared files and identical copies use one preview without duplicate downloads',async t=>{
 const f=fixture(t,[product('A'),product('B')]),a={...f.response,items:[f.response.items[0]]},b={...f.response,items:[f.response.items[1]]};
 let v=await f.batch.importFiles([file(a,'a.json'),file(a,'copy.json'),file(b,'b.json')]);v=await finish(f,v.requestId);assert.equal(v.files.length,2);assert.equal(v.rows.length,2);assert.equal(f.calls(),2);assert.match(v.notices.join(' '),/no duplicate/);
});

test('a restored collection cannot silently rebase saved shared-import mappings',async t=>{
 const f=fixture(t);let v=await f.batch.importFiles([file(f.response)]);v=await finish(f,v.requestId);f.store.replace(f.store.snapshot());
 await assert.rejects(f.batch.importFiles([file(f.response)]),{code:'COLLECTION_CHANGED'});await assert.rejects(f.batch.command('apply',v.requestId),{code:'COLLECTION_CHANGED'});assert.equal(f.store.snapshot().parts[0].picture,'');
});

test('changing the saved picture during preview cannot overwrite the new original',async t=>{
 const f=fixture(t);let v=await f.batch.importFiles([file(f.response)]);v=await finish(f,v.requestId);await f.batch.command('select',v.requestId,{itemIds:v.rows.map(r=>r.itemId)});
 const part=f.store.snapshot().parts[0];f.store.mutate('part.save',{id:part.id,data:{...part,picture:original}});await f.batch.command('apply',v.requestId);v=await finish(f,v.requestId);
 assert.match(v.saveError,/changed/);assert.equal(f.store.snapshot().parts[0].picture,original);assert.ok(v.rows.every(r=>r.status!=='applied'));
});

test('matching holds the batch lock; cancellation before completion creates no mappings or downloads',async t=>{
 const f=fixture(t),read=f.service.read.bind(f.service);let entered,release;const started=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
 f.service.read=async(...args)=>{entered();await resume;return read(...args);};const pending=f.batch.importFiles([file(f.response)]);await started;
 await assert.rejects(f.batch.importFiles([file(f.response)]),{code:'BATCH_BUSY'});await assert.rejects(f.batch.single('clear','older-window',{}),{code:'BATCH_BUSY'});await f.batch.stop();release();await assert.rejects(pending,{code:'BATCH_STOPPED'});assert.equal(f.service.journal.list().length,0);assert.equal(f.calls(),0);
});

test('a local file without its saved request can match, but an existing local response cannot evade context checks',async t=>{
 const f=fixture(t),d=P.prepare(f.store,{expected:P.browse(f.store,{}),manufacturer:'Example Racing',selected:f.store.snapshot().parts.map(r=>({kind:'part',id:r.id}))})[0];
 const response=structuredClone(d.request);response.items.forEach(r=>r.imageUrl='https://images.example/local');let v=await f.batch.importFiles([file(response)]);v=await finish(f,v.requestId);assert.equal(v.rows.length,1);
 f.service.journal.save([d]);response.items[0].name='Changed by AI';await assert.rejects(f.batch.importFiles([file(response)]),{code:'PRODUCT_CHANGED'});assert.equal(f.calls(),1);
});
