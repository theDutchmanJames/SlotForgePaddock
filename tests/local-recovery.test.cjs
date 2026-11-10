'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('real-process local-library recovery qualification', {timeout:120000},async()=>{const report=await require('./support/local-recovery-qualification.cjs').run();assert.equal(report.passed,true);assert.ok(report.checks.length>=10);});
