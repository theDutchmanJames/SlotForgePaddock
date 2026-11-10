'use strict';
// Both release defaults, full suite, synthetic profiles. No production edits.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),base=path.join(project,'.qa/history-gate-states');fs.mkdirSync(base,{recursive:true});
const output=fs.mkdtempSync(path.join(base,'run-'));
const gates=['src/rich-history-gate.cjs','src/historical-approval-gate.cjs'].map(f=>path.join(project,f)),originals=gates.map(f=>fs.readFileSync(f));
const tests=fs.readdirSync(path.join(project,'tests')).filter(f=>f.endsWith('.test.cjs')).sort().map(f=>path.join(project,'tests',f));
const results=[];
async function run(state){
 const preload=path.join(project,'tests/support',state==='closed'?'history-closed-preload.cjs':'history-enabled-preload.cjs'),env={...process.env};delete env.NODE_TEST_CONTEXT;
 const logfile=path.join(output,state+'.tap'),stream=fs.createWriteStream(logfile);let text='',error='';
 console.log('Running full suite with simulated '+state+' release gates...');
 try{await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--require',preload,'--test','--test-reporter=tap',...tests],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>{child.kill();reject(Error(state+' qualification timed out'));},300000);
  child.stdout.on('data',b=>{text+=b;stream.write(b);});child.stderr.on('data',b=>{error+=b;stream.write(b);});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',(code,signal)=>{clearTimeout(timer);code===0&&!signal?resolve():reject(Error(state+' tests failed: '+code+'/'+signal+' '+error.slice(-2000)));});
 });}finally{await new Promise(resolve=>stream.end(resolve));}
 const counts=require('../tests/support/test-totals.cjs')(text);results.push({state,...counts,logfile});console.log(state+': '+counts.pass+' passed, zero skips.');
}
(async()=>{console.log('Evidence: '+output);try{await run('closed');await run('enabled');}finally{gates.forEach((f,i)=>assert.deepEqual(fs.readFileSync(f),originals[i],'Production gate source changed'));}fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,sourceUnchanged:true,results},null,2));})().catch(e=>{console.error(e.stack);fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:e.stack,results},null,2));process.exitCode=1;});
