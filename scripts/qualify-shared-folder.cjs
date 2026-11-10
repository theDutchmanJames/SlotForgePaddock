'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const base=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(base,'.qa/shared-folder-native-')),profile=path.join(root,'profiles','slotforge-timing');fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(path.join(root,'paddock-profile'));
const raw={version:1,paddock:{sourceId:'old-native-timing'},slotcars:[{id:'old-car',name:'Old Timing car',reference:'old-reference'}],sessions:[{id:'old-race',sessionType:'race',date:'2018-01-01',setupName:'Old measured race',standings:[]},{id:'old-tokens',sessionType:'tokens',setupName:'Old token session'}],laps:[{id:'old-lap',sessionId:'old-race',carId:'old-car',lapNumber:1,lane:1,time:8000},{id:'token-lap',sessionId:'old-tokens',carId:'old-car',lapNumber:1,lane:1,time:4000}],tracks:[],drivers:[],teams:[],raceclasses:[]};
const file=path.join(profile,'slotforge-timing.json'),bytes=JSON.stringify(raw);fs.writeFileSync(file,bytes);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(require('electron'),['.', '--shared-folder-smoke='+root],{cwd:base,env,windowsHide:true,encoding:'utf8',timeout:90000});
if(fs.readFileSync(file,'utf8')!==bytes)throw Error('Original Timing database changed.');
console.log(JSON.stringify({root,status:result.status,result:fs.existsSync(path.join(root,'native-result.json'))?JSON.parse(fs.readFileSync(path.join(root,'native-result.json'))):null},null,2));
if(result.status!==0){console.error(result.stdout,result.stderr);process.exitCode=1;}
