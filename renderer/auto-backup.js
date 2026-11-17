'use strict';
// Settings → Database → Automatic backups. The settings live on this computer, not in the collection.
let autoBackupState = null;
let autoBackupLoading = false;
const AUTO_BACKUP_EVERY = { day: 'Every day', week: 'Every week', month: 'Every month' };

function autoBackupWhen(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function autoBackupSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return Math.round(bytes / 1024 / 1024) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function loadAutoBackupStatus() {
  if (autoBackupLoading) return;
  autoBackupLoading = true;
  try {
    autoBackupState = await api('autoBackup', 'status');
  } catch (e) {
    autoBackupState = { error: e.message };
  } finally {
    autoBackupLoading = false;
  }
  if (page === 'Settings' && settingsSection === 'Database') render();
}

function autoBackupNextText(s) {
  if (!s.enabled) return 'Off';
  if (s.running) return 'Running now…';
  if (!s.nextDue || s.nextDue <= Date.now()) return 'Soon, the next time Paddock is not in use';
  return autoBackupWhen(s.nextDue);
}

function renderAutoBackupSettings() {
  const s = autoBackupState;
  if (!s) {
    void loadAutoBackupStatus();
    return panel('Automatic backups', '<p class="muted">Loading…</p>');
  }
  if (s.error) return panel('Automatic backups', `<p class="note warning">${esc(s.error)}</p>`);
  const last = s.lastSuccess
    ? `${autoBackupWhen(s.lastSuccess.at)} · ${autoBackupSize(s.lastSuccess.size)}`
    : 'None yet';
  const problem =
    s.lastError && s.enabled
      ? `<p class="note warning auto-backup-problem"><strong>The last automatic backup did not work.</strong> ${esc(s.lastError.message)}</p>`
      : '';
  const intro = s.enabled
    ? `<p class="muted">Paddock makes a complete backup ${esc(AUTO_BACKUP_EVERY[s.every].toLowerCase())} and keeps the newest ${s.keep}. It waits until you are not using Paddock and stops at once when you start working again.</p>`
    : '<p class="muted">Automatic backups are off. Turn them on to keep recent complete backups without having to remember.</p>';
  const body =
    intro +
    problem +
    dl([
      ['Status', s.enabled ? 'On' : 'Off'],
      ['Schedule', `${AUTO_BACKUP_EVERY[s.every]} · keep ${s.keep}`],
      ['Last backup', last],
      ['Next backup', autoBackupNextText(s)]
    ]) +
    `<h3 class="mt">Backup folder</h3><div class="settings-path">${esc(s.folder)}</div>` +
    (s.customFolder
      ? ''
      : '<p class="tiny muted">The standard folder, inside Paddock\'s own profile folder on this computer. Choose a folder on another drive or a USB disk to protect against a broken disk.</p>') +
    `<div class="actions mt">${btn(icon('edit') + ' Change schedule…', 'auto-backup-edit', s.enabled ? '' : 'primary')}` +
    `${btn('Choose folder…', 'auto-backup-folder')}` +
    `${s.customFolder ? btn('Use standard folder', 'auto-backup-default-folder') : ''}` +
    `${btn('Open folder', 'auto-backup-open')}` +
    `${btn(icon('database') + ' Back up now', 'auto-backup-run')}</div>` +
    '<p class="tiny muted mt">Only automatic backups of this collection are removed when there are more than you keep. Your own backups and other files in the folder are never touched. Settings here apply to this computer only.</p>';
  return panel('Automatic backups', body);
}

async function autoBackupAction(action) {
  if (!action.startsWith('auto-backup-')) return false;
  const refresh = value => {
    if (value && typeof value === 'object' && 'enabled' in value) autoBackupState = value;
    render();
  };
  if (action === 'auto-backup-edit') {
    const s = autoBackupState || {};
    const everyOptions = Object.entries(AUTO_BACKUP_EVERY)
      .map(([value, text]) => `<option value="${value}" ${value === s.every ? 'selected' : ''}>${esc(text)}</option>`)
      .join('');
    simpleForm(
      'Automatic backups',
      `<label class="check wide"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Make automatic backups</label>` +
        `<label class="field">How often<select name="every">${everyOptions}</select></label>` +
        `<label class="field">Backups to keep<input name="keep" type="number" min="${s.keepRange?.[0] || 1}" max="${s.keepRange?.[1] || 50}" step="1" value="${esc(s.keep || 5)}" required></label>` +
        '<p class="tiny muted wide">Each backup is a complete copy including photos and documents, so keeping many can take a lot of disk space.</p>',
      async values => {
        autoBackupState = await api('autoBackup', 'save', {
          enabled: values.enabled === 'on',
          every: values.every,
          keep: Number(values.keep)
        });
      },
      'Save'
    );
    return true;
  }
  if (action === 'auto-backup-folder') {
    const value = await api('autoBackup', 'choose');
    if (value) {
      refresh(value);
      toast('Automatic backups will be saved in the new folder.');
    }
    return true;
  }
  if (action === 'auto-backup-default-folder') {
    refresh(await api('autoBackup', 'default-folder'));
    toast('Automatic backups will be saved in the standard folder.');
    return true;
  }
  if (action === 'auto-backup-open') {
    await api('autoBackup', 'open');
    return true;
  }
  if (action === 'auto-backup-run') {
    const value = await api('autoBackup', 'run');
    refresh(value);
    if (value?.result) toast(`Backup saved (${autoBackupSize(value.result.size)}).`);
    return true;
  }
  return false;
}

window.slotforge.onAutoBackup(() => {
  void loadAutoBackupStatus();
});
