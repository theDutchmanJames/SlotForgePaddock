'use strict';
// The shared-library worker keeps its view of the library between requests while nothing
// changed (see shared-library-worker.cjs). These tests make sure "nothing changed" is never
// assumed wrongly: the other application's saves must show at the very next request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../packages/shared-library/index.cjs');
const { Store } = require('../src/store.cjs');

async function library(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-reuse-'));
  const h = await open({ application: 'Timing', installationId: 'Timing', sharedRoot: root, legacyProfiles: [] });
  t.after(async () => {
    await h.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const status = await h.status();
  let n = 0;
  const create = name =>
    h.carWrite({
      databaseId: status.databaseId,
      recoveryId: status.recoveryId,
      operationId: 'reuse-test-' + ++n,
      action: 'create',
      set: { name, maker: 'Scalextric' }
    });
  // What Paddock does: its own long-lived store saving into the same file.
  const paddock = name =>
    new Store(status.file, { deferred: true }).mutate('car.save', { data: { name } }, { snapshot: false });
  const names = async () => (await h.catalogue()).cars.map(c => c.fields.name).sort();
  return { h, status, create, paddock, names };
}

test("the other application's save shows at the next request", async t => {
  const { h, create, paddock, names } = await library(t);
  await create('From Timing');
  assert.deepEqual(await names(), ['From Timing']);
  assert.deepEqual(await names(), ['From Timing'], 'asking again changes nothing');
  paddock('From Paddock');
  assert.deepEqual(await names(), ['From Paddock', 'From Timing'], 'a save by Paddock is seen at once');
  const revision = (await h.status()).revision;
  paddock('Second from Paddock');
  assert.ok((await h.status()).revision > revision, 'so is the new revision');
  assert.equal((await names()).length, 3);
});

test('saves from both sides, in turn, never lose or repeat a car', async t => {
  const { create, paddock, names } = await library(t);
  for (let i = 1; i <= 4; i++) {
    await create('Timing ' + i);
    paddock('Paddock ' + i);
    assert.equal((await names()).length, i * 2);
  }
  assert.deepEqual(await names(), [1, 2, 3, 4].flatMap(i => ['Paddock ' + i, 'Timing ' + i]).sort());
});

test('a failed request does not leave a stale view behind', async t => {
  const { h, create, paddock, names } = await library(t);
  await create('Before');
  await assert.rejects(() => h.car('no-such-car'));
  paddock('After the failure');
  assert.deepEqual(await names(), ['After the failure', 'Before']);
  await assert.rejects(() => h.carWrite({ action: 'create', set: { name: 'Bad request' } }));
  assert.equal((await names()).length, 2, 'a rejected write changes nothing');
});

test('many requests in a row stay correct while the library is unchanged', async t => {
  const { h, create, names } = await library(t);
  await create('Only car');
  const id = (await h.catalogue()).cars[0].id;
  const answers = await Promise.all([...Array(40)].map((_, i) => (i % 2 ? h.car(id) : h.status())));
  assert.equal(answers.filter(a => a?.revision !== undefined).length >= 20, true);
  assert.deepEqual(await names(), ['Only car']);
});
