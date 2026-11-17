'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const VERSION = 1;
function directory({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    if (!env.LOCALAPPDATA) throw Error('Local application data is unavailable.');
    return path.join(env.LOCALAPPDATA, 'SlotForge', 'shared-library', 'v1');
  }
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'SlotForge', 'shared-library', 'v1');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'slotforge', 'shared-library', 'v1');
}
function fault(code, message) {
  return Object.assign(Error(message), { code });
}
// A moved-away library keeps this state key (plus write-blocking triggers) so
// any handle still pointing at the old file stops instead of writing into it.
const MOVED_KEY = 'relocated_to';
function identity(file) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    if (db.prepare('PRAGMA application_id').get().application_id !== 0x53465044)
      throw fault('LIBRARY_FORMAT', 'The registered file is not a compatible shared library.');
    const moved = db.prepare('SELECT value FROM state WHERE key=?').get(MOVED_KEY)?.value;
    if (moved !== undefined) {
      let movedTo = '';
      try {
        movedTo = String(JSON.parse(moved).file || '');
      } catch {}
      throw Object.assign(
        fault('LIBRARY_MOVED', 'The shared library was moved to another folder. Reopen it to continue.'),
        { details: { movedTo } }
      );
    }
    const version = db.prepare("SELECT value FROM state WHERE key='shared_engine_version'").get()?.value;
    if (version !== undefined && version !== String(VERSION))
      throw fault('ENGINE_VERSION', 'Update both apps to use this library.');
    return JSON.parse(db.prepare("SELECT value FROM state WHERE key='identity'").get().value)[0];
  } finally {
    db.close();
  }
}
function read(root) {
  const file = path.join(root, 'library.json');
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
    throw fault('LIBRARY_REGISTRATION', 'Invalid shared library registration.');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (
    value.version !== VERSION ||
    typeof value.databaseId !== 'string' ||
    typeof value.file !== 'string' ||
    !path.isAbsolute(value.file)
  )
    throw fault('LIBRARY_REGISTRATION', 'Unsupported shared library registration.');
  if (!fs.existsSync(value.file))
    throw fault(
      'LIBRARY_MISSING',
      'The shared library is missing. Restore its location; an empty replacement has not been created.'
    );
  if (identity(value.file) !== value.databaseId)
    throw fault('DATABASE_MISMATCH', 'The registered library was replaced by another collection.');
  return value;
}
async function lock(root, fn) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  // SQLite supplies an OS-backed cross-process lock. Process death releases it;
  // there is no stale PID file to delete and no race between stale-lock owners.
  const db = new DatabaseSync(path.join(root, 'coordination.sqlite'), { timeout: 0 });
  let acquired = false;
  try {
    for (let n = 0; n < 6000; n++) {
      try {
        db.exec('BEGIN IMMEDIATE');
        acquired = true;
        break;
      } catch (e) {
        if (e.errcode !== 5 && e.code !== 'SQLITE_BUSY' && !/database is locked/.test(e.message)) throw e;
        await new Promise(r => setTimeout(r, 100));
      }
    }
    if (!acquired) throw fault('LIBRARY_BUSY', 'Another app is preparing the shared library. Retry shortly.');
    db.exec('CREATE TABLE IF NOT EXISTS coordination(version INTEGER NOT NULL);');
    const result = await fn();
    db.exec('COMMIT');
    acquired = false;
    return result;
  } finally {
    if (acquired)
      try {
        db.exec('ROLLBACK');
      } catch {}
    db.close();
  }
}
async function resolve(options = {}) {
  const root = path.resolve(options.sharedRoot || directory());
  let known;
  try {
    known = read(root);
  } catch (error) {
    // An interrupted move leaves its receipt; finish or undo it before reporting the library missing.
    if (['LIBRARY_MISSING', 'LIBRARY_MOVED'].includes(error.code) && fs.existsSync(path.join(root, RELOCATION))) {
      await recover(root);
      known = read(root);
    }
    // library.json names a locked file but no move receipt exists: the move was never published.
    else if (error.code === 'LIBRARY_MOVED') {
      await unlockStranded(root);
      known = read(root);
    } else {
      if (error.code !== 'DATABASE_MISMATCH') throw error;
      await recoverReplacement(root);
      known = read(root);
    }
  }
  // A receipt can also outlive a finished move (cleanup failed after publishing): tidy it up.
  if (known && fs.existsSync(path.join(root, RELOCATION))) {
    await recover(root);
    known = read(root);
  }
  if (known) return { ...known, root };
  return lock(root, async () => {
    const existing = read(root);
    if (existing) return { ...existing, root };
    let file = options.legacyPaddockPath && path.resolve(options.legacyPaddockPath);
    if (file && !fs.existsSync(file) && !fs.existsSync(require('./sqlite-storage.cjs').sqlitePath(file))) file = null;
    // library.json was lost after a move: the old, locked file records where the library went.
    const followed = file && followMoved(root, require('./sqlite-storage.cjs').sqlitePath(file));
    if (followed) return { ...followed, root };
    file = file || path.join(root, 'library.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Store's established JSON/SQLite migration preserves its original source.
    const store = await require('./store.cjs').Store.open(file);
    if (store.expectedIdentity === null) store.persist(store.data);
    file = store.file;
    const db = new DatabaseSync(file, { timeout: 5000 });
    try {
      db.exec('BEGIN IMMEDIATE');
      const release = require('./car-merge-fence.cjs').begin(db);
      db.prepare("INSERT INTO state(key,value) VALUES('shared_engine_version',?) ON CONFLICT(key) DO NOTHING").run(
        String(VERSION)
      );
      release();
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    identity(file);
    const result = { version: VERSION, file: fs.realpathSync(file), databaseId: store.data.id };
    const temporary = path.join(root, 'library-' + nonce() + '.tmp'),
      fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(result));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, path.join(root, 'library.json'));
    return { ...result, root };
  });
}
const nonce = () => crypto.randomUUID();
function saveRegistration(root, value) {
  const temporary = path.join(root, 'library-' + nonce() + '.tmp'),
    fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, path.join(root, 'library.json'));
}
// Called only after an explicitly requested restore/reset by the owning app.
// Existing handles retain their original ID; they cannot write into the new one.
function rebindLocked(root, file, previousId) {
  const registration = path.join(root, 'library.json'),
    old = JSON.parse(fs.readFileSync(registration, 'utf8'));
  if (old.databaseId !== previousId || path.resolve(old.file) !== path.resolve(file))
    throw fault('DATABASE_MISMATCH', 'The shared library registration changed during replacement.');
  const result = { version: VERSION, file: fs.realpathSync(file), databaseId: identity(file) };
  saveRegistration(root, result);
  return result;
}
async function rebind(root, file, previousId) {
  return lock(root, () => rebindLocked(root, file, previousId));
}
function beginLocked(root, file, previousId, lockHeld = false) {
  const old = read(root);
  if (!old || old.databaseId !== previousId || path.resolve(old.file) !== path.resolve(file))
    throw fault('DATABASE_MISMATCH', 'Shared library changed before replacement.');
  const existing = path.join(root, 'replacement.json');
  if (fs.existsSync(existing)) {
    const prior = JSON.parse(fs.readFileSync(existing, 'utf8'));
    let gone = false;
    if (!Number.isInteger(prior.pid) || prior.pid <= 0)
      throw fault('LIBRARY_REGISTRATION', 'Invalid pending replacement receipt.');
    try {
      process.kill(prior.pid, 0);
    } catch (e) {
      gone = e.code === 'ESRCH';
    }
    if (!gone && prior.lockHeld !== true)
      throw fault('LIBRARY_BUSY', 'Another app is already restoring the shared library.');
    // read(root) above proves replacement did not leave a different database ID.
    fs.unlinkSync(existing);
  }
  const ticket = {
      version: 1,
      file: old.file,
      previousId,
      pid: process.pid,
      nonce: nonce(),
      ...(lockHeld ? { lockHeld: true } : {})
    },
    name = path.join(root, 'replacement.json'),
    temp = name + '.' + ticket.nonce + '.tmp',
    fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(ticket));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, name);
  return ticket;
}
async function beginReplacement(root, file, previousId) {
  return lock(root, () => beginLocked(root, file, previousId));
}
function finishLocked(root, ticket) {
  const name = path.join(root, 'replacement.json');
  if (!fs.existsSync(name) || JSON.parse(fs.readFileSync(name, 'utf8')).nonce !== ticket.nonce)
    throw fault('LIBRARY_BUSY', 'The replacement receipt changed before acknowledgement.');
  const current = JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));
  if (current.databaseId === ticket.previousId) rebindLocked(root, ticket.file, ticket.previousId);
  else if (path.resolve(current.file) !== path.resolve(ticket.file) || current.databaseId !== identity(ticket.file))
    throw fault('DATABASE_MISMATCH', 'The shared library changed during replacement acknowledgement.');
  // Registration may already have been durably updated before the worker died.
  fs.unlinkSync(name);
}
async function finishReplacement(root, ticket) {
  return lock(root, () => finishLocked(root, ticket));
}
async function withReplacement(root, file, previousId, fn) {
  return lock(root, async () => {
    const ticket = beginLocked(root, file, previousId, true),
      result = await fn(ticket);
    finishLocked(root, ticket);
    return result;
  });
}
async function recoverReplacement(root) {
  return lock(root, () => {
    const name = path.join(root, 'replacement.json');
    if (!fs.existsSync(name))
      throw fault('DATABASE_MISMATCH', 'The registered library was replaced without a replacement receipt.');
    const ticket = JSON.parse(fs.readFileSync(name, 'utf8')),
      registration = path.join(root, 'library.json'),
      old = JSON.parse(fs.readFileSync(registration, 'utf8'));
    if (
      ticket.version !== 1 ||
      ticket.file !== old.file ||
      ticket.previousId !== old.databaseId ||
      !Number.isInteger(ticket.pid) ||
      ticket.pid <= 0
    )
      throw fault('DATABASE_MISMATCH', 'Invalid library replacement receipt.');
    // A lockHeld ticket is recoverable once this transaction owns the lock, even
    // when only the worker died and the parent application PID is still alive.
    let gone = false;
    try {
      process.kill(ticket.pid, 0);
    } catch (e) {
      gone = e.code === 'ESRCH';
    }
    if (!gone && ticket.lockHeld !== true)
      throw fault('LIBRARY_BUSY', 'Another app is finishing library replacement. Retry shortly.');
    const result = { ...old, databaseId: identity(old.file) };
    saveRegistration(root, result);
    fs.unlinkSync(name);
  });
}

// ---------------------------------------------------------------------------
// Moving the library to another folder.
//
// library.json (in the fixed per-account root) is the only place either app
// looks, so a move is: lock the old file, copy it, verify the copy, repoint
// library.json. Everything runs inside the coordination lock and is recorded in
// relocation.json, so an interrupted move is finished or undone on next open.
//
//  1. Lock the old file IN PLACE: a state marker ("relocated_to") plus triggers
//     that abort every write. Taking the write lock waits for any in-flight save
//     by another app to commit first, so nothing committed is ever lost, and
//     no handle (any engine version, any OS) can save there afterwards.
//     The old file never disappears, so no app can recreate an empty library
//     at the old path, and older launchers still find their file.
//  2. Copy it with SQLite's backup API to a temporary file beside the target,
//     remove the marker and triggers from the copy, run integrity_check.
//  3. Hard-link the copy to <folder>/library.sqlite (fails if one appeared).
//  4. Publish library.json. From this point the move is final: recovery only
//     ever completes it. Before this point, recovery unlocks the old file.
const RELOCATION = 'relocation.json',
  TARGET_NAME = 'library.sqlite',
  TRIGGER_PREFIX = 'library_moved_',
  LOCK_WAIT_MS = 30000;
function samePath(a, b) {
  a = path.resolve(a);
  b = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function realOrSelf(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}
function writeJson(root, name, value) {
  const temporary = path.join(root, name.replace(/\.json$/, '') + '-' + nonce() + '.tmp'),
    fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, path.join(root, name));
}
function readTicket(root) {
  const file = path.join(root, RELOCATION);
  if (!fs.existsSync(file)) return null;
  let t;
  try {
    t = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    t = null;
  }
  if (
    !t ||
    t.version !== 2 ||
    typeof t.databaseId !== 'string' ||
    ![t.from, t.to, t.temp].every(p => typeof p === 'string' && path.isAbsolute(p))
  )
    throw fault('LIBRARY_REGISTRATION', 'Invalid library move receipt. Keep the files and contact support.');
  return t;
}
// strict: only "no library.json yet" counts as none; a read failure (e.g. a
// scanner briefly locking it) is thrown, never mistaken for "no registration".
function registration(root, { strict = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'));
  } catch (e) {
    if (strict && e.code !== 'ENOENT') throw e;
    return null;
  }
}
// Marker and database ID of a locked (moved-away) file, without the LIBRARY_MOVED check.
function movedInfo(file) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    const value = db.prepare('SELECT value FROM state WHERE key=?').get(MOVED_KEY)?.value;
    if (value === undefined) return null;
    let to = '';
    try {
      to = String(JSON.parse(value).file || '');
    } catch {}
    return {
      movedTo: to,
      databaseId: JSON.parse(db.prepare("SELECT value FROM state WHERE key='identity'").get().value)[0]
    };
  } finally {
    db.close();
  }
}
function followMoved(root, file) {
  if (!fs.existsSync(file)) return null;
  let info;
  try {
    info = movedInfo(file);
  } catch {
    return null;
  }
  if (!info || !info.movedTo || !path.isAbsolute(info.movedTo) || !fs.existsSync(info.movedTo)) return null;
  let id;
  try {
    id = identity(info.movedTo);
  } catch {
    return null;
  }
  if (id !== info.databaseId) return null;
  const result = { version: VERSION, file: fs.realpathSync(info.movedTo), databaseId: id };
  writeJson(root, 'library.json', result);
  return result;
}
async function unlockStranded(root) {
  return lock(root, () => {
    if (fs.existsSync(path.join(root, RELOCATION))) return settleLocked(root);
    const current = registration(root, { strict: true });
    if (current && typeof current.file === 'string' && fs.existsSync(current.file)) {
      const info = movedInfo(current.file);
      if (info && info.databaseId === current.databaseId) unfenceMoved(current.file);
    }
  });
}
function removeIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
function quoted(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}
function busy(e) {
  return e && (e.errcode === 5 || e.errcode === 6 || /database is locked|SQLITE_BUSY/i.test(String(e.message)));
}
// Virtual tables cannot carry triggers; their storage tables are covered instead.
function writeTables(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND upper(coalesce(sql,'')) NOT LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name"
    )
    .all()
    .map(r => r.name);
}
function withWrite(file, fn, timeout = 5000) {
  // An existing file only: never create a database at a path we are about to lock.
  if (!fs.existsSync(file))
    throw fault(
      'LIBRARY_MISSING',
      'The shared library is missing. Restore its location; an empty replacement has not been created.'
    );
  const db = new DatabaseSync(file, { timeout });
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      fn(db);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw e;
    }
  } finally {
    db.close();
  }
}
// Step 1: marker plus write-blocking triggers on every table. Idempotent.
function fenceMoved(file, to, wait = LOCK_WAIT_MS) {
  withWrite(
    file,
    db => {
      if (db.prepare('SELECT 1 FROM state WHERE key=?').get(MOVED_KEY)) return;
      const release = require('./car-merge-fence.cjs').begin(db);
      db.prepare('INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
        MOVED_KEY,
        JSON.stringify({ file: to, at: new Date().toISOString() })
      );
      release();
      writeTables(db).forEach((table, i) => {
        for (const action of ['INSERT', 'UPDATE', 'DELETE'])
          db.exec(
            `CREATE TRIGGER IF NOT EXISTS ${TRIGGER_PREFIX}${i}_${action.toLowerCase()} BEFORE ${action} ON ${quoted(table)} BEGIN SELECT RAISE(ABORT,'LIBRARY_MOVED: this shared library was moved to another folder; reopen it'); END`
          );
      });
    },
    wait
  );
}
// Reverse of fenceMoved: used on the fresh copy and when undoing a move.
function fenced(file) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    return (
      !!db.prepare('SELECT 1 FROM state WHERE key=?').get(MOVED_KEY) ||
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND substr(name,1,?)=?")
        .get(TRIGGER_PREFIX.length, TRIGGER_PREFIX)
    );
  } finally {
    db.close();
  }
}
function unfenceMoved(file) {
  if (!fenced(file)) return;
  withWrite(
    file,
    db => {
      for (const { name } of db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE ? ESCAPE '\\'")
        .all(TRIGGER_PREFIX.replace(/_/g, '\\_') + '%'))
        db.exec('DROP TRIGGER ' + quoted(name));
      if (!db.prepare('SELECT 1 FROM state WHERE key=?').get(MOVED_KEY)) return;
      const release = require('./car-merge-fence.cjs').begin(db);
      db.prepare('DELETE FROM state WHERE key=?').run(MOVED_KEY);
      release();
    },
    LOCK_WAIT_MS
  );
}
function verifyCopy(file, databaseId) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok')
      throw fault('LIBRARY_COPY_INVALID', 'The copied library failed its integrity check. The original has been kept.');
  } finally {
    db.close();
  }
  if (identity(file) !== databaseId)
    throw fault('LIBRARY_COPY_INVALID', 'The copied library does not match the original. The original has been kept.');
  const fd = fs.openSync(file, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function leaveNote(ticket) {
  // Best effort: a plain-language pointer for people looking in the old folder.
  try {
    fs.writeFileSync(
      path.join(path.dirname(ticket.from), 'MOVED-TO.txt'),
      [
        `The SlotForge shared library was moved on ${new Date().toISOString().slice(0, 10)}.`,
        '',
        `It now lives here: ${ticket.to}`,
        '',
        `The old copy in this folder (${path.basename(ticket.from)}) is locked against changes and is no longer used.`,
        'You can delete it once SlotForge Paddock and SlotForge Timing both open the library from its new folder.',
        'Older backup files in this folder were not moved.',
        ''
      ].join('\r\n')
    );
  } catch {}
}
function cleanTemp(ticket) {
  for (const f of [ticket.temp, ticket.temp + '-journal', ticket.temp + '-wal'])
    try {
      removeIfPresent(f);
    } catch {}
}
// Step 4 and after. Once library.json names the new file the move is final, so
// every later step is best effort: a leftover receipt is finished on next open.
function publish(root, ticket) {
  const current = registration(root);
  if (!current || !samePath(current.file, realOrSelf(ticket.to)))
    writeJson(root, 'library.json', {
      version: VERSION,
      file: fs.realpathSync(ticket.to),
      databaseId: ticket.databaseId
    });
  leaveNote(ticket);
  cleanTemp(ticket);
  try {
    fs.unlinkSync(path.join(root, RELOCATION));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      /* settleLocked finishes this receipt next time. */
    }
  }
  return { file: realOrSelf(ticket.to), databaseId: ticket.databaseId, from: ticket.from };
}
function published(root, ticket) {
  const current = registration(root);
  return !!current && fs.existsSync(ticket.to) && samePath(current.file, realOrSelf(ticket.to));
}
// Undo a move that was not published: drop our copy and unlock the original.
function rollBack(root, ticket) {
  if (published(root, ticket)) return publish(root, ticket);
  cleanTemp(ticket);
  if (fs.existsSync(ticket.to)) {
    let ours = false;
    try {
      ours = identity(ticket.to) === ticket.databaseId;
    } catch (e) {
      ours = e.code === 'LIBRARY_MOVED';
    }
    if (ours) for (const s of ['', '-wal', '-journal']) removeIfPresent(ticket.to + s);
  }
  if (fs.existsSync(ticket.from)) unfenceMoved(ticket.from);
  fs.unlinkSync(path.join(root, RELOCATION));
  return null;
}
// Steps 1-4.
async function complete(root, ticket, wait = LOCK_WAIT_MS) {
  // If locking fails its transaction rolled back: nothing has changed, so there is nothing to undo.
  try {
    fenceMoved(ticket.from, ticket.to, wait);
  } catch (e) {
    const error = busy(e)
      ? fault(
          'LIBRARY_IN_USE',
          'Another app, such as SlotForge Timing, is busy saving to the shared library. Close it and try again.'
        )
      : e;
    error.unchanged = true;
    throw error;
  }
  cleanTemp(ticket);
  const { backup } = require('node:sqlite'),
    source = new DatabaseSync(ticket.from, { readOnly: true, timeout: LOCK_WAIT_MS });
  try {
    await backup(source, ticket.temp);
  } finally {
    source.close();
  }
  unfenceMoved(ticket.temp);
  verifyCopy(ticket.temp, ticket.databaseId);
  // linkSync refuses to replace an existing file (renameSync would on Windows).
  const appeared = () =>
    fault(
      'TARGET_EXISTS',
      'A library.sqlite file appeared in the new folder during the move. The original has been kept.'
    );
  try {
    fs.linkSync(ticket.temp, ticket.to);
  } catch (e) {
    if (e.code === 'EEXIST') throw appeared();
    // FAT32/exFAT (USB sticks, SD cards) and some network drives have no hard links: copy instead.
    if (!['EPERM', 'ENOTSUP', 'EISDIR', 'EXDEV', 'ENOSYS', 'EINVAL', 'EOPNOTSUPP'].includes(e.code)) throw e;
    try {
      fs.copyFileSync(ticket.temp, ticket.to, fs.constants.COPYFILE_EXCL);
    } catch (c) {
      if (c.code === 'EEXIST') throw appeared();
      throw c;
    }
    verifyCopy(ticket.to, ticket.databaseId);
  }
  cleanTemp(ticket);
  return publish(root, ticket);
}
// Finish or undo whatever an interrupted move left behind. Caller holds the lock.
function settleLocked(root) {
  const ticket = readTicket(root);
  if (!ticket) return null;
  if (published(root, ticket)) return publish(root, ticket);
  const current = registration(root, { strict: true });
  // A receipt for some other library (e.g. after a restore) must not touch files.
  if (!current || current.databaseId !== ticket.databaseId || !samePath(current.file, ticket.from)) {
    fs.unlinkSync(path.join(root, RELOCATION));
    return null;
  }
  // The verified copy is in place; only library.json was not updated yet.
  if (fs.existsSync(ticket.to)) {
    let ready = false;
    try {
      ready = identity(ticket.to) === ticket.databaseId;
    } catch {}
    if (ready) return publish(root, ticket);
  }
  return rollBack(root, ticket);
}
async function recover(root) {
  return lock(root, () => settleLocked(root));
}
// Per-call check for an already-open handle: report a move as LIBRARY_MOVED
// (or LIBRARY_BUSY while one is running) so clients reopen via library.json.
function checkOpen(root, file, databaseId) {
  // "Busy" only while the move is unpublished; once library.json names another file it is "moved".
  const moving = () => {
    if (!root || !fs.existsSync(path.join(root, RELOCATION))) return false;
    const current = registration(root);
    return !(
      current &&
      current.databaseId === databaseId &&
      typeof current.file === 'string' &&
      !samePath(current.file, file)
    );
  };
  if (!fs.existsSync(file)) {
    if (moving()) throw fault('LIBRARY_BUSY', 'The shared library is being moved. Try again in a moment.');
    const current = root && registration(root);
    if (
      current &&
      current.databaseId === databaseId &&
      typeof current.file === 'string' &&
      !samePath(current.file, file)
    )
      throw Object.assign(
        fault('LIBRARY_MOVED', 'The shared library was moved to another folder. Reopen it to continue.'),
        { details: { movedTo: current.file } }
      );
    throw fault(
      'LIBRARY_MISSING',
      'The shared library is missing. Restore its location; an empty replacement has not been created.'
    );
  }
  try {
    return identity(file);
  } catch (e) {
    if (e.code === 'LIBRARY_MOVED' && moving())
      throw fault('LIBRARY_BUSY', 'The shared library is being moved. Try again in a moment.');
    throw e;
  }
}
// Used by open(): the registration must still name this file inside the lock,
// so a move that finished while we waited is never adopted into the old file.
function assertCurrent(root, file, databaseId) {
  const current = read(root);
  if (!current || current.databaseId !== databaseId || !samePath(current.file, file))
    throw Object.assign(
      fault('LIBRARY_MOVED', 'The shared library was moved to another folder. Reopen it to continue.'),
      { details: { movedTo: current?.file || '' } }
    );
}
async function relocate(root, { file, databaseId, folder, lockWaitMs = LOCK_WAIT_MS }) {
  return lock(root, async () => {
    settleLocked(root);
    const current = read(root);
    if (!current) throw fault('LIBRARY_REGISTRATION', 'No shared library is registered yet.');
    if (current.databaseId !== databaseId || !samePath(current.file, file))
      throw fault('DATABASE_MISMATCH', 'The shared library changed before it could be moved.');
    if (typeof folder !== 'string' || !path.isAbsolute(folder))
      throw fault('INVALID_LOCATION', 'Choose a complete folder path.');
    const to = path.join(path.resolve(folder), TARGET_NAME);
    if (samePath(path.dirname(to), path.dirname(current.file)))
      throw fault('INVALID_LOCATION', 'The library is already in this folder.');
    if ([to, to + '-wal', to + '-journal'].some(f => fs.existsSync(f)))
      throw fault('TARGET_EXISTS', 'This folder already contains a library.sqlite file. Choose another folder.');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const ticket = {
      version: 2,
      pid: process.pid,
      databaseId,
      from: current.file,
      to,
      temp: to + '.' + nonce() + '.tmp'
    };
    writeJson(root, RELOCATION, ticket);
    try {
      return await complete(root, ticket, lockWaitMs);
    } catch (error) {
      // Never undo a published move; otherwise unlock the original and remove our copy.
      if (error.unchanged) {
        fs.unlinkSync(path.join(root, RELOCATION));
        throw error;
      }
      try {
        rollBack(root, ticket);
      } catch (undo) {
        error.rollbackError = undo.message;
      }
      if (published(root, ticket)) return publish(root, ticket);
      throw error;
    }
  });
}
module.exports = {
  VERSION,
  directory,
  read,
  resolve,
  identity,
  lock,
  rebind,
  beginReplacement,
  finishReplacement,
  withReplacement,
  relocate,
  recover,
  checkOpen,
  assertCurrent,
  TARGET_NAME
};
