'use strict';
// Test-only internal qualification entry point. Not imported by the app.
const {isMainThread,Worker,workerData,parentPort}=require('node:worker_threads');
if(isMainThread){const worker=new Worker(__filename,{workerData:{root:process.argv[2]}});worker.on('message',v=>process.stdout.write(JSON.stringify(v)));worker.on('error',e=>{console.error(e);process.exitCode=1;});}
else{const fs=require('node:fs'),path=require('node:path'),{Store}=require('../../src/store.cjs');const request=JSON.parse(fs.readFileSync(path.join(workerData.root,'request.json')));const store=new Store(path.join(workerData.root,'database.sqlite'),{deferred:true});parentPort.postMessage(require('../../src/rich-history.cjs').approveQualified(store,request));}
