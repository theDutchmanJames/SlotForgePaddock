'use strict';
const test = require('node:test'),
  assert = require('node:assert'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { Club } = require('../src/club.cjs');

test('automatic Dealership backups keep the newest three; one-off backups are never removed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-prune-')),
    folder = path.join(dir, 'club-backups');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(folder);
  const make = (label, time) => {
    const file = path.join(folder, label + '-' + time + '-' + crypto.randomUUID() + '.sfpbackup');
    fs.writeFileSync(file, 'x');
    return file;
  };
  for (let i = 1; i <= 6; i++) make('before-update', 1000 + i);
  for (let i = 1; i <= 5; i++) make('before-sync-replacement', 2000 + i);
  make('before-joining', 1);
  make('before-joining', 2);
  make('leaving-club', 3);
  fs.writeFileSync(path.join(folder, 'unsent-proposals-1-x.json'), '{}');
  // The backup just written is kept even if its clock time looks older.
  const club = { folder: dir, backupPath: make('before-update', 999) };
  for (const label of ['before-update', 'before-sync-replacement', 'before-joining', 'leaving-club'])
    Club.prototype.pruneBackups.call(club, label);
  const left = fs
    .readdirSync(folder)
    .map(n => n.replace(/-[0-9a-f-]{36}\.sfpbackup$/, ''))
    .sort();
  assert.deepEqual(left, [
    'before-joining-1',
    'before-joining-2',
    'before-sync-replacement-2003',
    'before-sync-replacement-2004',
    'before-sync-replacement-2005',
    'before-update-1004',
    'before-update-1005',
    'before-update-1006',
    'before-update-999',
    'leaving-club-3',
    'unsent-proposals-1-x.json'
  ]);
});
