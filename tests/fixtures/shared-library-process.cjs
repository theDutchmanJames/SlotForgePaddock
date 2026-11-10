'use strict';
const {open}=require('../../packages/shared-library/index.cjs');
let library,queue=Promise.resolve();
process.on('message',message=>{queue=queue.then(async()=>{try{
 let value;if(message.method==='open'){library=await open(message.input);value={pid:process.pid,...await library.status()};}
 else if(message.method==='close'){await library.close();process.send({id:message.id,value:true},()=>process.disconnect());return;}
 else if(message.method==='car')value=await library.car(message.input);
 else value=await library[message.method](message.input);
 process.send({id:message.id,value});
}catch(e){process.send({id:message.id,error:{code:e.code,message:e.message}});}});});
