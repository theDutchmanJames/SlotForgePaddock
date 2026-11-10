'use strict';
// Test/tool support only, excluded from the packaged application. Select state
// before loading production modules; never mutate a running app's module cache.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const files={rich:path.resolve(__dirname,'../../src/rich-history-gate.cjs'),historical:path.resolve(__dirname,'../../src/historical-approval-gate.cjs')};
const declaration=/^const VERIFIED = (?:true|false);$/gm;
function compile(code,enabled){
 if(typeof enabled!=='boolean'||[...code.matchAll(declaration)].length!==1)throw Error('Expected exactly one compiled boolean history gate.');
 return code.replace(declaration,`const VERIFIED = ${enabled};`);
}
let states={rich:false,historical:false},installed=false;
function install(next){
 for(const [key,value]of Object.entries(next))if(!Object.hasOwn(files,key)||typeof value!=='boolean')throw Error('Unknown test gate or non-boolean state.');
 for(const file of Object.values(files))if(require.cache[file])throw Error('Choose test gates before loading production history modules.');
 states={...states,...next};
 if(installed)return;installed=true;
 // Worker defaults come from Node's startup options, not subsequent edits to
 // process.execArgv. Pass the selected test state explicitly to the unchanged
 // domain worker through a test-only bootstrap, before it imports any schema.
 const threads=require('node:worker_threads'),Worker=threads.Worker,domain=path.resolve(__dirname,'../../src/domain-worker.cjs');
 threads.Worker=class extends Worker{constructor(file,options){
  if(typeof file==='string'&&path.resolve(file)===domain)super(path.join(__dirname,'history-gate-worker.cjs'),{...options,workerData:{...(options?.workerData||{}),__testHistoryGates:{...states}}});
  else super(file,options);
 }};
 const original=Module._extensions['.js'];
 Module._extensions['.js']=function(module,file){const key=Object.keys(files).find(k=>files[k]===path.resolve(file));if(!key)return original(module,file);module._compile(compile(fs.readFileSync(file,'utf8'),states[key]),file);};
}
module.exports={compile,install};
