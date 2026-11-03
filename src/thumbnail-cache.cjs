'use strict';
const {randomUUID}=require('node:crypto');
class ThumbnailCache {
 constructor(send,load,{limit=16*1024*1024,timeout=15000}={}){this.send=send;this.load=load;this.limit=limit;this.timeout=timeout;this.cache=new Map();this.pending=new Map();this.active=new Map();this.queue=[];this.bytes=0;this.generation=0;}
 get(key,url){if(this.cache.has(key)){const v=this.cache.get(key);this.cache.delete(key);this.cache.set(key,v);return Promise.resolve(v);}if(this.pending.has(key))return this.pending.get(key).promise;if(this.queue.length>=64)return Promise.resolve(null);let resolve;const promise=new Promise(r=>resolve=r),job={id:randomUUID(),key,url,promise,resolve,generation:this.generation};this.pending.set(key,job);this.queue.push(job);this.pump();return promise;}
 pump(){while(this.active.size<2&&this.queue.length){const job=this.queue.shift();this.active.set(job.id,job);job.timer=setTimeout(()=>this.finish(job,null),this.timeout);job.timer.unref?.();this.load(job.url).then(image=>{if(this.active.has(job.id)&&image)this.send({id:job.id,bytes:image.bytes,mime:image.mime});else this.finish(job,null);}).catch(()=>this.finish(job,null));}}
 receive(id,result){const job=this.active.get(id);if(!job)return;const valid=result&&['image/png','image/jpeg'].includes(result.mime)&&result.bytes instanceof Uint8Array&&result.bytes.length>0&&result.bytes.length<=4*1024*1024;this.finish(job,valid?{mime:result.mime,bytes:Buffer.from(result.bytes)}:null);}
 finish(job,value){if(!this.active.delete(job.id))return;clearTimeout(job.timer);this.pending.delete(job.key);if(value&&job.generation===this.generation&&value.bytes.length<=this.limit){while(this.bytes+value.bytes.length>this.limit&&this.cache.size){const key=this.cache.keys().next().value;this.bytes-=this.cache.get(key).bytes.length;this.cache.delete(key);}this.cache.set(job.key,value);this.bytes+=value.bytes.length;}job.resolve(value);this.pump();}
 clear(){this.generation++;for(const job of this.pending.values()){clearTimeout(job.timer);job.resolve(null);}this.pending.clear();this.active.clear();this.queue=[];this.cache.clear();this.bytes=0;}
}
module.exports={ThumbnailCache};
