'use strict';
// Automatic complete backups of the personal collection.
//
// Settings and the last result belong to this computer's profile (auto-backup.json),
// never to the collection: the folder is a local path and each computer decides for
// itself. Backups use the same portable export as Import & Export → Create backup.
//
// Rules that keep this safe and out of the way:
// - It only starts while nobody is using Paddock (window in the background, or no
//   keyboard/mouse input for a while) and no request or dialog is in progress. The main
//   process stops an automatic run as soon as the user does something (see yield()).
// - The standard folder is inside Paddock's own profile, so private collection data is
//   not uploaded by OneDrive/iCloud folder sync unless the user chooses such a folder.
// - Only files whose names match this computer's automatic backups of this collection
//   are ever removed, only after a newer backup was verified and saved, and never one
//   that is dated after the new backup (a clock that was wrong must not cost backups).
// - A custom folder that is missing (for example an unplugged USB drive) is not created.
// - Folder checks are asynchronous with a time limit, so a sleeping network drive cannot
//   freeze Paddock.
// - A generous amount of free space is left on the drive.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FILE = 'auto-backup.json';
const VERSION = 1;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const INTERVALS = { day: DAY, week: 7 * DAY, month: 30 * DAY };
const KEEP_MIN = 1;
const KEEP_MAX = 50;
const DEFAULTS = { enabled: true, folder: null, every: 'week', keep: 5 };
const RETRY_AFTER = HOUR;
const IDLE_MS = 2 * 60 * 1000;
const FOLDER_TIMEOUT_MS = 15 * 1000;
const GIB = 1024 * 1024 * 1024;
const TEMP = /^\.slotforge-backup-[0-9a-f-]{36}\.tmp$/;

function fault(message, code) {
  return Object.assign(Error(message), code ? { code } : {});
}

function clean(value, fallback) {
  const text = String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase();
  return text || fallback;
}

function stamp(date) {
  const two = n => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}-` +
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  );
}

/** SlotForge-Paddock-auto-<collection>-<computer>-<local date and time>.sfpbackup */
function fileName(databaseId, installation, date) {
  return `SlotForge-Paddock-auto-${clean(databaseId, 'collection')}-${clean(installation, 'computer')}-${stamp(date)}.sfpbackup`;
}

function pattern(databaseId, installation) {
  return new RegExp(
    `^SlotForge-Paddock-auto-${clean(databaseId, 'collection')}-${clean(installation, 'computer')}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.sfpbackup$`
  );
}

/** Free space Paddock leaves on the drive after an automatic backup: 5% of the drive, at least 1 GiB, at most 20 GiB. */
function reserve(totalBytes) {
  return Math.min(20 * GIB, Math.max(GIB, Math.round(totalBytes * 0.05)));
}

function cleanSettings(input = {}, current = DEFAULTS) {
  const next = { ...current };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw fault('Choose whether automatic backups are on.');
    next.enabled = input.enabled;
  }
  if (input.every !== undefined) {
    if (!Object.hasOwn(INTERVALS, input.every)) throw fault('Choose daily, weekly or monthly backups.');
    next.every = input.every;
  }
  if (input.keep !== undefined) {
    const keep = Number(input.keep);
    if (!Number.isInteger(keep) || keep < KEEP_MIN || keep > KEEP_MAX) {
      throw fault(`Keep between ${KEEP_MIN} and ${KEEP_MAX} backups.`);
    }
    next.keep = keep;
  }
  if (input.folder !== undefined) {
    if (input.folder !== null && (typeof input.folder !== 'string' || !path.isAbsolute(input.folder))) {
      throw fault('Choose a complete folder path.');
    }
    next.folder = input.folder === null ? null : path.resolve(input.folder);
  }
  return next;
}

/** Runs a file-system check, giving up after a while (a network drive may hang for a minute). */
function limited(promise, folder, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          fault(
            `The backup folder did not respond: ${folder}. Check the drive or network connection.`,
            'FOLDER_MISSING'
          )
        ),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class AutoBackup {
  /**
   * @param {object} o
   * @param {string} o.profile        Profile folder that holds auto-backup.json.
   * @param {string} o.defaultFolder  Used while no folder was chosen. Created when needed.
   * @param {() => object} o.getStore The personal collection Store (never a Dealership copy).
   * @param {object} o.jobs           BackupJobs instance shared with manual backups.
   * @param {() => boolean} o.busy    True while Paddock must not start a backup (requests, dialogs, restore, quit).
   * @param {() => number} o.idleFor  Milliseconds since the user last used Paddock.
   * @param {() => string[]} o.protectedFiles
   * @param {() => void} [o.onChange]
   * @param {() => number} [o.now]
   * @param {(folder: string) => Promise<{free: number, total: number}>} [o.disk]
   * @param {number} [o.folderTimeout]
   */
  constructor(o) {
    this.file = path.join(o.profile, FILE);
    this.defaultFolder = path.resolve(o.defaultFolder);
    this.getStore = o.getStore;
    this.jobs = o.jobs;
    this.busy = o.busy || (() => false);
    this.idleFor = o.idleFor || (() => Infinity);
    this.protectedFiles = o.protectedFiles || (() => []);
    this.onChange = o.onChange || (() => {});
    this.now = o.now || (() => Date.now());
    this.folderTimeout = o.folderTimeout || FOLDER_TIMEOUT_MS;
    this.disk =
      o.disk ||
      (async folder => {
        const s = await fsp.statfs(folder);
        return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
      });
    this.running = null;
    this.manual = false;
    this.jobId = null;
    this.cancelled = false;
    this.stopped = false;
    this.swept = new Set();
    this.state = this.load();
  }

  load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      saved = null; // Missing or unreadable: start from the defaults.
    }
    let settings = DEFAULTS;
    try {
      if (saved?.version === VERSION) settings = cleanSettings(saved.settings || {}, DEFAULTS);
    } catch {
      settings = DEFAULTS;
    }
    const record = value => (value && typeof value === 'object' && Number.isFinite(value.at) ? value : null);
    return {
      settings,
      installation:
        typeof saved?.installation === 'string' && /^[a-z0-9]{8}$/.test(saved.installation)
          ? saved.installation
          : randomUUID().replace(/-/g, '').slice(0, 8),
      lastSuccess: record(saved?.lastSuccess),
      lastAttempt: Number.isFinite(saved?.lastAttempt) ? saved.lastAttempt : null,
      lastError: record(saved?.lastError)
    };
  }

  persist() {
    const text = JSON.stringify({ version: VERSION, ...this.state }, null, 2);
    const temp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, this.file);
  }

  folder() {
    return this.state.settings.folder || this.defaultFolder;
  }

  /** When the next automatic backup becomes due (milliseconds), or null when off. */
  nextDue() {
    const { settings, lastSuccess, lastAttempt, lastError } = this.state;
    if (!settings.enabled) return null;
    const now = this.now();
    const store = this.getStore();
    // A date in the future means the clock was wrong when it was saved; don't wait for it.
    const believable = at => Number.isFinite(at) && at <= now + DAY;
    const sameCollection =
      lastSuccess && store && lastSuccess.databaseId === store.data.id && believable(lastSuccess.at);
    let due = sameCollection ? lastSuccess.at + INTERVALS[settings.every] : 0;
    // After a failure, wait a little before trying again instead of retrying every minute.
    if (
      lastError &&
      lastError.retry !== false &&
      lastAttempt &&
      lastError.at === lastAttempt &&
      believable(lastAttempt)
    ) {
      due = Math.max(due, lastAttempt + RETRY_AFTER);
    }
    return due;
  }

  status() {
    const { settings, lastSuccess, lastError } = this.state;
    const store = this.getStore();
    const forThisCollection = lastSuccess && store && lastSuccess.databaseId === store.data.id ? lastSuccess : null;
    return {
      ...settings,
      folder: this.folder(),
      defaultFolder: this.defaultFolder,
      customFolder: !!settings.folder,
      lastSuccess: forThisCollection,
      // An interrupted run (the user started working) is not a problem worth showing.
      lastError:
        lastError && lastError.code !== 'CANCELLED' && (!forThisCollection || lastError.at > forThisCollection.at)
          ? lastError
          : null,
      nextDue: this.nextDue(),
      running: !!this.running,
      keepRange: [KEEP_MIN, KEEP_MAX]
    };
  }

  async save(input) {
    const settings = cleanSettings(input, this.state.settings);
    if (settings.folder && input.folder !== undefined) await this.checkFolder(settings.folder, { create: false });
    this.state = { ...this.state, settings };
    // A new folder or schedule deserves a fresh attempt rather than waiting out a retry delay.
    if (input.folder !== undefined || input.enabled === true) this.state.lastError = null;
    this.persist();
    this.onChange();
    return this.status();
  }

  async checkFolder(folder, { create }) {
    const check = async () => {
      if (create) {
        try {
          await fsp.mkdir(folder, { recursive: true });
        } catch (e) {
          throw fault(`Paddock cannot create the backup folder ${folder}: ${e.message}`, 'FOLDER_READONLY');
        }
      }
      let stat;
      try {
        stat = await fsp.stat(folder);
      } catch {
        throw fault(
          `The backup folder is not available: ${folder}. Connect the drive or choose another folder.`,
          'FOLDER_MISSING'
        );
      }
      if (!stat.isDirectory()) throw fault(`The backup location is not a folder: ${folder}`, 'FOLDER_MISSING');
      try {
        await fsp.access(folder, fs.constants.W_OK);
      } catch {
        throw fault(`Paddock cannot write to the backup folder: ${folder}`, 'FOLDER_READONLY');
      }
    };
    await limited(check(), folder, this.folderTimeout);
  }

  /** Called regularly by the main process. Starts a backup only when it is due and nobody is busy. */
  async tick() {
    if (this.stopped || this.running) return null;
    const due = this.nextDue();
    if (due === null || this.now() < due) return null;
    if (this.busy() || this.jobs.active || this.idleFor() < IDLE_MS) return null;
    return this.run({ manual: false });
  }

  /** Runs a backup now. Manual runs ignore the schedule but share every safety check. */
  run({ manual }) {
    if (this.running) {
      // "Back up now" while an automatic run is already being stopped: start a fresh one after it.
      if (manual && this.cancelled) return this.running.catch(() => {}).then(() => this.run({ manual: true }));
      // "Back up now" during an automatic run: keep that run, but the user now wants it to finish.
      if (manual) this.manual = true;
      return this.running;
    }
    if (this.stopped) return Promise.reject(fault('Paddock is closing.'));
    this.cancelled = false;
    this.manual = !!manual;
    this.running = this.backup(manual).finally(() => {
      this.running = null;
      this.manual = false;
      this.jobId = null;
      this.onChange();
    });
    this.onChange();
    return this.running;
  }

  async backup(manual) {
    const store = this.getStore();
    const startedAt = this.now();
    this.state.lastAttempt = startedAt;
    try {
      if (!store) throw fault('The collection is not open yet.');
      // busy() also counts the user's own "Back up now" request, so it only stops automatic runs.
      if (!manual && this.busy())
        throw fault('Paddock is busy with another database task. Try again in a moment.', 'BUSY');
      if (this.jobs.active) throw fault('Another backup is already running.', 'BUSY');
      const folder = this.folder();
      await this.checkFolder(folder, { create: folder === this.defaultFolder });
      await this.sweep(folder);
      const size = this.protectedFiles().reduce((sum, file) => {
        try {
          return sum + fs.statSync(file).size;
        } catch {
          return sum;
        }
      }, 0);
      const disk = await limited(this.disk(folder), folder, this.folderTimeout);
      const needed = Math.ceil(size * 1.2) + reserve(disk.total);
      if (!(disk.free >= needed)) {
        throw fault(
          `Not enough free disk space in ${folder}. Paddock keeps at least ${Math.round(reserve(disk.total) / GIB)} GB free on the drive. Free up space or choose another folder.`,
          'NO_SPACE'
        );
      }
      const databaseId = store.data.id;
      const destination = path.join(folder, fileName(databaseId, this.state.installation, new Date(startedAt)));
      if (this.cancelled || this.stopped) throw fault('Automatic backup cancelled.', 'CANCELLED');
      await store.exclusiveFileOperation(() => {
        if (this.cancelled || this.stopped) throw fault('Automatic backup cancelled.', 'CANCELLED');
        if (store.data.id !== databaseId)
          throw fault('The collection changed. The backup will run again.', 'COLLECTION_CHANGED');
        if (fs.existsSync(destination))
          throw fault('A backup with this name already exists. Try again in a moment.', 'BUSY');
        if (!store.expectedIdentity) store.persist(store.data);
        const job = this.jobs.run('export', store.file, destination, {
          label: manual ? 'Backup now' : 'Automatic backup',
          expectedIdentity: store.expectedIdentity,
          protectedFiles: this.protectedFiles()
        });
        this.jobId = this.jobs.active?.id || null;
        return job;
      });
      const bytes = fs.statSync(destination).size;
      const removed = await this.rotate(folder, databaseId, path.basename(destination));
      this.state.lastSuccess = { at: startedAt, file: destination, size: bytes, databaseId, manual: !!manual };
      this.state.lastError = null;
      this.persist();
      return { file: destination, size: bytes, removed };
    } catch (e) {
      const cancelled = e.code === 'CANCELLED';
      this.state.lastError = {
        at: startedAt,
        message: cancelled ? 'The last automatic backup was interrupted. It will run again later.' : e.message,
        code: e.code || null,
        // A replaced collection is backed up straight away rather than after the retry delay.
        retry: e.code !== 'COLLECTION_CHANGED'
      };
      try {
        this.persist();
      } catch {
        /* The error is still returned to the caller. */
      }
      throw e;
    }
  }

  /** Removes temporary files left in the folder by a backup that was cut off (crash, power cut). */
  async sweep(folder) {
    if (this.swept.has(folder) || this.jobs.active) return;
    this.swept.add(folder);
    try {
      for (const name of await fsp.readdir(folder)) {
        if (!TEMP.test(name)) continue;
        const file = path.join(folder, name);
        try {
          // Only old leftovers: another computer may be writing to a shared folder right now.
          const stat = await fsp.lstat(file);
          if (stat.isFile() && Date.now() - stat.mtimeMs > DAY) await fsp.unlink(file);
        } catch {
          /* Still in use or already gone. */
        }
      }
    } catch {
      /* A sweep is a courtesy; the backup itself checks the folder. */
    }
  }

  /**
   * Keeps the newest `keep` automatic backups this computer made of this collection. Only
   * files dated before the new backup are removed; other files are never touched.
   */
  async rotate(folder, databaseId, keepName) {
    const match = pattern(databaseId, this.state.installation);
    const names = (await fsp.readdir(folder)).filter(name => match.test(name)).sort();
    let surplus = names.length - this.state.settings.keep;
    const removed = [];
    for (const name of names) {
      if (surplus <= 0 || name >= keepName) break;
      const file = path.join(folder, name);
      try {
        if ((await fsp.lstat(file)).isFile()) {
          await fsp.unlink(file);
          removed.push(name);
          surplus--;
        }
      } catch {
        /* An old backup that cannot be removed now is tried again next time. */
      }
    }
    return removed;
  }

  /**
   * Stops a running automatic backup so the user's own action can go ahead, and resolves when
   * it has stopped. A backup the user started by hand keeps running (like Create backup) unless
   * `force` is set, which only happens at quit.
   */
  async yield({ force = false } = {}) {
    const running = this.running;
    if (!running || (this.manual && !force)) return;
    this.cancelled = true;
    if (this.jobId) this.jobs.cancel(this.jobId);
    try {
      await running;
    } catch {
      /* Recorded in the status; the user's action continues. */
    }
  }

  /** Called at quit: no new backups, cancel the current one. */
  async stop() {
    this.stopped = true;
    await this.yield({ force: true });
  }
}

module.exports = { AutoBackup, fileName, pattern, reserve, cleanSettings, INTERVALS, DEFAULTS, IDLE_MS, RETRY_AFTER };
