'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
async function reset({store,club,network,backupJobs,protectedFiles=[]},p){
 const guard=()=>{if(club.store!==store||club.active||store.data.club?.replica||store.data.club&&!club.coordinator)throw Error('Reset is only available on the personal or authoritative dealership computer.');if(p.databaseId!==store.data.id||p.revision!==store.data.revision)throw Error('The collection changed. Review the reset again.');if(p.confirmation!=='RESET')throw Error('Type RESET to confirm.');if(network.sending||club.sending||club.busy)throw Error('Wait for the current transfer to finish.');};
 guard();store.assertIdle();
 const folder=path.join(path.dirname(store.file),'recovery-backups');fs.mkdirSync(folder,{recursive:true});
 const recovery=path.join(folder,'before-reset-'+Date.now()+'-'+randomUUID()+'.sfpbackup');
 await store.exclusiveFileOperation(()=>{guard();if(!store.expectedIdentity)store.persist(store.data);return backupJobs.run('export',store.file,recovery,{expectedIdentity:store.expectedIdentity,protectedFiles});});
 guard();await network.stop();guard();
 const fresh=require('./store.cjs').initial();
 const data=await store.restoreAsync(fresh,p.revision,guard);network.disconnect();network.discardSubmission();
 return {data,recovery};
}
module.exports={reset};
