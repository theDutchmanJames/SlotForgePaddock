'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const C=require('./catalogue-pictures-contract.cjs'),P=require('./catalogue-picture-requests.cjs'),L=C.limits;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),fault=(code,message)=>Object.assign(Error(message),{code});
const pinned=row=>require('./catalogue-picture-application.cjs').unresolved(row);
const locked=row=>{if(pinned(row))throw fault('SAVE_UNCONFIRMED','Check the saved outcome first. Pending or uncertain pictures cannot be changed or discarded.');};
const files=row=>[row.asset,row.thumbnail,row.currentThumbnail].filter(Boolean);
const rowFor=(job,id)=>{const row=job.rows.find(r=>r.itemId===id);if(!row)throw fault('UNKNOWN_ITEM','Unknown picture-request row.');return row;};
function cancellable(promise,signal){if(!signal)return promise;return new Promise((resolve,reject)=>{const abort=()=>reject(fault('DOWNLOAD_CANCELLED','Download stopped.'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});}
class PicturePreviews{
 constructor({profile,getStore,decode,download=require('./catalogue-picture-download.cjs').download,clock=Date.now,checkSpace=require('./storage-resources.cjs').requireSpace}){
  this.journal=new P.Journal(profile);this.folder=path.join(profile,'catalogue-picture-previews');fs.mkdirSync(this.folder,{recursive:true});this.getStore=getStore;this.decode=decode;this.download=download;this.clock=clock;this.checkSpace=checkSpace;this.running=new Map();this.urls=new Map();this.active=null;this.reserved=0;this.decodeTail=Promise.resolve();this.readTail=Promise.resolve();this.generation=0;this.closed=false;this.discarding=new Set();this.recover();
 }
 all(){return this.journal.use(db=>db.prepare('SELECT data FROM picture_jobs').all().map(x=>JSON.parse(x.data)));}
 job(id){return this.journal.use(db=>{const row=db.prepare('SELECT data FROM picture_jobs WHERE request_id=?').get(id);if(!row)throw fault('RESPONSE_NOT_FOUND','Import the returned picture JSON first.');return JSON.parse(row.data);});}
 save(job){const text=JSON.stringify(job);this.journal.use(db=>{db.exec('BEGIN IMMEDIATE');try{if(!db.prepare('SELECT id FROM requests WHERE id=?').get(job.requestId))throw fault('REQUEST_NOT_FOUND','The request is no longer available.');const total=db.prepare('SELECT COALESCE(sum(length(CAST(descriptor AS BLOB))),0) n FROM requests').get().n+db.prepare('SELECT COALESCE(sum(length(CAST(data AS BLOB))),0) n FROM picture_jobs WHERE request_id<>?').get(job.requestId).n;if(total+Buffer.byteLength(text)>L.journalBytes)throw fault('JOURNAL_FULL','Picture-request metadata is full. Discard an unused request before continuing.');db.prepare('INSERT INTO picture_jobs VALUES(?,?) ON CONFLICT(request_id) DO UPDATE SET data=excluded.data').run(job.requestId,text);db.prepare("UPDATE requests SET state='preview' WHERE id=?").run(job.requestId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}});}
 file(name){if(typeof name!=='string'||! /^[a-f0-9-]{36}\.(bin|thumb)$/.test(name))throw Error('Invalid preview file.');return path.join(this.folder,name);}
 exists(asset){try{const stat=fs.lstatSync(this.file(asset.name));return stat.isFile()&&stat.size===asset.size;}catch{return false;}}
 remove(asset){if(!asset)return;const file=this.file(asset.name);try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}for(const [url,item]of this.urls)if(item.name===asset.name)this.urls.delete(url);}
 forget(row){for(const asset of files(row))this.remove(asset);delete row.asset;delete row.thumbnail;delete row.currentThumbnail;delete row.assetHash;delete row.downloadedAt;delete row.currentPreviewNote;row.selected=false;}
 releaseCompleted(id){
  const job=this.job(id);let changed=false;const pending=new Map((job.cleanupFiles||[]).map(a=>[a.name,a]));
  for(const row of job.rows){
   // Only a durably acknowledged import may release its original. Pending,
   // uncertain and failed saves retain the evidence needed for safe retries.
   const acknowledged=['applied','unchanged'].includes(row.attempt?.status)&&row.attempt.receipt?.status===row.attempt.status;
   const alreadyStored=!row.attempt&&row.status==='unchanged'&&row.assetHash&&row.assetHash===row.currentHash;
   if(!acknowledged&&!alreadyStored)continue;
   if(!files(row).length)continue;
   for(const asset of files(row))pending.set(asset.name,asset);
   for(const key of ['asset','thumbnail','currentThumbnail','assetHash','downloadedAt','currentPreviewNote'])delete row[key];
   row.selected=false;row.error='';changed=true;
  }
  // Detach references before unlinking. Interrupted or locked-file cleanup is
  // retryable; it cannot turn a committed import into a failed save.
  if(changed){job.cleanupFiles=[...pending.values()];this.save(job);}
  if(!pending.size)return;
  const remaining=[];for(const asset of pending.values())try{this.remove(asset);}catch{remaining.push(asset);}
  if(remaining.length!==pending.size){job.cleanupFiles=remaining;this.save(job);}
 }
 cleanupCompleted(id){try{this.releaseCompleted(id);}catch{/* Keep the durable receipt and retry temporary-file cleanup later. */}}
 recover(){const referenced=new Set();for(const saved of this.all()){this.cleanupCompleted(saved.requestId);const job=this.job(saved.requestId);let changed=false;for(const row of job.rows){if(!row.attempt&&row.status==='download-failed'&&/^(Preview storage is full\.|Not enough free disk space for this preview\.)/.test(row.error||'')){row.status='needs-download';row.error='';changed=true;}if(row.status==='downloading'){row.status='needs-download';row.error='Interrupted download. Retry when ready.';changed=true;}if(row.asset&&!row.attempt&&(!files(row).every(a=>this.exists(a))||!row.selected&&this.clock()-(row.savedAt||0)>L.previewCacheHours*3600000)){this.forget(row);row.status=row.imageUrl?'needs-download':'no-image';changed=true;}for(const f of files(row))referenced.add(f.name);}for(const f of job.cleanupFiles||[])referenced.add(f.name);if(changed)this.save(job);}for(const name of fs.readdirSync(this.folder))if(/^[a-f0-9-]{36}\.(bin|thumb)$/.test(name)&&!referenced.has(name))try{this.remove({name});}catch{/* A locked orphan can be removed on the next start. */}}
 used(){let total=0;for(const name of fs.readdirSync(this.folder))if(/^[a-f0-9-]{36}\.(bin|thumb)$/.test(name)){const stat=fs.lstatSync(this.file(name));if(stat.isFile())total+=stat.size;}return total;}
 cleanup(){for(const saved of this.all()){this.cleanupCompleted(saved.requestId);const job=this.job(saved.requestId);if(job.requestId===this.active||this.running.has(job.requestId))continue;let changed=false;for(const row of job.rows)if(row.asset&&!row.attempt&&!row.selected&&this.clock()-(row.savedAt||0)>L.previewCacheHours*3600000){this.forget(row);row.status='needs-download';changed=true;}if(changed)this.save(job);}}
 activeIdentity(){return P.withReader(this.getStore(),(_r,a)=>a);}
 descriptor(id){return this.journal.get(id,this.activeIdentity());}
 idle(id){this.application?.assertIdle();if(this.discarding.has(id)||this.running.has(id))throw fault('DOWNLOAD_BUSY','Stop downloads before changing this preview.');}
 prepareImport(bytes,previous){const response=C.parse(bytes),active=this.activeIdentity(),descriptor=this.journal.get(response.requestId,active);C.validateResponse(response,descriptor,{databaseId:active.databaseId,recoveryId:active.recoveryId});this.idle(response.requestId);
  let job;try{job=this.job(response.requestId);}catch(error){if(error.code!=='RESPONSE_NOT_FOUND')throw error;job={version:1,requestId:response.requestId,rows:descriptor.request.items.map(r=>({itemId:r.itemId,status:'unreturned',imageUrl:'',imagePageUrl:'',notes:'',selected:false}))};}
  if(previous)job=structuredClone(previous);
  for(const row of response.items){const current=rowFor(job,row.itemId);if(current.status!=='unreturned'&&['imageUrl','imagePageUrl','notes'].some(k=>current[k]!==row[k]))throw fault('RESPONSE_CHANGED','This row already has a different response. Use Edit image links for URL corrections, or create a new request for revised research notes.');if(current.status==='unreturned')Object.assign(current,{imageUrl:row.imageUrl,imagePageUrl:row.imagePageUrl,notes:row.notes,status:row.imageUrl?'needs-download':'no-image'});}
  return job;
 }
 import(bytes){const job=this.prepareImport(bytes);this.save(job);this.active=job.requestId;return job.requestId;}
 async importAndDownload(bytes){
  if(this.closed)throw Error('Picture previews are closing.');
  if(this.running.size)throw fault('DOWNLOAD_BUSY','Finish or stop the current download batch before opening another picture file.');
  // Validate and persist the entire response before any supplied URL is fetched.
  // Only rows present in this file participate; reopening saved previews never starts work.
  const response=C.parse(bytes),id=this.import(bytes);
  await this.start(id,response.items.map(row=>row.itemId),{automatic:true});
  return this.view(id);
 }
 read(file,method,p,signal){const next=this.readTail.catch(()=>{}).then(()=>P.run(file,method,p,{signal}));this.readTail=next.catch(()=>{});return cancellable(next,signal);}
 async inspect(id){const descriptor=this.descriptor(id),store=this.getStore(),result=await this.read(store.file,'inspect',{journal:descriptor});P.identity(this.activeIdentity(),result.active);return {descriptor,result};}
 outcome(target,current){return C.compareTarget({version:1,databaseId:target.databaseId,recoveryId:target.recoveryId,kind:target.kind,recordId:target.recordId,operationId:'preview',expected:target.expected,action:'set',assetHash:'0'.repeat(64),replaceExisting:true,provenance:null},current);}
 async view(id){const {descriptor,result}=await this.inspect(id);this.active=id;this.cleanupCompleted(id);const job=this.job(id),observed=new Map(result.rows.map(r=>[r.itemId,r.current]));let changed=false;
  const rows=job.rows.map(row=>{if(row.status==='downloading'&&!this.running.has(id)){row.status='needs-download';row.error='Interrupted download. Retry when ready.';changed=true;}const product=descriptor.request.items.find(x=>x.itemId===row.itemId),target=descriptor.targets.find(x=>x.itemId===row.itemId),current=observed.get(row.itemId),conflict=this.outcome({...target,...result.active},current);if(row.selected&&(conflict!=='READY'||!row.thumbnail||!this.exists(row.thumbnail))){row.selected=false;changed=true;}const valid=row.asset&&files(row).every(a=>this.exists(a));if(row.asset&&!valid&&!pinned(row)){this.forget(row);row.status='needs-download';changed=true;}return {...product,imageUrl:row.imageUrl,imagePageUrl:row.imagePageUrl,notes:row.notes,status:row.attempt?.status|| (conflict==='READY'?row.status:'needs-attention'),conflict:row.attempt?'READY':conflict,locked:!!row.attempt,selected:row.selected,error:row.attempt?.error||row.error||'',currentPreviewNote:row.currentPreviewNote||'',hasCurrent:!!current?.pictureHash,attention:!product.reference.trim()||!!row.notes,thumbnail:valid&&row.thumbnail?this.url(row.thumbnail):null,currentThumbnail:valid&&row.currentThumbnail&&row.currentHash===current?.pictureHash?this.url(row.currentThumbnail):null};});if(changed)this.save(job);return {...result.active,requestId:id,manufacturer:descriptor.request.manufacturer,rows,running:this.running.has(id),applying:this.application?.work?.id===id,saveError:this.application?.error||'',downloadPause:job.downloadPause||null,stagingBytes:this.used(),stagingLimit:L.stagingBytes};
 }
 url(asset){for(const [url,a]of this.urls)if(a.name===asset.name)return url;const url='paddock-media://catalogue-preview/'+crypto.randomUUID();this.urls.set(url,asset);return url;}
 async response(url){const asset=this.urls.get(url);if(!asset||!this.exists(asset)||asset.size>L.thumbnailBytes)return null;const handle=await fs.promises.open(this.file(asset.name),'r');let bytes;try{bytes=Buffer.alloc(asset.size+1);let n=0;while(n<bytes.length){const r=await handle.read(bytes,n,bytes.length-n,null);if(!r.bytesRead)break;n+=r.bytesRead;}bytes=bytes.subarray(0,n);}finally{await handle.close();}if(bytes.length!==asset.size||hash(bytes)!==asset.hash)return null;return {bytes,mime:asset.mime};}
 async write(bytes,extension,mime){const asset={name:crypto.randomUUID()+'.'+extension,size:bytes.length,hash:hash(bytes),mime};const file=await fs.promises.open(this.file(asset.name),'wx');try{await file.writeFile(bytes);await file.sync();}catch(error){try{await file.close();await fs.promises.unlink(this.file(asset.name));}catch{}throw error;}finally{await file.close().catch(()=>{});}return asset;}
 serialDecode(picture,signal){const next=this.decodeTail.catch(()=>{}).then(()=>{if(signal.aborted)throw fault('DOWNLOAD_CANCELLED','Download stopped.');return this.decode(picture,{thumbnail:true,signal});});this.decodeTail=next.catch(()=>{});return cancellable(next,signal);}
 async start(id,itemIds,{automatic=false}={}){
  const generation=this.generation;
  const admit=()=>{if(this.closed||generation!==this.generation)throw fault('DOWNLOAD_CANCELLED','Download start was cancelled.');this.idle(id);if(this.running.size)throw fault('DOWNLOAD_BUSY','Finish or stop the current download batch first.');};
  admit();
  const {descriptor,result}=await this.inspect(id);
  admit();
  const job=this.job(id);
  if(!Array.isArray(itemIds)||(!automatic&&!itemIds.length)||itemIds.length>100||new Set(itemIds).size!==itemIds.length)throw Error('Choose up to 100 unique picture rows.');
  const selected=itemIds.map(key=>rowFor(job,key));
  // A saved preview whose files disappeared is not a reusable download. Keep
  // pending save evidence untouched; these rows must use receipt recovery.
  let repaired=false;
  if(automatic)for(const row of selected)if(row.asset&&!row.attempt&&!files(row).every(asset=>this.exists(asset))){this.forget(row);row.status='needs-download';repaired=true;}
  if(repaired)this.save(job);
  const currents=new Map(result.rows.map(x=>[x.itemId,x.current]));
  const eligible=selected.filter(row=>{const target=descriptor.targets.find(x=>x.itemId===row.itemId);return !row.attempt&&!!row.imageUrl&&!row.asset&&['needs-download','download-failed'].includes(row.status)&&this.outcome({...target,...result.active},currents.get(row.itemId))==='READY';});
  if(!automatic&&eligible.length!==selected.length)throw fault('NOT_DOWNLOADABLE','Only current rows with an image link and no downloaded preview can be downloaded.');
  itemIds=eligible.map(row=>row.itemId);
  if(!itemIds.length)return {started:0};
  this.idle(id);if(this.closed||generation!==this.generation)throw fault('DOWNLOAD_CANCELLED','Download start was cancelled.');if(this.running.size)throw fault('DOWNLOAD_BUSY','Finish or stop the current download batch first.');this.cleanup();
  const fresh=this.job(id);delete fresh.downloadPause;for(const key of itemIds){const row=rowFor(fresh,key);row.status='needs-download';row.error='';}this.save(fresh);
  const control=new AbortController(),work={control,promise:null};this.running.set(id,work);const queue=[...itemIds],file=this.getStore().file;
  work.promise=this.drain(id,queue,descriptor,file,control).finally(()=>this.running.delete(id));return {started:itemIds.length};
 }
 async drain(id,queue,descriptor,file,control){
  const inFlight=new Set(),reservation=L.sourcePhotoBytes+2*L.thumbnailBytes;
  const pause=(code,message)=>{const job=this.job(id);job.downloadPause={code,message,remaining:queue.length};this.save(job);};
  try{
   while(queue.length||inFlight.size){
    if(control.signal.aborted)break;
    let diskFull=false;
    while(queue.length&&inFlight.size<L.downloadConcurrency){
     if(this.used()+this.reserved+reservation>L.stagingBytes)break;
     try{this.checkSpace(this.folder,reservation+this.reserved);}catch{diskFull=true;break;}
     const task=this.one(id,queue.shift(),descriptor,file,control.signal).finally(()=>inFlight.delete(task));inFlight.add(task);
    }
    // Reservations are temporary: wait for a real completion, rather than
    // failing every queued item while another download holds the capacity.
    if(inFlight.size){await Promise.race(inFlight);continue;}
    if(queue.length){pause(diskFull?'DISK_FULL':'STAGING_FULL',diskFull?'Downloads paused: not enough free disk space. Free space, then resume downloads.':'Downloads paused: temporary picture storage is full. Import ready pictures or clear unwanted previews, then resume downloads. Pictures awaiting review or an uncertain save are kept safe.');break;}
   }
  }catch(error){control.abort();try{pause('QUEUE_ERROR','Downloads stopped: '+error.message);}catch{/* Retain row states if the journal itself is unavailable. */}}
  finally{await Promise.allSettled([...inFlight]);}
 }
 async one(id,itemId,descriptor,file,signal){
  const reservation=L.sourcePhotoBytes+2*L.thumbnailBytes;
  this.reserved+=reservation;const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();const timer=setTimeout(abort,L.itemTimeoutMs);const created=[];
  try{let job=this.job(id),row=rowFor(job,itemId);row.status='downloading';row.error='';row.selected=false;this.save(job);
   const target=descriptor.targets.find(t=>t.itemId===itemId),download=await this.download(row.imageUrl,{signal:controller.signal}),thumb=await this.serialDecode(download.picture,controller.signal);
   if(controller.signal.aborted)throw fault('DOWNLOAD_CANCELLED','Download stopped.');
   const inspected=await this.read(file,'inspect',{journal:descriptor},controller.signal);P.identity(this.activeIdentity(),inspected.active);if(this.getStore().file!==file)throw fault('COLLECTION_CHANGED','The active collection changed.');const current=inspected.rows.find(x=>x.itemId===itemId).current;
   if(this.outcome({...target,...inspected.active},current)!=='READY')throw fault('TARGET_CHANGED','The product or picture changed. Create a fresh request.');
   let currentThumb,currentPreviewNote='';if(current.pictureHash){try{const picture=await this.read(file,'previewSource',{expected:inspected.active,kind:target.kind,recordId:target.recordId,pictureHash:current.pictureHash},controller.signal);currentThumb=await this.serialDecode(picture,controller.signal);}catch{if(controller.signal.aborted)throw fault('DOWNLOAD_CANCELLED','Download stopped.');currentPreviewNote='Existing photograph preview unavailable within the image limits. The original is unchanged.';}}
   if(controller.signal.aborted)throw fault('DOWNLOAD_CANCELLED','Download stopped.');
   // This synchronous reservation covers all upcoming files until they exist.
   const source=await this.write(download.bytes,'bin',download.mime);created.push(source);const thumbnail=await this.write(Buffer.from(thumb.bytes),'thumb',thumb.mime);created.push(thumbnail);let currentThumbnail;if(currentThumb){currentThumbnail=await this.write(Buffer.from(currentThumb.bytes),'thumb',currentThumb.mime);created.push(currentThumbnail);}
   if(controller.signal.aborted)throw fault('DOWNLOAD_CANCELLED','Download stopped.');
   job=this.job(id);row=rowFor(job,itemId);const assetHash=require('./lazy-assets.cjs').digest(download.picture);Object.assign(row,{asset:source,thumbnail,...(currentThumbnail?{currentThumbnail}:{}),currentHash:current.pictureHash,currentPreviewNote,assetHash,downloadedAt:new Date(this.clock()).toISOString(),savedAt:this.clock(),status:assetHash===current.pictureHash?'unchanged':'ready',error:'',selected:false});this.save(job);
   if(row.status==='unchanged')this.cleanupCompleted(id);

  }catch(error){for(const asset of created)try{this.remove(asset);}catch{}try{const job=this.job(id),row=rowFor(job,itemId);row.status=controller.signal.aborted?'needs-download':'download-failed';row.error=controller.signal.aborted?'Download stopped or timed out. Retry when ready.':error.code==='TARGET_CHANGED'||error.code==='COLLECTION_CHANGED'?error.message:'Picture download failed: '+(error.code||'IMAGE_INVALID')+'. Check the link and image limits, then retry.';row.selected=false;this.save(job);}catch{/* Descriptor may have been explicitly discarded after shutdown. */}}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);this.reserved-=reservation;}
 }
 async cancel(id){this.generation++;const work=this.running.get(id);work?.control.abort();await work?.promise;return {stopped:true};}
 async stop(){this.generation++;await this.batches?.stop();await this.application?.stop();for(const work of this.running.values())work.control.abort();await Promise.allSettled([...this.running.values()].map(w=>w.promise));}
 async close(){this.closed=true;await this.stop();}
 async edit(id,itemId,imageUrl,imagePageUrl){this.idle(id);this.descriptor(id);C.link(imageUrl);C.link(imagePageUrl);const job=this.job(id),row=rowFor(job,itemId);locked(row);const old=files(row);delete row.attempt;for(const key of ['asset','thumbnail','currentThumbnail','assetHash','downloadedAt'])delete row[key];Object.assign(row,{imageUrl,imagePageUrl,selected:false,status:imageUrl?'needs-download':'no-image',error:''});this.save(job);for(const asset of old)this.remove(asset);return this.view(id);}
 async select(id,itemIds,bulk=false){this.idle(id);const view=await this.view(id);this.idle(id);const job=this.job(id);if(!Array.isArray(itemIds)||new Set(itemIds).size!==itemIds.length||itemIds.length>100)throw Error('Invalid picture selection.');const selected=new Set(itemIds);for(const key of selected){const row=view.rows.find(x=>x.itemId===key);if(!row||row.status!=='ready'||bulk&&!job.rows.find(r=>r.itemId===key)?.selected&&(row.hasCurrent||row.attention))throw fault('REVIEW_REQUIRED','Select existing-picture replacements and uncertain matches individually.');}for(const row of job.rows)row.selected=selected.has(row.itemId);this.save(job);return this.view(id);}
 async clear(id,itemId){this.idle(id);this.descriptor(id);const job=this.job(id),rows=itemId?[rowFor(job,itemId)]:job.rows.filter(r=>!r.selected&&!r.attempt),old=rows.flatMap(files);for(const row of rows){locked(row);if(row.attempt)throw Error('Keep the completed save record or discard the finished request.');}for(const row of rows){for(const key of ['asset','thumbnail','currentThumbnail','assetHash','downloadedAt'])delete row[key];row.selected=false;row.status=row.imageUrl?'needs-download':row.status==='unreturned'?'unreturned':'no-image';row.error='';}this.save(job);for(const asset of old)this.remove(asset);return this.view(id);}
 async discard(id,databaseId,updateJournal){this.application?.assertIdle();const existing=this.all().find(j=>j.requestId===id);for(const row of existing?.rows||[])locked(row);if(this.discarding.has(id))throw Error('Request is being discarded.');this.discarding.add(id);try{await this.cancel(id);const job=this.all().find(j=>j.requestId===id),old=job?[...job.rows.flatMap(files),...(job.cleanupFiles||[])]:[];this.journal.use(db=>{db.exec('BEGIN IMMEDIATE');try{const r=db.prepare("DELETE FROM requests WHERE id=? AND database_id=? AND state IN ('awaiting-response','preview')").run(id,databaseId);if(r.changes!==1)throw fault('REQUEST_BUSY','This request cannot be discarded.');db.prepare('DELETE FROM picture_jobs WHERE request_id=?').run(id);updateJournal?.(db);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}});for(const asset of old)this.remove(asset);return {discarded:true};}finally{this.discarding.delete(id);}}
 protectedFiles(){return fs.readdirSync(this.folder).filter(n=>/^[a-f0-9-]{36}\.(bin|thumb)$/.test(n)).map(n=>this.file(n));}
}
async function readResponse(file){const handle=await fs.promises.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>L.fileBytes)throw fault('FILE_TOO_LARGE','Choose a picture-response JSON file of at most 2 MiB.');const bytes=Buffer.alloc(L.fileBytes+1);let size=0;while(size<bytes.length){const result=await handle.read(bytes,size,bytes.length-size,null);if(!result.bytesRead)break;size+=result.bytesRead;}if(size>L.fileBytes)throw fault('FILE_TOO_LARGE','Picture-response JSON exceeds 2 MiB.');return bytes.subarray(0,size);}finally{await handle.close();}}
module.exports={PicturePreviews,readResponse};
