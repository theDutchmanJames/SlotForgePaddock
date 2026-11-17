'use strict';
// A list or object built by a nested query, such as (SELECT json_group_array(...)), is only
// guaranteed to stay a list when it is wrapped in json(...). Without the wrapper SQLite may hand
// it on as plain text: json_object('lanes',(SELECT json_group_array(...))) then stores "[2]"
// instead of [2]. That happened on macOS only (v1.7.1 release build), so it cannot be caught by
// running the queries on Windows or Linux. This test reads the source instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
function sources(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return ['vendor', 'timing-legacy'].includes(entry.name) ? [] : sources(file);
    return /\.cjs$/.test(entry.name) ? [file] : [];
  });
}
const NESTED = /\(\s*SELECT\s+json_group_(?:array|object)\s*\(/gi;

test('every nested query that builds a JSON list or object is wrapped in json(...)', () => {
  const unwrapped = [];
  let found = 0;
  for (const file of sources(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(NESTED)) {
      found++;
      if (!/json\(\s*$/i.test(text.slice(Math.max(0, match.index - 12), match.index))) {
        unwrapped.push(path.relative(root, file) + ':' + text.slice(0, match.index).split('\n').length);
      }
    }
  }
  assert.ok(found >= 6, 'the check still finds the known nested queries');
  assert.deepEqual(unwrapped, [], 'wrap these as json((SELECT json_group_...))');
});

test('json(...) around a nested list keeps it a list', () => {
  const db = new (require('node:sqlite').DatabaseSync)(':memory:');
  try {
    const row = db
      .prepare(
        "SELECT json_object('lanes',json((SELECT json_group_array(value) FROM (SELECT value FROM json_each('[2,1]') ORDER BY value))),'none',json((SELECT json_group_array(value) FROM json_each('[]')))) j"
      )
      .get();
    assert.deepEqual(JSON.parse(row.j), { lanes: [1, 2], none: [] });
  } finally {
    db.close();
  }
});
