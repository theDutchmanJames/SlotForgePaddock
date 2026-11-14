'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const base=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(base,'.qa/connection-settings-ui-'));fs.mkdirSync(path.join(root,'profiles'));fs.writeFileSync(path.join(root,'connection-settings.json'),JSON.stringify({migration:process.argv.includes('--migration')}));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(require('electron'),['.',`--shared-folder-smoke=${root}`],{cwd:base,env,windowsHide:true,encoding:'utf8',timeout:180000});fs.writeFileSync(path.join(root,'electron.log'),(result.stdout||'')+(result.stderr||''));console.log(root);
if(result.status!==0||!fs.existsSync(path.join(root,'native-result.json'))){console.error(result.stderr,result.error);process.exitCode=1;}else console.log(fs.readFileSync(path.join(root,'native-result.json'),'utf8'));
