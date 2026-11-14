'use strict';
// UI orchestration only. Original request identities, receipts, image validation
// and collection writes continue to belong to the existing preview/application services.
const path=require('node:path'),C=require('./catalogue-pictures-contract.cjs'),P=require('./catalogue-picture-requests.cjs');
const fault=(code,message)=>Object.assign(Error(message),{code});
const key=(id,itemId)=>id+':'+itemId;
class PictureBatches{
 constructor(previews){this.p=previews;previews.batches=this;this.work=null;}
 resolve(id){return this.p.all().find(j=>j.batch?.members.some(m=>m.id===id))?.requestId||id;}
 state(id){return this.p.job(this.resolve(id)).batch;}
 update(id,fn){const job=this.p.job(id);fn(job.batch);this.p.save(job);}
 idle(){if(this.work||this.p.running.size||this.p.application?.work)throw fault('BATCH_BUSY','Finish or stop the current picture work first.');if(this.p.closed)throw Error('Picture previews are closing.');}
 async importFiles(inputs){
  this.idle();if(!Array.isArray(inputs)||!inputs.length||inputs.length>C.limits.activeRequests)throw Error('Choose between 1 and '+C.limits.activeRequests+' picture JSON files.');
  // All files are validated before one journal change or network request. A bad
  // filename is included in the error; corrected files can be selected again safely.
  if(inputs.reduce((n,i)=>n+i.bytes.length,0)>C.limits.journalBytes)throw Error('Selected picture JSON files exceed the 16 MiB metadata budget. Choose fewer files.');
  const jobs=new Map(),members=new Map(),queue=new Map(),notices=[],seen=new Set();
  const addQueue=(id,itemId)=>queue.set(key(id,itemId),{requestId:id,itemId});
  for(const input of inputs){const name=path.basename(input.name||'Picture JSON');try{
   const response=C.parse(input.bytes),id=response.requestId;
   const old=this.p.all().find(j=>j.batch?.members.some(m=>m.id===id));
   if(old&&!seen.has(old.requestId)){seen.add(old.requestId);for(const m of old.batch.members){const job=this.p.job(m.id);delete job.batch;jobs.set(m.id,job);members.set(m.id,m);}for(const q of old.batch.queue)addQueue(q.requestId,q.itemId);}
   const repeated=members.has(id),job=this.p.prepareImport(input.bytes,jobs.get(id));delete job.batch;jobs.set(id,job);
   if(!members.has(id))members.set(id,{id,name});else if(repeated)notices.push(name+': existing request reused; no duplicate products added.');
   for(const row of response.items){const r=job.rows.find(x=>x.itemId===row.itemId);if(!r.attempt&&r.imageUrl&&(!r.asset||![r.asset,r.thumbnail,r.currentThumbnail].filter(Boolean).every(a=>this.p.exists(a)))&&['needs-download','download-failed','ready'].includes(r.status))addQueue(id,r.itemId);}
  }catch(e){throw fault(e.code||'INVALID_FILE',name+': '+e.message);}}
  for(const id of members.keys())this.p.descriptor(id);
  const lead=members.keys().next().value;
  jobs.get(lead).batch={version:1,members:[...members.values()],queue:[...queue.values()],auto:true,pause:null,error:'',notices};
  // One transaction: invalid inputs and metadata exhaustion cannot leave half a batch.
  this.p.journal.use(db=>{db.exec('BEGIN IMMEDIATE');try{
   const current=new Map(db.prepare('SELECT request_id,data FROM picture_jobs').all().map(r=>[r.request_id,r.data]));for(const [id,j]of jobs)current.set(id,JSON.stringify(j));
   const size=db.prepare('SELECT COALESCE(sum(length(CAST(descriptor AS BLOB))),0) n FROM requests').get().n+[...current.values()].reduce((n,t)=>n+Buffer.byteLength(t),0);
   if(size>C.limits.journalBytes)throw fault('JOURNAL_FULL','Picture-request metadata is full. Discard an unused request before continuing.');
   for(const [id,j]of jobs){db.prepare('INSERT INTO picture_jobs VALUES(?,?) ON CONFLICT(request_id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(j));db.prepare("UPDATE requests SET state='preview' WHERE id=?").run(id);}db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}});
  this.launch(lead,'download',w=>this.drain(lead,w));return this.view(lead);
 }
 launch(id,phase,fn){this.idle();const identity=this.p.activeIdentity(),file=this.p.getStore().file,work={id,phase,stopped:false,promise:null};this.work=work;
  work.check=()=>{if(work.stopped||this.p.closed)throw fault('BATCH_STOPPED','Picture work stopped.');P.identity(this.p.activeIdentity(),identity);if(this.p.getStore().file!==file)throw fault('COLLECTION_CHANGED','The active collection changed.');};
  work.promise=Promise.resolve().then(()=>{work.check();return fn(work);}).catch(e=>{if(!work.stopped)try{this.update(id,b=>{b.error=e.message;b.pause={code:e.code||'BATCH_ERROR',message:e.message};});}catch{/* Existing durable row receipts remain authoritative. */}}).finally(()=>{if(this.work===work)this.work=null;});return {started:true};
 }
 async drain(id,w){
  w.phase='download';
  while(!w.stopped){w.check();const state=this.state(id);if(!state.auto||!state.queue.length)return;
   const next=state.queue[0].requestId,keys=state.queue.filter(q=>q.requestId===next).map(q=>q.itemId);
   const started=await this.p.start(next,keys,{automatic:true});await this.p.running.get(next)?.promise;if(w.stopped)return;w.check();
   if(!started.started){this.update(id,b=>{b.queue=b.queue.filter(q=>q.requestId!==next);b.pause=null;});continue;}
   const job=this.p.job(next),waiting=new Set(job.rows.filter(r=>!r.attempt&&!r.asset&&r.status==='needs-download').map(r=>r.itemId));
   this.update(id,b=>{b.queue=b.queue.filter(q=>q.requestId!==next||waiting.has(q.itemId));b.pause=job.downloadPause||null;});
   if(job.downloadPause)return;
   // No retry storm for failed URLs, changed targets or an interrupted decoder.
   this.update(id,b=>{b.queue=b.queue.filter(q=>q.requestId!==next);});
  }
 }
 async open(id){id=this.resolve(id);const b=this.state(id);if(b?.auto&&b.queue.length&&!this.work&&!this.p.running.size&&!this.p.application?.work)this.launch(id,'download',w=>this.drain(id,w));return this.view(id);}
 async view(id){id=this.resolve(id);const b=this.state(id);if(!b)return this.p.view(id);
  const views=[];for(const m of b.members){const v=await this.p.view(m.id);if(views.length)P.identity(views[0],v);views.push(v);}
  const fresh=this.state(id),work=this.work?.id===id?this.work:null;
  return {...views[0],requestId:id,manufacturer:b.members.length===1?views[0].manufacturer:'Combined import',files:b.members,notices:fresh.notices,
   rows:views.flatMap((v,i)=>v.rows.map(r=>({...r,itemId:key(v.requestId,r.itemId),sourceFile:b.members[i].name}))),
   running:work?.phase==='download'||views.some(v=>v.running),applying:work?.phase==='apply'||views.some(v=>v.applying),
   saveError:fresh.error||views.find(v=>v.saveError)?.saveError||'',remainingDownloads:fresh.queue.length,
   downloadPause:fresh.pause?{...fresh.pause,remaining:fresh.queue.length}:null,stagingBytes:this.p.used()};
 }
 route(id,keys){const b=this.state(id),result=new Map(b.members.map(m=>[m.id,[]]));if(!Array.isArray(keys)||keys.length>100*C.limits.activeRequests||new Set(keys).size!==keys.length)throw Error('Invalid picture selection.');
  const rows=new Map();for(const m of b.members)for(const r of this.p.job(m.id).rows)rows.set(key(m.id,r.itemId),{id:m.id,itemId:r.itemId});
  for(const k of keys){const row=rows.get(k);if(!row)throw Error('Unknown picture-request row.');result.get(row.id).push(row.itemId);}return result;
 }
 async command(method,id,p={}){
  id=this.resolve(id);const b=this.state(id);if(!b)return this.single(method,id,p);
  if(method==='open')return this.open(id);if(method==='status')return this.view(id);
  if(['cancel','stop-save'].includes(method)){if(this.work&&this.work.id!==id)throw fault('BATCH_BUSY','Another picture batch is active.');await this.stop(true);return {stopped:true};}
  if(method==='close'){this.p.active=null;return {closed:true};}
  this.idle();this.p.application?.assertIdle();for(const m of b.members)this.p.descriptor(m.id);
  if(method==='download'){const groups=this.route(id,p.itemIds);this.update(id,s=>{const q=new Map(s.queue.map(q=>[key(q.requestId,q.itemId),q]));for(const [rid,ids]of groups)for(const itemId of ids)q.set(key(rid,itemId),{requestId:rid,itemId});s.queue=[...q.values()];s.auto=true;s.pause=null;s.error='';});return this.launch(id,'download',w=>this.drain(id,w));}
  if(['apply','retry-save','reconcile'].includes(method)){
   // Capture exactly this confirmation's selection before any background work.
   const targets=b.members.filter(m=>this.p.job(m.id).rows.some(r=>method==='apply'?r.selected&&!r.attempt:r.attempt&&!['applied','unchanged','rejected'].includes(r.attempt.status)));
   if(!targets.length&&method!=='reconcile')throw Error('Select pictures to import first.');
   this.update(id,s=>{s.error='';});this.p.application.error='';
   return this.launch(id,'apply',async w=>{for(const m of targets){w.check();if(method==='reconcile')await this.p.application.reconcile(m.id);else{await this.p.application.start(m.id,{retry:method==='retry-save'});await this.p.application.work?.promise;}if(w.stopped)return;if(this.p.application.error)throw Error(this.p.application.error);}
    w.check();await this.drain(id,w);
   });
  }
  // The same lock covers async inspection, so a second IPC cannot start a batch
  // between selecting its first and last file.
  const work={id,phase:'editing',stopped:false,promise:null};this.work=work;
  work.promise=(async()=>{
   if(method==='select'){const groups=this.route(id,p.itemIds),v=await this.view(id);for(const k of p.itemIds){const r=v.rows.find(r=>r.itemId===k);if(r.status!=='ready'||p.bulk&&!r.selected&&(r.hasCurrent||r.attention))throw Error('Review replacements and uncertain matches before selecting.');}for(const [rid,keys]of groups){if(work.stopped)break;await this.p.select(rid,keys,p.bulk===true);}}
   else if(method==='edit'||method==='clear'){const groups=this.route(id,p.itemId?[p.itemId]:[]);for(const [rid,keys]of groups){if(work.stopped)break;if(method==='edit'&&keys.length)await this.p.edit(rid,keys[0],p.imageUrl,p.imagePageUrl);if(method==='clear'&&(!p.itemId||keys.length))await this.p.clear(rid,keys[0]);}}
   else throw Error('Unknown picture batch action.');
  })();try{await work.promise;}finally{if(this.work===work)this.work=null;}return this.view(id);
 }
 async single(method,id,p){const service=this.p;if(!['open','status','close'].includes(method)&&this.work)throw fault('BATCH_BUSY','Finish or stop the combined import first.');
  if(method==='open'||method==='status')return service.view(id);
  if(method==='apply'||method==='retry-save')return service.application.start(id,{retry:method==='retry-save'});
  if(method==='reconcile')return service.application.reconcile(id);
  if(method==='stop-save')return service.application.stop().then(()=>({stopped:true}));
  if(method==='download')return service.start(id,p.itemIds);
  if(method==='cancel')return service.cancel(id);
  if(method==='select')return service.select(id,p.itemIds,p.bulk===true);
  if(method==='edit')return service.edit(id,p.itemId,p.imageUrl,p.imagePageUrl);
  if(method==='clear')return service.clear(id,p.itemId);
  if(method==='close'){service.active=null;return {closed:true};}
  throw Error('Unknown picture preview action.');
 }
 async stop(disable=false){const w=this.work;let failure;if(w){w.stopped=true;try{if(disable&&this.p.all().find(j=>j.requestId===w.id)?.batch)this.update(w.id,b=>{b.auto=false;});}catch(e){failure=e;}}this.p.generation++;for(const id of this.p.running.keys())await this.p.cancel(id);await this.p.application?.stop();await w?.promise?.catch(()=>{});if(failure)throw Error('Downloads stopped, but the stop preference could not be saved: '+failure.message);}
 async discard(id,databaseId){this.idle();const lead=this.resolve(id),b=this.p.all().find(j=>j.requestId===lead)?.batch;
  const work={id:lead,phase:'editing',stopped:false,promise:null};this.work=work;
  work.promise=this.p.discard(id,databaseId,b?db=>{
   const next={...b,members:b.members.filter(m=>m.id!==id),queue:b.queue.filter(q=>q.requestId!==id)};
   if(!next.members.length)return;
   const anchor=id===lead?next.members[0].id:lead,row=db.prepare('SELECT data FROM picture_jobs WHERE request_id=?').get(anchor);
   if(!row)throw Error('A saved combined request is missing.');const job=JSON.parse(row.data);job.batch=next;
   db.prepare('UPDATE picture_jobs SET data=? WHERE request_id=?').run(JSON.stringify(job),anchor);
  }:undefined);try{return await work.promise;}finally{if(this.work===work)this.work=null;}
 }
}
module.exports={PictureBatches};
