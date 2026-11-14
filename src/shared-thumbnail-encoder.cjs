'use strict';
const {randomUUID}=require('node:crypto');
// Renderer replies are accepted only from the current window's main frame.
class SharedThumbnailEncoder {
 constructor({getWindow,url,timeout=20000}){this.getWindow=getWindow;this.url=url;this.timeout=timeout;this.pending=new Map();this.ready=false;}
 owns(event){const win=this.getWindow();return !!(win&&!win.isDestroyed()&&!event.sender.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame?.url===this.url);}
 markReady(event){if(!this.owns(event))return;this.ready=true;for(const job of this.pending.values())this.send(job);}
 send(job){if(!this.ready||job.sent)return;const win=this.getWindow();if(!win||win.isDestroyed())return;job.sent=true;try{win.webContents.send('sf:shared-thumbnail',{id:job.id,source:job.source});job.source=null;}catch(error){this.finish(job,error);}}
 encode(source){return new Promise((resolve,reject)=>{
  if(this.pending.size>=32)return reject(Error('Photo preview worker is busy.'));
  const job={id:randomUUID(),source,resolve,reject};job.timer=setTimeout(()=>this.finish(job,Error('Photo preview generation timed out.')),this.timeout);job.timer.unref?.();this.pending.set(job.id,job);this.send(job);
 });}
 finish(job,error,data){if(!this.pending.delete(job.id))return;clearTimeout(job.timer);job.source=null;if(error)job.reject(error);else job.resolve(data);}
 receive(event,id,data){if(!this.owns(event))return;const job=this.pending.get(id);if(!job||!job.sent)return;this.finish(job,typeof data==='string'?null:Error('Photo preview could not be generated.'),data);}
 reset(){this.ready=false;for(const job of this.pending.values())this.finish(job,Error('Photo preview worker was interrupted.'));}
}
module.exports={SharedThumbnailEncoder};
