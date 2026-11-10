'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const totals=require('./support/test-totals.cjs');
const good='# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
test('gate qualification requires explicit completed TAP totals, never exit status alone',()=>{
 assert.equal(totals(good).pass,3);assert.equal(totals(good.replaceAll('\n','\r\n')).pass,3);
 for(const bad of ['',good.replace('# pass 3','# pass 2'),good.replace('# fail 0','# fail 1'),good.replace('# skipped 0','# skipped 1'),good.replaceAll('3','0'),good+'# tests 3\n'])assert.throws(()=>totals(bad));
});
