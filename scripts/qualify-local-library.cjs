'use strict';
// Reusable qualification entry point. All mutations use generated profiles.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
async function child(args){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>error+=b);p.on('error',reject);p.on('exit',code=>{if(code)reject(Error(error||output));else try{resolve(JSON.parse(output.trim()));}catch(e){reject(Error('Invalid qualification output: '+output.slice(-1000)));}});});}
(async()=>{
 const qa=path.resolve(__dirname,'..','.qa');fs.mkdirSync(qa,{recursive:true});const report={date:new Date().toISOString(),environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model},recovery:await require('../tests/support/local-recovery-qualification.cjs').run({progress:message=>console.log('PASS '+message)})};
 if(process.argv.includes('--large')){
  const profile=fs.mkdtempSync(path.join(qa,'sf-local-qualify-'));report.fixture=profile;
  const helper=path.join(__dirname,'..','tests','support','local-large-qualification.cjs');
  report.seed=await child(['--max-old-space-size=3072',helper,'--seed',profile]);
  report.large=await child([helper,'--measure',profile]);
 }
 const file=path.join(qa,'local-library-phase-three.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log('Report: '+file);if(report.large)console.log(JSON.stringify(report.large,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
