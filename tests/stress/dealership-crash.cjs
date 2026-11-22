'use strict';
// Kills a Dealership member at random moments while it copies the collection (photos, saving the copy),
// restarts it in the same folder, and checks it opens, can join again, and ends with the host's collection.
// Run: npm run stress:dealership (about 4 minutes for 8 rounds). ROUNDS, SEED and RESTART_MS adjust it.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  zlib = require('node:zlib'),
  crypto = require('node:crypto'),
  { fork } = require('node:child_process');
const SRC = path.join(__dirname, '../../src');
const { Store } = require(SRC + '/store.cjs'),
  { Network } = require(SRC + '/network.cjs'),
  { Club } = require(SRC + '/club.cjs');
const ROUNDS = Number(process.env.ROUNDS) || 12;
let seed = Number(process.env.SEED) || 5;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const wait = ms => new Promise(r => setTimeout(r, ms));
// A PNG of random pixels does not compress, so it behaves like a real photo in size.
function noisePng(w, h) {
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, -4)), b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), crypto.randomBytes(w * 3));
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 0 })),
      chunk('IEND', Buffer.alloc(0))
    ]).toString('base64')
  );
}
function member(dir) {
  const child = fork(path.join(__dirname, 'dealership-crash-member.cjs'), [dir], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  let stderr = '';
  child.stderr.on('data', b => (stderr += b));
  const pending = new Map();
  let id = 0;
  child.on('message', m => {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (p) m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
  });
  child.on('exit', () => {
    for (const p of pending.values()) p.reject(Error('member stopped ' + stderr.slice(-300)));
    pending.clear();
  });
  return {
    child,
    call: (cmd, arg) =>
      new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        child.send({ id: i, cmd, arg });
      }),
    exited: new Promise(r => child.on('exit', r))
  };
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-dealer-crash-')),
    hostDir = path.join(root, 'host');
  fs.mkdirSync(hostDir);
  const store = new Store(path.join(hostDir, 'library.sqlite'));
  for (let i = 0; i < 40; i++)
    store.mutate('car.save', {
      data: { name: 'Car ' + i, photos: [{ id: 'p' + i, name: 'Front', data: noisePng(700, 700) }] }
    });
  const net = new Network(store),
    club = new Club(store, net, hostDir);
  club.enable('Crash host', 'crash password', false);
  await net.start();
  const address = '127.0.0.1:' + net.port,
    code = net.clubCode;
  const problems = [];
  let killed = 0,
    finished = 0;
  for (let round = 0; round < ROUNDS; round++) {
    const dir = path.join(root, 'member' + round);
    // Kill the first attempt at a random moment, possibly several times in a row.
    const kills = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < kills; k++) {
      const m = member(dir);
      await m.call('init');
      const joining = m.call('connect', { address, code }).catch(() => {});
      await wait(150 + Math.floor(rnd() * 3500));
      m.child.kill('SIGKILL');
      killed++;
      await m.exited;
      await joining;
    }
    // A computer that was switched off takes a while to start again.
    await wait(Number(process.env.RESTART_MS) || 20000);
    // Start again: it must open and join, ending with the host's collection.
    const m = member(dir);
    try {
      const before = await m.call('init');
      const after = await m.call('connect', { address, code });
      if (after.state !== 'connected' || after.rev !== store.data.revision || after.cars !== store.data.cars.length)
        problems.push({
          round,
          kind: 'joined wrong',
          before,
          after,
          host: { rev: store.data.revision, cars: store.data.cars.length }
        });
      else finished++;
      const check = await m.call('verify');
      if (!check.ok) problems.push({ round, kind: 'copy check', check });
      const left = fs.readdirSync(dir).filter(n => n.startsWith('sync-'));
      if (left.length) console.log('round', round, 'temporary leftovers after rejoining:', left.join(', '));
    } catch (e) {
      problems.push({ round, kind: 'restart failed', detail: e.message.slice(0, 900) });
    } finally {
      m.child.kill('SIGKILL');
      await m.exited;
    }
  }
  console.log(JSON.stringify({ rounds: ROUNDS, killed, finished, problems }, null, 1));
  club.close();
  await net.stop?.();
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(problems.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
