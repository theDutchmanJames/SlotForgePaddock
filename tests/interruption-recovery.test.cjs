'use strict';
// What is left behind when a backup or a Dealership copy is cut off (computer switched off, app killed),
// and that it is cleaned up without touching work that is still in progress.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../src/store.cjs'),
  { Network } = require('../src/network.cjs'),
  { Club } = require('../src/club.cjs'),
  Sync = require('../src/club-sync.cjs'),
  B = require('../src/portable-backup.cjs');
const tmp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-interrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const age = (file, days) => {
  const when = new Date(Date.now() - days * 86400000);
  fs.utimesSync(file, when, when);
};

test('a backup clears day-old leftovers of cut-off backups in its folder, and keeps recent ones', t => {
  const dir = tmp(t),
    store = new Store(path.join(dir, 'db.sqlite'));
  store.mutate('car.save', { data: { name: 'Backed up' } });
  const folder = path.join(dir, 'backups');
  fs.mkdirSync(folder);
  const name = id => path.join(folder, '.slotforge-backup-' + id + '.tmp');
  const oldTemp = name('00000000-0000-4000-8000-000000000001'),
    oldJournal = oldTemp + '-journal',
    recent = name('00000000-0000-4000-8000-000000000002'),
    unrelated = path.join(folder, 'my notes.tmp');
  for (const f of [oldTemp, oldJournal, recent, unrelated]) fs.writeFileSync(f, 'x');
  for (const f of [oldTemp, oldJournal, unrelated]) age(f, 2);
  B.exportBackup(store.file, path.join(folder, 'today.sfpbackup'), { expectedIdentity: store.expectedIdentity });
  assert.equal(fs.existsSync(oldTemp), false);
  assert.equal(fs.existsSync(oldJournal), false);
  assert.equal(fs.existsSync(recent), true, 'a recent leftover may still be written by another computer');
  assert.equal(fs.existsSync(unrelated), true, 'other files are never touched');
  assert.ok(fs.existsSync(path.join(folder, 'today.sfpbackup')));
});

test('a member start removes photo staging left by a cut-off copy', async t => {
  const dir = tmp(t);
  const leftover = path.join(dir, 'sync-stage-abc123');
  fs.mkdirSync(leftover);
  fs.writeFileSync(path.join(leftover, 'assets.sqlite'), 'photos');
  const store = new Store(path.join(dir, 'own.sqlite'));
  store.mutate('car.save', { data: { name: 'Member' } });
  const club = new Club(store, new Network(store), dir);
  t.after(() => club.close());
  assert.equal(fs.existsSync(leftover), false, 'a fresh leftover from a previous run is removed at start');
});

test('a staging folder in use by a running copy survives a cleanup pass', async t => {
  const root = tmp(t),
    png = require('./support/thumbnail-images.cjs');
  const make = name => {
    const dir = path.join(root, name),
      store = new Store(path.join(dir, 'db.sqlite'));
    store.mutate('car.save', {
      data: { name, photos: [{ id: 'p-' + name, name: 'Front', data: png(40, 30, name.length * 20) }] }
    });
    const net = new Network(store),
      club = new Club(store, net, dir);
    t.after(async () => {
      club.close();
      await net.stop();
      net.close();
    });
    return { store, net, club, dir };
  };
  const h = make('host'),
    c = make('member');
  h.club.enable('Dealership', 'test password', false);
  await h.net.start();
  let release, inUse;
  const paused = new Promise(r => (release = r));
  const request = c.club.request.bind(c.club);
  c.club.request = async (route, ...rest) => {
    if (route.includes('/sync/asset') && !inUse) {
      inUse = fs.readdirSync(c.dir).filter(n => n.startsWith('sync-stage-'));
      new Sync.Snapshots(c.club); // runs the start-up cleanup while this copy is downloading
      inUse = inUse.filter(n => fs.existsSync(path.join(c.dir, n)));
      await paused;
    }
    return request(route, ...rest);
  };
  const joining = c.club.connect({ address: '127.0.0.1:' + h.net.port, code: h.net.clubCode, name: 'Member' });
  for (let i = 0; i < 200 && !inUse; i++) await new Promise(r => setTimeout(r, 20));
  release();
  await joining;
  assert.equal(inUse.length, 1, 'the staging folder of the running copy was kept');
  assert.equal(c.club.state, 'connected');
  assert.deepEqual(
    fs.readdirSync(c.dir).filter(n => n.startsWith('sync-stage-')),
    [],
    'removed once the copy finished'
  );
});

test('a quiet transfer left by a member that went away makes room for a new join', async t => {
  const root = tmp(t);
  const make = name => {
    const dir = path.join(root, name),
      store = new Store(path.join(dir, 'db.sqlite'));
    store.mutate('car.save', { data: { name } });
    const net = new Network(store),
      club = new Club(store, net, dir);
    t.after(async () => {
      club.close();
      await net.stop();
      net.close();
    });
    return { store, net, club };
  };
  const h = make('host');
  h.club.enable('Dealership', 'test password', false);
  const snaps = h.club.snapshots;
  const a = snaps.create(),
    b = snaps.create();
  // Both are being downloaded right now: a third join must wait.
  assert.throws(() => snaps.create(), /Two snapshot transfers/);
  // One member went away mid-copy 20 seconds ago.
  snaps.sessions.get(a.id).used = Date.now() - 20000;
  const c = snaps.create();
  assert.equal(snaps.sessions.has(a.id), false, 'the quiet transfer gave way');
  assert.ok(snaps.sessions.has(b.id) && snaps.sessions.has(c.id));
  // A transfer that keeps asking for pieces stays protected.
  snaps.sessions.get(b.id).used = Date.now() - 20000;
  snaps.get(b.id);
  assert.throws(() => snaps.create(), /Two snapshot transfers/);
  for (const id of [b.id, c.id]) snaps.release(id);
});
