'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PaddockThumbnails,photoWrites}=require('../src/paddock-thumbnails.cjs'),{SharedThumbnailEncoder}=require('../src/shared-thumbnail-encoder.cjs');
const tick=()=>new Promise(r=>setImmediate(r)),png='data:image/png;base64,YWJj';
function controller(t,overrides={}){
 const store={data:{id:'db'},file:'canonical.sqlite'},calls=[],encoder={ready:true,reset(){this.ready=false;}},handle={status:async()=>({databaseId:'db',file:'canonical.sqlite'}),thumbnail:async input=>{calls.push(input);return png;},close:async()=>{}};
 const c=new PaddockThumbnails({getStore:()=>store,available:()=>true,encoder,open:async()=>handle,...overrides});t.after(()=>c.close());return {c,store,handle,calls,encoder,entry:{mainPhotos:new Map([['canonical.sqlite',new Set(['car'])]]),meta:{hash:'a'.repeat(64)}}};
}
test('only canonical main-photo bindings use shared previews; opaque photo hashes stay exact',async t=>{
 const {c,calls,entry}=controller(t);assert.equal(await c.get({meta:{}}),undefined);assert.equal(await c.get({...entry,mainPhotos:new Map([['remote.sqlite',new Set(['car'])]])}),undefined);
 assert.deepEqual(await c.get(entry),{mime:'image/png',bytes:Buffer.from('abc')});assert.deepEqual(calls,[{carId:'car',expectedHash:'a'.repeat(64)}]);
});
test('shared photographs remain usable after one bound car changes or disappears; failures fall back safely',async t=>{
 const {c,handle,entry}=controller(t);entry.mainPhotos.get('canonical.sqlite').add('second');
 handle.thumbnail=async({carId})=>{if(carId==='car')throw Object.assign(Error('Removed'),{code:'CAR_NOT_FOUND'});return png;};assert.equal((await c.get(entry)).mime,'image/png');
 handle.thumbnail=async()=>null;assert.equal(await c.get(entry),undefined);
 handle.thumbnail=async()=>{throw Error('Damaged cache');};assert.equal(await c.get(entry),undefined);
});
test('background work is bounded, defers to foreground work and cannot fail a save',async t=>{
 const {c,calls,handle}=controller(t);c.foreground=1;c.warm(Array.from({length:80},(_,i)=>'c'+i));await tick();assert.equal(c.queue.size,32);assert.equal(calls.length,0);
 handle.thumbnail=async input=>{calls.push(input);throw Error('Encoder failed');};c.foreground=0;c.pump();for(let i=0;i<80&&c.queue.size;i++)await tick();assert.equal(calls.length,32);assert.equal(c.queue.size,0);
});
test('opening is coalesced; collection changes close the old handle and invalidate in-flight replies',async t=>{
 let opened=0,closed=0,finish;const {c,store,entry,handle}=controller(t);c.open=async()=>{opened++;return {...handle,status:async()=>({databaseId:store.data.id,file:store.file}),close:async()=>{closed++;}};};
 await Promise.all([c.get(entry),c.get(entry)]);assert.equal(opened,1);store.data.id='other';await c.get(entry);assert.equal(opened,2);assert.equal(closed,1);
 c.handle.thumbnail=()=>new Promise(r=>{finish=r;});const request=c.get(entry);await tick();await c.reset();finish(png);assert.equal(await request,undefined);assert.equal(c.handle,null);
});
test('closing while opening never retains a worker or accepts a wrong database',async t=>{
 let release,closed=0;const {c,handle}=controller(t);c.open=()=>new Promise(r=>{release=r;});const pending=c.library();await tick();const ending=c.close();release({...handle,close:async()=>closed++});await pending;await ending;assert.equal(closed,1);assert.equal(c.handle,null);
 const other=controller(t);other.handle.status=async()=>({databaseId:'wrong',file:'canonical.sqlite'});assert.equal(await other.c.get(other.entry),undefined);
});
test('a dead shared worker is discarded so the next preview can reopen it',async t=>{
 const {c,entry,handle}=controller(t);let opens=0,closes=0;c.open=async()=>{opens++;return {...handle,close:async()=>{closes++;},thumbnail:opens===1?async()=>{throw Object.assign(Error('Worker stopped'),{code:'LIBRARY_CLOSED'});}:handle.thumbnail};};
 assert.equal(await c.get(entry),undefined);assert.equal(closes,1);assert.equal(c.handle,null);assert.equal((await c.get(entry)).mime,'image/png');assert.equal(opens,2);
});
test('encoder accepts only the owning main frame, queues until ready, and ignores late reset replies',async()=>{
 const sent=[],frame={url:'file:///app.html'},contents={mainFrame:frame,isDestroyed:()=>false,send:(_name,job)=>sent.push(job)},win={isDestroyed:()=>false,webContents:contents};
 const e=new SharedThumbnailEncoder({getWindow:()=>win,url:frame.url}),event={sender:contents,senderFrame:frame};
 const p=e.encode('original');e.markReady({...event,senderFrame:{url:frame.url}});assert.equal(sent.length,0);e.markReady(event);assert.equal(sent.length,1);
 e.receive({...event,senderFrame:{url:frame.url}},sent[0].id,png);assert.equal(e.pending.size,1);e.receive(event,sent[0].id,png);assert.equal(await p,png);
 const next=e.encode('new');const rejected=assert.rejects(next,/interrupted/);e.reset();e.receive(event,sent[1].id,png);await rejected;assert.equal(e.pending.size,0);assert.equal(e.ready,false);
 const restart=e.encode('retry');e.markReady(event);e.receive(event,sent[2].id,png);assert.equal(await restart,png);
});
test('encoder times out missing replies and rejects excess pending work',async()=>{
 const e=new SharedThumbnailEncoder({getWindow:()=>null,url:'unused',timeout:15}),keepAlive=setTimeout(()=>{},1000);
 try{const pending=Array.from({length:32},()=>e.encode('source'));const settled=Promise.allSettled(pending);await assert.rejects(e.encode('overflow'),/busy/);assert((await settled).every(r=>r.status==='rejected'&&/timed out/.test(r.reason.message)));assert.equal(e.pending.size,0);}finally{clearTimeout(keepAlive);e.reset();}
});
test('renderer worker recovers once from a crash and ignores stale failure events',()=>{
 const workers=[],calls=[];class Worker{constructor(file){this.file=file;workers.push(this);}terminate(){this.terminated=true;}postMessage(){}}
 const slotforge={onAssemblyPhoto(){},onAssemblyPhotoCancel(){},assemblyPhotoResult(){},onThumbnail(){},thumbnailResult(){},onSharedThumbnail(fn){this.receive=fn;},sharedThumbnailResult(){},sharedThumbnailReady(){calls.push('ready');},sharedThumbnailFailed(){calls.push('failed');},mediaLease(){}};
 require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/media-lifecycle.js'),'utf8'),{Worker,window:{slotforge},document:{body:{}},MutationObserver:class{observe(){}}});
 const first=workers[1];first.onerror();assert(first.terminated);assert.equal(workers.length,3);assert.deepEqual(calls,['ready','failed','ready']);first.onmessageerror();assert.equal(workers[2].terminated,undefined);
 workers[2].onerror();assert.equal(workers.length,3);assert.deepEqual(calls,['ready','failed','ready','failed']);
});
test('committed photo write hints and lazy renderer bindings do not load or change originals',async t=>{
 const {Store}=require('../src/store.cjs'),{RendererMedia}=require('../src/renderer-media.cjs'),lazy=require('../src/lazy-assets.cjs');
 const dir=fs.mkdtempSync(path.join(__dirname,'../.qa/photo-writes-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));
 const original='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
 const id=s.mutate('car.save',{data:{name:'Photo car',picture:original}}).result;assert.deepEqual(s.photoPreviewWrites,{revision:s.data.revision,ids:[id]});
 const saved=s.photoPreviewWrites;assert.throws(()=>s.mutate('car.save',{id,revision:-1,data:{picture:''}}));assert.equal(s.photoPreviewWrites,saved);
 const reopened=new Store(s.file,{deferred:true}),media=new RendererMedia();lazy.clearCache();const car=require('../src/sqlite-query.cjs').read(reopened,undefined,r=>r.one('cars',id)).value;
 const projected=media.project({cars:[car]});const entry=media.lookup(projected.cars[0].picture).entry;assert(entry.mainPhotos.get(s.file).has(id));assert.equal(lazy.stats().reads,0);
 const custom=media.project({custom:{cars:[{id:'fake',picture:original}]}});assert.equal(custom.custom.cars[0].picture,original);assert(!entry.mainPhotos.get(s.file).has('fake'));
 await s.mutateAsync('car.save',{id,revision:s.data.cars[0].revision,data:{picture:''}},{snapshot:false});assert.deepEqual(s.photoPreviewWrites.ids,[]);
 assert.deepEqual(photoWrites({records:[{bucket:'["photos"]',identity:'id:x',json:'{}'}]}),[]);
});

test('background command and Portal saves publish committed photo IDs, while rejected writes publish none',async t=>{
 const {Store}=require('../src/store.cjs'),tasks=require('../src/domain-tasks.cjs'),{randomUUID}=require('node:crypto');const dir=fs.mkdtempSync(path.join(__dirname,'../.qa/photo-worker-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.sqlite'));
 const picture='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');let notices=[];s.subscribe(()=>notices.push(s.photoPreviewWrites));
 const created=await s.mutateAsync('car.save',{data:{name:'Worker car',picture}},{commandId:randomUUID(),snapshot:false});assert.deepEqual(s.photoPreviewWrites.ids,[created.result]);assert.equal(s.photoPreviewWrites.revision,s.data.revision);
 const count=notices.length;await assert.rejects(s.mutateAsync('car.save',{id:created.result,revision:-1,data:{picture:''}},{commandId:randomUUID(),snapshot:false}));assert.equal(notices.length,count);
 const portal=await tasks.run(s,{kind:'portal-create',input:{operationId:randomUUID(),manufacturer:'NSR',model:'Portal car',picture},expected:{databaseId:s.data.id,recoveryId:s.deferredState.token.epoch}});assert.deepEqual(s.photoPreviewWrites.ids,[portal.carId]);assert.equal(notices.at(-1).revision,s.data.revision);
});
