'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../renderer/collection-value-model.js');
const V = require('../src/collection-value.cjs');
const { Store } = require('../src/store.cjs');

test('amounts are read the way people type them', () => {
  const cases = [['49.95', 49.95], ['49,95', 49.95], ['1250', 1250], ['1 250', 1250], ['1,250', 1250],
    ['1.250,50', 1250.5], ['1,250.50', 1250.5], ["1'250.50", 1250.5], [' 12 ', 12], [12.5, 12.5], ['0', 0],
    // A single dot is always a decimal point: that is how Paddock's own forms store amounts.
    ['1.250', 1.25], ['0.125', 0.125], ['0.500', 0.5], ['12.345', 12.345],
    ['1.250.000', 1250000], ['1,250,000', 1250000], ['0,500', 0.5], ['1,5', 1.5]];
  for (const [input, expected] of cases) assert.equal(M.amount(input), expected, JSON.stringify(input));
  for (const bad of ['', 'about 50', '€50', '-5', 'n/a', null, undefined, NaN, -3]) assert.equal(M.amount(bad), null, String(bad));
});

test('value uses the valuation, else the purchase price; spending is per purchase year', () => {
  const s = M.summarize([
    { price: '100', valuation: '150', currency: 'EUR', acquired: '2024-03-01' },
    { price: '60', costs: '5', currency: 'eur', acquired: '2024-06-01' },
    { price: '80', currency: 'EUR', acquired: '2026-01-10' },
    { price: '200', valuation: '300', currency: 'EUR', acquired: '2023-05-05', archived: true }, // Sold: spent, not worth.
    { price: '999', currency: 'EUR', acquired: '2025-01-01', wishlist: true }, // Wishlist: ignored.
    { price: '40', currency: 'EUR' }, // No date: spent, not in a year.
    { name: 'no money' },
    { price: '25', currency: 'GBP', acquired: '2025-02-02' },
  ]);
  const eur = s.currencies[0];
  assert.equal(eur.currency, 'EUR');
  assert.equal(eur.value, 150 + 60 + 80 + 40);
  assert.equal(eur.spent, 100 + 65 + 80 + 200 + 40);
  assert.equal(eur.undatedCars, 1);
  assert.deepEqual(eur.years, [
    { year: 2023, spent: 200, cars: 1 },
    { year: 2024, spent: 165, cars: 2 },
    { year: 2025, spent: 0, cars: 0 }, // Gaps are filled so every year has a bar.
    { year: 2026, spent: 80, cars: 1 },
  ]);
  assert.deepEqual(s.currencies.map(c => c.currency), ['EUR', 'GBP'], 'currencies are never added together');
  assert.deepEqual(s.counts, { active: 6, valued: 1, priceOnly: 4, unknown: 1, unreadable: 0 });
});

test('currency symbols and codes are grouped together; a typo in the year is not charted', () => {
  assert.equal(M.currencyCode('€'), 'EUR');
  assert.equal(M.currencyCode(' eur '), 'EUR');
  const s = M.summarize([
    { price: '10', currency: '€', acquired: '2024-01-01' },
    { price: '20', currency: 'EUR', acquired: '0202-05-05' }, // Typo: spent, but not in a year.
    { price: '30', currency: 'eur', acquired: '20245-01-01' },
  ]);
  assert.equal(s.currencies.length, 1);
  assert.equal(s.currencies[0].spent, 60);
  assert.deepEqual(s.currencies[0].years, [{ year: 2024, spent: 10, cars: 1 }]);
  assert.equal(s.currencies[0].undatedCars, 2);
  assert.equal(M.year('2027-01-01', 2027), 2027);
  assert.equal(M.year('2028-01-01', 2027), null);
});

test('merged-away cars are left out of the in-memory summary too', () => {
  const rows = M.fromCars([{ price: '10', currency: 'EUR' }, { price: '10', currency: 'EUR', archived: true, merge: { into: 'x' } }]);
  assert.equal(rows.length, 1);
});

test('unreadable amounts are counted and left out', () => {
  const s = M.summarize([{ price: 'about 50', currency: 'EUR' }, { price: '10', currency: 'EUR' }]);
  assert.equal(s.counts.unreadable, 1);
  assert.equal(s.currencies[0].value, 10);
});

test('an empty collection has nothing to show', () => {
  assert.deepEqual(M.summarize([]), { currencies: [], counts: { active: 0, valued: 0, priceOnly: 0, unknown: 0, unreadable: 0 } });
});

test('the database summary matches the in-memory one and loads no car records', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-value-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(path.join(dir, 'db.sqlite'));
  const save = data => s.mutate('car.save', { revision: s.data.revision, data }, { snapshot: false }).result;
  save({ name: 'A', price: '100', currency: 'EUR', acquired: '2024-03-01', valuation: '120', privateNotes: 'x' });
  save({ name: 'B', price: '50,50', currency: 'EUR', acquired: '2025-03-01' });
  save({ name: 'C', price: '30', currency: 'EUR', acquired: '2025-04-01', collectionStatus: 'wishlist' });
  const d = new Store(s.file, { deferred: true });
  const fromDb = require('../src/sqlite-query.cjs').read(d, null, r => V.summary(r)).value;
  assert.deepEqual(fromDb, V.fromData(s.data));
  assert.equal(fromDb.currencies[0].value, 170.5);
  assert.ok(!d.deferredState.stats.loadedSections.includes('cars'), 'cars were not loaded into memory');
  const view = require('../src/view-query.cjs').view(d, { page: 'Overview' });
  assert.deepEqual(view._view.value, fromDb, 'the Overview page receives it');
});
