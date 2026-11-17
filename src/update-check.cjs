'use strict';
// "A new version is available": asks GitHub for the newest published Paddock release.
//
// Only the version number of the latest release is requested. Nothing about the user or
// the collection is sent; the request carries a generic User-Agent with the app version.
// Paddock never downloads or installs anything itself: the notice opens the release page
// in the browser, where people choose the download for their computer. That page address
// is built from the validated version number, never taken from the answer, so only this
// app's own release pages can be opened.
//
// Settings and the last result belong to this computer's profile (update-check.json).
const fs = require('node:fs');
const path = require('node:path');

const FILE = 'update-check.json';
const VERSION = 1;
const HOUR = 60 * 60 * 1000;
const CHECK_EVERY = 12 * HOUR;
const RETRY_AFTER = 3 * HOUR;
// Linux and macOS downloads are attached by a build that runs after publishing.
const SETTLE = HOUR;
const TIMEOUT_MS = 15 * 1000;
const MAX_BYTES = 1024 * 1024;
const SEMVER = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;

function fault(message, code) {
  return Object.assign(Error(message), code ? { code } : {});
}

/** "1.6.0" or "v1.6.0" → [1, 6, 0]; anything else → null. */
function parse(version) {
  const m = SEMVER.exec(String(version || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  const x = parse(a),
    y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

/** "https://github.com/owner/repo" (package.json homepage, optionally .git or #readme) → "owner/repo". */
function repository(homepage) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?(?:#.*)?$/.exec(
    String(homepage || '')
  );
  if (!m) throw fault('Paddock does not know where its releases are published.', 'NO_REPOSITORY');
  return `${m[1]}/${m[2]}`;
}

function pageUrl(repo, tag) {
  return `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
}

/** Validates GitHub's "latest release" answer and keeps only what Paddock shows. */
function release(json) {
  if (!json || typeof json !== 'object') throw fault('GitHub sent an unexpected answer.', 'BAD_RESPONSE');
  if (json.draft || json.prerelease) throw fault('GitHub sent an unpublished release.', 'BAD_RESPONSE');
  const tag = String(json.tag_name || '');
  if (!parse(tag)) throw fault('The latest release has no usable version number.', 'BAD_RESPONSE');
  const published = Date.parse(json.published_at || '');
  return {
    version: tag.replace(/^v/, ''),
    tag,
    publishedAt: Number.isFinite(published) ? published : null
  };
}

class UpdateCheck {
  /**
   * @param {object} o
   * @param {string} o.profile          Profile folder that holds update-check.json.
   * @param {string} o.current          The running app version.
   * @param {string} o.homepage         package.json "homepage" (the GitHub repository).
   * @param {(url: string, init: object) => Promise<Response>} o.fetch
   * @param {boolean} [o.automatic]     Check by itself (packaged apps only).
   * @param {() => void} [o.onChange]
   * @param {() => number} [o.now]
   */
  constructor(o) {
    this.file = path.join(o.profile, FILE);
    this.current = o.current;
    try {
      this.repo = repository(o.homepage);
    } catch (e) {
      this.repo = null; // Never stop Paddock from opening over this; Settings explains it.
      this.unavailable = e.message;
    }
    this.fetch = o.fetch;
    this.automatic = o.automatic !== false;
    this.onChange = o.onChange || (() => {});
    this.now = o.now || (() => Date.now());
    this.checking = null;
    this.controller = null;
    this.stopped = false;
    this.state = this.load();
  }

  load() {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      saved = null;
    }
    if (saved?.version !== VERSION) saved = {};
    let latest = null;
    try {
      if (saved.latest)
        latest = release({
          tag_name: saved.latest.tag,
          published_at: Number.isFinite(saved.latest.publishedAt)
            ? new Date(saved.latest.publishedAt).toISOString()
            : ''
        });
    } catch {
      latest = null;
    }
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
      lastCheck: Number.isFinite(saved.lastCheck) ? saved.lastCheck : null,
      lastAttempt: Number.isFinite(saved.lastAttempt) ? saved.lastAttempt : null,
      latest,
      skipped: parse(saved.skipped) ? String(saved.skipped) : null,
      lastError: typeof saved.lastError === 'string' ? saved.lastError : null
    };
  }

  persist() {
    const temp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ version: VERSION, ...this.state }, null, 2));
    fs.renameSync(temp, this.file);
  }

  status() {
    const { enabled, lastCheck, latest, skipped, lastError } = this.state;
    const newer = !!latest && compare(latest.version, this.current) > 0;
    // Give the release an hour so every platform's download is attached before people are told.
    const settled = !latest?.publishedAt || this.now() - latest.publishedAt >= SETTLE;
    return {
      enabled,
      automatic: this.automatic && !!this.repo,
      current: this.current,
      latest: newer ? { version: latest.version } : null,
      upToDate: !!latest && !newer,
      // The notice in the top bar; "Not now" hides it until an even newer version appears.
      notify: enabled && newer && settled && (!skipped || compare(latest.version, skipped) > 0),
      lastCheck,
      lastError: this.unavailable || lastError,
      checking: !!this.checking
    };
  }

  /** Called regularly by the main process: checks at most every 12 hours, after a failure every 3. */
  async tick() {
    if (!this.automatic || !this.repo || !this.state.enabled || this.checking || this.stopped) return null;
    const now = this.now();
    // A time in the future means the clock was wrong when it was saved: check anyway.
    const age = at => (Number.isFinite(at) && at <= now ? now - at : Infinity);
    if (age(this.state.lastCheck) < CHECK_EVERY || age(this.state.lastAttempt) < RETRY_AFTER) return null;
    try {
      return await this.check();
    } catch {
      return null; // Shown in Settings; checked again later.
    }
  }

  /** Resolves with the status after the check has finished (checking is false by then). */
  check() {
    if (!this.repo) return Promise.reject(fault(this.unavailable, 'NO_REPOSITORY'));
    if (this.stopped) return Promise.reject(fault('Paddock is closing.'));
    if (!this.checking) {
      this.checking = this.request().finally(() => {
        this.checking = null;
        this.onChange();
      });
      this.onChange();
    }
    return this.checking.then(() => this.status());
  }

  async request() {
    this.state.lastAttempt = this.now();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let found;
    try {
      let response;
      try {
        // Redirects are followed: GitHub answers a renamed repository with a redirect.
        response = await this.fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `SlotForge-Paddock/${this.current}` },
          signal: controller.signal
        });
      } catch {
        throw controller.signal.aborted && !this.stopped
          ? fault('GitHub did not answer in time. Try again later.', 'TIMEOUT')
          : fault('Paddock could not reach GitHub. Check the internet connection and try again.', 'OFFLINE');
      }
      if (response.status === 404) throw fault('No published release was found yet.', 'NO_RELEASE');
      if (response.status === 403 || response.status === 429)
        throw fault('GitHub asked Paddock to wait before checking again. Try again later.', 'RATE_LIMITED');
      if (!response.ok)
        throw fault(`GitHub answered with an error (${response.status}). Try again later.`, 'BAD_RESPONSE');
      const length = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(length) && length > MAX_BYTES)
        throw fault('GitHub sent an unexpectedly large answer.', 'BAD_RESPONSE');
      let text;
      try {
        text = await response.text();
      } catch {
        throw fault('GitHub did not answer in time. Try again later.', 'TIMEOUT');
      }
      if (Buffer.byteLength(text) > MAX_BYTES) throw fault('GitHub sent an unexpectedly large answer.', 'BAD_RESPONSE');
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw fault('GitHub sent an unexpected answer.', 'BAD_RESPONSE');
      }
      found = release(json);
    } catch (e) {
      this.state.lastError = e.message;
      try {
        this.persist();
      } catch {
        /* The error still reaches the caller. */
      }
      throw e;
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
    // Success is recorded even if saving it to disk fails; it is saved again next time.
    this.state.latest = found;
    this.state.lastCheck = this.state.lastAttempt;
    this.state.lastError = null;
    try {
      this.persist();
    } catch {
      /* Kept in memory for this session. */
    }
    return this.status();
  }

  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw fault('Choose whether Paddock checks for new versions.');
    this.state.enabled = enabled;
    this.persist();
    this.onChange();
    return this.status();
  }

  /** "Not now": hides the notice until a version newer than this one appears. */
  skip(version) {
    if (!this.state.latest || version !== this.state.latest.version)
      throw fault('This version is no longer the latest.');
    this.state.skipped = version;
    this.persist();
    this.onChange();
    return this.status();
  }

  /** The release page to open: built from the repository and the validated version tag only. */
  releaseUrl() {
    if (!this.status().latest) throw fault('There is no newer version to download.');
    return pageUrl(this.repo, this.state.latest.tag);
  }

  /** At quit: no new checks, and a check in progress is abandoned. */
  stop() {
    this.stopped = true;
    this.controller?.abort();
  }
}

module.exports = { UpdateCheck, parse, compare, repository, release, pageUrl, CHECK_EVERY, RETRY_AFTER, SETTLE };
