'use strict';
// Desktop side of "Move library…". The move itself (copy, verify, repoint
// library.json) is in shared-library-location.cjs. Paddock never moves the
// file it has open: it saves a request, restarts, and moves before opening.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const REQUEST = 'library-move-request.json';
// Folder names used by common sync clients. Sync tools copy files while SQLite
// is writing them, which can corrupt the library, so we warn (not block).
const CLOUD =
  /(^|[\\/])(OneDrive(\s*-\s*[^\\/]*)?|Dropbox|Google Drive|GoogleDrive|My Drive|iCloud\s?Drive|iCloudDrive|Mobile Documents|CloudStorage|Box|Box Sync|pCloud\s?Drive|MEGA|MEGAsync|Nextcloud|ownCloud|Sync|SynologyDrive|Tresorit)([\\/]|$)/i;
const fault = (code, message) => Object.assign(Error(message), { code });
function same(a, b) {
  a = path.resolve(a);
  b = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}
// Check a folder the user picked. Returns what the confirmation needs to show.
function inspect(
  folder,
  { file, appFolder, platform = process.platform, requireSpace = require('./storage-resources.cjs').requireSpace }
) {
  if (typeof folder !== 'string' || !folder || !path.isAbsolute(folder))
    throw fault('INVALID_LOCATION', 'Choose a complete folder path.');
  folder = path.resolve(folder);
  if (platform === 'win32' && /^\\\\/.test(folder))
    throw fault(
      'NETWORK_LOCATION',
      'Choose a folder on this computer. Network folders are not safe for the shared library.'
    );
  if (same(folder, path.dirname(file))) throw fault('INVALID_LOCATION', 'The library is already in this folder.');
  if (appFolder && inside(folder, appFolder))
    throw fault('INVALID_LOCATION', 'Choose a folder outside the Paddock program folder. Updates replace that folder.');
  const target = path.join(folder, require('./shared-library-location.cjs').TARGET_NAME);
  if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory())
    throw fault('INVALID_LOCATION', 'This is a file, not a folder. Choose a folder.');
  if ([target, target + '-wal', target + '-journal'].some(f => fs.existsSync(f)))
    throw fault('TARGET_EXISTS', 'This folder already contains a library.sqlite file. Choose another folder.');
  // SQLite needs room for "<temp copy>-journal" within Windows' 260-character path limit.
  if (platform === 'win32' && (target + '.' + crypto.randomUUID() + '.tmp-journal').length >= 260)
    throw fault('LOCATION_TOO_LONG', 'This folder path is too long. Choose a folder with a shorter path.');
  // Check the folder without leaving new folders behind if the user then cancels.
  let created, result;
  try {
    created = fs.mkdirSync(folder, { recursive: true });
  } catch {
    throw fault('LOCATION_NOT_WRITABLE', 'Paddock cannot create this folder. Choose a folder you can write to.');
  }
  try {
    const probe = path.join(folder, '.slotforge-write-test-' + crypto.randomUUID());
    try {
      fs.writeFileSync(probe, '', { flag: 'wx' });
    } catch {
      throw fault(
        'LOCATION_NOT_WRITABLE',
        'Paddock cannot save files in this folder. Choose a folder you can write to.'
      );
    } finally {
      try {
        fs.unlinkSync(probe);
      } catch {}
    }
    const size = ['', '-wal'].reduce((n, s) => n + (fs.existsSync(file + s) ? fs.statSync(file + s).size : 0), 0);
    // Room for the copy plus SQLite's own working space.
    try {
      requireSpace(folder, size * 2 + 64 * 1024 * 1024);
    } catch {
      throw fault(
        'NOT_ENOUGH_SPACE',
        'There is not enough free space in this folder for the library. Free some space or choose another drive.'
      );
    }
    result = { folder, target, current: file, size, warnings: [] };
  } finally {
    if (created) removeCreated(created, folder);
  }
  if (CLOUD.test(folder))
    result.warnings.push(
      'This folder looks like it is synced by a cloud service (such as OneDrive, Dropbox or iCloud). Sync tools can damage a database while it is in use. A normal folder on this computer is safer.'
    );
  return result;
}
// Remove folders that inspect() created (deepest first), only while still empty.
function removeCreated(first, folder) {
  for (let dir = path.resolve(folder); ; dir = path.dirname(dir)) {
    try {
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    if (same(dir, first) || same(path.dirname(dir), dir)) return;
  }
}
function requestFile(profile) {
  return path.join(profile, REQUEST);
}
function request(profile, { folder, file, databaseId }) {
  const value = { version: 1, folder, file, databaseId, requestedAt: new Date().toISOString() },
    temp = requestFile(profile) + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx' });
  fs.renameSync(temp, requestFile(profile));
  return value;
}
function pending(profile) {
  try {
    const v = JSON.parse(fs.readFileSync(requestFile(profile), 'utf8'));
    return v &&
      v.version === 1 &&
      [v.folder, v.file].every(p => typeof p === 'string' && path.isAbsolute(p)) &&
      typeof v.databaseId === 'string'
      ? v
      : null;
  } catch {
    return null;
  }
}
function clear(profile) {
  try {
    fs.unlinkSync(requestFile(profile));
  } catch {}
}
// Called at startup before the library is opened. Never throws: a failed move
// leaves the library where it was (the engine undoes partial work) and Paddock
// opens normally. The result is shown to the user once the window is ready.
// A request only counts for the restart it was made for. If that quit was
// cancelled, a much later start must not move the library unannounced.
const REQUEST_LIFETIME_MS = 15 * 60 * 1000;
async function runPending({
  profile,
  root,
  dialog,
  location = require('./shared-library-location.cjs'),
  now = Date.now()
}) {
  const req = pending(profile);
  if (!req) {
    clear(profile);
    return null;
  }
  const age = now - Date.parse(req.requestedAt);
  if (!(age >= 0 && age <= REQUEST_LIFETIME_MS)) {
    clear(profile);
    return {
      status: 'error',
      error:
        'The move was requested a while ago and Paddock did not restart then, so the library was not moved. Choose Move library… again if you still want to move it.'
    };
  }
  for (;;) {
    try {
      await location.recover(root);
      const current = location.read(root);
      if (!current || current.databaseId !== req.databaseId || !same(current.file, req.file)) {
        clear(profile);
        return { status: 'error', error: 'The library changed after the move was requested, so it was not moved.' };
      }
      const result = await location.relocate(root, { file: req.file, databaseId: req.databaseId, folder: req.folder });
      // file = new location; from = the old file, left in place and locked.
      clear(profile);
      return { status: 'moved', file: result.file, from: result.from };
    } catch (e) {
      if (e.code === 'LIBRARY_IN_USE') {
        const r = await dialog.showMessageBox({
          type: 'warning',
          title: 'Close SlotForge Timing first',
          message: 'The library cannot be moved while another app is saving to it.',
          detail:
            'Close SlotForge Timing and any other SlotForge app, then choose Try again.\n\nChoose Cancel move to open Paddock with the library in its current folder.',
          buttons: ['Try again', 'Cancel move'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        });
        if (r.response === 0) continue;
        clear(profile);
        return { status: 'cancelled' };
      }
      clear(profile);
      return { status: 'error', error: e.message };
    }
  }
}
module.exports = { inspect, request, pending, clear, runPending, CLOUD };
