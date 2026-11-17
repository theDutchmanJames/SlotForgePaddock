'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sameProgram } = require('../scripts/format-check.cjs');

test('the formatting guard accepts layout-only changes', async () => {
  assert.equal(await sameProgram("const a=(1+2)*3,b='x';", 'const a = (1 + 2) * 3,\n  b = "x";\n'), true);
  assert.equal(await sameProgram('f(a,b)//note', 'f(a, b); // note\n'), true);
  assert.equal(await sameProgram('x=0x10', 'x = 0x10;'), true);
});

test('the formatting guard rejects any change in meaning', async () => {
  assert.equal(await sameProgram('const C=1024*1024', 'const C=1024*1023'), false);
  assert.equal(await sameProgram('a=(1+2)*3', 'a=1+2*3'), false);
  assert.equal(await sameProgram("s='a b'", "s='a  b'"), false);
  assert.equal(await sameProgram('x=`a${b}`', 'x=`a ${b}`'), false);
  assert.equal(await sameProgram('if(a)b()', 'if(a);b()'), false);
});
