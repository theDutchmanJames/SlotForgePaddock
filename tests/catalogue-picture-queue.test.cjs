'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {Store}=require('../src/store.cjs'),P=require('../src/catalogue-picture-requests.cjs'),C=require('../src/catalogue-pictures-contract.cjs');
const {PicturePreviews}=require('../src/catalogue-picture-previews.cjs'),{PictureApplication}=require('../src/catalogue-picture-application.cjs');
const png=require('./support/thumbnail-images.cjs'),thumb=Buffer.from(png(24,16,80).split(',')[1],'base64');
// A valid, poorly compressible 512px PNG: real staging usage, not a mocked quota.
function largePng(seed){
 const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(zlib.crc32(b.subarray(4,-4)),b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(512);header.writeUInt32BE(512,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((512*4+1)*512);let state=seed;
 for(let y=0;y<512;y++)for(let x=1;x<=512*4;x++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[y*(512*4+1)+x]=state&255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

test('combined large catalogues automatically advance after confirmed imports with bounded staging',{timeout:300000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-combined-large-')),store=new Store(path.join(root,'library.sqlite')),profile=path.join(root,'profile');
 const {PictureBatches}=require('../src/catalogue-picture-batches.cjs'),images=new Map(),inputs=[];let service,batch,downloads=0,live=0,peak=0,peakBytes=0;
 const opts={profile,getStore:()=>store,decode:async()=>({bytes:thumb,mime:'image/png',width:24,height:16}),download:async url=>{peak=Math.max(peak,++live);try{await new Promise(r=>setTimeout(r,2));downloads++;const bytes=images.get(new URL(url).hostname);return {bytes,mime:'image/png',picture:'data:image/png;base64,'+bytes.toString('base64')};}finally{live--;}}};
 const open=()=>{service=new PicturePreviews(opts);new PictureApplication(service,null);batch=new PictureBatches(service);const write=service.write.bind(service);service.write=async(...a)=>{const result=await write(...a);peakBytes=Math.max(peakBytes,service.used());assert.ok(service.used()<=C.limits.stagingBytes);return result;};};open();
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 for(let n=0;n<3;n++){const manufacturer='Combined '+n,selected=[];images.set('brand'+n+'.example',largePng(7654321+n));for(let i=0;i<100;i++){const kind=i%10?'part':'supply',data={name:'Product '+i,maker:manufacturer,reference:'P'+i,quantity:0,...(kind==='part'?{category:'Motors & motor parts',partType:'Motor',tracking:'quantity'}:{category:'Cleaning & lubrication',partType:'Bearing oil',kind:'Consumable'})};selected.push({kind,id:store.mutate(kind+'.save',{revision:store.data.revision,data}).result});}
  const d=P.prepare(store,{expected:P.browse(store,{}),manufacturer,selected})[0];service.journal.save([d]);const r=structuredClone(d.request);r.items.forEach(x=>x.imageUrl='https://brand'+n+'.example/'+x.itemId);inputs.push({name:'brand-'+n+'.json',bytes:Buffer.from(JSON.stringify(r))});}
 let v=await batch.importFiles(inputs),id=v.requestId;await batch.work?.promise;v=await batch.view(id);assert.equal(v.files.length,3);assert.equal(v.rows.length,300);assert.equal(v.downloadPause.code,'STAGING_FULL');
 const firstDownloads=downloads;await service.close();open();assert.equal(downloads,firstDownloads);await batch.open(id);await batch.work?.promise;v=await batch.view(id);
 let rounds=0;
 while(v.rows.some(r=>r.status!=='applied')){
  assert.ok(++rounds<=8);assert.ok(v.rows.every(r=>r.status!=='download-failed'&&!r.selected));const ready=v.rows.filter(r=>r.status==='ready');assert.ok(ready.length);
  await batch.command('select',id,{itemIds:ready.map(r=>r.itemId)});await batch.command('apply',id);await batch.work?.promise;v=await batch.view(id);
  assert.equal(v.saveError,'');assert.ok(v.rows.every(r=>!r.selected),'continuation must never select or apply another picture');
 }
 assert.equal(downloads,300);assert.ok(peak<=2);assert.equal(v.remainingDownloads,0);assert.equal(service.used(),0);
 const reader=new (require('../src/sqlite-query.cjs').Reader)(store.file);try{for(const table of ['parts','supplies'])for(const item of store.data[table]){const record=reader.record(JSON.stringify([table,'id:'+item.id]));assert.equal(record.picture,'data:image/png;base64,'+images.get('brand'+item.maker.split(' ')[1]+'.example').toString('base64'));assert.equal(record.quantity,0);}}finally{reader.close();}
 t.diagnostic(JSON.stringify({combinedFiles:3,products:300,downloads,peakDownloads:peak,peakStagingMiB:peakBytes/1048576,confirmationRounds:rounds,finalStagingBytes:service.used()}));
});
test('three 100-product catalogues pause, import and resume without accumulated staging or lost originals',{timeout:240000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-large-catalogues-')),store=new Store(path.join(root,'library.sqlite')),profile=path.join(root,'profile');
 let service,application,downloads=0,live=0,peakLive=0,peakBytes=0;const batches=[],pictures=new Map();
 const opts={profile,getStore:()=>store,decode:async()=>({bytes:thumb,mime:'image/png',width:24,height:16}),download:async url=>{
  peakLive=Math.max(peakLive,++live);try{await new Promise(r=>setTimeout(r,2));downloads++;const bytes=pictures.get(new URL(url).hostname);return {bytes,mime:'image/png',picture:'data:image/png;base64,'+bytes.toString('base64')};}finally{live--;}
 }};
 const open=()=>{service=new PicturePreviews(opts);application=new PictureApplication(service,null);const write=service.write.bind(service);service.write=async(...args)=>{const result=await write(...args);peakBytes=Math.max(peakBytes,service.used());assert.ok(service.used()<=C.limits.stagingBytes);return result;};};
 t.after(async()=>{await service?.close();fs.rmSync(root,{recursive:true,force:true});});open();
 for(let brand=1;brand<=3;brand++){
  const maker='Brand '+brand,selected=[],bytes=largePng(brand*1234567),image='data:image/png;base64,'+bytes.toString('base64');pictures.set('brand'+brand+'.example',bytes);
  assert.ok(bytes.length>1024*1024);
  for(let n=0;n<100;n++){
   const kind=n%10===0?'supply':'part',data={name:'Product '+n,maker,reference:'REF-'+n,quantity:0,...(kind==='part'?{category:'Motors & motor parts',partType:'Motor',tracking:'quantity'}:{category:'Cleaning & lubrication',partType:'Bearing oil',kind:'Consumable'})};
   const id=store.mutate(kind+'.save',{revision:store.data.revision,data}).result;selected.push({kind,id});
  }
  const descriptor=P.prepare(store,{expected:P.browse(store,{}),manufacturer:maker,selected})[0];service.journal.save([descriptor]);
  const response=structuredClone(descriptor.request);response.items.forEach(r=>r.imageUrl='https://brand'+brand+'.example/'+r.itemId+'.png');const id=response.requestId;
  await service.importAndDownload(Buffer.from(JSON.stringify(response)));await service.running.get(id)?.promise;
  let view=await service.view(id);assert.equal(view.downloadPause.code,'STAGING_FULL');assert.ok(view.rows.some(r=>r.status==='ready'));assert.ok(view.rows.some(r=>r.status==='needs-download'));assert.ok(view.rows.every(r=>r.status!=='download-failed'));
  // A paused request is durable, and merely reopening it never fetches again.
  if(brand===2){const count=downloads;await service.close();open();view=await service.view(id);assert.equal(downloads,count);assert.equal(view.downloadPause.code,'STAGING_FULL');}
  let rounds=0;
  while(view.rows.some(r=>!['applied','unchanged'].includes(r.status))){
   assert.ok(++rounds<=3,'queue must make bounded progress');const ready=view.rows.filter(r=>r.status==='ready');assert.ok(ready.length);
   await service.select(id,ready.map(r=>r.itemId));await application.start(id);await application.work?.promise;
   assert.equal(application.error,'');assert.equal(service.used(),0,'confirmed pictures release all temporary copies immediately');
   view=await service.view(id);const remaining=view.rows.filter(r=>r.status==='needs-download');
   if(remaining.length){await service.start(id,remaining.map(r=>r.itemId));await service.running.get(id)?.promise;view=await service.view(id);assert.ok(view.rows.every(r=>r.status!=='download-failed'));}
  }
  assert.equal(view.rows.filter(r=>r.status==='applied').length,100);assert.equal(service.reserved,0);assert.equal(service.used(),0);batches.push({maker,selected,image,rounds});
 }
 assert.equal(downloads,300);assert.ok(peakLive<=2);assert.ok(peakBytes>40*1024*1024&&peakBytes<=C.limits.stagingBytes);
 await service.close();open();assert.equal(service.used(),0);
 const {Reader}=require('../src/sqlite-query.cjs'),reader=new Reader(store.file);
 try{for(const batch of batches)for(const {kind,id}of batch.selected){const record=reader.record(JSON.stringify([kind==='part'?'parts':'supplies','id:'+id]));assert.equal(record.picture,batch.image);assert.equal(record.quantity,0);assert.ok(record.pictureProvenance.sourceBytesHash);}}finally{reader.close();}
 t.diagnostic(JSON.stringify({catalogues:3,products:300,downloads,peakLive,peakStagingMiB:peakBytes/1048576,finalStagingBytes:service.used(),rounds:batches.map(b=>b.rounds)}));
});
