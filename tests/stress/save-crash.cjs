'use strict';
// Pulls the plug on a saving Paddock process at random moments, then checks the collection:
// it opens with its integrity checks, every confirmed save is still there, and backups that
// finished can be restored. Run: npm run stress:crash (or stress:crash-backups). ROUNDS and SEED adjust it.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawn } = require('node:child_process'),
  { DatabaseSync } = require('node:sqlite');
const SRC = path.join(__dirname, '../../src');
const { Store } = require(SRC + '/store.cjs'),
  T = require(SRC + '/timing-integration.cjs'),
  { fixtures } = require('../support/timing-fixtures.cjs');
const ROUNDS = Number(process.env.ROUNDS) || 30,
  MODE = process.env.MODE || (process.argv.includes('--backups') ? 'backup' : 'saves');
let seed = Number(process.env.SEED) || 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-crash-')),
    file = path.join(dir, 'db.sqlite'),
    ackFile = path.join(dir, 'ack.txt');
  const f = fixtures(),
    s0 = new Store(file);
  s0.replace(f.store.snapshot());
  T.receive(s0, f.normal);
  s0.mutate('part.save', { data: { name: 'Stock motor', quantity: 30, tracking: 'quantity' } });
  const problems = [];
  let kills = 0,
    confirmed = 0,
    backupsChecked = 0;
  for (let round = 0; round < ROUNDS; round++) {
    fs.writeFileSync(ackFile, '');
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'save-crash-child.cjs'), file, ackFile, MODE, String(round + 1)],
      {
        stdio: ['ignore', 'ignore', 'pipe']
      }
    );
    let stderr = '';
    child.stderr.on('data', b => (stderr += b));
    const exited = new Promise(r => child.on('exit', r));
    // Let it get going, then kill it at a random moment.
    await wait(400 + Math.floor(rnd() * 2600));
    child.kill('SIGKILL');
    kills++;
    await exited;
    const acks = fs.readFileSync(ackFile, 'utf8').trim().split('\n').filter(Boolean);
    const crash = acks.find(a => a.startsWith('crash'));
    if (crash)
      problems.push({ round, kind: 'child crashed on its own', detail: crash.slice(0, 600) + stderr.slice(-400) });
    const revs = acks.filter(a => a.startsWith('rev ')).map(a => Number(a.split(' ')[1]));
    confirmed += revs.length;
    const lastConfirmed = revs.length ? Math.max(...revs) : 0;
    // 1. Raw SQLite integrity.
    try {
      const db = new DatabaseSync(file);
      const ic = db.prepare('PRAGMA integrity_check').get();
      const fk = db.prepare('PRAGMA foreign_key_check').all();
      db.close();
      if (Object.values(ic)[0] !== 'ok' || fk.length)
        problems.push({ round, kind: 'sqlite integrity', detail: JSON.stringify({ ic, fk: fk.slice(0, 3) }) });
    } catch (e) {
      problems.push({ round, kind: 'sqlite open', detail: e.message });
    }
    // 2. Paddock opens it fully (all validation) and the deferred way, and has every confirmed save.
    try {
      const full = new Store(file),
        data = full.snapshot();
      if (data.revision < lastConfirmed)
        problems.push({
          round,
          kind: 'lost confirmed save',
          detail: `on disk ${data.revision}, confirmed ${lastConfirmed}`
        });
      const deferred = new Store(file, { deferred: true });
      if (deferred.data.revision !== data.revision)
        problems.push({ round, kind: 'deferred differs', detail: deferred.data.revision + ' vs ' + data.revision });
      // Every photo a car refers to must be readable.
      for (const c of data.cars)
        for (const p of c.photos || [])
          if (!String(p.data).startsWith('data:image/')) problems.push({ round, kind: 'bad photo', detail: c.id });
    } catch (e) {
      problems.push({ round, kind: 'paddock open', detail: e.stack.slice(0, 800) });
      break;
    }
    // 3. Finished backups restore.
    for (const a of acks.filter(a => a.startsWith('backup '))) {
      const [, target, rev] = a.split(' ');
      const staged = path.join(dir, 'restored-' + round + '.sqlite');
      try {
        require(SRC + '/portable-backup.cjs').stageBackup(target, staged);
        const r = new Store(staged).data.revision;
        if (r !== Number(rev)) problems.push({ round, kind: 'backup revision', detail: r + ' vs ' + rev });
        backupsChecked++;
      } catch (e) {
        problems.push({ round, kind: 'backup restore', detail: e.message });
      } finally {
        fs.rmSync(staged, { force: true });
        fs.rmSync(target, { force: true });
      }
    }
    // Unfinished backup leftovers next to the collection.
    const leftovers = fs
      .readdirSync(dir)
      .filter(n => !/^(db\.sqlite(-wal|-shm|-journal)?|ack\.txt|backup-\d+\.sfpbackup)$/.test(n));
    if (leftovers.length) console.log('round', round, 'left behind:', leftovers.join(', '));
    for (const n of fs.readdirSync(dir))
      if (/^backup-\d+\.sfpbackup$/.test(n)) fs.rmSync(path.join(dir, n), { force: true });
  }
  const final = new Store(file).snapshot();
  console.log(
    JSON.stringify(
      {
        mode: MODE,
        kills,
        confirmedSaves: confirmed,
        backupsChecked,
        finalRevision: final.revision,
        cars: final.cars.length,
        problems
      },
      null,
      1
    )
  );
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(problems.length ? 1 : 0);
})();
