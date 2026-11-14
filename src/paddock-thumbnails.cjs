'use strict';
// Main-photo requests keep opaque media URLs. Only host-issued car/file/hash
// bindings can reach the shared cache; other images retain their private cache.
class PaddockThumbnails {
 constructor({open,getStore,available,encoder}){Object.assign(this,{open,getStore,available,encoder});this.handle=null;this.identity=null;this.opening=null;this.closed=false;this.epoch=0;this.foreground=0;this.warming=false;this.queue=new Set();}
 async library(){
  if(this.closed||!this.available())return null;const store=this.getStore(),identity=store.data.id+'\n'+store.file;
  if(this.handle&&identity===this.identity)return this.handle;
  if(this.opening){await this.opening;return this.library();}
  const epoch=this.epoch;
  this.opening=(async()=>{
   await this.handle?.close();this.handle=null;this.identity=null;
   const h=await this.open();try{const status=await h.status();if(this.closed||epoch!==this.epoch||identity!==this.getStore().data.id+'\n'+this.getStore().file||status.databaseId!==store.data.id||status.file!==store.file){await h.close();return null;}this.handle=h;this.identity=identity;return h;}catch(e){await h.close();throw e;}
  })();try{return await this.opening;}finally{this.opening=null;}
 }
 async get(entry){
  if(!this.available()||this.closed)return undefined;const store=this.getStore(),carIds=entry.mainPhotos?.get(store.file);if(!carIds?.size)return undefined;
  const epoch=this.epoch;this.foreground++;let h;
  try{h=await this.library();if(!h)return undefined;for(const carId of carIds){let value;try{value=await h.thumbnail({carId,expectedHash:entry.meta.hash});}catch(error){if(error.code==='CAR_NOT_FOUND')continue;throw error;}if(epoch!==this.epoch||!this.available())return undefined;if(value)return {mime:'image/png',bytes:Buffer.from(value.slice(22),'base64')};}return undefined;}
  catch(error){await this.discardFailed(h,error);return undefined;} // Fall back to this exact original's private preview.
  finally{this.foreground--;this.pump();}
 }
 async discardFailed(handle,error){if(handle&&this.handle===handle&&['LIBRARY_CLOSED','WRITE_UNCERTAIN'].includes(error.code)){this.handle=null;this.identity=null;await handle.close().catch(()=>{});}}
 warm(ids){if(this.closed||!this.available()||!this.encoder.ready)return;for(const id of ids){if(this.queue.size>=32)break;this.queue.add(id);}this.pump();}
 pump(){
  if(this.warming||this.foreground||!this.queue.size||this.closed)return;
  this.warming=true;setImmediate(async()=>{let h;try{if(!this.closed&&!this.foreground&&this.available()&&this.encoder.ready){const id=this.queue.values().next().value;this.queue.delete(id);h=await this.library();if(h)await h.thumbnail({carId:id});}}catch(error){await this.discardFailed(h,error);/* Preview failure never changes the outcome of a durable save. */}finally{this.warming=false;if(!this.available()||!this.encoder.ready)this.queue.clear();this.pump();}});
 }
 async reset(){this.epoch++;this.queue.clear();this.encoder.reset();await this.opening?.catch(()=>{});const h=this.handle;this.handle=null;this.identity=null;await h?.close();}
 async close(){this.closed=true;await this.reset();}
}
// Changed car IDs come from the committed write set, never a full-library scan.
function photoWrites(packed){const ids=[];for(const row of packed.records){if(row.bucket!=='["cars"]'||!row.identity.startsWith('id:'))continue;const refs=JSON.parse(row.json).refs;if(refs.some(r=>r.path.length===1&&r.path[0]==='picture'))ids.push(row.identity.slice(3));if(ids.length===32)break;}return ids;}
module.exports={PaddockThumbnails,photoWrites};
