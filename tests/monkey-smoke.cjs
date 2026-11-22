'use strict';
// Random-click run (`--smoke --monkey-only`): clicks, types and opens windows at random on whatever
// collection the smoke profile holds, and records every error, stuck screen or failed check.
// Nothing leaves the computer: dialogs are cancelled, links and folders are not opened, printing and
// network hosting are switched off, and actions that move or wipe files are never chosen.
// MONKEY_STEPS (default 1500) and MONKEY_SEED adjust the run; the report goes to .qa/monkey-result.json.
const fs = require('node:fs'),
  path = require('node:path'),
  electron = require('electron');
const BLOCKED = [
  'club-enable',
  'club-start',
  'club-join',
  'club-open',
  'club-update',
  'club-disable',
  'club-leave',
  'connect',
  'connect-discovered',
  'discover-hosts',
  'portal-toggle',
  'start-sharing',
  'stop-sharing',
  'migrate-host',
  'set-host-password',
  'database-reset',
  'library-move',
  'update-check',
  'update-open',
  'update-skip',
  'update-toggle',
  'backup',
  'backup-previous',
  'auto-backup-run',
  'auto-backup-edit',
  'auto-backup-folder',
  'auto-backup-default-folder',
  'auto-backup-open',
  'recovery-import'
];
module.exports = async (win, store, network) => {
  const qa = path.join(__dirname, '..', '.qa'),
    steps = Number(process.env.MONKEY_STEPS) || 1500;
  let seed = Number(process.env.MONKEY_SEED) || 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const problems = new Map(),
    trail = [],
    blockedCalls = [];
  const note = (kind, message) => {
    const key = kind + ': ' + String(message).slice(0, 300);
    const p = problems.get(key) || {
      kind,
      message: String(message).slice(0, 2000),
      count: 0,
      lastSteps: trail.slice(-12)
    };
    p.count++;
    problems.set(key, p);
  };
  // Keep everything on this computer.
  const { dialog, shell, app } = electron;
  const keep = {};
  const stub = (obj, name, fn) => {
    keep[name] = [obj, obj[name]];
    obj[name] = fn;
  };
  stub(dialog, 'showOpenDialog', async () => (blockedCalls.push('open dialog'), { canceled: true, filePaths: [] }));
  stub(dialog, 'showSaveDialog', async () => (blockedCalls.push('save dialog'), { canceled: true }));
  stub(dialog, 'showMessageBox', async (...a) => {
    const o = a.find(x => x && typeof x === 'object' && x.buttons) || {};
    blockedCalls.push('message: ' + (o.message || '').slice(0, 80));
    const cancel = o.cancelId ?? o.buttons?.findIndex(b => /cancel|keep|not now|no\b|close/i.test(b));
    return { response: cancel >= 0 ? cancel : 0, checkboxChecked: false };
  });
  stub(dialog, 'showErrorBox', (title, body) => note('error box', title + ' — ' + body));
  stub(shell, 'openExternal', async url => void blockedCalls.push('link ' + url));
  stub(shell, 'openPath', async p => (blockedCalls.push('open ' + p), ''));
  stub(shell, 'showItemInFolder', p => void blockedCalls.push('show ' + p));
  for (const name of ['quit', 'relaunch'])
    stub(app, name, () => note('tried to ' + name, 'The app asked to ' + name + ' during the run.'));
  for (const name of ['start', 'startHost'])
    if (typeof network[name] === 'function') stub(network, name, async () => void blockedCalls.push('network ' + name));
  const onRejection = e => note('main process unhandled rejection', e?.stack || e);
  const onException = e => note('main process exception', e?.stack || e);
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  win.webContents.on('console-message', (...args) => {
    const e = args[0],
      level = e?.level ?? args[1],
      message = e?.message ?? args[2];
    if (level === 'error' || level === 3 || /Uncaught|TypeError|ReferenceError|RangeError/.test(String(message)))
      note('renderer console error', message);
  });
  win.webContents.on('render-process-gone', (_e, d) => note('window crashed', JSON.stringify(d)));
  win.webContents.on('unresponsive', () => note('window unresponsive', 'The window stopped responding.'));
  const js = code => win.webContents.executeJavaScript(code, true);
  await js(`(() => {
    window.__monkeyErrors = [];
    addEventListener('error', e => __monkeyErrors.push('error: ' + (e.error?.stack || e.message)));
    addEventListener('unhandledrejection', e => __monkeyErrors.push('rejection: ' + (e.reason?.stack || e.reason)));
  })()`);
  // Every candidate is described so a problem can be traced back to the clicks that led to it.
  const pickAndAct = r => `(async () => {
    const r = ${r}, BLOCKED = new Set(${JSON.stringify(BLOCKED)});
    const dialogOpen = document.querySelector('#dialog')?.open;
    const scope = dialogOpen ? document.querySelector('#dialog') : document;
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const all = [...scope.querySelectorAll('button,[data-action],a[href],input,select,textarea,summary,[role=tab]')]
      .filter(el => visible(el) && !el.disabled && !BLOCKED.has(el.dataset?.action) && !el.closest('[data-action-blocked]'));
    const describe = el => (el.dataset?.action ? '[' + el.dataset.action + (el.dataset.id ? ' ' + el.dataset.id.slice(0, 12) : '') + '] ' : '') +
      el.tagName.toLowerCase() + (el.name ? ' name=' + el.name : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 40) + '"';
    const texts = ['', 'abc', '-1', '0', '9999999', '1,5', '2.75', '<b>x</b>', 'Ünïcødé 🏁', 'x'.repeat(400), '2026-13-45', '  spaced  ', "O'Neil"];
    const roll = r * 100;
    if (dialogOpen && roll < 6) { document.querySelector('#dialog').close(); return 'close window'; }
    if (dialogOpen && roll < 12 && document.querySelector('#modal-form')) { document.querySelector('#modal-form').requestSubmit(); return 'submit window'; }
    if (roll < 15) { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 'press Escape'; }
    if (!all.length) return 'nothing to click';
    const el = all[Math.floor(((r * 7919) % 1) * all.length)];
    const label = describe(el);
    if (el.matches('input[type=checkbox],input[type=radio]')) { el.click(); return 'tick ' + label; }
    if (el.matches('input:not([type=button]):not([type=submit]):not([type=file]),textarea')) {
      const v = el.type === 'number' ? texts[Math.floor(r * 9)].replace(/[^0-9.,-]/g, '') || '3' : texts[Math.floor(((r * 104729) % 1) * texts.length)];
      el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      if (r < 0.3) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 'type ' + JSON.stringify(v.slice(0, 30)) + ' into ' + label;
    }
    if (el.matches('input[type=file]')) return 'skip file input';
    if (el.tagName === 'SELECT') {
      const options = [...el.options].filter(o => !o.disabled);
      if (options.length) { el.value = options[Math.floor(r * options.length)].value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return 'choose ' + JSON.stringify(el.value.slice(0, 30)) + ' in ' + label;
    }
    if (el.tagName === 'A' && /^https?:/.test(el.getAttribute('href') || '')) return 'skip outside link';
    if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'click ' + label;
  })()`;
  const idle = `(async () => { const t = performance.now();
    while (performance.now() - t < 15000) {
      const busy = (typeof actionBusy !== 'undefined' && actionBusy) || (typeof viewPendingKey !== 'undefined' && viewPendingKey) || (typeof modalSaving !== 'undefined' && modalSaving);
      if (!busy) return { ok: true, main: (document.querySelector('#main')?.children.length || 0) > 0, errors: __monkeyErrors.splice(0) };
      await new Promise(r => setTimeout(r, 20));
    }
    return { ok: false, what: JSON.stringify({ actionBusy: typeof actionBusy !== 'undefined' && actionBusy, view: typeof viewPendingKey !== 'undefined' && viewPendingKey, modalSaving: typeof modalSaving !== 'undefined' && modalSaving }), errors: __monkeyErrors.splice(0) };
  })()`;
  const started = Date.now();
  let done = 0;
  for (let step = 0; step < steps; step++) {
    // Now and then start again from a main page, so the run spreads over the whole app.
    if (step % 60 === 0)
      await js(
        `(async () => { const nav = [...document.querySelectorAll('[data-action="nav"]')]; if (document.querySelector('#dialog')?.open) document.querySelector('#dialog').close(); nav[Math.floor(${rnd()} * nav.length)]?.click(); })()`
      ).catch(() => {});
    let action;
    try {
      action = await js(pickAndAct(rnd()));
    } catch (e) {
      note('action failed', e.message);
      action = 'failed action';
    }
    trail.push(step + ' ' + action);
    if (trail.length > 40) trail.shift();
    await new Promise(r => setTimeout(r, 30));
    try {
      const s = await js(idle);
      for (const e of s.errors) note('renderer error', e);
      if (!s.ok) {
        note('stuck for 15 s', s.what);
        await js(`document.querySelector('#dialog')?.open && document.querySelector('#dialog').close()`).catch(
          () => {}
        );
      }
      if (s.ok && !s.main) note('blank page', 'The main area was empty after: ' + action);
    } catch (e) {
      note('window check failed', e.message);
    }
    done++;
  }
  // The collection must still open with every check after all that.
  let collection = 'ok';
  try {
    await store.whenIdle?.();
    const { Store } = require('../src/store.cjs');
    const data = new Store(store.file).snapshot();
    collection = `ok: revision ${data.revision}, ${data.cars.length} cars, ${data.parts.length} parts`;
  } catch (e) {
    collection = 'FAILED: ' + e.stack;
    note('collection check', e.stack);
  }
  process.off('unhandledRejection', onRejection);
  process.off('uncaughtException', onException);
  for (const [name, [obj, fn]] of Object.entries(keep)) obj[name] = fn;
  const report = {
    steps: done,
    minutes: +((Date.now() - started) / 60000).toFixed(1),
    collection,
    problems: [...problems.values()].sort((a, b) => b.count - a.count),
    blockedCalls: [...new Set(blockedCalls)].slice(0, 200)
  };
  fs.writeFileSync(path.join(qa, 'monkey-result.json'), JSON.stringify(report, null, 1));
  console.log(
    `Random-click run: ${done} steps in ${report.minutes} min, ${report.problems.length} distinct problems. ${collection}`
  );
};
