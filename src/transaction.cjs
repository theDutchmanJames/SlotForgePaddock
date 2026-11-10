'use strict';
// One commit boundary for both targeted commands and compatibility drafts.
// Preparation must not mutate the committed state. Publication follows storage.
function commit(store,prepared){
 prepared=require('./car-merge-intake.cjs').prepare(store,prepared);
 if(prepared.noop)return prepared.result;
 store.persist(prepared.data,prepared.scope);
 store.data=prepared.data;store.emit();return prepared.result;
}
function run(store,prepare,{scoped=false}={}){store.assertIdle();if(!scoped)store.ensureLoaded();return commit(store,prepare(store.data));}
async function runAsync(store,prepare,{scoped=false}={}){
 if(store.pendingWrite){await store.whenIdle();return runAsync(store,prepare,{scoped});}
 let release;store.pendingWrite=new Promise(resolve=>{release=resolve;});
 try{if(!scoped)await store.ensureLoadedAsync();const prepared=require('./car-merge-intake.cjs').prepare(store,prepare(store.data));if(prepared.noop)return prepared.result;await store.persistAsync(prepared.data,prepared.scope);store.data=prepared.data;store.emit();return prepared.result;}
 finally{store.pendingWrite=null;release();}
}
module.exports={run,runAsync};
