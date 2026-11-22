'use strict';
// Starting a rebuild gives it its own shopping list straight away, named "Car · Rebuild …", the same
// way in the full save path and the scoped one the app uses; starting it again adds no second list.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../src/store.cjs');

function rebuildLists(data, jobId) {
  return (data.planning.shoppingLists || []).filter(l => l.source.kind === 'job' && l.source.id === jobId);
}
for (const scoped of [false, true])
  test(
    'starting a rebuild creates its shopping list at once (' + (scoped ? 'scoped' : 'full') + ' save path)',
    async t => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-rebuild-list-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const file = path.join(dir, 'db.sqlite');
      let store = new Store(file);
      const carId = store.mutate('car.save', { data: { name: 'Porsche 917' } }).result;
      store.mutate('part.save', { data: { name: 'Motor', quantity: 2, tracking: 'quantity' } });
      if (scoped) store = new Store(file, { deferred: true });
      const start = () =>
        scoped
          ? store.mutateAsync('rebuild.start', { carId, revision: store.data.revision }, { snapshot: false })
          : store.mutate('rebuild.start', { carId, revision: store.data.revision });
      await start();
      const saved = () => new Store(file).snapshot();
      let data = saved();
      const job = data.jobs.find(j => j.carId === carId && j.category === 'rebuild');
      assert.ok(job, 'the rebuild job exists');
      let lists = rebuildLists(data, job.id);
      assert.equal(lists.length, 1, 'one list for the rebuild');
      assert.equal(lists[0].name, 'Porsche 917 · Rebuild Porsche 917');
      assert.ok(
        data.planning.shoppingLists.some(l => l.id === 'general'),
        'General shopping is still there'
      );
      assert.equal(data.planning.shopping.length, 0, 'nothing to buy until parts are planned');
      // Opening Start rebuild again returns the same rebuild and adds no second list.
      if (scoped) store = new Store(file, { deferred: true });
      await start();
      data = saved();
      lists = rebuildLists(data, job.id);
      assert.equal(lists.length, 1);
      assert.equal(data.buildDrafts.filter(d => d.data.rebuild?.jobId === job.id).length, 1);
    }
  );

for (const scoped of [false, true])
  test(
    'a rebuild’s first planned parts fill its list even after an unrelated stock change (' +
      (scoped ? 'scoped' : 'full') +
      ' save path)',
    async t => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-rebuild-plan-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const file = path.join(dir, 'db.sqlite');
      let s = new Store(file);
      const carId = s.mutate('car.save', { data: { name: 'Old racer' } }).result;
      const motor = s.mutate('part.save', { data: { name: 'Motor', quantity: 0, tracking: 'quantity' } }).result;
      const run = async (action, p) => {
        if (!scoped) return s.mutate(action, { revision: s.data.revision, ...p }).result;
        s = new Store(file, { deferred: true });
        return (await s.mutateAsync(action, { revision: s.data.revision, ...p }, { snapshot: false })).result;
      };
      const draftId = await run('rebuild.start', { carId });
      await run('part.save', { data: { name: 'Unrelated tyres', quantity: 4, tracking: 'quantity' } });
      const plan = structuredClone(new Store(file).snapshot().buildDrafts.find(d => d.id === draftId).data);
      plan.parts = [{ key: 'motor', partId: motor, name: 'Motor', quantity: 2, slot: 'motor', position: 'Motor' }];
      await run('build.draft.save', { id: draftId, data: plan });
      const lines = new Store(file).snapshot().planning.shopping.filter(l => l.buildId === draftId);
      assert.deepEqual(
        lines.map(l => [l.partId, l.quantity]),
        [[motor, 2]]
      );
    }
  );

for (const scoped of [false, true])
  test(
    'renaming a car or its rebuild shows in the rebuild list name (' + (scoped ? 'scoped' : 'full') + ' save path)',
    async t => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-rebuild-name-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const file = path.join(dir, 'db.sqlite');
      let s = new Store(file);
      const carId = s.mutate('car.save', { data: { name: 'Bravo' } }).result;
      const run = async (action, p) => {
        if (!scoped) return s.mutate(action, { revision: s.data.revision, ...p }).result;
        s = new Store(file, { deferred: true });
        return (await s.mutateAsync(action, { revision: s.data.revision, ...p }, { snapshot: false })).result;
      };
      await run('rebuild.start', { carId });
      const shown = () => {
        const page = new Store(file, { deferred: true });
        const v = require('../src/view-query.cjs').view(page, { page: 'Shopping List' });
        return (v.data || v).planning.shoppingLists.filter(l => l.source.kind === 'job').map(l => l.name);
      };
      assert.deepEqual(shown(), ['Bravo · Rebuild Bravo']);
      const car = new Store(file).snapshot().cars.find(c => c.id === carId);
      await run('car.save', { id: carId, revision: car.revision, data: { name: 'Delta' } });
      assert.deepEqual(shown(), ['Delta · Rebuild Bravo'], 'the car rename shows at once');
      const job = new Store(file).snapshot().jobs.find(j => j.carId === carId);
      await run('job.edit', { id: job.id, name: 'Fresh racer', notes: '', category: 'rebuild' });
      assert.deepEqual(shown(), ['Delta · Fresh racer'], 'the job rename shows too');
    }
  );
