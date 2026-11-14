'use strict';
// Pause LAN admission without stopping the independent local HTTP service or
// cancelling accepted writes. Track handlers, not long-lived response streams.
class HostIntake {
 constructor(){this.paused=false;this.tasks=new Set();}
 wrap(handler){return (req,res)=>{
  if(this.paused){res.writeHead(503,{'Content-Type':'application/json','Retry-After':'2','Connection':'close'});res.end(JSON.stringify({code:'HOST_MIGRATING',error:'The host is changing sharing mode. Keep pending deliveries and reconnect with the new address and password.'}));req.resume();return;}
  // Preserve the existing handler's start ordering (including stream setup).
  let task;try{task=Promise.resolve(handler(req,res));}catch(error){task=Promise.reject(error);}this.tasks.add(task);
  task.then(()=>this.tasks.delete(task),()=>this.tasks.delete(task));return task;
 };}
 async idle(){while(this.tasks.size)await Promise.allSettled([...this.tasks]);}
}
module.exports={HostIntake};
