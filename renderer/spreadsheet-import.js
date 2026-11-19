'use strict';
let spreadsheetView = null,
  spreadsheetPoll = null,
  sheetStep = 1,
  sheetFilter = 'all',
  sheetDetail = null,
  sheetChanging = false;
const sheetCall = (action, p = {}) => api('file', 'spreadsheet.' + action, p);
// one spreadsheet row in the preview grid, in px (spreadsheet-import.css keeps the same height)
const SHEET_ROW = 40;
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
    `${summary ? `<div class="sheet-footer-summary" aria-live="polite">${summary}</div>` : ''}<div class="actions">${btn('Save for later', 'sheet-later')}${html}</div>`;
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
function sheetSteps(step) {
  return `<nav class="sheet-steps" aria-label="Import steps">${['Check file', 'Match columns', 'Review & import'].map((label, i) => `<span ${step === i + 1 ? 'aria-current="step"' : ''}><b>${i + 1}</b>${label}</span>`).join('<span class="sheet-step-arrow" aria-hidden="true">›</span>')}</nav>`;
}
function sheetGrid(v, mapping) {
  return `<div class="sheet-grid-frame"><div class="sheet-grid-scroll" role="region" aria-label="Spreadsheet preview; scroll for all rows and columns" tabindex="0"><table class="sheet-grid"><thead><tr><th class="sheet-row-number" scope="row">File</th>${v.headers.map((h, i) => `<th scope="col" data-sheet-column="${i}" class="sheet-source ${mapping && !v.config.mapping[i] ? 'sheet-ignored' : ''}"><small>${sheetLetter(i)}</small><strong>${esc(h)}</strong></th>`).join('')}</tr>${
    mapping
      ? `<tr><th class="sheet-row-number" scope="row">Save to ↓</th>${v.headers
          .map((h, i) => {
            const f = v.fields.find(f => f.id === v.config.mapping[i]);
            return `<td class="sheet-map-cell ${!f ? 'sheet-ignored' : ''}" data-sheet-column="${i}"><small>Paddock field</small><input type="hidden" id="sheet-map-${i}" value="${esc(f?.id || '')}"><button type="button" class="sheet-map-button" data-action="sheet-assign" data-id="${i}" aria-label="${esc('Assign ' + h + ' column; ' + (f ? f.group + ' → ' + f.label : 'Do not import'))}"><span><strong>${esc(f?.label || 'Do not import')}</strong><small>${esc(f?.group || 'Column left out')}</small></span><span aria-hidden="true">⌄</span></button></td>`;
          })
          .join('')}</tr>`
      : ''
  }</thead><tbody>${sheetGridRows(v, v.previewRows, 0, mapping)}</tbody></table></div><div class="sheet-grid-note"><span>All ${v.previewTotal} spreadsheet rows · original row numbers</span><span>Scroll for all rows and ${v.headers.length} columns ↕ ↔</span></div></div>`;
}
// Render a bounded row window; the scrollbar still spans the entire source sheet.
function sheetGridRows(v, rows, offset, mapping) {
  const spacer = n =>
    n
      ? `<tr aria-hidden="true" class="sheet-grid-spacer"><td colspan="${v.headers.length + 1}" data-sheet-space="${n}"></td></tr>`
      : '';
  return (
    spacer(offset) +
    rows
      .map(
        r =>
          `<tr class="sheet-data-row" data-source-row="${r.row}"><th scope="row" class="sheet-row-number">${r.row}</th>${r.cells.map((value, i) => `<td data-sheet-column="${i}" class="${mapping && !v.config.mapping[i] ? 'sheet-ignored' : ''}"><div class="sheet-cell-text" title="${esc(value)}">${esc(value)}</div></td>`).join('')}</tr>`
      )
      .join('') +
    spacer(Math.max(0, v.previewTotal - offset - rows.length))
  );
}
function sheetSizeSpacers(root) {
  root.querySelectorAll('[data-sheet-space]').forEach(e => {
    e.style.height = Number(e.dataset.sheetSpace) * SHEET_ROW + 'px';
  });
}
function sheetBindGrid(v, mapping) {
  const scroller = $('.sheet-grid-scroll'),
    body = scroller.querySelector('tbody'),
    status = $('#sheet-scroll-status');
  let loaded = 0,
    wanted = 0,
    running = false,
    scheduled = false;
  sheetSizeSpacers(body);
  const update = async () => {
    if (running || !scroller.isConnected || !$('#dialog').open) return;
    running = true;
    try {
      while (wanted !== loaded && scroller.isConnected && $('#dialog').open) {
        const offset = wanted;
        status.textContent = 'Loading rows…';
        const page = await sheetCall('previewRows', { id: v.id, offset, token: v.previewToken });
        if (!scroller.isConnected || !$('#dialog').open) return;
        if (offset !== wanted) continue;
        const top = scroller.scrollTop,
          left = scroller.scrollLeft;
        body.innerHTML = sheetGridRows(v, page.rows, offset, mapping);
        sheetSizeSpacers(body);
        scroller.scrollTop = top;
        scroller.scrollLeft = left;
        loaded = offset;
        status.textContent = '';
      }
    } catch (e) {
      status.textContent = e.message + ' Scroll again to retry.';
    } finally {
      running = false;
    }
  };
  scroller.addEventListener(
    'scroll',
    () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const index = Math.floor(scroller.scrollTop / SHEET_ROW);
        wanted = Math.min(
          Math.max(0, Math.floor((index - 10) / 40) * 40),
          Math.max(0, Math.floor((v.previewTotal - 1) / 40) * 40)
        );
        if (wanted !== loaded) void update();
      });
    },
    { passive: true }
  );
}
// Everything that stops "Choose cars →", described per problem so the box can
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
function sheetColumnName(col) {
  return `column ${sheetLetter(col)} “${esc(spreadsheetView.headers[col])}”`;
}
function sheetThings(n) {
  return n === 1 ? '1 thing' : n + ' things';
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
function sheetMappingStatus() {
  const v = spreadsheetView,
    mapping = sheetConfig().mapping,
    assigned = mapping.filter(Boolean),
    problems = sheetMappingProblems(mapping);
  v.config.mapping = mapping;
  const box = $('#sheet-blockers');
  if (box) {
    box.innerHTML = problems.length ? sheetBlockersHtml(problems) : '';
    box.hidden = !problems.length;
  }
  $('#sheet-mapping-status').textContent = problems.length
    ? `${sheetThings(problems.length)} to fix before continuing.`
    : 'Suggested assignments are ready to check. You can change any column.';
  $('#sheet-mapping-status').classList.toggle('sr-only', !!problems.length);
  // Mark the clashing columns in the grid header so they can be found by eye.
  const clash = new Map();
  for (const p of problems)
    for (const c of p.columns || [])
      clash.set(
        c,
        p.columns.filter(o => o !== c)
      );
  document
    .querySelectorAll('.sheet-grid thead [data-sheet-column]')
    .forEach(e => e.classList.toggle('sheet-col-problem', clash.has(Number(e.dataset.sheetColumn))));
  document.querySelectorAll('.sheet-map-cell').forEach(cell => {
    const others = clash.get(Number(cell.dataset.sheetColumn));
    let flag = cell.querySelector('.sheet-col-flag');
    if (!others) {
      flag?.remove();
      return;
    }
    if (!flag) {
      flag = document.createElement('span');
      flag.className = 'sheet-col-flag';
      cell.insertBefore(flag, cell.querySelector('.sheet-map-button'));
    }
    flag.textContent = 'Same field as column ' + others.map(sheetLetter).join(', ');
  });
  $('#sheet-mapping-count').textContent =
    `${assigned.length} of ${v.headers.length} columns included · ${v.headers.length - assigned.length} left out`;
  // The button stays clickable: a click while blocked points at the box instead of doing nothing.
  const blocked = !!problems.length || !!v.recoveryChanged,
    button = $('[data-action="sheet-preview"]');
  if (button) {
    button.setAttribute('aria-disabled', String(blocked));
    button.classList.toggle('sheet-blocked', blocked);
  }
  const note = $('#sheet-footer-blocked');
  if (note) {
    note.textContent = problems.length ? `Fix ${sheetThings(problems.length)} above to continue` : '';
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
  $(`.sheet-grid thead [data-sheet-column="${col}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
  d.innerHTML = `<div class="dialog-head"><h2 id="sheet-picker-title">Which column holds your car names?</h2><button type="button" class="btn ghost small" data-action="sheet-picker-close" aria-label="Close column selector">✕</button></div><div class="sheet-picker-body"><p class="tiny">The column you choose is saved as <strong>Identity → Display name</strong>, replacing its current assignment.</p><div id="sheet-field-results">${v.headers.map((h, i) => `<button type="button" class="sheet-field-option" data-action="sheet-name-pick" data-id="${i}"><span><strong>${sheetLetter(i)} · ${esc(h)}</strong><small>${v.samples[i].filter(Boolean).map(esc).join(' · ') || 'Blank'}</small></span><small>${esc(current(i))}</small></button>`).join('')}</div></div><div class="dialog-footer">${btn('Cancel', 'sheet-picker-close')}</div>`;
  $('#dialog').append(d);
  d.addEventListener('close', () => d.remove(), { once: true });
  d.showModal();
  d.querySelector('.sheet-field-option')?.focus();
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
  }</div><details class="sheet-format-options"><summary>Date, number and label formats</summary><div class="form-grid"><label>Text date order<select id="sheet-date">${sheetOptions(
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
  )}</select></label></div></details><div class="actions mt">${btn('Refresh file preview', 'sheet-columns')}</div><p class="tiny muted">Changing worksheet, header row or CSV separator refreshes column suggestions. Blank cells never erase saved details.</p>`;
}
function sheetRowStatus(r) {
  if (r.result) return badge(r.result.status === 'imported' ? 'Imported' : 'Submitted for approval', 'good');
  if (r.error || r.errors.length) return badge('Needs attention', 'warn');
  if (r.attempt) return badge('Save pending · retry safely', 'warn');
  if (r.choice === 'new')
    return badge(r.candidates.length || r.duplicate ? 'Add a separate car' : 'Add a new car', 'good');
  if (r.choice !== 'skip') return badge('Update existing car', 'good');
  return badge(
    r.candidates.length ? 'Possible match · left out' : r.duplicate ? 'Repeated in file · left out' : 'Not imported',
    r.candidates.length || r.duplicate ? 'warn' : ''
  );
}
function showSpreadsheet(v, step) {
  clearTimeout(spreadsheetPoll);
  sheetDetail = null;
  spreadsheetView = v;
  sheetFilter = v.filter || 'all';
  sheetStep = v.state === 'mapping' ? step || 2 : 3;
  const readOnly = v.recoveryChanged,
    warning = readOnly
      ? '<p class="note warning">This collection was restored. This import is retained for reference and cannot be replayed. Check the collection before importing a revised file.</p>'
      : '';
  const fileline = `<div class="sheet-file-line"><strong>${esc(v.name)}</strong><span>${v.sourceRows} car rows · ${v.headers.length} columns</span></div>`;
  if (v.state === 'mapping') {
    modal(
      'Import your cars',
      `<div data-spreadsheet="${esc(v.id)}" class="sheet-import"><div class="sheet-topbar">${sheetSteps(sheetStep)}${fileline}</div>${warning}<div class="sheet-intro"><h3>${sheetStep === 1 ? 'Check your file' : 'Where should each column go?'}</h3><p>${sheetStep === 1 ? 'One car per row. Your column names can stay exactly as they are.' : 'Read down each column: <strong>your heading → Paddock field → your data.</strong> Click an assignment to change it.'}</p></div>${sheetStep === 1 ? sheetFileOptions(v) : '<div id="sheet-blockers" class="sheet-blockers" role="region" aria-labelledby="sheet-blockers-title" tabindex="-1" hidden></div><p id="sheet-mapping-status" class="tiny" role="status"></p>'}${sheetGrid(v, sheetStep === 2)}<p class="tiny muted" id="sheet-scroll-status" role="status"></p></div>`,
      null
    );
    if (readOnly)
      $('#dialog')
        .querySelectorAll('input,select,button[data-action="sheet-columns"],button[data-action="sheet-assign"]')
        .forEach(e => (e.disabled = true));
    sheetFooter(
      readOnly
        ? ''
        : sheetStep === 1
          ? btn('Match columns →', 'sheet-match', 'primary')
          : btn('Back', 'sheet-file') + btn('Choose cars →', 'sheet-preview', 'primary'),
      sheetStep === 2
        ? '<strong id="sheet-mapping-count"></strong><div id="sheet-footer-blocked" class="sheet-footer-blocked" hidden></div><div class="tiny muted">Blank cells leave existing details unchanged.</div>'
        : 'No cars have been added yet.'
    );
    if (sheetStep === 2 && !readOnly) sheetMappingStatus();
    sheetBindGrid(v, sheetStep === 2);
    return;
  }
  const c = v.counts,
    controls = !v.work && !readOnly;
  modal(
    v.state === 'complete' ? 'Spreadsheet import complete' : 'Import your cars',
    `<div data-spreadsheet="${esc(v.id)}" class="sheet-import"><div class="sheet-topbar">${sheetSteps(3)}${fileline}</div>${warning}<div class="sheet-intro"><h3>${v.work ? 'Importing your cars…' : v.state === 'complete' ? 'Your selected cars have been processed' : 'Choose the cars to import'}</h3><p>${v.work ? 'Progress is saved after each car. Closing this window keeps your progress in Review → Spreadsheet imports.' : v.state === 'complete' ? `${c.imported} imported · ${c.submitted} submitted for Dealership approval · ${c.skipped} left out. Submitted cars still need approval.` : 'Ticked rows will be imported. Review possible matches before choosing to update an existing car or add a separate one.'}</p></div>${v.work ? `<progress aria-label="Import progress" max="${v.total || 1}" value="${v.done}"></progress>` : ''}${v.error ? `<p class="note warning">${esc(v.error)}</p>` : ''}<div class="sheet-review-toolbar"><div class="actions">${[
      ['all', 'All cars'],
      ['new', 'Unmatched'],
      ['matches', 'Possible matches'],
      ['attention', 'Needs attention']
    ]
      .map(
        ([key, label]) =>
          `<button type="button" class="btn small ${sheetFilter === key ? 'sheet-tab-selected' : ''}" data-action="sheet-filter" data-id="${key}" aria-pressed="${sheetFilter === key}">${label} (${c[key]})</button>`
      )
      .join(
        ''
      )}</div>${controls && v.state !== 'complete' ? `<div class="actions">${btn('Select new cars', 'sheet-select', 'small')}${btn('Clear selection', 'sheet-skip', 'small')}</div>` : ''}</div><div class="table-wrap sheet-review-wrap"><table class="sheet-review"><thead><tr><th scope="col">Include</th><th scope="col">Car from your file</th><th scope="col">What will happen</th><th scope="col">Review</th></tr></thead><tbody>${v.rows.map(r => `<tr class="${r.choice === 'skip' && !r.result ? 'sheet-excluded-row' : ''}"><td><input type="checkbox" data-sheet-include="${r.row}" aria-label="Include row ${r.row}: ${esc(r.data.name || 'Unnamed car')}" ${r.choice !== 'skip' ? 'checked' : ''} ${!controls || r.attempt || r.errors.length || (r.choice === 'skip' && (r.candidates.length || r.duplicate)) ? 'disabled' : ''}></td><td><strong>${esc(r.data.name || 'Unnamed car')}</strong><div class="tiny muted">Row ${r.row} · ${esc([r.data.maker, r.data.reference].filter(Boolean).join(' · '))}</div>${r.duplicate ? '<div class="tiny">Repeated in this file</div>' : ''}${r.errors.map(e => '<p class="tiny error">' + esc(e) + '</p>').join('')}${r.error ? '<p class="tiny error">' + esc(r.error) + '</p>' : ''}</td><td>${sheetRowStatus(r)}</td><td>${btn(r.candidates.length || r.duplicate ? 'Review match' : 'View fields', 'sheet-detail', 'small', String(r.row))}${r.error && r.attempt?.mode === 'local' && controls ? btn('Review again', 'sheet-recheck', 'small', String(r.row)) : ''}</td></tr>`).join('') || '<tr><td colspan="4">No cars in this view.</td></tr>'}</tbody></table></div><div class="sheet-grid-note"><span>${v.filteredTotal ? `${v.offset + 1}–${Math.min(v.filteredTotal, v.offset + 40)} of ${v.filteredTotal} cars` : 'No matching rows'}</span><div class="actions">${v.offset ? btn('Previous', 'sheet-page', 'small', String(Math.max(0, v.offset - 40))) : ''}${v.offset + 40 < v.filteredTotal ? btn('Next', 'sheet-page', 'small', String(v.offset + 40)) : ''}</div></div><p class="tiny muted">Selections cover all pages and filters. Blank cells and unticked fields stay unchanged. Fitted parts are protected.</p></div>`,
    null
  );
  sheetFooter(
    v.work
      ? btn('Pause after this car', 'sheet-stop')
      : readOnly
        ? ''
        : v.state === 'complete'
          ? btn('Done', 'sheet-done', 'primary')
          : `${!v.locked ? btn('Back to columns', 'sheet-back') : ''}${v.ready ? btn(v.locked ? 'Retry / continue import…' : `Import ${v.ready} cars…`, 'sheet-confirm', 'primary') : ''}`,
    `<strong>${v.ready} selected and remaining · ${c.skipped} left out</strong><div class="tiny muted">${c.create} new · ${c.update} updates · ${v.done} saved or submitted</div>`
  );
  if (v.work)
    spreadsheetPoll = setTimeout(async () => {
      if (!$('#dialog').open || !document.querySelector('[data-spreadsheet]') || spreadsheetView?.id !== v.id) return;
      const marker = document.querySelector('[data-spreadsheet]');
      try {
        const next = await sheetCall('view', { id: v.id, offset: v.offset, filter: sheetFilter });
        if (marker?.isConnected && $('#dialog').open) showSpreadsheet(next);
      } catch (e) {
        toast(e.message);
      }
    }, 800);
}
function sheetClosePicker() {
  const d = $('#sheet-field-dialog');
  if (d) {
    d.close();
    d.remove();
  }
}
function sheetPickerResults() {
  const d = $('#sheet-field-dialog'),
    query = $('#sheet-field-search').value.toLowerCase().trim(),
    group = $('#sheet-field-group').value,
    col = Number(d.dataset.column),
    chosen = $('#sheet-map-' + col).value;
  const fields = spreadsheetView.fields.filter(
    f => (!group || f.group === group) && `${f.group} ${f.label}`.toLowerCase().includes(query)
  );
  $('#sheet-field-results').innerHTML =
    fields
      .map(
        f =>
          `<button type="button" class="sheet-field-option" data-action="sheet-field-pick" data-id="${esc(f.id)}" aria-pressed="${f.id === chosen}"><span><strong>${esc(f.label)}</strong><small>${esc(f.group)}</small></span><small>${f.id === chosen ? '✓ Assigned' : spreadsheetView.config.mapping.includes(f.id) ? 'Used by another column' : ''}</small></button>`
      )
      .join('') || '<p>No fields match your search.</p>';
  $('#sheet-field-count').textContent = `${fields.length} matching fields`;
}
function sheetOpenPicker(col) {
  if (spreadsheetView.recoveryChanged) return;
  sheetClosePicker();
  const v = spreadsheetView,
    d = document.createElement('dialog');
  d.id = 'sheet-field-dialog';
  d.dataset.column = String(col);
  d.setAttribute('aria-labelledby', 'sheet-picker-title');
  d.innerHTML = `<div class="dialog-head"><h2 id="sheet-picker-title">Assign “${esc(v.headers[col])}”</h2><button type="button" class="btn ghost small" data-action="sheet-picker-close" aria-label="Close field selector">✕</button></div><div class="sheet-picker-body"><p class="tiny">Examples from your file: <strong>${v.samples[col].filter(Boolean).map(esc).join(' · ') || 'Blank'}</strong></p><div class="sheet-picker-search"><label>Find a Paddock field<input id="sheet-field-search" type="search" placeholder="Search all editable fields…"></label><label>Field group<select id="sheet-field-group"><option value="">All groups</option>${[...new Set(v.fields.map(f => f.group))].map(g => `<option>${esc(g)}</option>`).join('')}</select></label></div><p id="sheet-field-count" class="tiny muted" role="status"></p><div id="sheet-field-results"></div></div><div class="dialog-footer">${btn('Do not import this column', 'sheet-field-ignore')}${btn('Cancel', 'sheet-picker-close')}</div>`;
  $('#dialog').append(d);
  d.addEventListener('close', () => d.remove(), { once: true });
  sheetPickerResults();
  d.showModal();
  $('#sheet-field-search').focus();
}
function sheetAssign(id) {
  sheetSetColumn(Number($('#sheet-field-dialog').dataset.column), id);
}
function sheetSetColumn(col, id) {
  const v = spreadsheetView,
    f = v.fields.find(f => f.id === id);
  $('#sheet-map-' + col).value = f?.id || '';
  document.querySelectorAll(`[data-sheet-column="${col}"]`).forEach(e => e.classList.toggle('sheet-ignored', !f));
  const button = $(`[data-action="sheet-assign"][data-id="${col}"]`);
  button.querySelector('strong').textContent = f?.label || 'Do not import';
  button.querySelector('small').textContent = f?.group || 'Column left out';
  button.setAttribute(
    'aria-label',
    `Assign ${v.headers[col]} column; ${f ? f.group + ' → ' + f.label : 'Do not import'}`
  );
  sheetClosePicker();
  sheetMappingStatus();
  button.focus();
}
async function sheetRefresh(offset = spreadsheetView.offset) {
  showSpreadsheet(await sheetCall('view', { id: spreadsheetView.id, offset, filter: sheetFilter }));
}
function sheetValue(value) {
  return esc(Array.isArray(value) ? value.join(', ') : (value ?? '—'));
}
function sheetDetailFields(d) {
  const editable = sheetDetail.editable,
    updating = !['new', 'skip'].includes(sheetDetail.choice);
  $('#sheet-detail-fields').innerHTML =
    `<div class="table-wrap"><table class="sheet-field-table"><thead><tr><th scope="col">Include field</th>${updating ? '<th scope="col">In Paddock now</th>' : ''}<th scope="col">From your file</th></tr></thead><tbody>${d.fields.map(f => `<tr><td><label class="check-row"><input type="checkbox" data-sheet-field="${esc(f.id)}" ${sheetDetail.fields.includes(f.id) ? 'checked' : ''} ${editable ? '' : 'disabled'}><span><strong>${esc(f.label)}</strong><small>${esc(f.group)}</small></span></label></td>${updating ? `<td class="prewrap">${sheetValue(f.before)}</td>` : ''}<td class="prewrap">${sheetValue(f.after)}</td></tr>`).join('')}</tbody></table></div>`;
}
async function sheetOpenDetail(rowNumber) {
  clearTimeout(spreadsheetPoll);
  const v = spreadsheetView,
    d = await sheetCall('detail', { id: v.id, row: rowNumber });
  sheetDetail = {
    row: rowNumber,
    choice: d.row.choice,
    fields: [...d.row.fields],
    editable: !v.work && !v.recoveryChanged && !d.row.attempt && !d.row.errors.length
  };
  const editable = sheetDetail.editable;
  modal(
    'Review car · ' + (d.row.data.name || 'Row ' + rowNumber),
    `<div data-sheet-detail="${rowNumber}" class="sheet-import"><p class="muted">File row ${rowNumber} · ${esc([d.row.data.maker, d.row.data.reference].filter(Boolean).join(' · '))}</p>${d.row.candidates.length || d.row.duplicate ? '<p class="note">A matching name or product reference does not prove this is the same physical car. Choose what should happen.</p>' : ''}${d.row.errors.map(e => `<p class="error">${esc(e)}</p>`).join('')}<label class="sheet-detail-choice">What should happen to this row?<select id="sheet-detail-choice" ${editable ? '' : 'disabled'}>${sheetOptions([['skip', 'Leave this row out'], ['new', d.row.candidates.length || d.row.duplicate ? 'Add as a separate car' : 'Add a new car'], ...d.row.candidates.map(c => [c.id, 'Update ' + c.name + (c.wishlist ? ' (Wishlist)' : '') + (c.archived ? ' (archived)' : '')])], d.row.choice)}</select></label><h3 class="mt">Fields to include</h3><p class="tiny muted">Only checked, non-empty fields are included. Unticked fields and blank cells leave existing details unchanged.</p>${editable ? `<div class="actions">${btn('Select all fields', 'sheet-fields-all', 'small')}${btn('Clear selection', 'sheet-fields-none', 'small')}</div>` : ''}<div id="sheet-detail-fields"></div></div>`,
    null
  );
  sheetDetailFields(d);
  sheetFooter(
    btn('Back without changes', 'sheet-return') +
      btn(
        editable ? 'Keep this choice' : 'Back to review',
        editable ? 'sheet-fields-save' : 'sheet-return',
        'primary',
        String(rowNumber)
      )
  );
}
function sheetDetailSelection() {
  return [...document.querySelectorAll('[data-sheet-field]:checked')].map(e => e.dataset.sheetField);
}
async function sheetSaveDetail() {
  if (!sheetDetail?.editable) return;
  const fields = sheetDetailSelection(),
    choice = sheetDetail.choice;
  if (choice === 'new' && !fields.includes('name')) throw Error('Include Display name to add this car.');
  if (choice !== 'skip' && !fields.length) throw Error('Select at least one field, or leave this row out.');
  await sheetCall('choose', { id: spreadsheetView.id, changes: [{ row: sheetDetail.row, choice, fields }] });
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
      return true;
    }
    if (action === 'sheet-assign') {
      sheetOpenPicker(Number(id));
      return true;
    }
    if (action === 'sheet-field-pick' || action === 'sheet-field-ignore') {
      sheetAssign(action === 'sheet-field-ignore' ? '' : id);
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
      sheetRevealColumn(Number(id));
      sheetOpenPicker(Number(id));
      return true;
    }
    if (action === 'sheet-preview' && v?.state === 'mapping' && sheetMappingProblems().length) {
      sheetShowBlockers();
      return true;
    }
    if (action === 'sheet-later') {
      if (v && !v.recoveryChanged && v.state === 'mapping')
        await sheetCall('configure', { ...p, config: sheetConfig() });
      if (sheetDetail) await sheetSaveDetail();
      clearTimeout(spreadsheetPoll);
      $('#dialog').close();
      await loadView();
    }
    if (action === 'sheet-pick') {
      const result = await sheetCall('pick');
      if (result) {
        sheetFilter = 'all';
        showSpreadsheet(result, 1);
      }
    }
    if (action === 'sheet-saved') await sheetSaved();
    if (action === 'sheet-open') {
      sheetFilter = 'all';
      showSpreadsheet(await sheetCall('view', { id }));
    }
    if (action === 'sheet-columns' || action === 'sheet-match')
      showSpreadsheet(await sheetCall('configure', { ...p, config: sheetConfig() }), action === 'sheet-match' ? 2 : 1);
    if (action === 'sheet-file') showSpreadsheet(await sheetCall('configure', { ...p, config: sheetConfig() }), 1);
    if (action === 'sheet-preview') {
      await sheetCall('configure', { ...p, config: sheetConfig() });
      sheetFilter = 'all';
      showSpreadsheet(await sheetCall('preview', p));
    }
    if (action === 'sheet-back') {
      modal(
        'Change column assignments?',
        '<div class="sheet-import"><p>Returning to column mapping resets this import’s row choices and field selections. No cars have been saved.</p></div>',
        null
      );
      sheetFooter(btn('Keep reviewing', 'sheet-return') + btn('Back to columns', 'sheet-back-confirm', 'primary'));
    }
    if (action === 'sheet-back-confirm') showSpreadsheet(await sheetCall('configure', { ...p, config: v.config }), 2);
    if (action === 'sheet-page') await sheetRefresh(Number(id));
    if (action === 'sheet-filter') {
      sheetFilter = id;
      await sheetRefresh(0);
    }
    if (action === 'sheet-select' || action === 'sheet-skip') {
      await sheetCall('bulk', { ...p, select: action === 'sheet-select' });
      await sheetRefresh();
    }
    if (action === 'sheet-detail') await sheetOpenDetail(Number(id));
    if (action === 'sheet-fields-all' || action === 'sheet-fields-none')
      document
        .querySelectorAll('[data-sheet-field]:not(:disabled)')
        .forEach(e => (e.checked = action === 'sheet-fields-all'));
    if (action === 'sheet-fields-save') {
      await sheetSaveDetail();
      await sheetRefresh();
    }
    if (action === 'sheet-confirm') {
      clearTimeout(spreadsheetPoll);
      const fresh = await sheetCall('view', { ...p, offset: v.offset, filter: sheetFilter });
      spreadsheetView = fresh;
      if (!fresh.ready || fresh.recoveryChanged || fresh.work) {
        showSpreadsheet(fresh);
        return true;
      }
      const c = fresh.counts;
      modal(
        'Ready to import?',
        `<div class="sheet-import"><p>Only the columns and fields you selected will be saved to the current collection.</p><dl class="sheet-confirm-counts"><div><dt>Add new cars</dt><dd>${c.create}</dd></div><div><dt>Update existing cars</dt><dd>${c.update}</dd></div><div><dt>Leave out</dt><dd>${c.skipped}</dd></div><div><dt>Already saved or submitted</dt><dd>${fresh.done}</dd></div></dl><p>Blank cells, photos, setups, inventory and racing history remain unchanged. Dealership imports wait for approval.</p><p class="muted tiny">Progress is saved after each car. Failed rows remain available for inspection and safe retry.</p></div>`,
        null
      );
      sheetFooter(btn('Back to review', 'sheet-return') + btn(`Import ${fresh.ready} cars`, 'sheet-start', 'primary'));
    }
    if (action === 'sheet-start') showSpreadsheet(await sheetCall('start', p));
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
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'sheet-field-group') {
    sheetPickerResults();
    return;
  }
  if (!el.matches('[data-sheet-include],#sheet-detail-choice')) return;
  if (sheetChanging || actionBusy) {
    if (el.id === 'sheet-detail-choice') el.value = sheetDetail.choice;
    else el.checked = spreadsheetView.rows.find(r => r.row === Number(el.dataset.sheetInclude))?.choice !== 'skip';
    return;
  }
  sheetChanging = true;
  actionBusy = true;
  const controls = [...$('#dialog').querySelectorAll('button,input,select')].map(e => ({ e, disabled: e.disabled }));
  controls.forEach(({ e }) => (e.disabled = true));
  try {
    if (el.id === 'sheet-detail-choice') {
      sheetDetail.fields = sheetDetailSelection();
      const choice = el.value;
      const d = await sheetCall('detail', { id: spreadsheetView.id, row: sheetDetail.row, choice });
      sheetDetail.choice = choice;
      sheetDetailFields(d);
    } else {
      const v = spreadsheetView;
      await sheetCall('choose', {
        id: v.id,
        changes: [{ row: Number(el.dataset.sheetInclude), choice: el.checked ? 'new' : 'skip' }]
      });
      await sheetRefresh();
    }
  } catch (error) {
    if (el.id === 'sheet-detail-choice') el.value = sheetDetail.choice;
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
