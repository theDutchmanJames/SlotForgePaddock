'use strict';
// Everyday paths the rest of the suite never reached (found with a coverage map, November 2026):
// adding a document from a file, phone and assembly photos in JPEG and WebP, leaving a club, and
// removing a spreadsheet import.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../src/store.cjs');
const tmp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-gaps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('a document chosen from disk is read, typed by its extension and checked against its content', t => {
  const { readDocument } = require('../src/documents.cjs'),
    dir = tmp(t);
  const pdf = path.join(dir, 'Receipt.PDF');
  fs.writeFileSync(pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const doc = readDocument(pdf);
  assert.equal(doc.name, 'Receipt.PDF');
  assert.equal(doc.mime, 'application/pdf');
  assert.equal(Buffer.from(doc.data, 'base64').toString().slice(0, 8), '%PDF-1.4');
  const empty = path.join(dir, 'empty.pdf');
  fs.writeFileSync(empty, '');
  assert.throws(() => readDocument(empty), /smaller than 20 MB/);
  const huge = path.join(dir, 'huge.pdf');
  fs.writeFileSync(huge, '%PDF');
  fs.truncateSync(huge, 21 * 1024 * 1024);
  assert.throws(() => readDocument(huge), /smaller than 20 MB/);
  const disguised = path.join(dir, 'photo.png');
  fs.writeFileSync(disguised, '%PDF-1.4 not a picture');
  assert.throws(() => readDocument(disguised), /PNG|Invalid/i);
});

// Minimal image headers: only the parts a dimension reader looks at.
function jpeg(width, height, { progressive = false, padding = false } = {}) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = progressive ? 0xc2 : 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    padding ? Buffer.from([0xff, 0xff]) : Buffer.alloc(0),
    sof,
    Buffer.from([0xff, 0xd9])
  ]);
}
function webp(kind, width, height) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0);
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8);
  b.write(kind, 12);
  if (kind === 'VP8X') {
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  } else if (kind === 'VP8 ') {
    b[23] = 0x9d;
    b[24] = 0x01;
    b[25] = 0x2a;
    b.writeUInt16LE(width, 26);
    b.writeUInt16LE(height, 28);
  } else {
    b[20] = 0x2f;
    b.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  }
  return b;
}
test('phone and assembly photos report width and height for JPEG and every WebP kind', () => {
  const P = require('../src/portal-photo.cjs');
  assert.deepEqual(P.dimensions(jpeg(4000, 3000)), [4000, 3000]);
  assert.deepEqual(P.dimensions(jpeg(1200, 1600, { progressive: true, padding: true })), [1200, 1600]);
  assert.deepEqual(P.dimensions(webp('VP8X', 1920, 1080)), [1920, 1080]);
  assert.deepEqual(P.dimensions(webp('VP8 ', 640, 480)), [640, 480]);
  assert.deepEqual(P.dimensions(webp('VP8L', 300, 200)), [300, 200]);
  assert.deepEqual(P.check(jpeg(4000, 3000)), { width: 4000, height: 3000 });
  assert.throws(() => P.check(jpeg(20001, 10)), /too large/);
  assert.throws(() => P.check(jpeg(9000, 9000)), /too large/);
  assert.throws(() => P.dimensions(Buffer.from('GIF89a')), /JPEG, PNG or WebP/);
  // A cut-off JPEG without a size marker is refused instead of read past its end.
  assert.throws(() => P.dimensions(jpeg(10, 10).subarray(0, 12)), /could not be read/);
});

test('leaving a club keeps a backup of the copy and forgets the pairing', async t => {
  const { Network } = require('../src/network.cjs'),
    { Club } = require('../src/club.cjs'),
    root = tmp(t),
    all = [];
  t.after(async () => {
    for (const x of all) {
      x.club.close();
      await x.net.stop();
      x.net.close();
    }
  });
  const make = name => {
    const dir = path.join(root, name),
      store = new Store(path.join(dir, 'db.sqlite'));
    store.mutate('car.save', { data: { name } });
    const net = new Network(store),
      club = new Club(store, net, dir),
      x = { store, net, club, dir };
    all.push(x);
    return x;
  };
  const h = make('host'),
    c = make('member');
  h.club.enable('Dealership', 'test password', false);
  await h.net.start();
  await c.club.connect({ address: '127.0.0.1:' + h.net.port, code: h.net.clubCode, name: 'Member' });
  assert.equal(c.club.state, 'connected');
  const copyRevision = c.club.cache.data.revision;
  await c.club.leaveAsync();
  assert.equal(c.club.device.pair, null);
  assert.match(path.basename(c.club.backupPath), /^leaving-club-\d+-[0-9a-f-]{36}\.sfpbackup$/);
  const staged = path.join(root, 'restored.sqlite');
  require('../src/portable-backup.cjs').stageBackup(c.club.backupPath, staged);
  assert.equal(new Store(staged).data.revision, copyRevision, 'the backup holds the copy as it was');
  assert.equal(c.store.data.cars[0].name, 'member', 'the computer’s own collection is untouched');
});

test('a finished spreadsheet import can be removed from the list; others stay', async t => {
  const SpreadsheetImports = require('../src/spreadsheet-import.cjs').SpreadsheetImports,
    dir = tmp(t);
  const store = new Store(path.join(dir, 'cars.sqlite'));
  store.persist(store.data);
  const service = new SpreadsheetImports({ profile: path.join(dir, 'profile'), getStore: () => store });
  t.after(() => service.close());
  const pick = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return service.pick(file);
  };
  const a = await pick('a.csv', 'Name\nFirst car\n'),
    b = await pick('b.csv', 'Name\nSecond car\n');
  const ids = service.list ? service.list().map(j => j.id) : null;
  if (ids) assert.ok(ids.includes(a.id) && ids.includes(b.id));
  assert.deepEqual(service.discard(a.id), { removed: true });
  assert.throws(() => service.get(a.id));
  assert.equal(service.get(b.id).id, b.id);
});
