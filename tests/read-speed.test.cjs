'use strict';
// Guards for speed fixes that must not weaken integrity checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../src/store.cjs');
const Q = require('../src/sqlite-query.cjs');
const lazy = require('../src/lazy-assets.cjs');

const photo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../assets/icon.png')).toString('base64');
const SLOW = 'length(value) size FROM assets';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-speed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(path.join(dir, 'db.sqlite'));
  s.mutate('car.save', { data: { name: 'With photo', picture: photo } });
  const key = JSON.stringify(['cars', 'id:' + s.data.cars[0].id]);
  lazy.clearCache();
  return { file: s.file, key };
}

/** Counts how often the statement that reads through a whole attachment is prepared. */
function countSlow(t) {
  const prepare = DatabaseSync.prototype.prepare;
  let slow = 0;
  DatabaseSync.prototype.prepare = function (text) {
    if (text.includes(SLOW)) slow++;
    return prepare.call(this, text);
  };
  t.after(() => (DatabaseSync.prototype.prepare = prepare));
  return () => slow;
}

const readCar = (file, key) => {
  const r = new Q.Reader(file);
  try {
    return r.record(key, { assetHandle: true });
  } finally {
    r.close();
  }
};

test('a photo description is verified once, then remembered', t => {
  const { file, key } = setup(t);
  const slow = countSlow(t);
  const first = readCar(file, key);
  assert.equal(slow(), 1, 'the first read verifies the description');
  const again = readCar(file, key);
  readCar(file, key);
  assert.equal(slow(), 1, 'later reads do not read through the photograph again');
  assert.equal(lazy.stats().reads, 0, 'and none of this loads the photograph itself');
  assert.equal(again.picture, photo, 'the remembered description still leads to the right photograph');
  assert.equal(first.picture, photo);
});

test('a remembered description does not hide a missing photograph', t => {
  const { file, key } = setup(t);
  readCar(file, key); // Remembered now.
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=OFF; DELETE FROM assets;');
  db.close();
  assert.throws(() => readCar(file, key), /Missing attachment|integrity/);
});

test('a damaged description is still rejected on first sight', t => {
  const { file, key } = setup(t);
  const db = new DatabaseSync(file);
  db.exec(`UPDATE assets SET meta=replace(meta,'"photo":true','"photo":false')`);
  db.close();
  assert.throws(() => readCar(file, key), /metadata integrity/);
  assert.throws(() => readCar(file, key), /metadata integrity/, 'and a failure is never remembered');
});

test('descriptions are remembered per collection file', t => {
  const a = setup(t);
  readCar(a.file, a.key);
  const b = setup(t); // setup() clears the memory; read the first again, then a second file.
  readCar(a.file, a.key);
  const slow = countSlow(t);
  readCar(b.file, b.key);
  assert.equal(slow(), 1, 'another file is verified for itself, even with the same photograph');
});

test('storage totals for Settings are worked out once per revision', t => {
  const { file } = setup(t);
  const store = new Store(file, { deferred: true });
  const state = store.deferredState;
  // Connections are closed before the test ends, so the temporary folder can be removed.
  const measure = on => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return [on.measure(db), on.measure(db)];
    } finally {
      db.close();
    }
  };
  const [first, again] = measure(state);
  assert.ok(first.logicalBytes > photo.length, 'includes the photograph');
  assert.equal(again, first, 'the same revision reuses the result');
  store.mutate('car.save', { data: { name: 'Another car' } }, { snapshot: false }); // As the app saves.
  assert.notEqual(store.deferredState, state, 'a save makes a new revision state');
  assert.ok(measure(store.deferredState)[0].logicalBytes > first.logicalBytes, 'which is measured afresh');
});
