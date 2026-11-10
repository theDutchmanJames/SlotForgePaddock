'use strict';
// Test-only fault injection, inherited by the host's database worker. Never
// loaded by production entry points. Arm only a freshly created temp profile.
const fs=require('node:fs'),path=require('node:path'),{isMainThread}=require('node:worker_threads');
const root=process.env.SF_TEST_CRASH_ROOT;
if(!isMainThread&&root&&path.basename(root).startsWith('sf-local-qualify-')){
 const {DatabaseSync}=require('node:sqlite'),exec=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){
  const arm=path.join(root,'crash-arm.json'),marker=path.join(root,'crash-reached.json');let mode;
  if(/^COMMIT;?$/i.test(sql.trim())&&fs.existsSync(arm)){
   const file=this.prepare('PRAGMA database_list').all().find(r=>r.name==='main')?.file;
   const setup=JSON.parse(fs.readFileSync(arm)),target=path.join(root,'database.sqlite'+(setup.staging?'.history-staging.sqlite':''));
   if(file&&path.resolve(file)===target&&this.prepare('SELECT total_changes() n').get().n>0){mode=setup.mode;fs.unlinkSync(arm);}
  }
  const park=()=>{fs.writeFileSync(marker,JSON.stringify({mode}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
  if(mode==='before-commit')park();const result=exec.call(this,sql);if(mode==='after-commit')park();return result;
 };
}
