'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {Store}=require('../src/store.cjs'),I=require('../src/history-imports.cjs'),H=require('../src/shared-history.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('real process death leaves historical approval wholly pending or wholly committed',{timeout:60000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-qualify-rich-')),file=path.join(root,'database.sqlite');let child;
 try{
  new Store(file).replace(require('./support/timing-fixtures.cjs').fixtures().store.snapshot());const s=new Store(file,{deferred:true}),batch=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));batch.recoveryId=H.status(s).recoveryId;I.receive(s,batch);
  const row=s.data.timing.imports[0],request={databaseId:s.data.id,recoveryId:batch.recoveryId,id:row.id,requestHash:row.requestHash,action:'approve',note:'Reviewed evidence'};fs.writeFileSync(path.join(root,'request.json'),JSON.stringify(request));
  const launch=()=>{child=cp.spawn(process.execPath,['--require',path.join(__dirname,'support/local-crash-preload.cjs'),path.join(__dirname,'support/rich-history-worker.cjs'),root],{windowsHide:true,env:{...process.env,SF_TEST_CRASH_ROOT:root},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);return new Promise(resolve=>child.once('exit',code=>resolve({code,out,err})));};
  for(const mode of ['before-commit','after-commit']){
   fs.writeFileSync(path.join(root,'crash-arm.json'),JSON.stringify({mode,staging:false}));const done=launch(),deadline=Date.now()+20000;
   while(!fs.existsSync(path.join(root,'crash-reached.json'))){if(child.exitCode!==null)throw Error(JSON.stringify(await done));if(Date.now()>deadline)throw Error('Crash marker timeout');await pause(20);}
   child.kill();await done;child=null;fs.unlinkSync(path.join(root,'crash-reached.json'));
   const verified=new Store(file),committed=mode==='after-commit';assert.equal(verified.data.timing.imports[0].status,committed?'approved':'pending');assert.equal(verified.data.timing.sessions.length,committed?1:0);assert.equal(verified.data.timing.audit?.length||0,committed?1:0);
  }
  const retry=await launch();assert.equal(retry.code,0,retry.err);assert.equal(JSON.parse(retry.out).duplicate,true);child=null;
  const verified=new Store(file);assert.equal(verified.data.timing.sessions.length,1);assert.equal(verified.data.timing.audit.length,1);
 }finally{if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sf-local-qualify-rich-'));fs.rmSync(root,{recursive:true,force:true});}
});
