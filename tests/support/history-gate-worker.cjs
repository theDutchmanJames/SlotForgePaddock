'use strict';
const {workerData}=require('node:worker_threads');
if(!workerData?.__testHistoryGates)throw Error('Explicit test history gates required.');
require('./history-gates.cjs').install(workerData.__testHistoryGates);
require('../../src/domain-worker.cjs');
