'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const base=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(base,'.qa/dealership-off-native-')),profile=path.join(root,'paddock-profile');
fs.mkdirSync(profile);fs.mkdirSync(path.join(root,'profiles'));
const store=new (require('../src/store.cjs').Store)(path.join(profile,'database.sqlite'));
store.mutate('car.save',{data:{name:'Preserved car'}});store.scopedTransact('@club',db=>{db.club={id:'offline-dealership',proposals:[]};});
fs.writeFileSync(path.join(profile,'club-device.json'),JSON.stringify({version:1,id:'smoke-device',name:'Test computer',coordinator:'offline-dealership',pair:null,outbox:[]}));
fs.writeFileSync(path.join(root,'disable-dealership.json'),'{}');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(require('electron'),['.','--shared-folder-smoke='+root],{cwd:base,env,windowsHide:true,encoding:'utf8',timeout:90000});
console.log(JSON.stringify({root,status:result.status,result:fs.existsSync(path.join(root,'native-result.json'))?JSON.parse(fs.readFileSync(path.join(root,'native-result.json'))):null},null,2));
if(result.status!==0){console.error(result.stdout,result.stderr);process.exitCode=1;}
