let collectionMeta = null,
  tableColumns = ['name', 'maker', 'scale', 'usage', 'location', 'availability'],
  columnDraft = [],
  choiceCatalogue = null,
  choiceField = 'maker',
  choiceQuery = '',
  choiceDraft = null,
  bulkDraft = null;
function choiceSuggestions(name, values) {
  const key = name
    .replace(/^(technical|factory)\./, 'tech_')
    .replace(/^custom\./, 'custom_')
    .replace(/^(value|labels)_/, '');
  const all = [...values];
  if (collectionMeta?.choices.some(f => f.key === key)) {
    all.push(...(db.choices[key] || []));
    if (key === 'track') all.push(...db.setups.map(s => s.track), ...db.tests.map(t => t.track));
    if (key === 'driver') all.push(...db.tests.map(t => t.driver));
  }
  return [
    ...new Set(
      all
        .filter(v => typeof v === 'string' && v.trim())
        .map(value => db?.choiceAliases?.find(a => a.field === key && a.from === value)?.to || value)
    )
  ];
}
function columnLabel(key) {
  if (key === 'price' && wishlistTab()) return 'Price';
  if (key.startsWith('tech_')) return techLabels[key.slice(5)] || key.slice(5);
  if (key.startsWith('custom_')) return db.customFields.find(f => f.id === key.slice(7))?.label || 'Custom field';
  return fieldLabel(key);
}
function columnValue(c, key) {
  if (key.startsWith('tech_')) return c.technical?.[key.slice(5)] || '';
  if (key.startsWith('custom_')) return c.custom?.[key.slice(7)] || '';
  return c[key] ?? '';
}
function renderCollectionTable(list, check) {
  const columns = local() ? tableColumns : ['name', 'maker', 'scale', 'usage', 'raceClass'];
  return `<div class="table-wrap"><table><thead><tr><th></th>${columns.map(k => `<th>${esc(columnLabel(k))}</th>`).join('')}</tr></thead><tbody>${list
    .map(
      c =>
        `<tr><td>${check(c)}</td>${columns
          .map(k => {
            const v = columnValue(c, k);
            return `<td>${k === 'name' ? `<button type="button" class="table-name collection-name" data-action="open-car" data-id="${c.id}">${c.picture && !columns.includes('picture') ? `<img class="table-thumb" src="${esc(thumbnailSource(c.picture))}" alt="" loading="lazy" decoding="async">` : ''}<span>${esc(c.name)}<small>${esc(c.number || c.maker)}</small></span></button>` : k === 'picture' ? (c.picture ? `<img class="table-thumb" src="${esc(thumbnailSource(c.picture))}" alt="${esc(c.name)}" loading="lazy" decoding="async">` : '—') : Array.isArray(v) ? v.map(x => badge(x, k === 'usage' ? 'usage' : '')).join(' ') : esc(v || '—')}</td>`;
          })
          .join('')}</tr>`
    )
    .join('')}</tbody></table></div>`;
}
function columnEditorBody() {
  return faBody(faContext('columns'));
}
function configureColumns() {
  columnDraft = [...tableColumns];
  const revision = db.revision;
  modal(
    'Table columns',
    `<div id="columns-editor">${columnEditorBody()}</div>`,
    async () => {
      await change('columns.save', { revision, columns: columnDraft });
      tableColumns = [...columnDraft];
      mode = 'table';
    },
    'Save columns'
  );
  faOpen();
}
function refreshColumnEditor() {
  keepFocus(() => ($('#columns-editor').innerHTML = columnEditorBody()));
}
async function loadChoices() {
  choiceCatalogue = await api('plan', 'choices.catalogue');
  collectionMeta = choiceCatalogue;
  if (!choiceCatalogue.choices.some(f => f.key === choiceField)) choiceField = choiceCatalogue.choices[0].key;
}
function renderChoiceRows() {
  const rows = (choiceCatalogue.values[choiceField] || []).filter(row =>
    [row.value, ...row.aliases].join(' ').toLowerCase().includes(choiceQuery.toLowerCase())
  );
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Reusable value</th><th>Current car records</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td><strong>${esc(row.value)}</strong>${row.aliases.length ? `<div class="tiny muted">Previous spellings: ${row.aliases.map(esc).join(', ')}</div>` : ''}</td><td>${row.cars}</td><td>${btn('Rename / merge…', 'rename-choice', 'small', row.value)}</td></tr>`).join('')}</tbody></table></div>`
    : empty(
        'No saved values in this field',
        'Values appear as you enter cars. You can also add an option now.',
        btn('Add option', 'add-choice', 'primary')
      );
}
function renderLibrary() {
  if (libraryTab === 'parts') return renderCatalogueManager();
  if (!local())
    return empty('Your choice library is local', 'Switch to your own database to organise reusable values.');
  if (!choiceCatalogue)
    return (
      libraryTabs() +
      empty(
        'Reusable choices',
        'Load the values from your collection.',
        btn('Load library', 'reload-choices', 'primary')
      )
    );
  return (
    heading(
      'Library',
      'Correct spellings and merge duplicates while preserving historical snapshots.',
      btn('Add option', 'add-choice', 'primary') + btn('Refresh', 'reload-choices', 'outline')
    ) +
    libraryTabs() +
    `<div class="library-layout">${libraryRail()}<div class="library-content"><div class="toolbar"><label class="field">Field<select id="library-field">${choiceCatalogue.choices.map(f => `<option value="${f.key}" ${f.key === choiceField ? 'selected' : ''}>${esc(f.group + ' · ' + (f.key.startsWith('tech_') ? columnLabel(f.key) : f.label))}</option>`).join('')}</select></label><label class="search">${icon('search')}<input id="choice-search" placeholder="Find a value or previous spelling…" value="${esc(choiceQuery)}" aria-label="Find reusable choices"></label></div><div class="note info">Renames update suggestions. You can also correct matching current car values after reviewing the changes. Saved setups, test records, factory references and previous history stay unchanged. Inventory component names are managed in Parts.</div><div id="choice-results">${renderChoiceRows()}</div></div></div>`
  );
}
function addChoice() {
  const revision = choiceCatalogue.revision,
    fieldKey = choiceField;
  simpleForm('Add reusable option', field('value', 'New value', ''), async values => {
    await change('choice.add', { revision, field: fieldKey, value: values.value });
    await loadChoices();
  });
}
function renameChoice(value) {
  choiceDraft = { field: choiceField, from: value, revision: choiceCatalogue.revision };
  modal(
    'Rename or merge a choice',
    `<p>Current value: <strong>${esc(value)}</strong></p>${field(
      'to',
      'New or existing value',
      '',
      'text',
      (choiceCatalogue.values[choiceField] || []).map(r => r.value).filter(v => v !== value)
    )}<label class="check-row"><input name="updateCars" type="checkbox" checked>Also correct matching current car values, including archived cars</label><p class="tiny muted">Tracked component fields are skipped. Track and driver history is preserved. Choosing an existing value merges the suggestions.</p>${btn('Review changes →', 'preview-choice', 'primary')}`,
    null
  );
}
async function previewChoice() {
  const payload = { ...choiceDraft, to: $('[name="to"]').value, updateCars: $('[name="updateCars"]').checked };
  let plan;
  try {
    plan = await api('plan', 'choice.preview', payload);
  } catch (e) {
    $('#form-error').hidden = false;
    $('#form-error').textContent = e.message;
    return;
  }
  modal(
    plan.merging ? 'Review merge' : 'Review rename',
    `<p><strong>${esc(plan.from)}</strong> → <strong>${esc(plan.to)}</strong></p><p>${plan.rows.length} current car record(s) will change. Future suggestions will use the new value.</p>${plan.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Car</th><th>Before</th><th>After</th></tr></thead><tbody>${plan.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(Array.isArray(r.before) ? r.before.join(', ') : r.before)}</td><td>${esc(Array.isArray(r.after) ? r.after.join(', ') : r.after)}</td></tr>`).join('')}</tbody></table></div>` : ''}${plan.skipped.length ? `<div class="note mt"><strong>Left unchanged: ${plan.skipped.length} tracked car(s)</strong>${plan.skipped.map(r => `<p>${esc(r.name)}: ${esc(r.reason)}</p>`).join('')}</div>` : ''}<label class="check-row mt"><input name="confirmed" type="checkbox" required>I confirm the reviewed change.</label>`,
    async values => {
      await change('choice.rename', { ...payload, confirmed: !!values.confirmed });
      await loadChoices();
      toast('Reusable choices updated.');
    },
    plan.merging ? 'Merge choices' : 'Rename choice'
  );
}
// Edit selected cars, after docs/ui-reference/bulk-edit-2026-11 (option A): every field as a row with what the
// selected cars have now and Keep / Set to… / Clear; Usage labels and Tags with Keep / Add / Remove / Replace;
// a live preview of what will change on the right, and one confirm and Apply instead of a second window.
// Form names stay: use_<field> (checked = change it), value_<field>, mode_<labels>, labels_<labels>, confirmed.
let bulkPreviewTimer = null,
  bulkPreviewSerial = 0;
const bulkGroups = [
  ['Collection & ownership', ['owner', 'location', 'ownership', 'availability', 'condition', 'packaging']],
  ['Racing', ['raceClass', 'category']]
];
function bulkSelectedCars() {
  const ids = new Set(bulkDraft.ids);
  return db.cars.filter(c => ids.has(c.id));
}
// "James 30 · Club 6 · empty 12" for the cars we have loaded.
function bulkDistribution(cars, key, labels = false) {
  const counts = new Map();
  let empty = 0;
  for (const c of cars) {
    const v = c[key];
    if (labels) {
      if (!v?.length) empty++;
      for (const x of v || []) counts.set(x, (counts.get(x) || 0) + 1);
    } else if (v) counts.set(v, (counts.get(v) || 0) + 1);
    else empty++;
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]),
    shown = top.slice(0, 4);
  return `<div class="bk-dist">${shown.map(([v, n]) => `<span>${esc(v)}<b>${n}</b></span>`).join('')}${top.length > 4 ? `<span class="more">+${top.length - 4} more</span>` : ''}${empty ? `<span class="empty">empty<b>${empty}</b></span>` : ''}</div>`;
}
function bulkFieldRow(cars, k) {
  return `<tr class="bk-row" data-bulk-field="${k}"><td class="bk-name"><b>${esc(fieldLabel(k))}</b></td><td>${bulkDistribution(cars, k)}</td><td><input type="checkbox" name="use_${k}" hidden><div class="bk-act" role="group" aria-label="${esc(fieldLabel(k))}">${[
    ['keep', 'Keep'],
    ['set', 'Set to…'],
    ['clear', 'Clear']
  ]
    .map(
      ([a, l]) =>
        `<button type="button" class="${a === 'keep' ? 'on' : ''}" data-action="bk-act" data-id="${k}|${a}" aria-pressed="${a === 'keep'}">${l}</button>`
    )
    .join(
      ''
    )}</div></td><td class="bk-new"><div class="bk-value">${field('value_' + k, fieldLabel(k), '', 'text', db.cars.map(c => c[k]).filter(Boolean))}</div><span class="bk-cleared">Emptied on every selected car</span></td></tr>`;
}
function bulkLabelRow(cars, k) {
  const known = [...new Set([...(db.choices[k] || []), ...cars.flatMap(c => c[k] || [])])].slice(0, 12);
  return `<tr class="bk-row" data-bulk-labels="${k}"><td class="bk-name"><b>${esc(fieldLabel(k))}</b></td><td>${bulkDistribution(cars, k, true)}</td><td><input type="hidden" name="mode_${k}" value="keep"><div class="bk-act" role="group" aria-label="${esc(fieldLabel(k))}">${[
    ['keep', 'Keep'],
    ['add', 'Add'],
    ['remove', 'Remove'],
    ['replace', 'Replace']
  ]
    .map(
      ([a, l]) =>
        `<button type="button" class="${a === 'keep' ? 'on' : ''}" data-action="bk-mode" data-id="${k}|${a}" aria-pressed="${a === 'keep'}">${l}</button>`
    )
    .join(
      ''
    )}</div></td><td class="bk-new"><div class="bk-value">${field('labels_' + k, 'Labels, separated by commas', '', 'text', db.choices[k] || [])}${known.length ? `<div class="bk-known">${known.map(v => `<button type="button" data-action="bk-label" data-id="${esc(k + '|' + v)}">${esc(v)}</button>`).join('')}</div>` : ''}</div></td></tr>`;
}
function bulkEdit() {
  bulkDraft = { ids: [...selected], revision: db.revision };
  const cars = bulkSelectedCars(),
    n = bulkDraft.ids.length,
    shown = cars.slice(0, 10);
  modal(
    'Edit selected cars',
    `<div class="bulk-sheet"><div class="bk-strip">${shown.map(c => `<span class="bk-thumb" title="${esc(c.name)}">${photo(c, true)}</span>`).join('')}${n > shown.length ? `<span class="bk-more mono">+${n - shown.length}</span>` : ''}<span class="bk-strip-text"><b class="mono">${n}</b> ${n === 1 ? 'car' : 'cars'} selected · only the fields you change are touched${cars.length < n ? ` · current values shown for the <b class="mono">${cars.length}</b> on this page` : ''}</span></div><div class="bk-body"><div class="bk-main"><table class="bk-table"><thead><tr><th>Field</th><th>Now, across the selection</th><th>Change</th><th>New value</th></tr></thead><tbody>${bulkGroups
      .map(
        ([g, keys]) =>
          `<tr class="bk-group"><td colspan="4">${esc(g)}</td></tr>${keys
            .filter(k => collectionMeta.bulkFields.includes(k))
            .map(k => bulkFieldRow(cars, k))
            .join('')}`
      )
      .join('')}${collectionMeta.bulkFields
      .filter(k => !bulkGroups.some(([, keys]) => keys.includes(k)))
      .map(k => bulkFieldRow(cars, k))
      .join(
        ''
      )}<tr class="bk-group"><td colspan="4">Labels</td></tr>${['usage', 'tags'].map(k => bulkLabelRow(cars, k)).join('')}</tbody></table><p class="bk-foot-note">Inventory and technical specifications are managed through the workshop. Replace with no labels clears the label list.</p></div><aside class="bk-side"><div class="bk-sh"><div class="eye">Live preview</div><h3>What will change</h3><p>Updated as you choose. Nothing is saved until you apply.</p></div><div class="bk-sb" id="bulk-preview"></div><div class="bk-sf">${btn('Refresh preview', 'preview-bulk', 'small ghost')}<label class="check-row"><input type="checkbox" name="confirmed" required>I confirm these changes to the selected cars</label></div></aside></div></div>`,
    async values => {
      const payload = bulkPayload(values);
      if (!Object.keys(payload.updates).length && !Object.keys(payload.labels).length)
        throw Error('Choose at least one change.');
      await change('car.bulk', { ...payload, confirmed: !!values.confirmed });
      toast('Bulk changes saved.');
    },
    'Apply changes'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="bk-summary" id="bulk-summary"></span>');
  bulkSync();
  clearTimeout(bulkPreviewTimer);
  void bulkRefreshPreview();
}
function bulkPayload(values = Object.fromEntries(new FormData($('#modal-form')))) {
  const updates = {},
    labels = {};
  for (const k of collectionMeta.bulkFields)
    if (values['use_' + k]) {
      const value = values['value_' + k] || '',
        row = document.querySelector(`[data-bulk-field="${k}"]`);
      if (value || !row || row.dataset.clear === '1') updates[k] = value;
    }
  for (const k of ['usage', 'tags']) {
    const mode = values['mode_' + k],
      list = comma(values['labels_' + k]);
    if (mode && mode !== 'keep' && (list.length || mode === 'replace')) labels[k] = { mode, values: list };
  }
  return { ...bulkDraft, updates, labels };
}
// Rows, switches and the preview follow the form (also when a value is set from outside, as tests do).
function bulkSync() {
  const form = $('#modal-form');
  if (!form?.querySelector('.bulk-sheet')) return;
  for (const row of form.querySelectorAll('[data-bulk-field]')) {
    const k = row.dataset.bulkField,
      use = form.elements.namedItem('use_' + k).checked,
      value = form.elements.namedItem('value_' + k).value,
      act = !use ? 'keep' : row.dataset.clear === '1' && !value ? 'clear' : 'set';
    row.classList.toggle('changing', use);
    row.classList.toggle('clearing', act === 'clear');
    row.querySelectorAll('[data-action="bk-act"]').forEach(b => {
      const on = b.dataset.id === k + '|' + act;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  for (const row of form.querySelectorAll('[data-bulk-labels]')) {
    const k = row.dataset.bulkLabels,
      mode = form.elements.namedItem('mode_' + k).value;
    row.classList.toggle('changing', mode !== 'keep');
    row.querySelectorAll('[data-action="bk-mode"]').forEach(b => {
      const on = b.dataset.id === k + '|' + mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  clearTimeout(bulkPreviewTimer);
  bulkPreviewTimer = setTimeout(() => void bulkRefreshPreview(), 250);
}
async function bulkRefreshPreview() {
  const box = $('#bulk-preview');
  if (!box) return;
  const payload = bulkPayload(),
    serial = ++bulkPreviewSerial,
    count = Object.keys(payload.updates).length + Object.keys(payload.labels).length,
    submit = $('#dialog .dialog-footer [type=submit]'),
    summary = $('#bulk-summary');
  if (!count) {
    box.innerHTML =
      '<div class="bk-empty">Choose <b>Set to…</b>, <b>Clear</b> or a label action on the left. The cars that change appear here.</div>';
    if (submit) submit.textContent = 'Apply changes';
    if (summary) summary.textContent = 'Nothing chosen yet';
    return;
  }
  let plan;
  try {
    plan = await api('plan', 'bulk.preview', payload);
  } catch (e) {
    if (serial === bulkPreviewSerial) box.innerHTML = `<p class="bk-error">${esc(e.message)}</p>`;
    return;
  }
  if (serial !== bulkPreviewSerial || !$('#bulk-preview')) return;
  const per = new Map();
  for (const r of plan.rows)
    for (const c of r.changes) {
      if (!per.has(c.key)) per.set(c.key, { count: 0, examples: [] });
      const p = per.get(c.key);
      p.count++;
      if (p.examples.length < 2) p.examples.push({ name: r.name, ...c });
    }
  const show = v => (Array.isArray(v) ? v.join(', ') : v) || 'empty',
    title = k => {
      if (k in payload.updates)
        return payload.updates[k] ? `${fieldLabel(k)} → ${payload.updates[k]}` : `${fieldLabel(k)} cleared`;
      const l = payload.labels[k];
      return `${fieldLabel(k)} ${{ add: '+', remove: '−', replace: '=' }[l.mode]} ${l.values.join(', ') || 'none'}`;
    };
  box.innerHTML = `<div class="bk-big"><div><b class="mono">${plan.changed}</b><small>${plan.changed === 1 ? 'car changes' : 'cars change'}</small></div><div><b class="mono">${plan.selected - plan.changed}</b><small>already match</small></div></div>${[
    ...Object.keys(payload.updates),
    ...Object.keys(payload.labels)
  ]
    .map(k => {
      const p = per.get(k) || { count: 0, examples: [] },
        cleared = k in payload.updates && !payload.updates[k];
      return `<div class="bk-chg ${cleared ? 'clear' : ''}"><div class="h"><b>${esc(title(k))}</b><span class="mono">${p.count} ${p.count === 1 ? 'car' : 'cars'}</span></div>${p.examples.map(x => `<div class="ex"><span class="car">${esc(x.name)}</span><s>${esc(show(x.before))}</s><span aria-hidden="true">→</span><em>${esc(show(x.after))}</em></div>`).join('') || '<div class="ex none">Already matches on every selected car</div>'}</div>`;
    })
    .join(
      ''
    )}${plan.rows.length ? `<details class="bk-all"><summary>See every car (${plan.rows.length})</summary><div class="table-wrap"><table><thead><tr><th>Car</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${plan.rows.flatMap(r => r.changes.map(c => `<tr><td>${esc(r.name)}</td><td>${esc(fieldLabel(c.key))}</td><td>${esc(show(c.before))}</td><td>${esc(show(c.after))}</td></tr>`)).join('')}</tbody></table></div></details>` : ''}`;
  if (submit)
    submit.textContent = plan.changed
      ? `Apply to ${plan.changed} ${plan.changed === 1 ? 'car' : 'cars'}`
      : 'Apply changes';
  if (summary)
    summary.innerHTML = `<b>${count} ${count === 1 ? 'change' : 'changes'}</b> on <b>${plan.changed} ${plan.changed === 1 ? 'car' : 'cars'}</b> · saved together, in one step`;
}
// "Review changes" from earlier versions now simply refreshes the preview in the same window.
async function previewBulk() {
  bulkSync();
  clearTimeout(bulkPreviewTimer);
  await bulkRefreshPreview();
}
function bulkAction(action, id) {
  if (!['bk-act', 'bk-mode', 'bk-label'].includes(action) || !$('.bulk-sheet')) return false;
  const [k, value] = [id.slice(0, id.indexOf('|')), id.slice(id.indexOf('|') + 1)],
    form = $('#modal-form');
  if (action === 'bk-act') {
    const row = $(`[data-bulk-field="${k}"]`),
      use = form.elements.namedItem('use_' + k),
      input = form.elements.namedItem('value_' + k);
    use.checked = value !== 'keep';
    row.dataset.clear = value === 'clear' ? '1' : '';
    if (value === 'clear') input.value = '';
    bulkSync();
    if (value === 'set') input.focus();
  }
  if (action === 'bk-mode') {
    form.elements.namedItem('mode_' + k).value = value;
    bulkSync();
    if (value !== 'keep') form.elements.namedItem('labels_' + k).focus();
  }
  if (action === 'bk-label') {
    const input = form.elements.namedItem('labels_' + k),
      list = comma(input.value);
    if (!list.includes(value)) input.value = [...list, value].join(', ');
    if (form.elements.namedItem('mode_' + k).value === 'keep') form.elements.namedItem('mode_' + k).value = 'add';
    bulkSync();
  }
  return true;
}
document.addEventListener('input', e => {
  if (!e.target.closest?.('.bulk-sheet')) return;
  const name = e.target.name || '';
  // Typing a value means "Set to…" this field.
  if (name.startsWith('value_')) {
    const k = name.slice(6),
      use = $('#modal-form').elements.namedItem('use_' + k);
    use.checked = true;
    $(`[data-bulk-field="${k}"]`).dataset.clear = '';
  }
  if (name.startsWith('labels_') && e.target.value.trim()) {
    const mode = $('#modal-form').elements.namedItem('mode_' + name.slice(7));
    if (mode.value === 'keep') mode.value = 'add';
  }
  bulkSync();
});
document.addEventListener('change', e => {
  if (e.target.closest?.('.bulk-sheet') && e.target.name !== 'confirmed') bulkSync();
});
function renderDocuments(c) {
  if (!local()) return '';
  const docs = db.documents.filter(d => d.carId === c.id);
  return `<div class="page-head mt"><div><h2>Private documents</h2><p>Manuals, receipts, setup sheets and inspection records.</p></div>${btn('Attach document', 'attach-document', 'primary', c.id)}</div><div class="note info">Documents are stored inside complete backups. They are excluded from car exports and public browsing. Dealership copies share the complete collection. Up to 20 MB per file. Guides are also available in Workshop → Manuals and Part Guides.</div>${docs.length ? `<div class="stack">${docs.map(d => panel(d.title, `<div class="row">${badge(d.category)}${badge('Private')}<span class="tiny muted">${esc(d.name)} · ${(d.size / 1024).toFixed(1)} KB · ${date(d.added)}</span></div><div class="actions mt">${btn('Open copy', 'open-document', '', d.id)}${btn('Export copy', 'export-document', '', d.id)}${btn('Remove…', 'remove-document', 'small', d.id)}</div>`)).join('')}</div>` : '<p class="muted">No documents attached yet.</p>'}<p class="tiny muted mt">Open copy uses your default document app. Edits made there are not saved back into this database; export a copy to keep external edits.</p>`;
}
async function attachDocument(id) {
  const c = db.cars.find(c => c.id === id),
    revision = c.revision;
  const document = await api('file', 'document.pick');
  if (!document) return;
  modal(
    'Attach private document',
    `<p>${esc(document.name)} · ${(document.size / 1024).toFixed(1)} KB</p><div class="form-grid">${field('title', 'Document title', document.name.slice(0, 200))}${field('category', 'Category', 'Document', 'text', ['Manual', 'Receipt', 'Setup sheet', 'Inspection', 'Document', ...db.documents.map(d => d.category)])}</div>`,
    async values => {
      await change('document.add', { carId: id, revision, document, title: values.title, category: values.category });
    },
    'Attach document'
  );
}
function removeDocument(id) {
  if (db.documents.find(d => d.id === id)?.guide) {
    removeGuide(id);
    return;
  }
  const doc = db.documents.find(d => d.id === id),
    c = db.cars.find(c => c.id === doc.carId);
  modal(
    'Remove document',
    `<p>Remove <strong>${esc(doc.title)}</strong> from this car? The original file on your computer and earlier complete backups are unchanged.</p>`,
    async () => change('document.remove', { id, revision: c.revision }),
    'Remove attachment'
  );
}
document.addEventListener('input', e => {
  if (e.target.id === 'choice-search') {
    choiceQuery = e.target.value;
    $('#choice-results').innerHTML = renderChoiceRows();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'library-field') {
    choiceField = e.target.value;
    choiceQuery = '';
    render();
  }
});
