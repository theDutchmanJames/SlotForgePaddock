'use strict';
// Read the retained synthetic Timing app fixture into an isolated copy. Never
// open a user's profile or mutate the peer's retained evidence.
const fs=require('node:fs'),path=require('node:path'),{spawnSync,spawn}=require('node:child_process');
const base=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]||'');
if(!source.includes(path.sep+'outputs'+path.sep+'shared-engine-ui'+path.sep)||!path.basename(source).startsWith('joint-'))throw Error('Supply the retained joint Timing QA registration folder.');
const original=JSON.parse(fs.readFileSync(path.join(source,'library.json'),'utf8'));
if(path.dirname(path.resolve(original.file))!==source)throw Error('QA registration must point inside its fixture.');
const root=fs.mkdtempSync(path.join(base,'.qa/shared-joint-')),shared=path.join(root,'shared');fs.mkdirSync(shared);fs.mkdirSync(path.join(root,'profiles'));fs.mkdirSync(path.join(root,'paddock-profile'));
const backup=require('../src/portable-backup.cjs'),archive=path.join(root,'original.sfpbackup'),file=path.join(shared,'library.sqlite');
backup.exportBackup(original.file,archive);backup.stageBackup(archive,file);fs.writeFileSync(path.join(shared,'library.json'),JSON.stringify({...original,file}));
const live=process.argv.includes('--live'),exchange=path.join(root,'exchange');
fs.writeFileSync(path.join(root,'joint.json'),JSON.stringify({databaseId:original.databaseId,source,readOnly:!process.argv.includes('--restore')&&!live,restore:process.argv.includes('--restore'),live,exchange}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let peer,peerLog;
if(live){
 const timing=path.resolve(process.env.SF_TIMING_QA_SOURCE||path.join(base,'../SlotForge Timing - Analog/SlotForgeTiming'));
 if(!fs.existsSync(path.join(timing,'tools/qa/shared-joint-electron.cjs')))throw Error('Timing joint app runner is missing.');
 fs.writeFileSync(path.join(shared,'joint-qa-permission.json'),JSON.stringify({disposable:true,allowTimingWrites:true}));
 peerLog=fs.openSync(path.join(root,'timing-launcher.log'),'w');
 peer=spawn(process.execPath,['-e',"require('./tools/qa/qualified-ui.cjs')('shared-joint-electron.cjs',process.env.SF_JOINT_LOG,190000)"],{cwd:timing,env:{...env,SF_JOINT_ROOT:shared,SF_JOINT_EXCHANGE:exchange,SF_JOINT_LOG:path.join(root,'timing-log')},windowsHide:true,stdio:['ignore',peerLog,peerLog]});
 peer.on('error',error=>{console.error(error);process.exitCode=1;});
}
const result=spawnSync(require('electron'),['.','--shared-folder-smoke='+root],{cwd:base,env,windowsHide:true,encoding:'utf8',timeout:live?190000:90000});
console.log(JSON.stringify({root,status:result.status,result:fs.existsSync(path.join(root,'native-result.json'))?JSON.parse(fs.readFileSync(path.join(root,'native-result.json'))):null},null,2));
if(result.status!==0){console.error(result.stdout,result.stderr);process.exitCode=1;}
if(peer)peer.on('exit',code=>{fs.closeSync(peerLog);const file=path.join(exchange,'result.json');if(code!==0||!fs.existsSync(file)||!JSON.parse(fs.readFileSync(file)).passed){console.error('Timing joint peer failed:',code);process.exitCode=1;}else console.log('Timing native peer passed: '+file);});
