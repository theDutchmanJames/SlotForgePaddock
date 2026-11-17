'use strict';
// "A new version is available": a quiet notice in the top bar, plus Settings → Database → Updates.
let updateState = null;
let updateLoading = false;
let updateReloadQueued = false;

// The rest of the app has finished starting (app.js sets these during init).
function updateAppReady() {
  return typeof db !== 'undefined' && !!db && typeof net !== 'undefined' && !!net && typeof render === 'function';
}

async function loadUpdateStatus() {
  // A change that arrives while loading is not lost: load once more afterwards.
  if (updateLoading) {
    updateReloadQueued = true;
    return;
  }
  updateLoading = true;
  try {
    updateState = await api('updateCheck', 'status');
  } catch {
    updateState = null; // The notice is optional; never block the app for it.
  } finally {
    updateLoading = false;
  }
  showUpdateState();
  if (updateReloadQueued) {
    updateReloadQueued = false;
    void loadUpdateStatus();
  }
}

/** Updates what is on screen without rebuilding the page the user is working on. */
function showUpdateState() {
  if (!updateAppReady()) return;
  if (page === 'Settings' && settingsSection === 'Database') {
    // Never redraw under an open form or a running action; the next redraw shows it.
    if (!document.querySelector('#dialog')?.open && !actionBusy && !modalSaving) render();
    return;
  }
  const bar = document.querySelector('#database-bar');
  if (!bar) return;
  const html = updateNoticeHtml();
  const old = bar.querySelector('.update-notice');
  if ((old?.outerHTML || '') === html) return;
  old?.remove();
  if (html) bar.insertAdjacentHTML('beforeend', html);
}

/** The notice next to the database name, only when a newer version exists and was not put off. */
function updateNoticeHtml() {
  const s = updateState;
  if (!s?.notify || !s.latest) return '';
  return (
    `<span class="update-notice" role="status">${icon('download')}<span>Paddock ${esc(s.latest.version)} is available</span>` +
    `<button type="button" class="btn small primary" data-action="update-open">Download</button>` +
    `<button type="button" class="btn small ghost" data-action="update-skip" title="Hide until a newer version appears">Not now</button></span>`
  );
}

function updateWhen(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function renderUpdateSettings() {
  const s = updateState;
  if (!s) {
    void loadUpdateStatus();
    return panel('Updates', '<p class="muted">Loading…</p>');
  }
  let state;
  if (s.checking) state = 'Checking…';
  else if (s.latest) state = `Version ${s.latest.version} is available`;
  else if (s.upToDate) state = 'You have the latest version';
  else state = 'Not checked yet';
  const how = !s.enabled
    ? 'Off: Paddock only checks when you click Check now.'
    : s.automatic
      ? 'Paddock checks for a new version twice a day at most and shows a notice in the top bar.'
      : 'This copy only checks when you click Check now.';
  const body =
    `<p class="muted">${esc(how)} It only asks GitHub for the newest version number; nothing about you or your collection is sent. Paddock never installs anything by itself.</p>` +
    (s.lastError && !s.checking ? `<p class="note warning">${esc(s.lastError)}</p>` : '') +
    dl([
      ['This version', s.current],
      ['Newest version', state],
      ['Last checked', s.lastCheck ? updateWhen(s.lastCheck) : 'Never']
    ]) +
    `<div class="actions mt">${s.latest ? btn(icon('download') + ' Download ' + esc(s.latest.version), 'update-open', 'primary') : ''}` +
    `${btn('Check now', 'update-check')}` +
    `${s.automatic ? btn(s.enabled ? 'Turn off automatic checks' : 'Turn on automatic checks', 'update-toggle') : ''}</div>` +
    (s.latest
      ? '<p class="tiny muted mt">Download opens the release page in your browser. Make a backup, close Paddock, then install the new version as before; your collection stays where it is.</p>'
      : '');
  return panel('Updates', body);
}

async function updateAction(action) {
  if (!action.startsWith('update-')) return false;
  if (action === 'update-open') {
    await api('updateCheck', 'open');
    return true;
  }
  if (action === 'update-skip') {
    updateState = await api('updateCheck', 'skip', { version: updateState?.latest?.version });
    showUpdateState();
    toast(
      'Paddock will remind you again when a newer version appears. Settings → Database → Updates has the download.'
    );
    return true;
  }
  if (action === 'update-check') {
    // Not awaited: a slow network must not hold up every other button. The status event
    // redraws Settings when the check ends.
    api('updateCheck', 'check').then(
      s => {
        updateState = s;
        showUpdateState();
        toast(s.latest ? `Version ${s.latest.version} is available.` : 'You have the latest version.');
      },
      e => {
        toast(e.message, true);
        void loadUpdateStatus();
      }
    );
    return true;
  }
  if (action === 'update-toggle') {
    updateState = await api('updateCheck', 'enable', { enabled: !updateState?.enabled });
    showUpdateState();
    return true;
  }
  return false;
}

window.slotforge.onUpdateCheck(() => {
  void loadUpdateStatus();
});
// api() and render() live in app.js, which loads after this file.
window.addEventListener('DOMContentLoaded', () => {
  void loadUpdateStatus();
});
