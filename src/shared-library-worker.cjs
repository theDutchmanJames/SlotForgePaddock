'use strict';
const {parentPort,workerData}=require('node:worker_threads');
let file,databaseId,root,queue=Promise.resolve(),closed=false;
parentPort.on('message',message=>{queue=queue.then(async()=>{
 try{
  if(closed)throw Error('Library handle closed.');let value;
  if(message.method==='open'){const bootstrap=require('./shared-library-bootstrap.cjs'),locations=require('./shared-library-location.cjs'),location=await locations.resolve({...workerData,legacyPaddockPath:bootstrap.paddockPath(workerData)});file=location.file;databaseId=location.databaseId;root=location.root;value={...location,adoption:await locations.lock(location.root,()=>bootstrap.adopt(file,location.root,workerData)),nativeHistoryRepair:await locations.lock(location.root,()=>require('./shared-library-native-history.cjs').repair(file,location.root))};}
  else if(message.method==='close'){closed=true;value=true;}
  else{
   if(!file)throw Error('Open the library first.');
   if(message.method==='restore')value=await require('./shared-library-restore.cjs').restore(file,{...workerData,sharedRoot:root,openedDatabaseId:databaseId},message.input);
   else
   for(let attempt=0;;attempt++)try{
    if(require('./shared-library-location.cjs').identity(file)!==databaseId)throw Object.assign(Error('The shared library was replaced. Reopen it explicitly before continuing.'),{code:'DATABASE_MISMATCH'});
    const store=new (require('./store.cjs').Store)(file,{deferred:true});
    value=await require('./shared-library-engine.cjs').call(store,{...workerData,thumbnailRoot:root},message.method,message.input);break;
   }catch(e){if(attempt>=5||!['QUERY_CHANGED','SQLITE_BUSY'].includes(e.code)&&!/database changed in another process|database is locked/.test(e.message))throw e;await new Promise(r=>setTimeout(r,20*(attempt+1)));}
  }
  parentPort.postMessage({id:message.id,value});
 }catch(e){parentPort.postMessage({id:message.id,error:{message:e.message,code:e.apiCode||e.code,details:e.details}});}
 });});
