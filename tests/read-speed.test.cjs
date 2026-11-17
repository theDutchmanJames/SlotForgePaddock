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

function catalogue(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-finder-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(path.join(dir, 'db.sqlite'));
  const add = (name, maker, reference) =>
    s.mutate('part.save', { data: { name, maker, reference, quantity: 0, tracking: 'quantity' } }, { snapshot: false });
  for (let i = 1; i <= 45; i++) add(`Slick tyre ${String(i).padStart(2, '0')}`, i % 2 ? 'Slot.it' : 'NSR', 'T' + i);
  for (let i = 1; i <= 5; i++) add(`Crown gear ${i}`, 'Sloting Plus', 'G' + i);
  return { s, add };
}

test('a field search counts and pages in one pass with the same answer as before', t => {
  const { s } = catalogue(t);
  const search = {
    searchFields: ['name', 'maker', 'reference', 'partType'],
    searchTerms: ['tyre', 'slot.it'],
    sort: 'name'
  };
  Q.read(s, null, r => {
    const counted = r.count('parts', search); // The separate count, as every search used to do.
    assert.equal(counted, 23);
    const first = r.list('parts', { ...search, limit: 20, idsOnly: true });
    assert.equal(first.total, counted);
    assert.equal(first.rows.length, 20);
    assert.equal(first.nextOffset, 20);
    const second = r.list('parts', { ...search, limit: 20, offset: 20, idsOnly: true });
    assert.equal(second.rows.length, 3);
    assert.equal(second.nextOffset, null);
    const all = r.list('parts', { ...search, limit: 200, idsOnly: true });
    assert.deepEqual([...first.rows, ...second.rows], all.rows, 'the pages are the ordered result, cut in two');
    // The collection's own order (used by Build from Scratch) pages the same way.
    const ordered = r.list('parts', { ...search, sort: 'order', limit: 200, idsOnly: true });
    const paged = r.list('parts', { ...search, sort: 'order', limit: 5, offset: 5, idsOnly: true });
    assert.deepEqual(paged.rows, ordered.rows.slice(5, 10));
    assert.equal(paged.total, counted);
    assert.equal(r.list('parts', { ...search, searchTerms: ['no such part'], limit: 20 }).total, 0);
  });
});

test('Find a Part: the manufacturer choices follow the collection', t => {
  const { s, add } = catalogue(t);
  const P = require('../src/page-query.cjs');
  const find = query => Q.read(s, null, r => P.finder(r, { kind: 'part', query })).value;
  const before = find('tyre');
  assert.deepEqual(
    before.makers,
    ['NSR', 'Sloting Plus', 'Slot.it'].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  );
  assert.equal(before.total, 45);
  assert.equal(before.rows.length, 20);
  assert.deepEqual(find('crown').makers, before.makers, 'the choices do not depend on what is typed');
  add('Guide', 'Policar', 'P1');
  assert.ok(find('tyre').makers.includes('Policar'), 'a save refreshes them');
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
