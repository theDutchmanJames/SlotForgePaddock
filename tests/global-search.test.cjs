'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/global-search.cjs');

const db = {
  cars: [
    { id: 'c1', name: 'Porsche 917K Gulf', maker: 'Slot.it', reference: 'CA02a', scale: '1:32', number: '2', tags: ['Le Mans'] },
    { id: 'c2', name: 'Citroën DS3 WRC', maker: 'Scalextric', reference: 'C3104' },
    { id: 'c3', name: 'Porsche 956', maker: 'Slot.it', reference: 'CA09', archived: true },
    { id: 'c4', name: 'Porsche 962C', maker: 'Slot.it', collectionStatus: 'wishlist' },
    { id: 'c5', name: 'Merged away Porsche', merge: { into: 'c1' } },
    { id: 'c6', name: 'Ford GT40', maker: 'NSR', location: 'Shelf porsche corner' },
  ],
  parts: [
    { id: 'p1', name: 'Pinion 9T', maker: 'Slot.it', reference: 'PS09', partType: 'Pinion', category: 'Transmission', quantity: 4 },
    { id: 'p2', name: 'Crown 27T', maker: 'Slot.it', reference: 'GS1827', partType: 'Crown', category: 'Transmission', quantity: 0 },
    { id: 'p3', name: 'Old pinion', maker: 'Ninco', partType: 'Pinion', archived: true, quantity: 1 },
  ],
  jobs: [
    { id: 'j1', name: 'Replace braids', carId: 'c1', status: 'active', category: 'braids' },
    { id: 'j2', name: 'Replace tyres', carId: 'c2', status: 'completed', notes: 'Ortmann' },
  ],
  documents: [
    { id: 'd1', guide: true, title: 'Exploded view 917', name: '917-exploded.pdf', carId: 'c1' },
    { id: 'd2', guide: true, title: 'Slot.it catalogue 2026', name: 'catalogue.pdf', carId: null },
    { id: 'd3', title: 'Private receipt porsche', name: 'receipt.pdf', carId: 'c1' },
  ],
};

const ids = group => group.items.map(x => x.id);

test('every word must match, in any order and any field', () => {
  assert.deepEqual(ids(S.search(db, 'gulf porsche').cars), ['c1']);
  assert.deepEqual(ids(S.search(db, 'slot.it 917').cars), ['c1']);
  assert.deepEqual(ids(S.search(db, 'le mans').cars), ['c1'], 'tags are searched');
  assert.deepEqual(ids(S.search(db, 'porsche ferrari').cars), []);
});

test('accents and capitals are ignored', () => {
  assert.deepEqual(ids(S.search(db, 'citroen').cars), ['c2']);
  assert.deepEqual(ids(S.search(db, 'CITROËN ds3').cars), ['c2']);
});

test('ranking: exact reference first, name matches before other fields, collection before wishlist and archive', () => {
  assert.deepEqual(ids(S.search(db, 'ca09').cars), ['c3']);
  assert.equal(S.search(db, 'ps09').parts.items[0].id, 'p1');
  const porsche = ids(S.search(db, 'porsche').cars);
  assert.deepEqual(porsche, ['c1', 'c4', 'c3', 'c6'], 'collection, wishlist, archived; a location match last');
  assert.ok(!porsche.includes('c5'), 'merged-away cars are hidden');
  const car = S.search(db, 'porsche').cars.items.find(c => c.id === 'c4');
  assert.equal(car.wishlist, true);
  assert.match(car.detail, /Wishlist/);
});

test('parts: archived ones are hidden, owned ones first, with what Paddock needs to open them', () => {
  const r = S.search(db, 'pinion');
  assert.deepEqual(ids(r.parts), ['p1']);
  assert.equal(r.parts.items[0].category, 'Transmission');
  assert.equal(r.parts.items[0].owned, true);
  assert.deepEqual(ids(S.search(db, 'slot.it').parts), ['p1', 'p2']);
});

test('jobs are found by their car, notes and category; active jobs first', () => {
  assert.deepEqual(ids(S.search(db, 'replace').jobs), ['j1', 'j2']);
  assert.deepEqual(ids(S.search(db, 'gulf braids').jobs), ['j1']);
  assert.deepEqual(ids(S.search(db, 'ortmann').jobs), ['j2']);
  assert.match(S.search(db, 'braids').jobs.items[0].detail, /Porsche 917K Gulf · Active/);
});

test('only manuals and part guides are searched, never private documents', () => {
  assert.deepEqual(ids(S.search(db, '917').guides), ['d1']);
  assert.deepEqual(ids(S.search(db, 'catalogue').guides), ['d2']);
  assert.deepEqual(ids(S.search(db, 'receipt').guides), []);
  assert.match(S.search(db, 'catalogue').guides.items[0].detail, /General reference/);
});

test('results are limited, with the total reported', () => {
  const many = { cars: Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, name: 'Mini ' + i })) };
  const r = S.search(many, 'mini');
  assert.equal(r.cars.items.length, S.LIMIT);
  assert.equal(r.cars.total, 30);
  assert.equal(S.search(many, 'mini', { limit: 2 }).cars.items.length, 2);
});

test('results carry only labels and ids, never photos or document contents', () => {
  const withMedia = { cars: [{ id: 'c', name: 'Photo car', picture: 'data:image/png;base64,AAAA', privateNotes: 'secret' }] };
  const item = S.search(withMedia, 'photo').cars.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['archived', 'detail', 'id', 'label', 'wishlist']);
});

// ---- The same search on a real SQLite collection, through the index ----
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../src/store.cjs');
const act = (s, a, p = {}) => s.mutate(a, { revision: s.data.revision, ...p }, { snapshot: false }).result;

function stored(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-search-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(path.join(dir, 'db.sqlite'));
  const gulf = act(s, 'car.save', { data: { name: 'Porsche 917K Gulf', maker: 'Slot.it', reference: 'CA02a', picture: 'data:image/png;base64,AAAA', privateNotes: 'Private' } });
  act(s, 'car.save', { data: { name: 'F40 Competizione', maker: 'Scaleauto', marque: 'Ferrari', raceClass: 'GT1', livery: 'Rosso Corsa' } });
  act(s, 'car.save', { data: { name: 'Citroën DS3 WRC', maker: 'Scalextric', reference: 'C3104' } });
  act(s, 'part.save', { data: { name: 'Pinion 9T', maker: 'Slot.it', reference: 'PS09', category: 'Transmission', partType: 'Pinion', quantity: 4, tracking: 'quantity' } });
  act(s, 'part.save', { data: { name: 'Crown 27T', maker: 'Slot.it', reference: 'GS1827', category: 'Transmission', partType: 'Crown', quantity: 0, tracking: 'quantity' } });
  act(s, 'job.start', { kind: 'general', carId: gulf, name: 'Replace braids' });
  s.transact(d => { for (let i = 0; i < 200; i++) d.cars.push({ ...d.cars[2], id: 'mini-' + i, name: 'Mini Cooper ' + i, reference: 'M' + i }); });
  return { s, gulf, open: () => new Store(s.file, { deferred: true }) };
}

function cold(store) {
  for (const bucket of ['cars', 'parts', 'jobs', 'documents']) {
    assert.ok(!store.deferredState.stats.loadedSections.includes(bucket), bucket + ' was loaded into memory');
  }
}

test('stored collections are searched through the index without loading them into memory', t => {
  const { gulf, open } = stored(t);
  const d = open();
  const r = S.searchStore(d, 'gulf porsche');
  assert.deepEqual(ids(r.cars), [gulf]);
  assert.equal(r.cars.items[0].label, 'Porsche 917K Gulf');
  assert.equal(r.cars.items[0].detail, 'Slot.it · CA02a');
  assert.deepEqual(Object.keys(r.cars.items[0]).sort(), ['archived', 'detail', 'id', 'label', 'wishlist']);
  assert.deepEqual(r.jobs.items.map(j => j.label), ['Replace braids'], "a car's jobs are found by the car");
  assert.equal(S.searchStore(d, 'braids').jobs.items[0].detail, 'Porsche 917K Gulf · Active');
  assert.deepEqual(S.searchStore(d, 'slot.it').parts.items.map(p => p.label), ['Pinion 9T', 'Crown 27T'], 'owned first');
  const pinion = S.searchStore(d, 'ps09').parts.items[0];
  assert.ok(pinion.category, 'carries the category needed to open the part');
  assert.equal(pinion.owned, true);
  cold(d);
});

test('stored collections: marque, class and livery are searched; accents are ignored', t => {
  const { open } = stored(t);
  const d = open();
  assert.deepEqual(S.searchStore(d, 'ferrari').cars.items.map(c => c.label), ['F40 Competizione']);
  assert.deepEqual(S.searchStore(d, 'gt1 rosso').cars.items.map(c => c.label), ['F40 Competizione']);
  assert.deepEqual(S.searchStore(d, 'citroen').cars.items.map(c => c.label), ['Citroën DS3 WRC']);
  cold(d);
});

test('stored collections: results are limited and the total is exact', t => {
  const { open } = stored(t);
  const d = open();
  const r = S.searchStore(d, 'mini cooper');
  assert.equal(r.cars.items.length, S.LIMIT);
  assert.equal(r.cars.total, 200);
  assert.equal(S.searchStore(d, 'm17').cars.items[0].label, 'Mini Cooper 17', 'exact reference first');
  cold(d);
});

test('the in-memory and index searches agree', t => {
  const { s, open } = stored(t);
  const d = open();
  for (const q of ['porsche', 'slot.it', 'ferrari', 'braids', 'mini 12', 'nothing here']) {
    const a = S.search(s.data, q), b = S.searchStore(d, q);
    for (const k of ['cars', 'parts', 'jobs', 'guides']) {
      assert.equal(b[k].total, a[k].total, `${q} ${k} total`);
      assert.deepEqual(ids(b[k]), ids(a[k]), `${q} ${k}`);
    }
  }
});

test('folding covers letters that have no accent mark', () => {
  assert.equal(S.fold('Ørsted Łódź Æro Straße'), 'orsted lodz aero strasse');
});

test('empty, missing and invalid input', () => {
  const r = S.search(db, '   ');
  assert.equal(r.cars.total + r.parts.total + r.jobs.total + r.guides.total, 0);
  assert.deepEqual(S.search({}, 'anything').cars, { total: 0, items: [] });
  assert.throws(() => S.search(db, 'x'.repeat(201)), /200 characters/);
  assert.throws(() => S.search(db, 42), /200 characters/);
});
