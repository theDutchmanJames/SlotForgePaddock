'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),P=require('../src/catalogue-picture-requests.cjs'),{PicturePreviews}=require('../src/catalogue-picture-previews.cjs'),{PictureApplication}=require('../src/catalogue-picture-application.cjs'),{PictureBatches}=require('../src/catalogue-picture-batches.cjs');
const picture=require('./support/thumbnail-images.cjs')(24,16,80),bytes=Buffer.from(picture.split(',')[1],'base64');
function fixture(t,count=8){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-combined-')),store=new Store(path.join(dir,'library.sqlite')),profile=path.join(dir,'profile');let calls=0,service,batch,app;const files=[];
 const options={profile,getStore:()=>store,decode:async()=>({bytes,mime:'image/png',width:24,height:16}),download:async()=>{calls++;return {picture,bytes,mime:'image/png'};}};
 const open=()=>{service=new PicturePreviews(options);app=new PictureApplication(service,null);batch=new PictureBatches(service);};open();
 for(let n=0;n<count;n++){const manufacturer=n%2?'NSR':'Slot.it',selected=[];for(let i=0;i<2;i++)selected.push({kind:'part',id:store.mutate('part.save',{data:{name:'Product '+n+'-'+i,maker:manufacturer,reference:'R'+n+'-'+i,category:'Motors & motor parts',partType:'Motor',quantity:0,tracking:'quantity'}}).result});
  const d=P.prepare(store,{expected:P.browse(store,{}),manufacturer,selected})[0];service.journal.save([d]);const response=structuredClone(d.request);response.items.forEach(r=>r.imageUrl='https://images.example/'+r.itemId);files.push({name:'pictures-'+n+'.json',bytes:Buffer.from(JSON.stringify(response)),response});}
 t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {files,store,options,open,get service(){return service;},get batch(){return batch;},get app(){return app;},calls:()=>calls};
}
async function finish(f,id){await f.batch.work?.promise;return f.batch.view(id);}
test('eight files use one review; all ready selection and confirmed imports span manufacturers',async t=>{
 const f=fixture(t),before=f.store.snapshot(),initial=await f.batch.importFiles(f.files),id=initial.requestId;let v=await finish(f,id);
 assert.equal(v.files.length,8);assert.equal(v.rows.length,16);assert.equal(new Set(v.rows.map(r=>r.itemId)).size,16);assert.ok(v.rows.every(r=>r.status==='ready'&&!r.selected&&r.sourceFile));assert.deepEqual(f.store.snapshot(),before);assert.equal(f.calls(),16);
 v=await f.batch.command('select',id,{itemIds:v.rows.map(r=>r.itemId)});assert.ok(v.rows.every(r=>r.selected));await f.batch.command('apply',id);v=await finish(f,id);
 assert.ok(v.rows.every(r=>r.status==='applied'));assert.equal(f.service.used(),0);assert.ok(f.store.snapshot().parts.every(p=>p.picture===picture&&p.quantity===0));
 await f.service.close();f.open();v=await f.batch.open(f.files[7].response.requestId);assert.equal(v.files.length,8);assert.ok(v.rows.every(r=>r.status==='applied'));assert.equal(f.calls(),16);
});
test('invalid later files leave every job and the database untouched and name the file',async t=>{
 const f=fixture(t,2),bad=structuredClone(f.files[1].response);bad.items[1].name='Wrong product';const before=f.store.snapshot();
 await assert.rejects(f.batch.importFiles([f.files[0],{name:'bad.json',bytes:Buffer.from(JSON.stringify(bad))}]),/bad.json/);
 assert.equal(f.service.all().length,0);assert.equal(f.calls(),0);assert.deepEqual(f.store.snapshot(),before);
});
test('duplicate files are reported and reused; changed duplicate content rejects the whole import',async t=>{
 const f=fixture(t,2);let v=await f.batch.importFiles([f.files[0],f.files[0],f.files[1]]);v=await finish(f,v.requestId);assert.equal(v.files.length,2);assert.equal(v.rows.length,4);assert.equal(v.notices.length,1);assert.equal(f.calls(),4);
 const before=f.service.all(),changed=structuredClone(f.files[1].response);changed.items[0].imageUrl='https://example.com/different.png';
 await assert.rejects(f.batch.importFiles([f.files[0],{name:'changed.json',bytes:Buffer.from(JSON.stringify(changed))}]),/changed.json.*different response/);assert.deepEqual(f.service.all(),before);assert.equal(f.calls(),4);
});
test('capacity pause survives restart and confirmed imports automatically continue only downloads',async t=>{
 const f=fixture(t,4);f.options.checkSpace=()=>{if(f.service.used()>0)throw Error('test disk capacity');};f.service.checkSpace=f.options.checkSpace;
 let v=await f.batch.importFiles(f.files),id=v.requestId;v=await finish(f,id);assert.equal(v.downloadPause.code,'DISK_FULL');assert.equal(v.remainingDownloads,6);assert.equal(f.calls(),2);
 await f.service.close();f.open();assert.equal(f.calls(),2);await f.batch.open(id);v=await finish(f,id);assert.equal(f.calls(),2);
 for(let round=0;round<4;round++){
  const ready=v.rows.filter(r=>r.status==='ready');assert.equal(ready.length,2);assert.ok(ready.every(r=>!r.selected));await f.batch.command('select',id,{itemIds:ready.map(r=>r.itemId)});await f.batch.command('apply',id);v=await finish(f,id);
  assert.equal(v.rows.filter(r=>r.status==='applied').length,(round+1)*2);assert.ok(v.rows.every(r=>!r.selected));assert.equal(v.rows.filter(r=>r.status==='ready').length,round<3?2:0);
 }
 assert.equal(f.calls(),8);assert.equal(v.remainingDownloads,0);assert.equal(v.downloadPause,null);assert.equal(f.service.used(),0);
});
test('a URL failure does not block the remaining files or get retried automatically',async t=>{
 const f=fixture(t,3);let calls=0;f.service.download=async()=>{if(++calls===1)throw Object.assign(Error('404'),{code:'HTTP_404'});return {picture,bytes,mime:'image/png'};};
 let v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);assert.equal(calls,6);assert.equal(v.remainingDownloads,0);assert.equal(v.rows.filter(r=>r.status==='download-failed').length,1);assert.equal(v.rows.filter(r=>r.status==='ready').length,5);
});
test('Stop cancels the whole queue, does not start the next file, and persists the paused work',async t=>{
 const f=fixture(t,3);let calls=0;f.service.download=(_url,{signal})=>new Promise((_resolve,reject)=>{calls++;signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true});});
 const v=await f.batch.importFiles(f.files),id=v.requestId;await f.batch.command('cancel',id);assert.ok(calls<=2);assert.equal(f.batch.work,null);assert.equal(f.service.running.size,0);assert.equal(f.service.reserved,0);
 await f.service.close();f.open();const count=calls;await f.batch.open(id);assert.equal(calls,count);assert.equal(f.batch.work,null);assert.equal(f.batch.state(id).auto,false);
});
test('regrouping an existing batch retains its members, selections and receipts',async t=>{
 const f=fixture(t,3);let v=await f.batch.importFiles(f.files.slice(0,2));v=await finish(f,v.requestId);await f.batch.command('select',v.requestId,{itemIds:[v.rows[0].itemId]});
 v=await f.batch.importFiles([f.files[1],f.files[2]]);v=await finish(f,v.requestId);assert.equal(v.files.length,3);assert.equal(v.rows.filter(r=>r.selected).length,1);assert.equal(f.calls(),6);assert.equal(f.service.all().filter(j=>j.batch).length,1);
});
test('collection restoration invalidates saved batches without applying old originals',async t=>{
 const f=fixture(t,2);let v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);await f.batch.command('select',v.requestId,{itemIds:v.rows.map(r=>r.itemId)});f.store.replace(f.store.snapshot());
 await assert.rejects(f.batch.command('apply',v.requestId),{code:'COLLECTION_CHANGED'});assert.ok(f.store.snapshot().parts.every(r=>!r.picture));assert.ok(f.service.used()>0);
});
test('discarding the anchor transfers the combined journal atomically; unprocessed requests remain discardable',async t=>{
 const f=fixture(t,3);let v=await f.batch.importFiles(f.files.slice(0,2));v=await finish(f,v.requestId);const anchor=v.requestId;
 await f.batch.discard(anchor,f.store.data.id);v=await f.batch.view(f.files[1].response.requestId);assert.equal(v.files.length,1);assert.equal(v.rows.length,2);assert.ok(v.rows.every(r=>r.status==='ready'));assert.equal(v.requestId,f.files[1].response.requestId);
 await f.batch.discard(f.files[2].response.requestId,f.store.data.id);assert.equal(f.service.journal.list().length,1);
});
test('pending Dealership receipts retain originals and hold downloads until approved outcomes are reconciled',async t=>{
 const f=fixture(t,2);f.service.checkSpace=()=>{if(f.service.used()>0)throw Error('capacity');};let v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);const id=v.requestId;
 // Drive the real durable application through a simulated host receipt transport.
 f.app.mode=()=>'dealership';const saved=new Map();let approved=false;
 f.app.club={lookupPicture:async i=>saved.has(i.operationId)?approved?{status:'accepted',result:saved.get(i.operationId).result}:{status:'pending'}:{status:'absent'},submitPicture:async payload=>{saved.set(payload.intent.operationId,payload);return {status:'pending'};}};
 await f.batch.command('select',id,{itemIds:v.rows.filter(r=>r.status==='ready').map(r=>r.itemId)});await f.batch.command('apply',id);v=await finish(f,id);assert.equal(v.rows.filter(r=>r.status==='pending').length,2);assert.equal(f.calls(),2);assert.equal(v.remainingDownloads,2);assert.ok(f.service.used()>0);
 for(const payload of saved.values())payload.result=(await f.store.mutateAsync(require('../src/catalogue-picture-apply.cjs').action,payload,{snapshot:false,commandId:payload.intent.operationId,databaseId:payload.intent.databaseId,epoch:payload.intent.recoveryId})).result;
 approved=true;await f.batch.command('reconcile',id);v=await finish(f,id);assert.equal(v.rows.filter(r=>r.status==='applied').length,2);assert.equal(v.rows.filter(r=>r.status==='ready').length,2);assert.equal(v.remainingDownloads,0);assert.equal(f.calls(),4);assert.ok(v.rows.every(r=>!r.selected));
});
test('stopping a confirmed import retains unsent selections and retry receipts across files',async t=>{
 const f=fixture(t,3);let v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);const id=v.requestId;await f.batch.command('select',id,{itemIds:v.rows.map(r=>r.itemId)});
 const write=f.store.mutateAsync.bind(f.store);let entered,release,first=true;const blocked=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
 f.store.mutateAsync=async(...args)=>{if(first){first=false;entered();await resume;}return write(...args);};
 await f.batch.command('apply',id);await blocked;const stopped=f.batch.command('stop-save',id);release();await stopped;v=await f.batch.view(id);
 assert.equal(v.rows.filter(r=>r.status==='applied').length,1);assert.equal(v.rows.filter(r=>r.status==='uncertain').length,1);assert.equal(v.rows.filter(r=>r.selected).length,4);
 const original=f.service.job(id).rows[1].attempt.intent.operationId;await f.batch.command('retry-save',id);await finish(f,id);assert.equal(f.service.job(id).rows[1].attempt.intent.operationId,original);
 await f.batch.command('apply',id);v=await finish(f,id);assert.ok(v.rows.every(r=>r.status==='applied'));assert.equal(f.service.used(),0);
});
test('discard excludes concurrent regrouping and leaves an intact surviving batch',async t=>{
 const f=fixture(t,3);let v=await f.batch.importFiles(f.files.slice(0,2));v=await finish(f,v.requestId);const discard=f.batch.discard(v.requestId,f.store.data.id);
 await assert.rejects(f.batch.importFiles(f.files),{code:'BATCH_BUSY'});await discard;v=await f.batch.view(f.files[1].response.requestId);assert.equal(v.files.length,1);
});
test('reimport repairs disappeared preview files without fetching intact previews again',async t=>{
 const f=fixture(t,2);let v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);const raw=f.service.job(v.requestId).rows[0];fs.unlinkSync(f.service.file(raw.asset.name));
 v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);assert.equal(f.calls(),5);assert.ok(v.rows.every(r=>r.status==='ready'));
});
test('a stale capacity pause on a completed request cannot block the next file after restart',async t=>{
 const f=fixture(t,2);let v=await f.batch.importFiles(f.files);v=await finish(f,v.requestId);const id=v.requestId,job=f.service.job(id),second=f.files[1].response.requestId;
 await f.service.clear(second);job.downloadPause={code:'STAGING_FULL',message:'Old pause',remaining:1};job.batch.queue=[{requestId:id,itemId:job.rows[0].itemId},...f.service.job(second).rows.map(r=>({requestId:second,itemId:r.itemId}))];f.service.save(job);
 await f.batch.open(id);v=await finish(f,id);assert.equal(f.calls(),6);assert.equal(v.remainingDownloads,0);assert.equal(v.downloadPause,null);assert.ok(v.rows.every(r=>r.status==='ready'));
});
test('Stop still cancels the downloader if persisting its preference fails',async t=>{
 const f=fixture(t,2);let calls=0;f.service.download=(_url,{signal})=>new Promise((_resolve,reject)=>{calls++;signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true});});
 const v=await f.batch.importFiles(f.files),save=f.service.save.bind(f.service);f.service.save=j=>{if(j.batch?.auto===false)throw Error('disk full');return save(j);};
 await assert.rejects(f.batch.command('cancel',v.requestId),/Downloads stopped.*could not be saved/);assert.equal(f.batch.work,null);assert.equal(f.service.running.size,0);assert.equal(f.service.reserved,0);assert.ok(calls<=2);f.service.save=save;
});
test('a stop request from an older window cannot cancel a different active batch',async t=>{
 const f=fixture(t,2);const first=await f.batch.importFiles([f.files[0]]);await finish(f,first.requestId);
 f.service.download=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));
 const second=await f.batch.importFiles([f.files[1]]);await assert.rejects(f.batch.command('cancel',first.requestId),{code:'BATCH_BUSY'});assert.equal(f.batch.work.id,second.requestId);await f.batch.command('cancel',second.requestId);assert.equal(f.batch.work,null);
});
