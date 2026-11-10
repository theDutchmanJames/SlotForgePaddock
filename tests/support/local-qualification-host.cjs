'use strict';
const fs=require('node:fs'),path=require('node:path'),{Store,initial}=require('../../src/store.cjs'),{LocalLibrary}=require('../../src/local-library.cjs');
const root=process.argv[2];if(!root||!path.basename(root).startsWith('sf-local-qualify-'))throw Error('Disposable qualification profile required.');
let store,service,restoreCopy,release,closing=false;
const send=value=>{if(process.connected)process.send(value);};
(async()=>{
 store=await Store.open(path.join(root,'database.sqlite'));service=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await service.start();if(service.error)throw Error(service.error);send({ready:true,file:service.file});
 process.on('message',async message=>{const {id,op,p={}}=message;try{let value;
  if(op==='history-review')value=await require('../../src/domain-tasks.cjs').run(store,{kind:'history-import',action:'review',input:p});
  else if(op==='review')value=await store.mutateAsync('submission.review',p,{snapshot:false,commandId:message.commandId});
  else if(op==='save')value=await store.mutateAsync('car.save',p,{snapshot:false});
  else if(op==='hold'){if(release)throw Error('Already held');store.pendingWrite=new Promise(r=>{release=r;});value=true;}
  else if(op==='release'){const r=release;release=null;store.pendingWrite=null;r?.();value=true;}
  else if(op==='pending')value=store.domainPending||0;
  else if(op==='backup'){restoreCopy=store.snapshot();value={databaseId:store.data.id};}
  else if(op==='restore'){await store.restoreAsync(restoreCopy,store.data.revision);value={databaseId:store.data.id};}
  else if(op==='reset'){await store.restoreAsync(initial(),store.data.revision);value={databaseId:store.data.id};}
  else if(op==='disable'){await service.setEnabled(false);value=true;}
  else if(op==='enable'){await service.setEnabled(true);value={file:service.file};}
  else if(op==='close'){closing=true;service.quiesce();await service.idle();await store.whenIdle();service.close();send({id,value:true});process.disconnect();return;}
  else throw Error('Unknown qualification control.');send({id,value});
 }catch(e){send({id,error:e.message,code:e.apiCode||e.code});}});
 process.on('disconnect',()=>{if(!closing)process.exit(1);});
})().catch(e=>{send({error:e.message});process.exitCode=1;process.disconnect();});
