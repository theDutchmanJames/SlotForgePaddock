'use strict';
// Exercise the ordinary compiled activation gate, not a smoke flag or gate override.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const base=path.resolve(__dirname,'..');assert.equal(require('../src/shared-library-activation.json').enabled,true,'Qualify only an enabled candidate');
for(const first of ['timing','paddock']){
 const root=fs.mkdtempSync(path.join(base,'.qa/shared-ordinary-')),profiles=path.join(root,'profiles'),paddock=path.join(profiles,'slotforge-database');fs.mkdirSync(paddock,{recursive:true});let source,bytes;
 if(first==='timing'){const timing=path.join(profiles,'slotforge-timing');fs.mkdirSync(timing);source=path.join(timing,'slotforge-timing.json');bytes=JSON.stringify({paddock:{sourceId:'ordinary-old-timing'},slotcars:[{id:'old-car',name:'Ordinary Timing car'}],sessions:[{id:'old-race',sessionType:'race',date:'2025-01-01T00:00:00.000Z',setupName:'Ordinary old laps'}],laps:[{id:'old-lap',sessionId:'old-race',carId:'old-car',lapNumber:1,lane:1,time:8000}],tracks:[],drivers:[],teams:[],raceclasses:[]});fs.writeFileSync(source,bytes);}
 else{const store=new(require('../src/store.cjs').Store)(path.join(paddock,'database.sqlite'));store.mutate('car.save',{data:{name:'Ordinary Paddock car'}});}
 fs.writeFileSync(path.join(root,'permission.json'),JSON.stringify({disposable:true,first}));
 const env={...process.env,SF_PADDOCK_ORDINARY_QA:root};delete env.ELECTRON_RUN_AS_NODE;const run=spawnSync(require('electron'),[path.join(base,'tests/support/shared-ordinary-electron.cjs')],{cwd:base,env,windowsHide:true,encoding:'utf8',timeout:90000});
 if(source)assert.equal(fs.readFileSync(source,'utf8'),bytes);
 const result=path.join(root,'result.json');if(run.status!==0||!fs.existsSync(result)){console.error(run.stdout,run.stderr);throw Error('Ordinary startup failed: '+root);}assert.equal(JSON.parse(fs.readFileSync(result)).passed,true);console.log(fs.readFileSync(result,'utf8'));
}
