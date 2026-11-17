'use strict';
// Search everything (Ctrl+K) and keyboard shortcuts.
//
// The palette has its own <dialog> so it never interferes with the app's form dialog.
// Results open things through the same actions as clicking does.

const PALETTE_DEBOUNCE_MS = 120;
const PALETTE_MAX = 200;
let paletteSerial = 0;
let paletteTimer = null;
let paletteItems = [];
let paletteIndex = 0;
let paletteShown = null; // The query the listed items belong to.
let paletteRunning = null; // The search in progress, so Enter can wait for it.

const isMac = /Mac/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const PALETTE_SPECIAL = { ø: 'o', ł: 'l', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', þ: 'th' };

/** Same matching as the collection search: every word, any order, no accents. */
function paletteFold(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[øłæœßđþ]/g, ch => PALETTE_SPECIAL[ch])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}
function paletteMatches(textValue, query) {
  const hay = paletteFold(textValue);
  return paletteFold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every(w => hay.includes(w));
}

const PALETTE_COMMANDS = [
  { label: 'Add car', detail: 'New car in your collection', keys: `${MOD} N`, run: () => paletteRunAction('add-car') },
  {
    label: 'Create backup',
    detail: 'Import & Export · save a complete backup now',
    run: () => paletteRunAction('backup')
  },
  {
    label: 'Settings: Database and backups',
    detail: 'Automatic backups, updates, library',
    keys: `${MOD} ,`,
    run: () => paletteGo('Settings', 'Database')
  },
  { label: 'Settings: Appearance', detail: 'Theme and interface size', run: () => paletteGo('Settings', 'Appearance') },
  { label: 'Keyboard shortcuts', detail: 'List of shortcuts', keys: '?', run: () => showShortcuts() }
];

/** True (after telling the user) while another action is still running. */
function paletteBusy() {
  if ((typeof actionBusy !== 'undefined' && actionBusy) || (typeof modalSaving !== 'undefined' && modalSaving)) {
    toast('Wait for the current action to finish, then try again.', true);
    return true;
  }
  return false;
}

/** Opens one of the app's actions exactly as a click on its button would. */
function paletteRunAction(action, id) {
  if (paletteBusy()) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.hidden = true;
  button.dataset.action = action;
  if (id) button.dataset.id = id;
  document.body.append(button);
  button.click();
  button.remove();
}

function paletteLeavePage() {
  exportChoosing = false;
  selected.clear();
  carId = null;
}

function paletteGo(targetPage, targetSection) {
  if (paletteBusy()) return;
  if (targetPage === 'Settings' && !local()) switchCollection('local');
  paletteLeavePage();
  page = targetPage;
  if (targetPage === 'Settings' && targetSection) settingsSection = targetSection;
  render();
  paletteFocusPage();
}

function paletteOpenPart(item) {
  if (paletteBusy()) return;
  paletteLeavePage();
  page = 'Parts';
  partsTab = 'Stock';
  stockScope = item.owned ? 'owned' : 'catalogue';
  partCategory = item.category || '';
  partTypeFilter = '';
  partMakerFilter = '';
  partQuery = '';
  partId = item.id;
  if (typeof detailOffsets === 'object' && detailOffsets) detailOffsets.partHistory = 0;
  render();
  paletteFocusPage();
}

/** After opening something, put keyboard focus on the new page instead of losing it. */
function paletteFocusPage() {
  window.scrollTo(0, 0);
  setTimeout(() => {
    const heading = document.querySelector('#main h1, #main h2');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }, 0);
}

function paletteDialog() {
  let dialog = document.querySelector('#palette');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'palette';
  dialog.className = 'palette';
  dialog.setAttribute('aria-label', 'Search everything');
  dialog.innerHTML = `<div class="palette-box">
    <div class="palette-input">${icon('search')}
      <input id="palette-query" type="text" maxlength="${PALETTE_MAX}" autocomplete="off" spellcheck="false" placeholder="Search cars, parts, jobs, manuals…" aria-label="Search cars, parts, jobs, manuals and commands" role="combobox" aria-expanded="false" aria-controls="palette-results" aria-autocomplete="list">
      <kbd aria-hidden="true">Esc</kbd></div>
    <div id="palette-results" class="palette-results" role="listbox" aria-label="Results"></div>
    <p id="palette-status" class="palette-note muted" role="status" aria-live="polite"></p>
    <p class="palette-help tiny muted">↑ ↓ to choose · Enter to open · ${MOD} K to search from anywhere · ? for all shortcuts</p>
  </div>`;
  document.body.append(dialog);
  const input = dialog.querySelector('#palette-query');
  input.addEventListener('input', () => {
    clearTimeout(paletteTimer);
    paletteTimer = setTimeout(() => {
      paletteTimer = null;
      void paletteSearch(input.value);
    }, PALETTE_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', paletteKeys);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      dialog.close();
      return;
    } // Click outside the box.
    const row = event.target.closest('[data-palette-index]');
    if (row) void paletteChoose(Number(row.dataset.paletteIndex));
  });
  dialog.addEventListener('close', () => {
    paletteSerial++;
    clearTimeout(paletteTimer);
    paletteTimer = null;
  });
  return dialog;
}

function openPalette(initial = '') {
  if (typeof db === 'undefined' || !db) return; // Still starting.
  if (document.querySelector('#dialog')?.open || document.querySelector('#showroom-viewer')?.open) return;
  const dialog = paletteDialog();
  const input = dialog.querySelector('#palette-query');
  input.value = initial;
  if (!dialog.open) dialog.showModal();
  input.focus();
  input.select();
  void paletteSearch(input.value);
}

function paletteGroup(title, entries) {
  return entries.length ? { title, entries } : null;
}

function paletteSearch(query) {
  const job = paletteLookup(query);
  paletteRunning = job;
  return job.finally(() => {
    if (paletteRunning === job) paletteRunning = null;
  });
}

async function paletteLookup(query) {
  const serial = ++paletteSerial;
  const q = query.trim();
  const commands = PALETTE_COMMANDS.filter(c => !q || paletteMatches(c.label + ' ' + c.detail, q));
  const pages = (q ? navs.filter(n => paletteMatches(n, q)) : []).map(n => ({
    label: n,
    detail: 'Go to page',
    run: () => paletteRunAction('nav', n)
  }));
  let groups = [];
  let note = '';
  if (q) {
    if (!local()) {
      note = 'Search works in your own collection. Switch back to it to search cars and parts.';
    } else {
      try {
        const r = await api('search', q);
        if (serial !== paletteSerial) return; // A newer search is on its way.
        groups = [
          paletteGroup(
            'Cars',
            r.cars.items.map(c => ({
              label: c.label,
              detail: c.detail,
              icon: 'car',
              run: () => paletteRunAction('open-car', c.id)
            }))
          ),
          paletteGroup(
            'Parts',
            r.parts.items.map(p => ({ label: p.label, detail: p.detail, icon: 'box', run: () => paletteOpenPart(p) }))
          ),
          paletteGroup(
            'Workshop jobs',
            r.jobs.items.map(j => ({
              label: j.label,
              detail: j.detail,
              icon: 'tool',
              run: () => {
                if (!paletteBusy()) return openJob(j.id);
              }
            }))
          ),
          paletteGroup(
            'Manuals and part guides',
            r.guides.items.map(g => ({
              label: g.label,
              detail: g.detail,
              icon: 'list',
              run: () => paletteRunAction('guide-open', g.id)
            }))
          )
        ].filter(Boolean);
        const more = ['cars', 'parts', 'jobs', 'guides'].reduce(
          (n, k) => n + Math.max(0, r[k].total - r[k].items.length),
          0
        );
        if (more) note = `${more} more ${more === 1 ? 'match' : 'matches'}. Type more to narrow it down.`;
      } catch (e) {
        if (serial !== paletteSerial) return;
        note = e.message;
      }
    }
  }
  if (serial !== paletteSerial) return;
  groups.push(paletteGroup('Pages', pages), paletteGroup(q ? 'Commands' : 'Quick commands', commands));
  paletteRender(groups.filter(Boolean), q, note);
}

function paletteRender(groups, query, note) {
  const out = document.querySelector('#palette-results');
  if (!out) return;
  paletteItems = groups.flatMap(g => g.entries);
  paletteIndex = 0;
  paletteShown = query;
  let index = 0,
    group = 0;
  out.innerHTML = groups
    .map(g => {
      const headingId = `palette-group-${group++}`;
      return `<div class="palette-group" role="group" aria-labelledby="${headingId}"><h3 id="${headingId}" role="presentation">${esc(g.title)}</h3>${g.entries
        .map(e => {
          const i = index++;
          return `<div class="palette-row" id="palette-row-${i}" role="option" data-palette-index="${i}" aria-selected="${i === 0}">${e.icon ? icon(e.icon) : ''}<span><strong>${esc(e.label)}</strong>${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</span>${e.keys ? `<kbd aria-hidden="true">${esc(e.keys)}</kbd>` : ''}</div>`;
        })
        .join('')}</div>`;
    })
    .join('');
  const status = document.querySelector('#palette-status');
  const found = query && !paletteItems.length && !note ? `Nothing found for “${query}”.` : '';
  status.textContent =
    note || found || (query ? `${paletteItems.length} ${paletteItems.length === 1 ? 'result' : 'results'}` : '');
  status.classList.toggle('sr-only', !note && !found);
  document.querySelector('#palette-query')?.setAttribute('aria-expanded', String(paletteItems.length > 0));
  paletteHighlight();
}

function paletteHighlight() {
  for (const row of document.querySelectorAll('#palette-results .palette-row')) {
    const active = Number(row.dataset.paletteIndex) === paletteIndex;
    row.classList.toggle('active', active);
    row.setAttribute('aria-selected', String(active));
    if (active) row.scrollIntoView({ block: 'nearest' });
  }
  const input = document.querySelector('#palette-query');
  if (!input) return;
  if (paletteItems.length) input.setAttribute('aria-activedescendant', `palette-row-${paletteIndex}`);
  else input.removeAttribute('aria-activedescendant');
}

function paletteKeys(event) {
  if (event.isComposing || event.keyCode === 229) return; // Typing with an input method (Japanese, Chinese…).
  if (event.key === 'Escape') {
    event.preventDefault();
    document.querySelector('#palette')?.close();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!paletteItems.length) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    paletteIndex = (paletteIndex + step + paletteItems.length) % paletteItems.length;
    paletteHighlight();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    void paletteEnter(event.target.value);
  }
}

/** Enter opens the highlighted item, but only from the results for what is typed now. */
async function paletteEnter(value) {
  const q = value.trim();
  if (paletteShown !== q || paletteTimer || paletteRunning) {
    clearTimeout(paletteTimer);
    paletteTimer = null;
    await paletteSearch(value);
    if (paletteShown !== q) return; // Still not up to date (typed again): ignore this Enter.
  }
  await paletteChoose(paletteIndex);
}

async function paletteChoose(index) {
  const item = paletteItems[index];
  if (!item) return;
  if (paletteBusy()) return;
  document.querySelector('#palette')?.close();
  try {
    await item.run();
  } catch (e) {
    toast(e.message, true);
  }
}

function showShortcuts() {
  const rows = [
    [`${MOD} K`, 'Search everything: cars, parts, jobs, manuals and commands'],
    ['/', 'Search everything (when not typing in a field)'],
    [`${MOD} F`, 'Search on this page, or search everything'],
    [`${MOD} N`, 'Add a car'],
    [`${MOD} ,`, 'Settings'],
    [isMac ? '⌥ 1 – 9' : 'Alt 1 – 9', 'Go to the pages in the main menu, in order (when not typing in a field)'],
    ['Esc', 'Close a window or menu'],
    ['?', 'This list']
  ];
  modal(
    'Keyboard shortcuts',
    `<table class="shortcut-table"><tbody>${rows.map(([k, t]) => `<tr><th><kbd>${esc(k)}</kbd></th><td>${esc(t)}</td></tr>`).join('')}</tbody></table>`,
    null
  );
}

/** The compact search button in the bar under the main menu. */
function paletteButtonHtml() {
  return `<button type="button" class="palette-button" data-action="palette-open" title="Search everything (${MOD} K)">${icon('search')}<span>Search…</span><kbd aria-hidden="true">${MOD} K</kbd></button>`;
}

async function paletteAction(action) {
  if (action === 'palette-open') {
    openPalette();
    return true;
  }
  return false;
}

function typingInField(target) {
  return !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
}

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (typeof db === 'undefined' || !db) return; // Still starting.
  // AltGr on European keyboards arrives as Ctrl+Alt, so every Ctrl shortcut requires no Alt.
  const mod = (isMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey;
  const key = event.key.toLowerCase();
  const palette = document.querySelector('#palette');
  if (mod && key === 'k') {
    event.preventDefault();
    if (palette?.open) palette.close();
    else openPalette();
    return;
  }
  if (palette?.open || document.querySelector('#dialog')?.open || document.querySelector('#showroom-viewer')?.open)
    return;
  const typing = typingInField(event.target);
  if (mod && key === 'f') {
    // Focus this page's own search box if it has one, otherwise search everything.
    event.preventDefault();
    const own = document.querySelector(
      '#car-search, #main input[type="search"], #main input[placeholder^="Search" i], #main input[placeholder^="Find" i]'
    );
    if (own) {
      own.focus();
      own.select?.();
    } else openPalette();
    return;
  }
  if (mod && key === 'n') {
    event.preventDefault();
    if (local()) paletteRunAction('add-car');
    return;
  }
  if (mod && event.key === ',') {
    event.preventDefault();
    paletteGo('Settings', settingsSection || 'Appearance');
    return;
  }
  if (typing) return;
  // Alt+1–9 by key position: works on AZERTY and macOS, and never on the numeric keypad
  // (Windows uses Alt+numpad digits to type characters such as é).
  const digit = /^Digit([1-9])$/.exec(event.code || '');
  if (digit && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    const target = navs[Number(digit[1]) - 1];
    if (target) {
      event.preventDefault();
      paletteRunAction('nav', target);
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '/') {
    event.preventDefault();
    openPalette();
    return;
  }
  if (event.key === '?') {
    event.preventDefault();
    showShortcuts();
  }
});
