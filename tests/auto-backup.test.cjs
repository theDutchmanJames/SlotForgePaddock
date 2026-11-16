'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
const B = require('../src/portable-backup.cjs');
const { BackupJobs } = require('../src/backup-jobs.cjs');
const A = require('../src/auto-backup.cjs');

const DAY = 24 * 60 * 60 * 1000;
const GIB = 1024 * 1024 * 1024;
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-auto-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(path.join(dir, 'live.sqlite'));
  store.mutate('car.save', { data: { name: 'Auto backup car', picture: photo } });
  const profile = path.join(dir, 'profile');
  fs.mkdirSync(profile);
  const clock = { now: Date.UTC(2026, 10, 16, 12, 0, 0) };
  const notices = [];
  const jobs = new BackupJobs(value => notices.push(value));
  const env = { idle: Infinity, busy: false, disk: { free: 500 * GIB, total: 1000 * GIB } };
  const make = () => new A.AutoBackup({
    profile,
    defaultFolder: path.join(dir, 'Backups'),
    getStore: () => store,
    jobs,
    busy: () => env.busy,
    idleFor: () => env.idle,
    protectedFiles: () => store.protectedFiles(),
    now: () => clock.now,
    disk: async () => env.disk,
    ...overrides,
  });
  const auto = make();
  return { dir, store, profile, clock, jobs, notices, env, make, auto, mine: () => A.pattern(store.data.id, auto.state.installation) };
}

const backups = folder => fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];

test('defaults: on, weekly, keep five, due straight away in the standard folder', t => {
  const f = fixture(t);
  const s = f.auto.status();
  assert.equal(s.enabled, true);
  assert.equal(s.every, 'week');
  assert.equal(s.keep, 5);
  assert.equal(s.folder, path.join(f.dir, 'Backups'));
  assert.equal(s.customFolder, false);
  assert.equal(s.lastSuccess, null);
  assert.equal(s.nextDue, 0);
  assert.match(f.auto.state.installation, /^[a-z0-9]{8}$/);
});

test('waits until Paddock is not in use, then makes a verified complete backup', async t => {
  const f = fixture(t);
  f.env.idle = 5000;
  assert.equal(await f.auto.tick(), null, 'user is active');
  f.env.idle = Infinity;
  f.env.busy = true;
  assert.equal(await f.auto.tick(), null, 'a request or dialog is in progress');
  f.env.busy = false;
  const result = await f.auto.tick();
  assert.ok(result.file.startsWith(path.join(f.dir, 'Backups') + path.sep), 'standard folder is created');
  assert.match(path.basename(result.file), f.mine());
  assert.deepEqual(B.verify(result.file).identity, [f.store.data.id, f.store.data.revision]);
  const s = f.auto.status();
  assert.equal(s.lastSuccess.file, result.file);
  assert.equal(s.lastSuccess.size, fs.statSync(result.file).size);
  assert.equal(s.nextDue, f.clock.now + 7 * DAY);
  assert.equal(s.lastError, null);
  f.clock.now += 6 * DAY;
  assert.equal(await f.auto.tick(), null);
  f.clock.now += DAY + 1000;
  assert.ok(await f.auto.tick());
  assert.equal(backups(path.join(f.dir, 'Backups')).length, 2);
  // The installation id survives a restart, so rotation keeps recognising earlier files.
  assert.equal(f.make().state.installation, f.auto.state.installation);
  assert.ok(f.notices.filter(Boolean).every(n => n.phase.startsWith('Automatic backup · ')));
});

test('"Back up now" works while the user is busy; automatic runs do not', async t => {
  const f = fixture(t);
  f.env.busy = true;
  assert.equal(await f.auto.tick(), null);
  const result = await f.auto.run({ manual: true });
  assert.ok(fs.existsSync(result.file));
  assert.ok(f.notices.filter(Boolean).every(n => n.phase.startsWith('Backup now · ')));
});

test('keeps only the newest backups of this collection on this computer and never touches other files', async t => {
  const f = fixture(t);
  const folder = path.join(f.dir, 'Backups');
  fs.mkdirSync(folder);
  const id = f.store.data.id, me = f.auto.state.installation;
  const at = s => A.fileName(id, me, new Date(0)).replace(/\d{4}-\d{2}-\d{2}-\d{6}/, s);
  const old = ['2026-01-01-000000', '2026-02-01-000000', '2026-03-01-000000'].map(at);
  for (const name of old) fs.writeFileSync(path.join(folder, name), 'old');
  const otherCollection = A.fileName('another-collection-id', me, new Date(Date.UTC(2020, 0, 1)));
  const otherComputer = A.fileName(id, 'otherpc1', new Date(Date.UTC(2020, 0, 1)));
  const own = ['My manual backup.sfpbackup', 'notes.txt', old[0] + '.keep'];
  for (const name of [otherCollection, otherComputer, ...own]) fs.writeFileSync(path.join(folder, name), 'keep me');
  await f.auto.save({ keep: 2 });
  const result = await f.auto.run({ manual: true });
  assert.deepEqual(result.removed.sort(), [old[0], old[1]].sort());
  const left = backups(folder);
  assert.ok(left.includes(old[2]));
  assert.ok(left.includes(path.basename(result.file)));
  for (const name of [otherCollection, otherComputer, ...own]) assert.ok(left.includes(name), name + ' was kept');
});

test('a backup dated after the new one (wrong clock) is never removed, and the new one is kept', async t => {
  const f = fixture(t);
  const folder = path.join(f.dir, 'Backups');
  fs.mkdirSync(folder);
  const future = A.fileName(f.store.data.id, f.auto.state.installation, new Date(2036, 0, 1));
  fs.writeFileSync(path.join(folder, future), 'future');
  await f.auto.save({ keep: 1 });
  const result = await f.auto.run({ manual: true });
  assert.deepEqual(result.removed, []);
  assert.ok(fs.existsSync(result.file));
  assert.ok(fs.existsSync(path.join(folder, future)));
});

test('a last backup dated in the future does not postpone backups for years', t => {
  const f = fixture(t);
  f.auto.state.lastSuccess = { at: Date.UTC(2036, 0, 1), file: 'x', size: 1, databaseId: f.store.data.id };
  assert.equal(f.auto.nextDue(), 0);
  f.auto.state.lastSuccess.at = f.clock.now + 60 * 60 * 1000; // A small clock difference is believed.
  assert.ok(f.auto.nextDue() > f.clock.now);
});

test('a missing custom folder is reported, not created, and retried an hour later', async t => {
  const f = fixture(t);
  const usb = path.join(f.dir, 'usb-drive');
  await assert.rejects(f.auto.save({ folder: usb }), /not available/);
  fs.mkdirSync(usb);
  await f.auto.save({ folder: usb });
  assert.equal(f.auto.status().customFolder, true);
  fs.rmSync(usb, { recursive: true });
  await assert.rejects(f.auto.tick(), e => e.code === 'FOLDER_MISSING');
  assert.equal(fs.existsSync(usb), false, 'a missing drive folder is never created');
  const s = f.auto.status();
  assert.match(s.lastError.message, /not available/);
  assert.equal(s.nextDue, f.clock.now + A.RETRY_AFTER);
  assert.equal(await f.auto.tick(), null, 'no retry within the hour');
  // Changing other settings keeps the custom folder without checking it again.
  await f.auto.save({ keep: 3 });
  await f.auto.save({ folder: null });
  assert.equal(f.auto.status().lastError, null);
  assert.ok(await f.auto.tick());
});

test('a folder that does not respond (sleeping network drive) times out instead of freezing', async t => {
  const f = fixture(t, { folderTimeout: 50, disk: () => new Promise(() => {}) });
  const started = Date.now();
  await assert.rejects(f.auto.tick(), /did not respond/);
  assert.ok(Date.now() - started < 5000);
});

test('leaves a generous amount of free space on the drive', async t => {
  assert.equal(A.reserve(100 * GIB), 5 * GIB);
  assert.equal(A.reserve(8 * GIB), GIB);
  assert.equal(A.reserve(4000 * GIB), 20 * GIB);
  const f = fixture(t);
  f.env.disk = { free: 2 * GIB, total: 100 * GIB };
  await assert.rejects(f.auto.tick(), e => e.code === 'NO_SPACE' && /5 GB free/.test(e.message));
  assert.match(f.auto.status().lastError.message, /free disk space/);
  assert.deepEqual(backups(path.join(f.dir, 'Backups')).filter(n => n.endsWith('.sfpbackup')), []);
});

test('old temporary files from an interrupted backup are cleaned up; recent ones are left alone', async t => {
  const f = fixture(t);
  const folder = path.join(f.dir, 'Backups');
  fs.mkdirSync(folder);
  const stale = path.join(folder, '.slotforge-backup-11111111-2222-3333-4444-555555555555.tmp');
  const fresh = path.join(folder, '.slotforge-backup-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.tmp');
  const other = path.join(folder, '.slotforge-backup-notes.tmp');
  for (const file of [stale, fresh, other]) fs.writeFileSync(file, 'partial');
  const old = new Date(Date.now() - 2 * DAY);
  fs.utimesSync(stale, old, old);
  fs.utimesSync(other, old, old);
  await f.auto.tick();
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true, 'another computer may be writing it now');
  assert.equal(fs.existsSync(other), true);
});

test('gives way to the user: yield() cancels a running backup without leaving files', async t => {
  const f = fixture(t);
  const running = f.auto.tick();
  assert.equal(f.auto.status().running, true);
  await f.auto.yield();
  await assert.rejects(running, e => e.code === 'CANCELLED');
  assert.equal(f.jobs.active, null);
  assert.deepEqual(backups(path.join(f.dir, 'Backups')), []);
  const s = f.auto.status();
  assert.equal(s.running, false);
  assert.equal(s.lastError, null, 'an interruption is not shown as a problem');
  assert.equal(s.nextDue, f.clock.now + A.RETRY_AFTER, 'tries again after a quiet spell');
  const car = f.store.data.cars[0];
  f.store.mutate('car.save', { id: car.id, revision: car.revision, data: { name: 'Edited' } });
});

test('"Back up now" during an automatic run shares it and is no longer interrupted', async t => {
  const f = fixture(t);
  const first = f.auto.run({ manual: false });
  const second = f.auto.run({ manual: true });
  assert.equal(first, second);
  await f.auto.yield();
  await first;
  assert.equal(backups(path.join(f.dir, 'Backups')).length, 1);
});

test('"Back up now" while an automatic run is being stopped starts a fresh backup', async t => {
  const f = fixture(t);
  const automatic = f.auto.run({ manual: false });
  const stopping = f.auto.yield();
  f.clock.now += 1000;
  const manual = f.auto.run({ manual: true });
  await stopping;
  await assert.rejects(automatic, e => e.code === 'CANCELLED');
  const result = await manual;
  assert.ok(fs.existsSync(result.file));
});

test('a backup started by hand is not interrupted by user activity, only by quitting', async t => {
  const f = fixture(t);
  const manual = f.auto.run({ manual: true });
  await f.auto.yield();
  const result = await manual;
  assert.ok(fs.existsSync(result.file));
  f.clock.now += 1000;
  const again = f.auto.run({ manual: true });
  await f.auto.stop();
  await assert.rejects(again, e => e.code === 'CANCELLED');
  assert.equal(await f.auto.tick(), null);
  await assert.rejects(f.auto.run({ manual: true }), /closing/);
});

test('refuses to start while a manual Create backup is running', async t => {
  const f = fixture(t);
  const manual = f.jobs.run('export', f.store.file, path.join(f.dir, 'manual.sfpbackup'), { expectedIdentity: f.store.expectedIdentity });
  assert.equal(await f.auto.tick(), null);
  await assert.rejects(f.auto.run({ manual: true }), e => e.code === 'BUSY');
  await manual;
});

test('a new collection identity (reset or restore) is backed up straight away', async t => {
  const f = fixture(t);
  await f.auto.tick();
  assert.ok(f.auto.status().nextDue > f.clock.now);
  f.store.data.id = 'replaced-collection';
  assert.equal(f.auto.status().lastSuccess, null);
  assert.equal(f.auto.status().nextDue, 0);
});

test('settings are validated, saved for this computer and survive a restart', async t => {
  const f = fixture(t);
  await assert.rejects(f.auto.save({ keep: 0 }), /between/);
  await assert.rejects(f.auto.save({ keep: 51 }), /between/);
  await assert.rejects(f.auto.save({ keep: 2.5 }), /between/);
  await assert.rejects(f.auto.save({ every: 'hour' }), /daily/);
  await assert.rejects(f.auto.save({ enabled: 'yes' }), /on/);
  await assert.rejects(f.auto.save({ folder: 'relative/folder' }), /complete folder/);
  await f.auto.save({ enabled: false, every: 'month', keep: 12 });
  const again = f.make().status();
  assert.equal(again.enabled, false);
  assert.equal(again.every, 'month');
  assert.equal(again.keep, 12);
  assert.equal(again.nextDue, null, 'off means never due');
  assert.equal(await f.auto.tick(), null);
});

test('a damaged settings file falls back to the defaults', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.profile, 'auto-backup.json'), '{not json');
  assert.equal(f.make().status().enabled, true);
  fs.writeFileSync(path.join(f.profile, 'auto-backup.json'), JSON.stringify({ version: 1, settings: { keep: -4 }, installation: '../../x' }));
  const fresh = f.make();
  assert.equal(fresh.status().keep, 5);
  assert.match(fresh.state.installation, /^[a-z0-9]{8}$/);
});

test('BackupJobs labels progress without passing the label to the worker', async t => {
  const f = fixture(t);
  const notices = [];
  const jobs = new BackupJobs(value => notices.push(value));
  await jobs.run('export', f.store.file, path.join(f.dir, 'labelled.sfpbackup'), { label: 'Backup now', expectedIdentity: f.store.expectedIdentity });
  const phases = notices.filter(Boolean).map(n => n.phase);
  assert.ok(phases.length > 1);
  assert.ok(phases.every(p => p.startsWith('Backup now · ')));
  B.verify(path.join(f.dir, 'labelled.sfpbackup'));
});
