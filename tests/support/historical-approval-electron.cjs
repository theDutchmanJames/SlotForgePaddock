'use strict';
if(!process.argv.includes('--smoke')||!process.argv.includes('--history-approval-only'))throw Error('Isolated approval smoke profile required.');
const preload=require('node:path').join(__dirname,'historical-approval-preload.cjs');
require(preload);
// Electron workers do not inherit the dynamically amended preload list. Use a
// test-only bootstrap that loads the gate, then the unchanged domain worker.
const threads=require('node:worker_threads'),path=require('node:path'),Worker=threads.Worker;
threads.Worker=class extends Worker{constructor(file,options){super(path.resolve(String(file))===path.resolve(__dirname,'../../src/domain-worker.cjs')?path.join(__dirname,'historical-approval-worker.cjs'):file,options);}};
require('../../src/main.cjs');
