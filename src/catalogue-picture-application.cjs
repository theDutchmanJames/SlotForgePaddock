'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),C=require('./catalogue-pictures-contract.cjs'),A=require('./catalogue-picture-apply.cjs'),P=require('./catalogue-picture-requests.cjs');
const unresolved=row=>['uncertain','pending'].includes(row.attempt?.status);
const terminal=row=>['applied','unchanged','rejected'].includes(row.attempt?.status);
class PictureApplication{
 constructor(previews,club){this.previews=previews;this.club=club;this.work=null;previews.application=this;}
 assertIdle(){if(this.work)throw Error('Wait for the current picture saves to finish, or stop the remaining saves.');}
 mode(){return this.previews.getStore().data.club?'dealership':'local';}
 check(attempt){const p=this.previews;P.identity(p.activeIdentity(),attempt.intent);if(this.mode()!==attempt.mode)throw Error('The connection mode changed. Return to the original collection and connection to check this save.');}
 update(id,itemId,patch){const p=this.previews,job=p.job(id),row=job.rows.find(r=>r.itemId===itemId);Object.assign(row.attempt,patch);row.selected=false;p.save(job);return row.attempt;}
 async lookup(attempt){this.check(attempt);const i=attempt.intent;
  if(attempt.mode==='dealership')return this.club.lookupPicture(i);
  const result=await require('./domain-tasks.cjs').run(this.previews.getStore(),{kind:'receipt',command:A.command({intent:i})});
  this.check(attempt);return result?{status:'accepted',result:{...result.result,duplicate:true}}:{status:'absent'};
 }
 outcome(id,itemId,answer){
  if(answer.status==='accepted'){
   const a=this.previews.job(id).rows.find(r=>r.itemId===itemId).attempt,r=answer.result;C.shape(r,'receipt');
   if(r.operationId!==a.intent.operationId||r.requestHash!==C.digest(a.intent)||r.databaseId!==a.intent.databaseId||r.recoveryId!==a.intent.recoveryId||r.kind!==a.intent.kind||r.recordId!==a.intent.recordId||r.pictureHash!==a.intent.assetHash)throw Error('The picture save receipt does not match this operation.');
   this.update(id,itemId,{status:r.status,receipt:r,error:''});this.previews.cleanupCompleted(id);return true;
  }
  if(['pending','rejected'].includes(answer.status)){this.update(id,itemId,{status:answer.status,error:''});return true;}
  if(answer.status!=='absent')throw Error('The picture save response is not understood.');return false;
 }
 async reconcile(id){this.assertIdle();this.previews.idle(id);this.error='';const work={id,stopped:false,promise:null};this.work=work;
  work.promise=(async()=>{for(const row of this.previews.job(id).rows.filter(r=>r.attempt&&!terminal(r))){if(work.stopped)break;try{const answer=await this.lookup(row.attempt);if(!this.outcome(id,row.itemId,answer))this.update(id,row.itemId,{status:'failed',error:'No saved operation found. Retry this picture when ready.'});}catch(e){this.update(id,row.itemId,{error:e.message});}}})();
  try{await work.promise;}finally{this.work=null;}return this.previews.view(id);
 }
 async start(id,{retry=false}={}){
  const p=this.previews,generation=p.generation;this.assertIdle();p.idle(id);if(p.closed||p.running.size)throw Error('Finish downloads before saving pictures.');
  const {descriptor,result}=await p.inspect(id);this.assertIdle();p.idle(id);if(p.closed||p.generation!==generation)throw Error('Picture save was cancelled.');
  const job=p.job(id),rows=job.rows.filter(r=>retry?r.attempt&&!terminal(r):r.selected&&!r.attempt);if(!rows.length)throw Error(retry?'There are no unresolved picture saves to retry.':'Select pictures to apply first.');
  for(const row of rows)if(!row.attempt){const target=descriptor.targets.find(t=>t.itemId===row.itemId),current=result.rows.find(r=>r.itemId===row.itemId).current;
   if(row.status!=='ready'||!row.asset||p.outcome({...target,...result.active},current)!=='READY')throw Error('The selected product or photograph changed. Refresh the preview.');
   const intent={version:1,operationId:crypto.randomUUID(),databaseId:descriptor.request.databaseId,recoveryId:descriptor.request.recoveryId,kind:target.kind,recordId:target.recordId,expected:target.expected,action:'set',assetHash:row.assetHash,replaceExisting:!!target.expected.pictureHash,provenance:{requestId:id,itemId:row.itemId,imageUrl:row.imageUrl,imagePageUrl:row.imagePageUrl,downloadedAt:row.downloadedAt,sourceBytesHash:row.asset.hash}};
   C.validateIntent(intent);row.attempt={intent,mode:this.mode(),status:'uncertain',error:''};row.selected=false;
  }
  // Every identity is durable before the first dispatch, including rows left
  // unsent when Stop is pressed. Never rebase these intents on retry.
  p.save(job);this.error='';const work={id,stopped:false,promise:null};this.work=work;
  work.promise=(async()=>{for(const row of rows){if(work.stopped)break;await this.one(id,row.itemId);}})().catch(error=>{this.error='Picture progress could not be saved: '+error.message+'. Free storage and check saved outcomes before retrying.';}).finally(()=>{this.work=null;});return {started:rows.length};
 }
 async one(id,itemId){const p=this.previews;let dispatched=false;
  try{const row=p.job(id).rows.find(r=>r.itemId===itemId),a=row.attempt,prior=await this.lookup(a);if(this.outcome(id,itemId,prior))return;
   if(!row.asset||!p.exists(row.asset)||row.asset.size>C.limits.sourcePhotoBytes)throw Error('The staged original is missing. No save was found; create a new picture request.');
   const handle=await fs.promises.open(p.file(row.asset.name),'r');let bytes;try{const buffer=Buffer.alloc(row.asset.size+1);let n=0;while(n<buffer.length){const read=await handle.read(buffer,n,buffer.length-n,null);if(!read.bytesRead)break;n+=read.bytesRead;}bytes=buffer.subarray(0,n);}finally{await handle.close();}
   if(bytes.length!==row.asset.size||crypto.createHash('sha256').update(bytes).digest('hex')!==row.asset.hash)throw Error('The staged original changed. Nothing was saved.');
   const payload={intent:a.intent,picture:'data:'+row.asset.mime+';base64,'+bytes.toString('base64')};A.validate(payload);
   await p.serialDecode(payload.picture,new AbortController().signal);this.check(a);
   if(this.work?.stopped)return;
   this.update(id,itemId,{status:'uncertain',error:''});dispatched=true;
   const answer=a.mode==='dealership'?await this.club.submitPicture(payload):{status:'accepted',result:(await p.getStore().mutateAsync(A.action,payload,{snapshot:false,commandId:a.intent.operationId,databaseId:a.intent.databaseId,epoch:a.intent.recoveryId})).result};
   this.check(a);this.outcome(id,itemId,answer);
  }catch(e){
   // A failed dispatch can have committed. A readable absent receipt is the
   // only evidence permitting release; a lookup error keeps bytes pinned.
   try{const a=p.job(id).rows.find(r=>r.itemId===itemId).attempt;if(dispatched){const answer=await this.lookup(a);if(this.outcome(id,itemId,answer))return;}else if(unresolved({attempt:a})){const answer=await this.lookup(a);if(this.outcome(id,itemId,answer))return;}
    this.update(id,itemId,{status:'failed',error:e.message});
   }catch{this.update(id,itemId,{status:'uncertain',error:e.message+' Check saved outcomes before retrying or discarding.'});}
  }
 }
 async stop(){if(this.work){this.work.stopped=true;await this.work.promise;}}
}
module.exports={PictureApplication,unresolved,terminal};
