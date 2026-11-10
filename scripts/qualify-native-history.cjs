'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
(async()=>{
 const base=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(base,'.qa/native-history-ui-')),profile=path.join(root,'paddock-profile');fs.mkdirSync(profile);fs.mkdirSync(path.join(root,'profiles'));
 const file=path.join(profile,'database.sqlite'),{Store}=require('../src/store.cjs'),seed=new Store(file);seed.mutate('settings.save',{patch:{name:'Isolated native history test'}});require('../src/shared-library-key.cjs').ensure(file);
 const store=()=>new Store(file,{deferred:true}),E=require('../src/shared-library-engine.cjs'),client={application:'SlotForge Timing',installationId:'old-native'},status=await E.call(store(),client,'status'),identity={databaseId:status.databaseId,recoveryId:status.recoveryId};
 const car=await E.call(store(),client,'adoptCar',{...identity,sourceId:'old-native',operationId:'car',originalId:'car',rawOriginal:{id:'car'},data:{name:'NSR Mosler — native history test'}});
 const raw={session:{id:'race',sessionType:'qualifying',setupName:'Qualifying',date:'2020-04-05T12:30:00.000Z',trackName:'Slotrace Circuit',trackId:'circuit'},laps:[7000,8000,30000].map((time,i)=>({id:'lap-'+i,carId:'car',driverId:'james',driverName:'James',lane:2,lapNumber:i+1,time,...(i===2?{invalid:true}:{})}))};
 const bundle=require('../src/timing-legacy/projection/paddock-historical-evidence.js').bundle(raw,status.databaseId,{car:car.carId});bundle.context.notes='Pending historical evidence, not accepted. Saved reviewed classification.';
 await E.call(store(),client,'adoptSession',{...identity,sourceId:'old-native',operationId:'race',originalId:'race',sessionId:'race',rawOriginal:raw,bundle});fs.writeFileSync(path.join(root,'native-history.json'),JSON.stringify({carId:car.carId}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const result=spawnSync(require('electron'),['.','--shared-folder-smoke='+root],{cwd:base,env,windowsHide:true,encoding:'utf8',timeout:90000});
 console.log(JSON.stringify({root,status:result.status,result:fs.existsSync(path.join(root,'native-result.json'))?JSON.parse(fs.readFileSync(path.join(root,'native-result.json'))):null},null,2));if(result.status!==0){console.error(result.stdout,result.stderr);process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1;});
