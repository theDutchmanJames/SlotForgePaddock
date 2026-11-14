'use strict';
// A disposable process running the real public engine, with a controllable encoder.
const fs=require('node:fs'),fixture=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
let handle,hold=false,serial=0;const encodings=new Map();
process.on('message',async message=>{try{
 if(message.method==='open'){
  hold=!!message.input.hold;handle=await require(process.argv[2]).open({application:message.input.application,installationId:message.input.application,sharedRoot:fixture.root,legacyProfiles:[],...(message.input.encoder===false?{}:{thumbnailEncoder:async source=>{const id=++serial;process.send({event:'encoding',id,source});if(hold)await new Promise(resolve=>encodings.set(id,resolve));const found=fixture.photos.find(p=>p.original===source);if(!found)throw Error('Unexpected original');return found.preview;}})});process.send({id:message.id,value:await handle.status()});
 }else if(message.method==='release'){hold=false;for(const resolve of encodings.values())resolve();encodings.clear();process.send({id:message.id,value:true});}
 else if(message.method==='close'){await handle.close();process.send({id:message.id,value:true},()=>process.disconnect());}
 else process.send({id:message.id,value:await handle[message.method](...(message.method==='car'?[message.input.id,message.input.options]:[message.input]))});
 }catch(error){process.send({id:message.id,error:{message:error.message,code:error.code}});}});
