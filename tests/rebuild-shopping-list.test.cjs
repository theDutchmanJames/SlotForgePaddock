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
