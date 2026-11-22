'use strict';
// Custom car fields: a car section per field, rename, reorder and delete (in both save
// paths), and sorting the Cars page by any custom field or the added built-in fields.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../src/store.cjs');
const V = require('../src/view-query.cjs');
const CarSort = require('../renderer/car-sort.js');
const CustomFields = require('../renderer/custom-fields.js');

function collection(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-custom-fields-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'db.sqlite');
}
const run = (store, scoped, action, p) =>
  scoped ? store.mutateAsync(action, p, { snapshot: false }).then(r => r.result) : store.mutate(action, p).result;

test('a new field remembers its car section; an unknown section is refused', () => {
  const s = new Store();
  s.mutate('custom.add', { label: 'Chassis plate', type: 'text', group: 'Technical & parts' });
  s.mutate('custom.add', { label: 'Club class', type: 'choice' });
  assert.equal(s.data.customFields[0].group, 'Technical & parts');
  assert.equal(Object.hasOwn(s.data.customFields[1], 'group'), false);
  assert.equal(CustomFields.section(s.data.customFields[1]), 'Identity & ownership');
  assert.equal(CustomFields.section({ group: 'Something from another app' }), 'Identity & ownership');
  assert.throws(() => s.mutate('custom.add', { label: 'X', type: 'text', group: 'Setups' }), /car section/);
  assert.throws(() => s.mutate('custom.add', { label: 'club CLASS', type: 'text' }), /already exists/);
});

for (const scoped of [false, true])
  test('rename, move and delete a field (' + (scoped ? 'scoped' : 'full') + ' save path)', async t => {
    const file = collection(t);
    let store = new Store(file);
    store.mutate('custom.add', { label: 'Body weight', type: 'number', group: 'Technical & parts' });
    store.mutate('custom.add', { label: 'Club class', type: 'choice' });
    store.mutate('custom.add', { label: 'Glue used', type: 'text', group: 'Technical & parts' });
    const [weight, club, glue] = store.data.customFields.map(f => f.id);
    const a = store.mutate('car.save', { data: { name: 'A', custom: { [weight]: '21.5', [club]: 'GT' } } }).result;
    const b = store.mutate('car.save', { data: { name: 'B', custom: { [club]: '' } } }).result;
    store.mutate('car.save', { data: { name: 'C' } });
    store.mutate('columns.save', { revision: store.data.revision, columns: ['name', 'custom_' + weight, 'maker'] });
    store.mutate('view.save', { name: 'Heavy first', sort: 'custom_' + weight, sortDirection: 'desc' });
    if (scoped) store = new Store(file, { deferred: true });

    await run(store, scoped, 'custom.edit', { id: weight, label: 'Body weight (g)', group: 'Technical & parts' });
    await assert.rejects(
      async () => run(store, scoped, 'custom.edit', { id: weight, label: 'Club class' }),
      /already exists/
    );
    await assert.rejects(
      async () => run(store, scoped, 'custom.edit', { id: weight, label: 'W', type: 'text' }),
      /type/
    );
    // Glue moves up past Club class (another section) to sit above Body weight.
    assert.equal((await run(store, scoped, 'custom.move', { id: glue, direction: 'up' })).moved, true);
    assert.equal((await run(store, scoped, 'custom.move', { id: glue, direction: 'up' })).moved, false);
    let saved = new Store(file).snapshot();
    assert.deepEqual(
      saved.customFields.map(f => f.label),
      ['Glue used', 'Club class', 'Body weight (g)']
    );
    assert.equal(saved.customFields[2].revision, 2);

    await assert.rejects(
      async () => run(store, scoped, 'custom.delete', { id: weight, revision: saved.revision }),
      /Confirm/
    );
    const result = await run(store, scoped, 'custom.delete', { id: weight, revision: saved.revision, confirmed: true });
    assert.equal(result.cleared, 1);
    saved = new Store(file).snapshot();
    assert.deepEqual(
      saved.customFields.map(f => f.id),
      [glue, club]
    );
    const carA = saved.cars.find(c => c.id === a);
    assert.deepEqual(carA.custom, { [club]: 'GT' });
    assert.deepEqual(saved.cars.find(c => c.id === b).custom, { [club]: '' });
    const removed = saved.events.find(e => e.carId === a && e.title === 'Custom field removed');
    assert.equal(removed.notes, 'Body weight (g): 21.5');
    assert.deepEqual(saved.settings.columns, ['name', 'maker']);
    assert.equal(saved.views[0].sort, 'name');
    assert.equal(saved.views[0].columns.includes('custom_' + weight), false);
  });

test('the added sorts order numbers, dates and yes/no properly, with empty values last', () => {
  assert.equal(CarSort.number('€ 45,50'), 45.5);
  assert.equal(CarSort.number('1,234.5'), 1234.5);
  assert.equal(CarSort.number('about 1972'), 1972);
  assert.equal(CarSort.number('unknown'), null);
  const cars = [
    { id: '1', price: '9', custom: { y: 'No' } },
    { id: '2', price: '' },
    { id: '3', price: '10,50', custom: { y: 'Yes' } },
    { id: '4', price: '100' }
  ];
  const order = (key, dir, kind) =>
    [...cars]
      .sort((x, y) => CarSort.compare(x, y, key, dir, kind))
      .map(c => c.id)
      .join('');
  assert.equal(order('price', 'asc'), '1342');
  assert.equal(order('price', 'desc'), '4312');
  assert.equal(order('custom_y', 'asc', 'yesno'), '3124');
  assert.equal(CarSort.valid('custom_abc-1'), true);
  assert.equal(CarSort.valid('custom_x y'), false);
  const options = CarSort.options([{ id: 'w', label: 'Weight', type: 'number' }]);
  assert.deepEqual(options.at(-1), { key: 'custom_w', label: 'Weight', kind: 'number', custom: true });
});

test('the Cars page sorts a saved collection by a custom number field and by purchase price', t => {
  const file = collection(t),
    s = new Store(file);
  s.mutate('custom.add', { label: 'Weight', type: 'number' });
  s.mutate('custom.add', { label: 'Painted', type: 'yesno' });
  const [w, p] = s.data.customFields.map(f => f.id);
  const add = (name, weight, painted, price) =>
    s.mutate('car.save', { data: { name, price, custom: { [w]: weight, [p]: painted } } });
  add('Light', '18', 'No', '45');
  add('Heavy', '120', 'Yes', '9,50');
  add('None', '', '', '');
  add('Mid', '21.5', 'Yes', '1,200.00');
  const names = (sort, sortDirection) =>
    V.view(new Store(file, { deferred: true }), { page: 'Cars', sort, sortDirection }).cars.map(c => c.name);
  assert.deepEqual(names('custom_' + w, 'asc'), ['Light', 'Mid', 'Heavy', 'None']);
  assert.deepEqual(names('custom_' + w, 'desc'), ['Heavy', 'Mid', 'Light', 'None']);
  const painted = names('custom_' + p, 'asc');
  assert.deepEqual(
    [painted.slice(0, 2).sort(), painted.slice(2)],
    [
      ['Heavy', 'Mid'],
      ['Light', 'None']
    ]
  );
  assert.deepEqual(names('price', 'asc'), ['Heavy', 'Light', 'Mid', 'None']);
  // A deleted (unknown) field falls back to Name.
  assert.deepEqual(names('custom_gone', 'asc'), ['Heavy', 'Light', 'Mid', 'None']);
  assert.deepEqual(names('name', 'asc'), ['Heavy', 'Light', 'Mid', 'None']);
});
