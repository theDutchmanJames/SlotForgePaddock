'use strict';
// Readability cleanup guard: proves that Prettier's formatting does not change what the code does.
// For each file it compares the program structure (syntax tree, without positions and comments
// layout) before and after formatting. Usage: node scripts/format-check.cjs [--write] <files...>
const fs = require('node:fs');

const SKIP = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments',
  'trailingComments', 'innerComments', 'tokens']);

function shape(node) {
  if (Array.isArray(node)) return node.map(shape);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const key of Object.keys(node).sort()) {
    if (SKIP.has(key)) continue;
    out[key] = shape(node[key]);
  }
  // Quote style and number spelling are formatting only: compare the values, not the raw text.
  if (out.type === 'StringLiteral' || out.type === 'NumericLiteral') delete out.raw;
  if (out.type === 'TemplateElement' && out.value) out.value = { cooked: out.value.cooked, raw: out.value.raw };
  // Prettier removes redundant parentheses; Babel records them only as extra.parenthesized.
  return out;
}

async function main() {
  const prettier = await import('prettier');
  const write = process.argv.includes('--write');
  const files = process.argv.slice(2).filter(a => a !== '--write');
  const parse = text => prettier.__debug.parse(text, { parser: 'babel', filepath: 'x.js' }).then(r => r.ast);
  let changed = 0, failed = 0;
  for (const file of files) {
    const input = fs.readFileSync(file, 'utf8');
    const options = { ...(await prettier.resolveConfig(file)), filepath: file };
    const output = await prettier.format(input, options);
    const same = JSON.stringify(shape(await parse(input))) === JSON.stringify(shape(await parse(output)));
    if (!same) { failed++; console.log(`DIFFERENT PROGRAM: ${file}`); continue; }
    if (output !== input) {
      changed++;
      if (write) fs.writeFileSync(file, output);
    }
  }
  console.log(`${files.length} files checked, ${changed} ${write ? 'formatted' : 'would change'}, ${failed} would change behaviour.`);
  process.exitCode = failed ? 1 : 0;
}
/** Whether two source texts are the same program (used by the guard's own test). */
async function sameProgram(a, b) {
  const prettier = await import('prettier');
  const parse = text => prettier.__debug.parse(text, { parser: 'babel', filepath: 'x.js' }).then(r => r.ast);
  return JSON.stringify(shape(await parse(a))) === JSON.stringify(shape(await parse(b)));
}

module.exports = { sameProgram };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 2; });
