'use strict';
// Keeps saving into a collection until it is killed. After each save is confirmed it appends the
// revision to an acknowledgement file (synced to disk), so the parent knows what must survive.
const fs = require('node:fs'),
  path = require('node:path');
const SRC = path.join(__dirname, '../../src');
const { Store } = require(SRC + '/store.cjs'),
  png = require('../support/thumbnail-images.cjs');
const [file, ackFile, mode, seedText] = process.argv.slice(2);
let s = Number(seedText) || 1;
const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const ack = text => {
  const fd = fs.openSync(ackFile, 'a');
  fs.writeSync(fd, text + '\n');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
};
(async () => {
  let store = new Store(file, { deferred: true });
  const photos = [png(1600, 1200, 30), png(1200, 1600, 200), png(2000, 1000, 90)];
  for (let i = 0; ; i++) {
    const data = store.data,
      cars = data.cars,
      parts = data.parts;
    const car = pick(cars),
      part = pick(parts);
    const choices = [
      ['car.save', { id: car.id, revision: car.revision, data: { name: 'Car ' + i, notes: 'x'.repeat(i % 500) } }],
      ['car.save', { data: { name: 'New ' + i, photos: [{ id: 'p' + i, name: 'Front', data: pick(photos) }] } }],
      ['car.save', { id: car.id, revision: car.revision, data: { picture: pick(photos) } }],
      ['work.add', { carId: car.id, title: 'Service ' + i, type: 'maintenance' }],
      ['part.save', { data: { name: 'Part ' + i, quantity: 3, tracking: 'quantity', category: 'Tyres' } }],
      part && [
        'part.install',
        { carId: car.id, partId: part.id, quantity: 1, field: pick(['motor', 'rearTyres', 'gears']) }
      ]
    ].filter(Boolean);
    const [action, payload] = pick(choices);
    if (mode === 'backup' && i % 3 === 0) {
      const { BackupJobs } = require(SRC + '/backup-jobs.cjs');
      const jobs = new BackupJobs(),
        target = path.join(path.dirname(file), 'backup-' + i + '.sfpbackup');
      await store.exclusiveFileOperation(() =>
        jobs.run('export', store.file, target, {
          expectedIdentity: store.expectedIdentity,
          protectedFiles: store.protectedFiles()
        })
      );
      ack('backup ' + target + ' ' + store.data.revision);
      continue;
    }
    try {
      await store.mutateAsync(action, payload, { snapshot: false });
      ack('rev ' + store.data.revision);
    } catch (e) {
      ack('refused ' + action + ' ' + e.message.slice(0, 120));
    }
    // Reopen now and then, as a new worker job does.
    if (i % 7 === 6) store = new Store(file, { deferred: true });
  }
})().catch(e => {
  ack('crash ' + e.stack);
  process.exit(1);
});
