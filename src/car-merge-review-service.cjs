'use strict';
const S=require('./car-merge-storage.cjs');
// Compiled availability plus collection-authority checks. Preferences, IPC
// arguments and environment flags cannot bypass a disabled build or replica.
function dispatch(input,store,selectionGuard=()=>{}){
 if(input?.action==='status')return {enabled:S.enabled()&&!store?.data.club?.replica};
 if(!S.enabled())return S.execute();
 if(!store?.file)throw Error('Open a saved collection before reviewing merges.');
 const guard=()=>{selectionGuard();if(!S.enabled())S.execute();if(store.data.club?.replica)throw Object.assign(Error('Review merges on the dealership computer.'),{code:'MERGE_AUTHORITY_REQUIRED'});};
 guard();return require('./domain-tasks.cjs').run(store,{kind:'car-merge',input},guard);
}
function qualification(directory){
 S.openQualification(directory);
 const {Worker}=require('node:worker_threads'),{Writer}=require('./sqlite-writer.cjs');
 const writer=new Writer(()=>new Worker(require('node:path').join(__dirname,'car-merge-review-worker.cjs')));
 return {request:q=>writer.write(directory,q,null),close:async()=>{if(writer.active||writer.queue.length)throw Error('Wait for merge operations before closing.');if(writer.worker){const w=writer.worker;writer.worker=null;await w.terminate();}}};
}
module.exports={dispatch,qualification};
