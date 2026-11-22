'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const SRC = path.join(__dirname, '../../src');
const { Store } = require(SRC + '/store.cjs'),
  { Network } = require(SRC + '/network.cjs'),
  { Club } = require(SRC + '/club.cjs');
const dir = process.argv[2];
let store, net, club;
const cmds = {
  async init() {
    fs.mkdirSync(dir, { recursive: true });
    store = new Store(path.join(dir, 'own.sqlite'));
    if (!store.data.cars.length) store.mutate('car.save', { data: { name: 'Member own car' } });
    net = new Network(store);
    club = new Club(store, net, dir);
    return { files: fs.readdirSync(dir), state: club.state, paired: !!club.device?.pair };
  },
  async connect({ address, code }) {
    if (club.device?.pair && club.state !== 'connected') {
      try {
        await club.connect({ address, code, name: 'Crash member' });
      } catch {
        await club.connect({ address, code, name: 'Crash member' });
      }
    } else await club.connect({ address, code, name: 'Crash member' });
    return { state: club.state, rev: club.cache.data.revision, cars: club.cache.data.cars.length };
  },
  async verify() {
    // Read every photo of the copy and reopen it from disk with all checks.
    const reopened = new Store(club.cache.file).snapshot();
    let photos = 0;
    for (const c of reopened.cars)
      for (const p of c.photos || []) if (String(p.data).startsWith('data:image/png')) photos++;
    return { ok: photos === reopened.cars.filter(c => c.photos?.length).length, photos, revision: reopened.revision };
  }
};
process.on('message', async m => {
  try {
    process.send({ id: m.id, result: await cmds[m.cmd](m.arg) });
  } catch (e) {
    process.send({ id: m.id, error: e.stack });
  }
});
