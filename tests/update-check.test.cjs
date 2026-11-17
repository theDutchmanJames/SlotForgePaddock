'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const U = require('../src/update-check.cjs');

const HOME = 'https://github.com/theDutchmanJames/SlotForgePaddock';
const REPO = 'theDutchmanJames/SlotForgePaddock';
const HOUR = 60 * 60 * 1000;

function answer(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
const latest = (tag, extra = {}) => ({ tag_name: tag, html_url: `${HOME}/releases/tag/${tag}`, name: `Release ${tag}`, published_at: '2026-11-17T08:00:00Z', draft: false, prerelease: false, ...extra });

function fixture(t, { current = '1.6.0', reply = () => answer(latest('v1.7.0')), automatic = true } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-update-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const clock = { now: Date.UTC(2026, 10, 17, 12) };
  const calls = [];
  const make = () => new U.UpdateCheck({
    profile, current, homepage: HOME, automatic, now: () => clock.now,
    fetch: async (url, init) => { calls.push({ url, init }); return reply(url, init); },
  });
  return { profile, clock, calls, make, u: make() };
}

test('version numbers are compared numerically', () => {
  assert.equal(U.compare('1.10.0', '1.9.9'), 1);
  assert.equal(U.compare('v1.6.0', '1.6.0'), 0);
  assert.equal(U.compare('1.6.0', '1.6.1'), -1);
  assert.equal(U.compare('2.0.0', '1.99.99'), 1);
  assert.equal(U.parse('1.7.0-beta.1'), null);
  assert.equal(U.repository(HOME), REPO);
  assert.equal(U.repository(HOME + '.git'), REPO);
  assert.throws(() => U.repository('https://example.com/x/y'), /releases/);
});

test('finds a newer release and asks GitHub only for the latest release', async t => {
  const f = fixture(t);
  const s = await f.u.check();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, `https://api.github.com/repos/${REPO}/releases/latest`);
  assert.equal(f.calls[0].init.headers['User-Agent'], 'SlotForge-Paddock/1.6.0');
  assert.equal(s.latest.version, '1.7.0');
  assert.equal(s.checking, false, 'the returned status is final');
  assert.equal(s.notify, true);
  assert.equal(s.lastCheck, f.clock.now);
  assert.equal(f.u.releaseUrl(), `${HOME}/releases/tag/v1.7.0`);
  // Remembered across restarts.
  assert.equal(f.make().status().latest.version, '1.7.0');
});

test('same or older release: up to date, no notice', async t => {
  for (const tag of ['v1.6.0', 'v1.5.9']) {
    const f = fixture(t, { reply: () => answer(latest(tag)) });
    const s = await f.u.check();
    assert.equal(s.latest, null);
    assert.equal(s.upToDate, true);
    assert.equal(s.notify, false);
    assert.throws(() => f.u.releaseUrl(), /no newer version/);
  }
});

test('after updating Paddock the stored newer release no longer shows', async t => {
  const f = fixture(t);
  await f.u.check();
  const updated = new U.UpdateCheck({ profile: f.profile, current: '1.7.0', homepage: HOME, fetch: async () => answer(latest('v1.7.0')), now: () => f.clock.now });
  assert.equal(updated.status().latest, null);
  assert.equal(updated.status().notify, false);
  assert.equal(updated.status().upToDate, true);
});

test('"Not now" hides the notice until an even newer version appears', async t => {
  let tag = 'v1.7.0';
  const f = fixture(t, { reply: () => answer(latest(tag)) });
  await f.u.check();
  assert.throws(() => f.u.skip('1.8.0'), /no longer the latest/);
  const s = f.u.skip('1.7.0');
  assert.equal(s.notify, false);
  assert.equal(s.latest.version, '1.7.0', 'still offered in Settings');
  assert.equal(f.make().status().notify, false);
  tag = 'v1.8.0';
  f.clock.now += 13 * HOUR;
  const later = await f.u.tick();
  assert.equal(later.latest.version, '1.8.0');
  assert.equal(later.notify, true);
});

test('automatic checks: at most every 12 hours, every 3 after a failure, never when off or in development', async t => {
  let fail = false;
  const f = fixture(t, { reply: () => (fail ? Promise.reject(Error('offline')) : answer(latest('v1.7.0'))) });
  await f.u.tick();
  assert.equal(f.calls.length, 1);
  f.clock.now += 11 * HOUR;
  assert.equal(await f.u.tick(), null);
  assert.equal(f.calls.length, 1);
  f.clock.now += 2 * HOUR;
  fail = true;
  assert.equal(await f.u.tick(), null, 'failures are not thrown from the timer');
  assert.equal(f.calls.length, 2);
  assert.match(f.u.status().lastError, /could not reach GitHub/);
  assert.equal(f.u.status().latest.version, '1.7.0', 'the last good answer is kept');
  f.clock.now += 2 * HOUR;
  await f.u.tick();
  assert.equal(f.calls.length, 2);
  f.clock.now += 2 * HOUR;
  fail = false;
  await f.u.tick();
  assert.equal(f.calls.length, 3);
  assert.equal(f.u.status().lastError, null);
  f.u.setEnabled(false);
  f.clock.now += 24 * HOUR;
  await f.u.tick();
  assert.equal(f.calls.length, 3);
  assert.equal(f.u.status().notify, false, 'no notice when turned off');
  const dev = fixture(t, { automatic: false });
  await dev.u.tick();
  assert.equal(dev.calls.length, 0);
  await dev.u.check();
  assert.equal(dev.calls.length, 1, 'Check now still works');
});

test('a last check dated in the future (wrong clock) does not stop checks', async t => {
  const f = fixture(t);
  f.u.state.lastCheck = Date.UTC(2036, 0, 1);
  f.u.state.lastAttempt = Date.UTC(2036, 0, 1);
  await f.u.tick();
  assert.equal(f.calls.length, 1);
});

test('rejects unexpected answers without changing the known release', async t => {
  const cases = [
    [answer('not json'), /unexpected answer/],
    [answer(latest('v1.7.0', { draft: true })), /unpublished/],
    [answer(latest('v1.7.0', { prerelease: true })), /unpublished/],
    [answer(latest('nightly')), /version number/],
    [answer(latest('v1.7.0/../../../evil')), /version number/],
    [answer(latest('1.7.0-beta')), /version number/],
    [answer('x'.repeat(1024 * 1024 + 1)), /large/],
    [answer('', 404), /No published release/],
    [answer('', 403), /wait/],
    [answer('', 500), /\(500\)/],
  ];
  for (const [reply, message] of cases) {
    const f = fixture(t, { reply: () => reply });
    await assert.rejects(f.u.check(), message);
    assert.equal(f.u.status().latest, null);
    assert.equal(f.u.status().lastCheck, null);
  }
});

test('a damaged settings file falls back to safe defaults', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.profile, 'update-check.json'), '{broken');
  assert.equal(f.make().status().enabled, true);
  fs.writeFileSync(path.join(f.profile, 'update-check.json'), JSON.stringify({ version: 1, enabled: 'no', latest: { tag: 'v9.9.9/../../evil', url: 'https://evil.example/x' }, skipped: 'all' }));
  const s = f.make().status();
  assert.equal(s.enabled, true);
  assert.equal(s.latest, null, 'an unsafe stored tag is ignored');
});

test('the page to open is built from this repository and the version only', async t => {
  const f = fixture(t, { reply: () => answer(latest('v1.7.0', { html_url: 'https://evil.example/x' })) });
  await f.u.check();
  assert.equal(f.u.releaseUrl(), `${HOME}/releases/tag/v1.7.0`);
  assert.equal(U.pageUrl(REPO, '1.7.0'), `${HOME}/releases/tag/1.7.0`);
});

test('a just-published release waits an hour before the notice, so every download is attached', async t => {
  const f = fixture(t, { reply: () => answer(latest('v1.7.0', { published_at: new Date(Date.UTC(2026, 10, 17, 11, 30)).toISOString() })) });
  const s = await f.u.check();
  assert.equal(s.latest.version, '1.7.0', 'Settings already shows it');
  assert.equal(s.notify, false);
  f.clock.now += 31 * 60 * 1000;
  assert.equal(f.u.status().notify, true);
});

test('"Not now" stays quiet if the newest release is withdrawn and an older one becomes latest', async t => {
  let tag = 'v1.8.0';
  const f = fixture(t, { reply: () => answer(latest(tag)) });
  await f.u.check();
  f.u.skip('1.8.0');
  tag = 'v1.7.0';
  const s = await f.u.check();
  assert.equal(s.latest.version, '1.7.0');
  assert.equal(s.notify, false);
});

test('a missing or odd homepage never stops Paddock from opening', async t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-update-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const u = new U.UpdateCheck({ profile, current: '1.6.0', homepage: undefined, fetch: async () => { throw Error('no'); } });
  assert.match(u.status().lastError, /does not know/);
  assert.equal(u.status().automatic, false);
  assert.equal(await u.tick(), null);
  await assert.rejects(u.check(), /does not know/);
  assert.equal(U.repository(HOME + '#readme'), REPO);
});

test('a timeout or a quit abandons the check with a clear message', async t => {
  const f = fixture(t, { reply: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted')))) });
  const pending = f.u.check();
  f.u.stop();
  await assert.rejects(pending, /could not reach GitHub/);
  await assert.rejects(f.u.check(), /closing/);
  assert.equal(await f.u.tick(), null);
});

test('a result that cannot be saved to disk is still used for this session', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.profile, 'update-check.json.tmp')); // Makes the save fail.
  const s = await f.u.check();
  assert.equal(s.latest.version, '1.7.0');
  assert.equal(s.lastError, null);
});

test('setting validation', t => {
  const f = fixture(t);
  assert.throws(() => f.u.setEnabled('yes'), /Choose/);
  assert.equal(f.u.setEnabled(false).enabled, false);
  assert.equal(f.make().status().enabled, false);
});
