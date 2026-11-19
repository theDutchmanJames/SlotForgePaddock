'use strict';
// Spreadsheet import window, after docs/ui-reference/spreadsheet-import-2026-11 (option A):
// one window size for both steps. Step 1 lists your spreadsheet's columns as rows (heading,
// examples, Paddock field, status) beside a live preview of a car; step 2 lists the cars beside
// a panel with the selected car's choice and fields. File settings open in the side panel.
let spreadsheetView = null,
  spreadsheetPoll = null,
  sheetStep = 2,
  sheetFilter = 'all',
  sheetDetail = null,
  sheetChanging = false,
  sheetColFilter = 'all',
  sheetColQuery = '',
  sheetFocusCol = null,
  sheetSettingsOpen = false,
  sheetPreviewIndex = 0,
  sheetPreviewCache = null,
  sheetLeftOut = { id: null, cols: new Set() };
const sheetCall = (action, p = {}) => api('file', 'spreadsheet.' + action, p);
function sheetOptions(items, value) {
  return items
    .map(
      ([v, label]) =>
        `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`
    )
    .join('');
}
function sheetFooter(html, summary = '') {
  $('#dialog .dialog-footer').innerHTML =
    `${summary ? `<div class="sheet-footer-summary" aria-live="polite">${summary}</div>` : ''}<div class="actions">${btn('Save for later', 'sheet-later', 'ghost')}${html}</div>`;
}
function sheetLetter(n) {
  let s = '';
  for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function sheetConfig() {
  const v = spreadsheetView;
  return {
    ...v.config,
    delimiter: v.delimiter,
    ...($('#sheet-tab')
      ? {
          sheet: Number($('#sheet-tab').value),
          header: Number($('#sheet-header').value),
          delimiter: $('#sheet-delimiter')?.value,
          dateOrder: $('#sheet-date').value,
          decimal: $('#sheet-decimal').value,
          labelSeparator: $('#sheet-labels').value
        }
      : {}),
    mapping: v.headers.map((_, i) => $('#sheet-map-' + i)?.value ?? v.config.mapping[i])
  };
}
const sheetChip = (kind, text) => `<span class="sx-chip ${kind}">${esc(text)}</span>`;
const sheetNorm = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// "1 update", "2 updates", with the number in Roboto Mono
const sheetCount = (n, one, many) => `<span class="mono">${n}</span> ${n === 1 ? one : many}`;
function sheetThings(n) {
  return n === 1 ? '1 thing' : n + ' things';
}
function sheetColumnName(col) {
  return `column ${sheetLetter(col)} “${esc(spreadsheetView.headers[col])}”`;
}
function sheetField(id) {
  return spreadsheetView.fields.find(f => f.id === id);
}

/* ---------- the window frame: file chip, steps, file settings summary ---------- */
function sheetSettingsSummary(v) {
  const c = v.config,
    dates = { '': 'YYYY-MM-DD', dmy: 'DD-MM-YYYY', mdy: 'MM-DD-YYYY' }[c.dateOrder || ''] || 'YYYY-MM-DD',
    parts = [];
  if (v.sheets.length > 1) parts.push(`Sheet “${esc(v.sheets[c.sheet]?.name || '')}”`);
  parts.push(`Headings in row <span class="mono">${c.header}</span>`);
  if (v.delimiter)
    parts.push(
      `separator <span class="mono">${esc({ ',': 'comma', ';': 'semicolon', '\t': 'tab' }[v.delimiter] || v.delimiter)}</span>`
    );
  parts.push(`dates <span class="mono">${dates}</span>`);
  parts.push(`decimals <span class="mono">${c.decimal === ',' ? '1.234,50' : '1,234.50'}</span>`);
  return parts.join(' · ');
}
function sheetColumnCounts(v, mapping = v.config.mapping) {
  const problems = sheetMappingProblems(mapping),
    states = v.headers.map((_, i) => sheetColumnState(i, mapping, problems).kind);
  return {
    used: mapping.filter(Boolean).length,
    check: states.filter(s => s === 'warn' || s === 'bad').length,
    out: states.filter(s => s === 'off').length
  };
}
function sheetStepsHtml(v) {
  const mapping = v.state === 'mapping',
    n = sheetColumnCounts(v),
    one = `${n.used} matched${n.check ? ' · ' + n.check + ' to check' : ''}${n.out ? ' · ' + n.out + ' left out' : ''}`,
    two = mapping ? 'Next' : v.state === 'complete' ? 'Done' : `${v.ready} of ${v.total} ticked`;
  return `<nav class="sx-steps" aria-label="Import steps"><button type="button" class="sx-step ${mapping ? 'on' : 'done'}" data-action="sheet-step" data-id="columns" ${mapping ? 'aria-current="step"' : ''}><i>${mapping ? '1' : '✓'}</i>Match columns<small>${one}</small></button><button type="button" class="sx-step ${mapping ? '' : 'on'}" data-action="sheet-step" data-id="cars" ${mapping ? '' : 'aria-current="step"'}><i>2</i>Choose cars<small>${two}</small></button><div class="sx-settings"><span>${sheetSettingsSummary(v)}</span>${mapping && !v.recoveryChanged ? btn(sheetSettingsOpen ? 'Close file settings' : 'File settings…', 'sheet-settings', 'small') : ''}</div></nav>`;
}
function sheetFileChip(v) {
  const head = $('#dialog .dialog-head');
  if (!head || head.querySelector('.sx-file')) return;
  const ext = (v.name.split('.').pop() || 'csv').slice(0, 4).toUpperCase(),
    chip = document.createElement('div');
  chip.className = 'sx-file';
  chip.innerHTML = `<span class="sx-file-ico">${esc(ext)}</span><b>${esc(v.name)}</b><span>${v.sourceRows} car rows · ${v.headers.length} columns</span>`;
  head.querySelector('h2').after(chip);
}
// Draw the whole window once; later changes repaint only its regions, so lists keep their scroll.
function sheetWindow(v, view, title, body) {
  const current = $(`#dialog[open] .sheet-x[data-spreadsheet="${CSS.escape(v.id)}"][data-view="${view}"]`);
  if (current) {
    const keep = [...current.querySelectorAll('[data-keep-scroll]')].map(e => [e.dataset.keepScroll, e.scrollTop]);
    current.outerHTML = `<div data-spreadsheet="${esc(v.id)}" data-view="${view}" class="sheet-import sheet-x">${body}</div>`;
    const fresh = $(`.sheet-x[data-spreadsheet="${CSS.escape(v.id)}"]`);
    for (const [key, top] of keep) {
      const e = fresh.querySelector(`[data-keep-scroll="${key}"]`);
      if (e) e.scrollTop = top;
    }
    $('#dialog .dialog-head h2').textContent = title;
    return;
  }
  modal(
    title,
    `<div data-spreadsheet="${esc(v.id)}" data-view="${view}" class="sheet-import sheet-x">${body}</div>`,
    null
  );
  sheetFileChip(v);
}

/* ---------- step 1: match columns ---------- */
// Fields that look like a column's heading, best first (used for "Check" and the picker's top group).
function sheetSuggestions(col) {
  const v = spreadsheetView,
    n = sheetNorm(v.headers[col]),
    words = n.split(' ').filter(w => w.length > 2);
  if (!n) return [];
  return v.fields
    .map(f => {
      const l = sheetNorm(f.label),
        score =
          l === n ? 3 : l.includes(n) || (l && n.includes(l)) ? 2 : words.some(w => l.split(' ').includes(w)) ? 1 : 0;
      return { f, score };
    })
    .filter(x => x.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(x => x.f);
}
// Everything that stops "Choose cars →", described per problem so the panel can
// say exactly which columns to fix instead of a single generic sentence.
function sheetMappingProblems(mapping = sheetConfig().mapping) {
  const v = spreadsheetView,
    uses = new Map(),
    problems = [];
  mapping.forEach((id, col) => {
    if (id) uses.set(id, [...(uses.get(id) || []), col]);
  });
  if (!uses.has('name')) problems.push({ kind: 'name' });
  for (const [id, columns] of uses)
    if (columns.length > 1) problems.push({ kind: 'duplicate', field: v.fields.find(f => f.id === id), columns });
  return problems;
}
function sheetColumnState(col, mapping, problems) {
  for (const p of problems)
    if (p.columns?.includes(col))
      return {
        kind: 'bad',
        label: 'Same field',
        note:
          'Same field as column ' +
          p.columns
            .filter(c => c !== col)
            .map(sheetLetter)
            .join(', ')
      };
  if (mapping[col]) return { kind: 'ok', label: 'Matched', note: '' };
  const left = sheetLeftOut.id === spreadsheetView.id && sheetLeftOut.cols.has(col),
    options = left ? [] : sheetSuggestions(col);
  if (options.length) {
    const same = options.filter(f => sheetNorm(f.label) === sheetNorm(options[0].label));
    return {
      kind: 'warn',
      label: 'Check',
      note:
        same.length > 1
          ? 'Could be ' + same.map(f => f.group).join(' or ')
          : 'Maybe ' + options[0].label + ' — pick a field or leave it out'
    };
  }
  return { kind: 'off', label: 'Left out', note: 'Not imported' };
}
function sheetColumnRows() {
  const v = spreadsheetView,
    mapping = sheetConfig().mapping,
    problems = sheetMappingProblems(mapping),
    q = sheetNorm(sheetColQuery);
  const rows = v.headers
    .map((h, i) => ({ h, i, st: sheetColumnState(i, mapping, problems), f: sheetField(mapping[i]) }))
    .filter(
      r =>
        (sheetColFilter === 'all' ||
          (sheetColFilter === 'check' && (r.st.kind === 'warn' || r.st.kind === 'bad')) ||
          (sheetColFilter === 'out' && r.st.kind === 'off')) &&
        (!q || sheetNorm(r.h + ' ' + sheetLetter(r.i) + ' ' + (r.f?.label || '')).includes(q))
    );
  return (
    rows
      .map(
        ({ h, i, st, f }) =>
          `<tr data-sheet-column="${i}" class="sx-colrow sx-${st.kind} ${sheetFocusCol === i ? 'sel' : ''}"><td><span class="sx-letter">${sheetLetter(i)}</span></td><td class="sx-head"><b>${esc(h) || '<span class="muted">No heading</span>'}</b>${st.note ? `<small>${esc(st.note)}</small>` : ''}</td><td class="sx-samples">${
            v.samples[i]
              .filter(Boolean)
              .map(s => `<span class="sx-sample" title="${esc(s)}">${esc(s)}</span>`)
              .join('') || '<span class="muted tiny">Blank in the first rows</span>'
          }</td><td class="sx-arrow" aria-hidden="true">→</td><td><button type="button" class="sx-pick ${f ? '' : 'none'}" data-action="sheet-assign" data-id="${i}" aria-label="${esc('Assign ' + h + ' column; ' + (f ? f.group + ' → ' + f.label : 'Leave out'))}"><span><b>${esc(f?.label || 'Leave out')}</b><small>${esc(f?.group || 'Not imported')}</small></span><span aria-hidden="true">⌄</span></button></td><td>${sheetChip(st.kind, st.label)}</td></tr>`
      )
      .join('') || `<tr><td colspan="6" class="sx-empty">No columns in this view.</td></tr>`
  );
}
function sheetBlockersHtml(problems) {
  const list = cols => cols.map(sheetColumnName).join(cols.length === 2 ? ' and ' : ', ');
  const items = problems
    .map(p =>
      p.kind === 'name'
        ? `<li><div><strong>Choose the column with your car names</strong><p>Every car needs a name in Paddock. Set one column to <b>Identity → Display name</b>. No name column in your file? Model usually works well.</p></div><div class="actions">${btn('Choose column…', 'sheet-name-column', 'small primary')}</div></li>`
        : `<li><div><strong>${esc(p.field?.label || 'A Paddock field')} is used by ${p.columns.length} columns</strong><p>${list(p.columns)} are ${p.columns.length === 2 ? 'both' : 'all'} set to <b>${esc(p.field ? p.field.group + ' → ' + p.field.label : 'the same field')}</b>. Keep it on one column and change the other${p.columns.length > 2 ? 's' : ''}.</p></div><div class="actions">${p.columns.map(c => btn('Change column ' + sheetLetter(c), 'sheet-blocker-column', 'small', String(c))).join('')}</div></li>`
    )
    .join('');
  return `<h4 id="sheet-blockers-title">Before you can continue</h4><p class="tiny">Fix ${sheetThings(problems.length)} below to choose your cars.</p><ul>${items}</ul>`;
}
function sheetPreviewRow() {
  const c = sheetPreviewCache;
  return c?.rows.get(sheetPreviewIndex) || null;
}
// The first car as Paddock will show it: every assigned column at once, grouped like the car page.
function sheetPreviewCard() {
  const v = spreadsheetView,
    mapping = sheetConfig().mapping,
    row = sheetPreviewRow();
  if (!row) return '<div class="sx-card-empty">Loading row…</div>';
  const value = id => {
      const col = mapping.indexOf(id);
      return col < 0 ? '' : row.cells[col] || '';
    },
    name = value('name'),
    sub = ['maker', 'reference', 'scale'].map(value).filter(Boolean),
    groups = new Map();
  mapping.forEach((id, col) => {
    const f = sheetField(id);
    if (!f || id === 'name') return;
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push({ f, col, value: row.cells[col] || '' });
  });
  const order = [...new Set(v.fields.map(f => f.group))];
  const body = [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(
      ([g, items]) =>
        `<div class="g">${esc(g)}</div>` +
        items
          .map(
            ({ f, col, value }) =>
              `<dt class="${sheetFocusCol === col ? 'hl' : ''}">${esc(f.label)}</dt><dd class="${sheetFocusCol === col ? 'hl' : ''} ${value ? '' : 'blank'}">${value ? esc(value) : 'blank'}<span class="from">${sheetLetter(col)}</span></dd>`
          )
          .join('')
    )
    .join('');
  return `<div class="sx-car"><div class="sx-car-title"><h4>${name ? esc(name) : '<span class="muted">No name in this row</span>'}</h4><p>${sub.map(esc).join(' · ') || '&nbsp;'}</p></div><dl class="sx-kv">${body || '<div class="g">No other columns assigned yet</div>'}</dl></div>`;
}
function sheetSideColumns() {
  const v = spreadsheetView;
  if (sheetSettingsOpen)
    return `<div class="sx-sh"><div class="eye">Your file</div><h3>File settings</h3><p>Paddock read these from your file. Change them when columns or dates look wrong.</p></div><div class="sx-sb">${sheetFileOptions(v)}</div><div class="sx-sf">${btn('Cancel', 'sheet-settings', 'small ghost')}<span class="grow"></span>${btn('Apply and read again', 'sheet-columns', 'small primary')}</div>`;
  const mapping = sheetConfig().mapping,
    problems = sheetMappingProblems(mapping),
    checks = v.headers
      .map((_, i) => ({ i, st: sheetColumnState(i, mapping, problems) }))
      .filter(x => x.st.kind === 'warn');
  return `<div class="sx-sh"><div class="eye">Live preview</div><h3>How your cars will look</h3><p>Every assignment shows here at once. Step through the rows of your file to check them.</p></div><div class="sx-sb" data-keep-scroll="side"><div id="sheet-blockers" class="sheet-blockers" role="region" aria-labelledby="sheet-blockers-title" tabindex="-1" ${problems.length ? '' : 'hidden'}>${problems.length ? sheetBlockersHtml(problems) : ''}</div><p id="sheet-mapping-status" class="sr-only" role="status">${problems.length ? sheetThings(problems.length) + ' to fix before continuing.' : 'Suggested assignments are ready to check.'}</p>${checks
    .slice(0, 3)
    .map(
      ({ i, st }) =>
        `<button type="button" class="sx-tip" data-action="sheet-assign" data-id="${i}"><span class="sx-tip-mark">?</span><span><b>Check column ${sheetLetter(i)} “${esc(v.headers[i])}”</b><small>${esc(st.note)}</small></span></button>`
    )
    .join(
      ''
    )}${sheetPreviewCard()}</div><div class="sx-sf"><div class="sx-rownav">${btn('‹', 'sheet-row', 'small', '-1')}<span>Car <b class="mono">${sheetPreviewIndex + 1}</b> of <span class="mono">${v.previewTotal}</span> · row <span class="mono">${sheetPreviewRow()?.row ?? '—'}</span></span>${btn('›', 'sheet-row', 'small', '1')}</div><span class="grow"></span><span class="tiny muted">Values exactly as in your file</span></div>`;
}
function sheetColumnsBody(v) {
  const readOnly = v.recoveryChanged,
    n = sheetColumnCounts(v, sheetConfig().mapping),
    seg = [
      ['all', 'All', v.headers.length],
      ['check', 'To check', n.check],
      ['out', 'Left out', n.out]
    ]
      .map(
        ([k, l, c]) =>
          `<button type="button" class="${sheetColFilter === k ? 'on' : ''}" data-action="sheet-colfilter" data-id="${k}" aria-pressed="${sheetColFilter === k}">${l} <span class="n">${c}</span></button>`
      )
      .join('');
  return `${sheetStepsHtml(v)}${readOnly ? '<p class="note warning sx-readonly">This collection was restored. This import is retained for reference and cannot be replayed. Check the collection before importing a revised file.</p>' : ''}<div class="sx-body"><div class="sx-main"><div class="sx-tool"><div class="sx-seg">${seg}</div><span class="grow"></span><input id="sheet-col-search" type="search" class="sx-search" placeholder="Find a column…" value="${esc(sheetColQuery)}" aria-label="Find a column"></div><div class="sx-scroll" data-keep-scroll="cols"><table class="sx-cols"><thead><tr><th class="sx-w-col">Col</th><th>Your heading</th><th>Examples from your file</th><th></th><th>Goes to Paddock field</th><th class="sx-w-status">Status</th></tr></thead><tbody id="sheet-col-rows">${sheetColumnRows()}</tbody></table><p class="sx-foot-note">One row per column of your spreadsheet. Blank cells never erase details you already saved.</p></div></div><aside class="sx-side" id="sheet-side">${sheetSideColumns()}</aside></div>${v.headers.map((_, i) => `<input type="hidden" id="sheet-map-${i}" value="${esc(v.config.mapping[i] || '')}">`).join('')}`;
}
// Repaint the column list, the preview and the footer after a change, without redrawing the window.
function sheetMappingStatus() {
  const v = spreadsheetView,
    mapping = sheetConfig().mapping,
    problems = sheetMappingProblems(mapping),
    n = sheetColumnCounts(v, mapping);
  v.config.mapping = mapping;
  const rows = $('#sheet-col-rows');
  if (rows) rows.innerHTML = sheetColumnRows();
  const side = $('#sheet-side');
  if (side && !sheetSettingsOpen) {
    const top = side.querySelector('[data-keep-scroll]')?.scrollTop || 0;
    side.innerHTML = sheetSideColumns();
    const sb = side.querySelector('[data-keep-scroll]');
    if (sb) sb.scrollTop = top;
  }
  const steps = $('.sx-steps');
  if (steps) steps.outerHTML = sheetStepsHtml(v);
  document.querySelectorAll('.sx-seg [data-action="sheet-colfilter"] .n').forEach((e, i) => {
    e.textContent = [v.headers.length, n.check, n.out][i];
  });
  const count = $('#sheet-mapping-count');
  if (count)
    count.textContent = `${n.used} of ${v.headers.length} columns used${n.check ? ' · ' + n.check + ' to check' : ''}`;
  const meter = $('#sheet-meter');
  if (meter) {
    const w = x => ((100 * x) / Math.max(1, v.headers.length)).toFixed(1) + '%';
    // widths go through the style object: the page's security policy blocks style attributes
    meter.innerHTML = '<span class="ok"></span><span class="warn"></span><span class="off"></span>';
    [n.used, n.check, n.out].forEach((x, i) => (meter.children[i].style.width = w(x)));
  }
  // The button stays clickable: a click while blocked points at the problems instead of doing nothing.
  const blocked = !!problems.length || !!v.recoveryChanged,
    button = $('[data-action="sheet-preview"]');
  if (button) {
    button.setAttribute('aria-disabled', String(blocked));
    button.classList.toggle('sheet-blocked', blocked);
  }
  const note = $('#sheet-footer-blocked');
  if (note) {
    note.textContent = problems.length ? `Fix ${sheetThings(problems.length)} in the panel to continue` : '';
    note.hidden = !problems.length;
  }
}
function sheetShowBlockers() {
  const box = $('#sheet-blockers');
  if (!box || box.hidden) return;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  box.classList.remove('sheet-blockers-flash');
  void box.offsetWidth;
  box.classList.add('sheet-blockers-flash');
  box.focus({ preventScroll: true });
}
function sheetRevealColumn(col) {
  $(`#sheet-col-rows [data-sheet-column="${col}"]`)?.scrollIntoView({ block: 'nearest' });
}
function sheetShowColumns(v) {
  if (sheetLeftOut.id !== v.id) sheetLeftOut = { id: v.id, cols: new Set() };
  if (sheetPreviewCache?.id !== v.id || sheetPreviewCache.token !== v.previewToken) {
    sheetPreviewCache = { id: v.id, token: v.previewToken, rows: new Map() };
    sheetPreviewIndex = 0;
  }
  v.previewRows.forEach((r, i) => sheetPreviewCache.rows.set(i, r));
  // A fresh view wins over the assignments still on screen (a new heading row resets them).
  document.querySelectorAll('.sheet-x input[id^="sheet-map-"]').forEach(e => e.remove());
  sheetWindow(v, 'columns', 'Import cars', sheetColumnsBody(v));
  if (v.recoveryChanged)
    $('#dialog')
      .querySelectorAll('input,select,button[data-action="sheet-columns"],button[data-action="sheet-assign"]')
      .forEach(e => (e.disabled = true));
  sheetFooter(
    v.recoveryChanged ? '' : btn('Choose cars →', 'sheet-preview', 'primary'),
    '<strong id="sheet-mapping-count"></strong><div id="sheet-footer-blocked" class="sheet-footer-blocked" hidden></div><div class="tiny muted">You can change any column later. Nothing is imported yet.</div>'
  );
  $('#dialog .sheet-footer-summary').insertAdjacentHTML(
    'afterend',
    '<div id="sheet-meter" class="sx-meter" aria-hidden="true"></div>'
  );
  sheetMappingStatus();
}
async function sheetStepRow(delta) {
  const v = spreadsheetView,
    next = Math.min(Math.max(0, sheetPreviewIndex + delta), Math.max(0, v.previewTotal - 1));
  if (!sheetPreviewCache.rows.has(next)) {
    const page = await sheetCall('previewRows', { id: v.id, offset: next, token: v.previewToken });
    page.rows.forEach((r, i) => sheetPreviewCache.rows.set(next + i, r));
  }
  sheetPreviewIndex = next;
  sheetMappingStatus();
}

/* ---------- the field picker: a popover beside the clicked column ---------- */
function sheetClosePicker() {
  $('#sheet-field-pop')?.remove();
  const d = $('#sheet-field-dialog');
  if (d) {
    d.close();
    d.remove();
  }
}
function sheetPickerResults() {
  const pop = $('#sheet-field-pop');
  if (!pop) return;
  const v = spreadsheetView,
    col = Number(pop.dataset.column),
    query = sheetNorm($('#sheet-field-search').value),
    chosen = $('#sheet-map-' + col).value,
    mapping = sheetConfig().mapping,
    option = f => {
      const other = mapping.findIndex((id, i) => id === f.id && i !== col);
      return `<button type="button" class="sheet-field-option" data-action="sheet-field-pick" data-id="${esc(f.id)}" aria-pressed="${f.id === chosen}"><span>${esc(f.label)}</span><small>${f.id === chosen ? '✓ Assigned' : other >= 0 ? 'Used by column ' + sheetLetter(other) : esc(f.group)}</small></button>`;
    };
  let html = '';
  const matching = v.fields.filter(f => !query || sheetNorm(f.group + ' ' + f.label).includes(query));
  if (!query) {
    const best = sheetSuggestions(col);
    if (best.length)
      html += `<div class="sx-pop-group">Best matches for “${esc(v.headers[col])}”</div>${best.map(option).join('')}`;
  }
  const groups = new Map();
  for (const f of matching) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  for (const [g, list] of groups) html += `<div class="sx-pop-group">${esc(g)}</div>${list.map(option).join('')}`;
  $('#sheet-field-results').innerHTML = html || '<p class="sx-pop-none">No fields match your search.</p>';
  $('#sheet-field-results .sheet-field-option')?.classList.add('hi');
  $('#sheet-field-count').textContent = `${matching.length} matching fields`;
}
function sheetPlacePicker() {
  const pop = $('#sheet-field-pop'),
    anchor = $(`.sx-pick[data-id="${pop?.dataset.column}"]`) || $(`.sx-tip[data-id="${pop?.dataset.column}"]`);
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect(),
    h = pop.offsetHeight,
    below = innerHeight - r.bottom - 12;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (below >= h || below > r.top ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
}
function sheetOpenPicker(col) {
  if (spreadsheetView.recoveryChanged) return;
  sheetClosePicker();
  sheetFocusCol = col;
  sheetMappingStatus();
  sheetRevealColumn(col);
  const pop = document.createElement('div');
  pop.id = 'sheet-field-pop';
  pop.className = 'sx-pop';
  pop.dataset.column = String(col);
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Assign column ${sheetLetter(col)} “${spreadsheetView.headers[col]}”`);
  pop.innerHTML = `<input id="sheet-field-search" type="search" placeholder="Search Paddock fields…" autocomplete="off"><p id="sheet-field-count" class="sr-only" role="status"></p><div id="sheet-field-results"></div><div class="sx-pop-foot">${btn('Leave column out', 'sheet-field-ignore', 'small ghost')}<span class="grow"></span>${btn('Close', 'sheet-picker-close', 'small')}</div>`;
  $('#dialog').append(pop);
  $(`.sx-pick[data-id="${col}"]`)?.classList.add('open');
  sheetPickerResults();
  sheetPlacePicker();
  $('#sheet-field-search').focus();
}
function sheetOpenNamePicker() {
  if (spreadsheetView.recoveryChanged) return;
  sheetClosePicker();
  const v = spreadsheetView,
    mapping = sheetConfig().mapping,
    d = document.createElement('dialog');
  d.id = 'sheet-field-dialog';
  d.setAttribute('aria-labelledby', 'sheet-picker-title');
  const current = col => {
    const f = v.fields.find(f => f.id === mapping[col]);
    return f ? 'Now: ' + f.label : 'Now: not imported';
  };
  d.innerHTML = `<div class="dialog-head"><h2 id="sheet-picker-title">Which column holds your car names?</h2><button type="button" class="btn ghost small" data-action="sheet-picker-close" aria-label="Close column selector">✕</button></div><div class="sheet-picker-body"><p class="tiny">The column you choose is saved as <strong>Identity → Display name</strong>, replacing its current assignment.</p><div id="sheet-name-results">${v.headers.map((h, i) => `<button type="button" class="sheet-field-option" data-action="sheet-name-pick" data-id="${i}"><span><strong>${sheetLetter(i)} · ${esc(h)}</strong><small>${v.samples[i].filter(Boolean).map(esc).join(' · ') || 'Blank'}</small></span><small>${esc(current(i))}</small></button>`).join('')}</div></div><div class="dialog-footer">${btn('Cancel', 'sheet-picker-close')}</div>`;
  $('#dialog').append(d);
  d.addEventListener('close', () => d.remove(), { once: true });
  d.showModal();
  d.querySelector('.sheet-field-option')?.focus();
}
function sheetSetColumn(col, id) {
  const f = sheetField(id);
  $('#sheet-map-' + col).value = f?.id || '';
  if (sheetLeftOut.id === spreadsheetView.id) {
    if (f) sheetLeftOut.cols.delete(col);
    else sheetLeftOut.cols.add(col);
  }
  sheetClosePicker();
  sheetFocusCol = col;
  sheetMappingStatus();
  $(`.sx-pick[data-id="${col}"]`)?.focus();
}
function sheetFileOptions(v) {
  return `<div class="form-grid sheet-file-options"><label>Worksheet<select id="sheet-tab">${sheetOptions(
    v.sheets.map(s => [s.index, s.name + ' (' + s.rows + ' rows)']),
    v.config.sheet
  )}</select></label><label>Column headings are in row<input id="sheet-header" type="number" min="1" max="${v.sheets[v.config.sheet].rows}" value="${v.config.header}"></label>${
    v.delimiter
      ? `<label>CSV separator<select id="sheet-delimiter">${sheetOptions(
          [
            [',', 'Comma'],
            [';', 'Semicolon'],
            ['\t', 'Tab']
          ],
          v.delimiter
        )}</select></label>`
      : ''
  }<label>Text date order<select id="sheet-date">${sheetOptions(
    [
      ['', 'ISO dates (YYYY-MM-DD)'],
      ['dmy', 'Day / month / year'],
      ['mdy', 'Month / day / year']
    ],
    v.config.dateOrder
  )}</select></label><label>Decimal separator<select id="sheet-decimal">${sheetOptions(
    [
      ['.', 'Point: 1,234.50'],
      [',', 'Comma: 1.234,50']
    ],
    v.config.decimal
  )}</select></label><label>Separate labels with<select id="sheet-labels">${sheetOptions(
    [
      [',', 'Comma'],
      [';', 'Semicolon'],
      ['|', 'Vertical bar']
    ],
    v.config.labelSeparator
  )}</select></label></div><p class="tiny muted">Changing the worksheet, heading row or CSV separator reads the file again and suggests the columns afresh. Blank cells never erase saved details.</p>`;
}

/* ---------- step 2: choose cars ---------- */
function sheetRowStatus(r) {
  if (r.result) return sheetChip('ok', r.result.status === 'imported' ? 'Imported' : 'Sent for approval');
  if (r.error || r.errors.length) return sheetChip('bad', 'Needs attention');
  if (r.attempt) return sheetChip('warn', 'Save pending · retry safely');
  if (r.choice === 'new')
    return sheetChip('ok', r.candidates.length || r.duplicate ? 'Add as separate car' : 'Add new car');
  if (r.choice !== 'skip') return sheetChip('blue', 'Update existing');
  return r.candidates.length
    ? sheetChip('warn', 'Possible match')
    : r.duplicate
      ? sheetChip('off', 'Repeated in file')
      : sheetChip('off', 'Left out');
}
function sheetRowEditable(r) {
  const v = spreadsheetView;
  return !v.work && !v.recoveryChanged && !r.attempt && !r.errors.length && !r.result;
}
function sheetValue(value) {
  return esc(Array.isArray(value) ? value.join(', ') : (value ?? '—'));
}
function sheetSideCar() {
  const v = spreadsheetView,
    c = v.counts;
  if (v.work)
    return `<div class="sx-sh"><div class="eye">Importing</div><h3>Importing your cars…</h3><p>Progress is saved after each car. Closing this window keeps your progress in Review → Spreadsheet imports.</p></div><div class="sx-sb"><progress aria-label="Import progress" max="${v.total || 1}" value="${v.done}"></progress><p class="sx-big"><b class="mono">${v.done}</b> of <span class="mono">${v.total}</span> saved or submitted</p></div>`;
  if (v.state === 'complete')
    return `<div class="sx-sh"><div class="eye">Finished</div><h3>Your cars have been processed</h3><p>Submitted cars still need Dealership approval.</p></div><div class="sx-sb"><div class="sx-stats"><div><b>${c.imported}</b><small>imported</small></div><div><b>${c.submitted}</b><small>sent for approval</small></div><div><b>${c.skipped}</b><small>left out</small></div></div></div>`;
  const d = sheetDetail?.data;
  if (!d)
    return '<div class="sx-sh"><div class="eye">Car</div><h3>Pick a car</h3><p>Click a car in the list to see what will happen to it.</p></div>';
  const r = d.row,
    editable = sheetRowEditable(r),
    choice = sheetDetail.choice,
    updating = !['new', 'skip'].includes(choice),
    matched = r.candidates.length || r.duplicate,
    choices = [
      ['new', matched ? 'Add as a separate car' : 'Add new car'],
      ['skip', 'Leave out']
    ];
  return `<div class="sx-sh"><div class="eye">Row ${r.row}${matched ? ' · possible match' : ''}</div><h3>${esc(r.data.name || 'Unnamed car')}</h3><p>${esc([r.data.maker, r.data.reference].filter(Boolean).join(' · ')) || '&nbsp;'}</p></div><div class="sx-sb" data-keep-scroll="side">${[
    ...r.errors,
    ...(r.error ? [r.error] : [])
  ]
    .map(e => `<p class="sx-error">${esc(e)}</p>`)
    .join('')}${r.duplicate ? '<p class="sx-hint">This car appears more than once in your file.</p>' : ''}${
    r.candidates.length
      ? `<p class="sx-hint">Looks like a car you already have. A matching name or reference does not prove it is the same physical car.</p>${r.candidates
          .map(
            c =>
              `<button type="button" class="sx-match ${choice === c.id ? 'on' : ''}" data-action="sheet-choice" data-id="${esc(c.id)}" aria-pressed="${choice === c.id}" ${editable ? '' : 'disabled'}><span class="sx-match-th" aria-hidden="true">${icon('car')}</span><span><b>${esc(c.name)}</b><small>In your collection${c.wishlist ? ' · Wishlist' : ''}${c.archived ? ' · archived' : ''}</small></span><span class="sx-match-go">${choice === c.id ? 'Will update' : 'Update this car'}</span></button>`
          )
          .join('')}`
      : ''
  }<div class="sx-choice" role="group" aria-label="What happens to this row">${choices.map(([k, l]) => `<button type="button" class="${choice === k ? 'on' : ''}" data-action="sheet-choice" data-id="${k}" aria-pressed="${choice === k}" ${editable ? '' : 'disabled'}>${l}</button>`).join('')}</div>${
    choice === 'skip'
      ? '<p class="sx-hint">This row will not be imported.</p>'
      : `<div class="sx-lbl"><span>Details to import</span>${editable ? `<span>${btn('All', 'sheet-fields-all', 'small ghost')}${btn('None', 'sheet-fields-none', 'small ghost')}</span>` : ''}</div><table class="sx-diff" id="sheet-detail-fields"><thead><tr><th></th><th>Field</th>${updating ? '<th>In Paddock</th>' : ''}<th>From your file</th></tr></thead><tbody>${d.fields
          .map(f => {
            const changed = updating && sheetValue(f.before) !== sheetValue(f.after);
            return `<tr class="${changed ? 'ch' : ''}"><td><input type="checkbox" data-sheet-field="${esc(f.id)}" aria-label="Include ${esc(f.label)}" ${sheetDetail.fields.includes(f.id) ? 'checked' : ''} ${editable ? '' : 'disabled'}></td><td>${esc(f.label)}<small>${esc(f.group)}</small></td>${updating ? `<td class="prewrap">${sheetValue(f.before)}</td>` : ''}<td class="prewrap">${sheetValue(f.after)}</td></tr>`;
          })
          .join(
            ''
          )}</tbody></table><p class="sx-hint">${updating ? 'Blue values are new or changed. ' : ''}Unticked fields and blank cells leave existing details unchanged. Fitted parts and photos stay as they are.</p>`
  }<p id="sheet-detail-error" class="sx-error" hidden></p></div><div class="sx-sf">${btn('‹ Previous', 'sheet-detail-step', 'small', '-1')}<span class="grow"></span>${btn('Next to review ›', 'sheet-detail-step', 'small', '1')}</div>`;
}
function sheetCarsBody(v) {
  const c = v.counts,
    controls = !v.work && !v.recoveryChanged && v.state !== 'complete',
    seg = [
      ['all', 'All'],
      ['new', 'New'],
      ['matches', 'Possible matches'],
      ['attention', 'Needs attention']
    ]
      .map(
        ([key, label]) =>
          `<button type="button" class="${sheetFilter === key ? 'on' : ''}" data-action="sheet-filter" data-id="${key}" aria-pressed="${sheetFilter === key}">${label} <span class="n">${c[key]}</span></button>`
      )
      .join('');
  const rows =
    v.rows
      .map(
        r =>
          `<tr class="${sheetDetail?.row === r.row ? 'sel' : ''} ${r.choice === 'skip' && !r.result ? 'sheet-excluded-row' : ''}"><td class="sx-tick"><input type="checkbox" data-sheet-include="${r.row}" aria-label="Include row ${r.row}: ${esc(r.data.name || 'Unnamed car')}" ${r.choice !== 'skip' ? 'checked' : ''} ${!controls || r.attempt || r.errors.length || (r.choice === 'skip' && (r.candidates.length || r.duplicate)) ? 'disabled' : ''}></td><td class="sx-rn">${r.row}</td><td class="sx-nm"><button type="button" class="sx-rowbtn" data-action="sheet-detail" data-id="${r.row}"><b>${esc(r.data.name || 'Unnamed car')}</b><small>${esc([r.data.maker, r.data.reference].filter(Boolean).join(' · ')) || '&nbsp;'}</small></button></td><td>${sheetRowStatus(r)}</td></tr>`
      )
      .join('') || '<tr><td colspan="4" class="sx-empty">No cars in this view.</td></tr>';
  const pager =
    v.filteredTotal > 40
      ? `<div class="sx-pager"><span>${v.offset + 1}–${Math.min(v.filteredTotal, v.offset + 40)} of ${v.filteredTotal} cars</span><span class="grow"></span>${v.offset ? btn('Previous', 'sheet-page', 'small', String(Math.max(0, v.offset - 40))) : ''}${v.offset + 40 < v.filteredTotal ? btn('Next', 'sheet-page', 'small', String(v.offset + 40)) : ''}</div>`
      : '';
  return `${sheetStepsHtml(v)}${v.recoveryChanged ? '<p class="note warning sx-readonly">This collection was restored. This import is retained for reference and cannot be replayed. Check the collection before importing a revised file.</p>' : ''}${v.error ? `<p class="note warning sx-readonly">${esc(v.error)}</p>` : ''}<div class="sx-body"><div class="sx-main"><div class="sx-tool"><div class="sx-seg">${seg}</div><span class="grow"></span>${controls ? btn('Tick all new', 'sheet-select', 'small') + btn('Untick all', 'sheet-skip', 'small ghost') : ''}</div><div class="sx-scroll" data-keep-scroll="cars"><table class="sx-cars sheet-review"><thead><tr><th></th><th>Row</th><th>Car from your file</th><th class="sx-w-what">What happens</th></tr></thead><tbody>${rows}</tbody></table></div>${pager}</div><aside class="sx-side sx-side-wide" id="sheet-side">${sheetSideCar()}</aside></div>`;
}
function sheetShowCars(v) {
  if (sheetDetail && !v.rows.some(r => r.row === sheetDetail.row) && v.rows.length) sheetDetail = null;
  sheetWindow(v, 'cars', v.state === 'complete' ? 'Import complete' : 'Import cars', sheetCarsBody(v));
  const c = v.counts;
  sheetFooter(
    v.work
      ? btn('Pause after this car', 'sheet-stop')
      : v.recoveryChanged
        ? ''
        : v.state === 'complete'
          ? btn('Done', 'sheet-done', 'primary')
          : `${!v.locked ? btn('← Columns', 'sheet-back') : ''}${v.ready ? btn(v.locked ? 'Retry / continue import…' : `Import ${v.ready} cars…`, 'sheet-confirm', 'primary') : ''}`,
    `<strong>${sheetCount(v.ready, 'car', 'cars')} ticked · ${sheetCount(c.create, 'new', 'new')} · ${sheetCount(c.update, 'update', 'updates')}${c.matches ? ' · ' + sheetCount(c.matches, 'possible match', 'possible matches') : ''}</strong><div class="tiny muted">${v.done ? v.done + ' saved or submitted · ' : ''}Progress is saved after each car. Pausing keeps your place in Review.</div>`
  );
  // Open the first car that needs a decision, or the first car.
  if (!sheetDetail && v.rows.length && !v.work && v.state !== 'complete') {
    const first = v.rows.find(r => (r.candidates.length || r.duplicate || r.errors.length) && !r.result) || v.rows[0];
    void sheetLoadDetail(first.row);
  } else if (sheetDetail && !v.work) void sheetLoadDetail(sheetDetail.row, true);
}
async function sheetLoadDetail(rowNumber, quiet = false) {
  const v = spreadsheetView,
    d = await sheetCall('detail', { id: v.id, row: rowNumber });
  if (spreadsheetView !== v) return;
  const same = sheetDetail?.row === rowNumber;
  sheetDetail = { row: rowNumber, choice: d.row.choice, fields: [...d.row.fields], data: d };
  const side = $('#sheet-side');
  if (!side) return;
  const top = same ? side.querySelector('[data-keep-scroll]')?.scrollTop || 0 : 0;
  side.innerHTML = sheetSideCar();
  const sb = side.querySelector('[data-keep-scroll]');
  if (sb) sb.scrollTop = top;
  document
    .querySelectorAll('.sx-cars tbody tr')
    .forEach(tr =>
      tr.classList.toggle('sel', tr.querySelector('[data-sheet-include]')?.dataset.sheetInclude === String(rowNumber))
    );
  if (!quiet) $('.sx-cars tbody tr.sel')?.scrollIntoView({ block: 'nearest' });
}
// Save the open car's choice and ticked fields straight away; the list and counts follow.
async function sheetSaveChoice(choice, fields) {
  const r = sheetDetail.data.row;
  if (!sheetRowEditable(r)) return;
  if (choice === 'new' && !fields.includes('name')) {
    if (sheetDetail.data.fields.some(f => f.id === 'name')) fields = ['name', ...fields];
    else throw Error('Include Display name to add this car.');
  }
  if (choice !== 'skip' && !fields.length) throw Error('Tick at least one detail, or leave this row out.');
  await sheetCall('choose', { id: spreadsheetView.id, changes: [{ row: r.row, choice, fields }] });
  // Reload with the list's own filter and page; the reply to "choose" is the unfiltered first page.
  await sheetRefresh();
}
function sheetDetailSelection() {
  return [...document.querySelectorAll('[data-sheet-field]:checked')].map(e => e.dataset.sheetField);
}
function sheetStepDetail(delta) {
  const rows = spreadsheetView.rows,
    at = rows.findIndex(r => r.row === sheetDetail?.row),
    review = r => (r.candidates.length || r.duplicate || r.errors.length) && !r.result;
  let next = null;
  if (delta > 0) next = rows.slice(at + 1).find(review) || rows[at + 1];
  else next = rows[at - 1];
  if (next) return sheetLoadDetail(next.row);
}

/* ---------- one card in the window (confirmations) ---------- */
function sheetCard(v, title, html, buttons) {
  sheetWindow(
    v,
    'card',
    'Import cars',
    `${sheetStepsHtml(v)}<div class="sx-center"><div class="sx-cardbox"><h3>${esc(title)}</h3>${html}</div></div>`
  );
  sheetFooter(buttons);
}

function showSpreadsheetView(v) {
  clearTimeout(spreadsheetPoll);
  spreadsheetView = v;
  sheetFilter = v.filter || 'all';
  sheetStep = v.state === 'mapping' ? 2 : 3;
  if (v.state === 'mapping') {
    sheetDetail = null;
    sheetShowColumns(v);
    return;
  }
  sheetSettingsOpen = false;
  sheetShowCars(v);
  if (v.work)
    spreadsheetPoll = setTimeout(async () => {
      if (!$('#dialog').open || !document.querySelector('[data-spreadsheet]') || spreadsheetView?.id !== v.id) return;
      const marker = document.querySelector('[data-spreadsheet]');
      try {
        const next = await sheetCall('view', { id: v.id, offset: v.offset, filter: sheetFilter });
        if (marker?.isConnected && $('#dialog').open) showSpreadsheetView(next);
      } catch (e) {
        toast(e.message);
      }
    }, 800);
}
function showSpreadsheet(v) {
  // A fresh window (or another import) starts with the full column list and no open car.
  if (spreadsheetView?.id !== v.id || !$('#dialog').open || !document.querySelector('.sheet-x')) {
    sheetColFilter = 'all';
    sheetColQuery = '';
    sheetFocusCol = null;
    sheetSettingsOpen = false;
    sheetDetail = null;
  }
  showSpreadsheetView(v);
}
async function sheetRefresh(offset = spreadsheetView.offset) {
  showSpreadsheetView(await sheetCall('view', { id: spreadsheetView.id, offset, filter: sheetFilter }));
}
async function sheetSaved() {
  clearTimeout(spreadsheetPoll);
  spreadsheetView = null;
  sheetDetail = null;
  const rows = await sheetCall('list');
  modal(
    'Saved spreadsheet imports',
    `<div class="sheet-import"><p>Mappings and selections stay here until you finish or remove them. Removing an import never deletes saved cars.</p>${rows.length ? rows.map(j => `<div class="list-row"><div><strong>${esc(j.name)}</strong><p class="tiny muted">${j.done} / ${j.total} saved or submitted · ${esc(j.state)}${j.recoveryChanged ? ' · collection restored' : ''}</p></div><div class="actions">${btn('Open', 'sheet-open', '', j.id)}${btn('Remove', 'sheet-discard', 'small', j.id)}</div></div>`).join('') : empty('No saved spreadsheet imports', 'Choose a CSV or XLSX file to begin.')}</div>`,
    null
  );
  sheetFooter(btn('Choose spreadsheet', 'sheet-pick', 'primary'));
}
function renderSpreadsheetImports() {
  return panel(
    'Spreadsheet imports',
    '<p>Resume your saved column mappings and car reviews. Ownership, notes and custom fields remain in this local import workflow.</p><div class="actions">' +
      btn('Saved imports', 'sheet-saved', 'primary') +
      btn('Choose CSV / XLSX', 'sheet-pick') +
      '</div>'
  );
}
function sheetError(e) {
  const panelError = $('#sheet-detail-error');
  if (panelError && $('#dialog').open) {
    panelError.hidden = false;
    panelError.textContent = e.message;
    panelError.scrollIntoView({ block: 'nearest' });
    return;
  }
  const error = $('#form-error');
  if (error && $('#dialog').open) {
    error.hidden = false;
    error.textContent = e.message;
    error.scrollIntoView({ block: 'nearest' });
  } else toast(e.message);
}
async function spreadsheetAction(action, id) {
  if (!action.startsWith('sheet-')) return false;
  if (sheetChanging) return true;
  try {
    const v = spreadsheetView,
      p = { id: v?.id };
    if (action === 'sheet-picker-close') {
      sheetClosePicker();
      sheetMappingStatus();
      return true;
    }
    if (action === 'sheet-assign') {
      if ($('#sheet-field-pop')?.dataset.column === id) sheetClosePicker();
      else sheetOpenPicker(Number(id));
      return true;
    }
    if (action === 'sheet-field-pick' || action === 'sheet-field-ignore') {
      sheetSetColumn(Number($('#sheet-field-pop').dataset.column), action === 'sheet-field-ignore' ? '' : id);
      return true;
    }
    if (action === 'sheet-colfilter') {
      sheetColFilter = id;
      document
        .querySelectorAll('[data-action="sheet-colfilter"]')
        .forEach(
          b => (
            b.classList.toggle('on', b.dataset.id === id), b.setAttribute('aria-pressed', String(b.dataset.id === id))
          )
        );
      sheetMappingStatus();
      return true;
    }
    if (action === 'sheet-row') {
      await sheetStepRow(Number(id));
      return true;
    }
    if (action === 'sheet-settings') {
      sheetSettingsOpen = !sheetSettingsOpen;
      $('#sheet-side').innerHTML = sheetSideColumns();
      $('.sx-steps').outerHTML = sheetStepsHtml(v);
      if (!sheetSettingsOpen) sheetMappingStatus();
      return true;
    }
    if (action === 'sheet-name-column') {
      sheetOpenNamePicker();
      return true;
    }
    if (action === 'sheet-name-pick') {
      sheetSetColumn(Number(id), 'name');
      sheetRevealColumn(Number(id));
      return true;
    }
    if (action === 'sheet-blocker-column') {
      sheetOpenPicker(Number(id));
      return true;
    }
    if (action === 'sheet-step') {
      if (id === 'cars' && v?.state === 'mapping') action = 'sheet-preview';
      else if (id === 'columns' && v && v.state !== 'mapping' && !v.locked && !v.work && v.state !== 'complete')
        action = 'sheet-back';
      else return true;
    }
    if (action === 'sheet-preview' && v?.state === 'mapping' && sheetMappingProblems().length) {
      sheetShowBlockers();
      return true;
    }
    if (action === 'sheet-later') {
      if (v && !v.recoveryChanged && v.state === 'mapping')
        await sheetCall('configure', { ...p, config: sheetConfig() });
      sheetClosePicker();
      clearTimeout(spreadsheetPoll);
      $('#dialog').close();
      await loadView();
    }
    if (action === 'sheet-pick') {
      const result = await sheetCall('pick');
      if (result) {
        sheetFilter = 'all';
        spreadsheetView = null;
        showSpreadsheet(result);
      }
    }
    if (action === 'sheet-saved') await sheetSaved();
    if (action === 'sheet-open') {
      sheetFilter = 'all';
      spreadsheetView = null;
      showSpreadsheet(await sheetCall('view', { id }));
    }
    if (action === 'sheet-columns' || action === 'sheet-match' || action === 'sheet-file') {
      sheetClosePicker();
      const next = await sheetCall('configure', { ...p, config: sheetConfig() });
      sheetSettingsOpen = false;
      showSpreadsheetView(next);
    }
    if (action === 'sheet-preview') {
      sheetClosePicker();
      await sheetCall('configure', { ...p, config: sheetConfig() });
      sheetFilter = 'all';
      sheetDetail = null;
      showSpreadsheetView(await sheetCall('preview', p));
    }
    if (action === 'sheet-back')
      sheetCard(
        v,
        'Change column assignments?',
        '<p>Returning to the columns resets this import’s car choices and ticked details. No cars have been saved.</p>',
        btn('Keep choosing cars', 'sheet-return') + btn('Back to columns', 'sheet-back-confirm', 'primary')
      );
    if (action === 'sheet-back-confirm') showSpreadsheetView(await sheetCall('configure', { ...p, config: v.config }));
    if (action === 'sheet-page') await sheetRefresh(Number(id));
    if (action === 'sheet-filter') {
      sheetFilter = id;
      sheetDetail = null;
      await sheetRefresh(0);
    }
    if (action === 'sheet-select' || action === 'sheet-skip') {
      await sheetCall('bulk', { ...p, select: action === 'sheet-select' });
      await sheetRefresh();
    }
    if (action === 'sheet-detail') await sheetLoadDetail(Number(id));
    if (action === 'sheet-detail-step') await sheetStepDetail(Number(id));
    if (action === 'sheet-choice' && sheetDetail) await sheetSaveChoice(id, sheetDetail.fields);
    if (action === 'sheet-fields-all' || action === 'sheet-fields-none')
      await sheetSaveChoice(
        sheetDetail.choice,
        action === 'sheet-fields-all' ? sheetDetail.data.fields.map(f => f.id) : []
      ).catch(e => {
        if (action === 'sheet-fields-none' && sheetDetail.choice !== 'skip')
          return sheetSaveChoice(
            sheetDetail.choice,
            sheetDetail.data.fields.some(f => f.id === 'name') ? ['name'] : []
          );
        throw e;
      });
    if (action === 'sheet-confirm') {
      clearTimeout(spreadsheetPoll);
      const fresh = await sheetCall('view', { ...p, offset: v.offset, filter: sheetFilter });
      spreadsheetView = fresh;
      if (!fresh.ready || fresh.recoveryChanged || fresh.work) {
        showSpreadsheetView(fresh);
        return true;
      }
      const c = fresh.counts;
      sheetCard(
        fresh,
        'Ready to import?',
        `<p>Only the columns and details you ticked are saved to the current collection.</p><dl class="sheet-confirm-counts"><div><dt>Add new cars</dt><dd>${c.create}</dd></div><div><dt>Update existing cars</dt><dd>${c.update}</dd></div><div><dt>Leave out</dt><dd>${c.skipped}</dd></div><div><dt>Already saved or submitted</dt><dd>${fresh.done}</dd></div></dl><p class="tiny muted">Blank cells, photos, setups, parts and racing history stay unchanged. Dealership imports wait for approval. Progress is saved after each car; failed rows stay available to check and retry safely.</p>`,
        btn('Back to cars', 'sheet-return') + btn(`Import ${fresh.ready} cars`, 'sheet-start', 'primary')
      );
    }
    if (action === 'sheet-start') showSpreadsheetView(await sheetCall('start', p));
    if (action === 'sheet-return') await sheetRefresh();
    if (action === 'sheet-recheck') {
      await sheetCall('recheck', { ...p, row: Number(id) });
      await sheetRefresh();
    }
    if (action === 'sheet-stop') {
      await sheetCall('stop', p);
      await sheetRefresh();
    }
    if (action === 'sheet-done') {
      clearTimeout(spreadsheetPoll);
      $('#dialog').close();
      await loadView();
      toast('Spreadsheet import saved.');
    }
    if (action === 'sheet-discard') {
      modal(
        'Remove saved import?',
        '<div class="sheet-import"><p>This removes the saved mapping and review only. Cars already imported and Dealership proposals remain intact.</p></div>',
        null
      );
      sheetFooter(btn('Back', 'sheet-saved') + btn('Remove saved import', 'sheet-discard-confirm', 'danger', id));
    }
    if (action === 'sheet-discard-confirm') {
      await sheetCall('discard', { id });
      await sheetSaved();
    }
  } catch (e) {
    sheetError(e);
  }
  return true;
}
document.addEventListener('input', e => {
  if (e.target.id === 'sheet-field-search') sheetPickerResults();
  if (e.target.id === 'sheet-col-search') {
    sheetColQuery = e.target.value;
    const rows = $('#sheet-col-rows');
    if (rows) rows.innerHTML = sheetColumnRows();
  }
});
// The picker: arrows move, Enter picks, Escape closes; a click outside closes it too.
document.addEventListener('keydown', e => {
  const pop = $('#sheet-field-pop');
  if (!pop || !pop.contains(e.target)) return;
  const options = [...pop.querySelectorAll('.sheet-field-option')],
    at = options.findIndex(o => o.classList.contains('hi'));
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    const col = pop.dataset.column;
    sheetClosePicker();
    sheetMappingStatus();
    $(`.sx-pick[data-id="${col}"]`)?.focus();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = options[Math.min(options.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    options.forEach(o => o.classList.toggle('hi', o === next));
    next?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && e.target.id === 'sheet-field-search' && options[at]) {
    e.preventDefault();
    options[at].click();
  }
});
document.addEventListener('mousedown', e => {
  const pop = $('#sheet-field-pop');
  if (pop && !pop.contains(e.target) && !e.target.closest('.sx-pick,.sx-tip,[data-action="sheet-blocker-column"]')) {
    sheetClosePicker();
    sheetMappingStatus();
  }
});
addEventListener('resize', () => sheetPlacePicker());
document.addEventListener(
  'scroll',
  e => {
    if ($('#sheet-field-pop') && e.target.closest?.('.sx-scroll')) sheetPlacePicker();
  },
  true
);
document.addEventListener('change', async e => {
  const el = e.target;
  if (!el.matches('[data-sheet-include],[data-sheet-field]')) return;
  if (sheetChanging || actionBusy) {
    if (el.matches('[data-sheet-field]')) el.checked = sheetDetail.fields.includes(el.dataset.sheetField);
    else el.checked = spreadsheetView.rows.find(r => r.row === Number(el.dataset.sheetInclude))?.choice !== 'skip';
    return;
  }
  sheetChanging = true;
  actionBusy = true;
  const controls = [...$('#dialog').querySelectorAll('button,input,select')].map(e => ({ e, disabled: e.disabled }));
  controls.forEach(({ e }) => (e.disabled = true));
  try {
    if (el.matches('[data-sheet-field]')) await sheetSaveChoice(sheetDetail.choice, sheetDetailSelection());
    else {
      const v = spreadsheetView;
      await sheetCall('choose', {
        id: v.id,
        changes: [{ row: Number(el.dataset.sheetInclude), choice: el.checked ? 'new' : 'skip' }]
      });
      await sheetRefresh();
    }
  } catch (error) {
    if (el.matches('[data-sheet-field]')) el.checked = !el.checked;
    else el.checked = !el.checked;
    sheetError(error);
  } finally {
    sheetChanging = false;
    actionBusy = false;
    controls.forEach(({ e, disabled }) => {
      if (e.isConnected) e.disabled = disabled;
    });
    if (pendingDatabaseChange) scheduleDatabaseChange();
  }
});
