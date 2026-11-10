'use strict';
const closingError=()=>Object.assign(Error('Paddock is closing. Reopen it before retrying.'),{code:'APP_CLOSING'});
class WorkGate {
 constructor(){this.closing=false;this.tasks=new Set();this.stopListeners=new Set();}
 run(fn){
  if(this.closing)return Promise.reject(closingError());
  const job=Promise.resolve().then(fn);this.tasks.add(job);
  // Observe rejection without turning it into an unhandled cleanup promise.
  job.then(()=>this.tasks.delete(job),()=>this.tasks.delete(job));return job;
 }
 onStop(fn){if(this.closing)fn();else this.stopListeners.add(fn);return ()=>this.stopListeners.delete(fn);}
 stop(){if(this.closing)return;this.closing=true;for(const fn of this.stopListeners)fn();this.stopListeners.clear();}
 async idle(){while(this.tasks.size)await Promise.allSettled([...this.tasks]);}
}
function http(gate,handler,{drainTimeoutMs=10000}={}){return (req,res)=>{
 if(gate.closing){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close','Retry-After':'2'});res.end(JSON.stringify({error:'Paddock is closing. Retry when the host is available.',code:'HOST_CLOSING'}));req.resume();return;}
 const sent=new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);});
 void gate.run(async()=>{try{await handler(req,res);}catch{res.destroy();}finally{
  // Bound only delivery of a completed response. Never time out a handler:
  // a disconnected or slow reader must not interrupt an accepted write.
  let timer;const dispose=gate.onStop(()=>{if(!res.writableFinished&&!res.destroyed){timer=setTimeout(()=>res.destroy(),drainTimeoutMs);timer.unref?.();}});
  try{await sent;}finally{dispose();clearTimeout(timer);}
 }}).catch(()=>res.destroy());
};}
module.exports={WorkGate,http,closingError};
