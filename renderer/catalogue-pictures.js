let pictureRequestView = null;
const pictureKey = row => JSON.stringify([row.kind, row.id]);
function pictureRequestCard() {
  return `<section class="panel mt catalogue-pictures-intro"><div class="row">${uiTile('photos', 'blue')}<div><h2>Illustrated Catalogue · picture research</h2><p class="muted">Already added your products? Ask your own AI to find pictures for existing parts and workshop supplies.</p></div></div><div class="actions mt">${btn('Create picture request', 'pictures-open')}${btn('Saved picture requests', 'pictures-saved')}${btn('Open completed picture files…', 'illustrated-import', 'primary')}</div><details class="exchange-more"><summary>Details</summary><p class="tiny muted">Exports only product descriptions and references, in files of up to 100 entries. Select one or several completed JSON files to review them together. Shared picture lists match existing products by manufacturer and product reference; import their parts lists first. Missing or ambiguous matches are skipped. Previews download automatically after validation; queued downloads continue when imports free temporary space. Select pictures, then use Finish import at the bottom right.</p></details></section>`;
}
// Picture request, after docs/ui-reference/picture-request-2026-11 option A: manufacturers on the left with how
// many products still miss a picture, the products as cards you tick, and the request on the right.
// The original filter controls stay (hidden) so the filter code and the scripted checks work as before.
function pictureTabs(on) {
  return `<div class="pq-tabs" role="tablist">${[
    ['new', 'New request', 'pictures-open'],
    ['saved', 'Saved requests', 'pictures-saved'],
    ['files', 'Open finished files…', 'illustrated-import']
  ]
    .map(
      ([id, label, action]) =>
        `<button type="button" role="tab" class="${on === id ? 'on' : ''}" aria-selected="${on === id}" ${on === id ? '' : `data-action="${action}"`}>${label}</button>`
    )
    .join('')}</div>`;
}
// Photos come back as references; keep them apart so they are never sent back with the next request.
function pictureTakeThumbs(v) {
  v.thumbs ||= new Map();
  for (const row of v.result.rows || [])
    if (Object.hasOwn(row, 'picture')) {
      if (row.picture) v.thumbs.set(pictureKey(row), row.picture);
      delete row.picture;
    }
}
function pictureCard(row, v) {
  const key = pictureKey(row),
    on = v.selected.has(key),
    thumb = v.thumbs?.get(key),
    type = [row.kind === 'part' ? 'Part' : 'Workshop supply', row.partType || row.category].filter(Boolean).join(' · ');
  return `<label class="pq-card ${on ? 'on' : ''}"><input type="checkbox" class="pq-check" aria-label="Select ${esc(row.name)}" data-picture-row="${esc(key)}" ${on ? 'checked' : ''}><span class="pq-pic ${row.hasPicture ? '' : 'miss'}">${thumb ? `<img src="${esc(thumbnailSource(thumb))}" alt="" loading="lazy" decoding="async">` : row.hasPicture ? '<span>Has a picture</span>' : '<span>No picture yet</span>'}</span><span class="pq-box" aria-hidden="true"></span>${row.hasPicture ? '<span class="pq-tag">Has picture</span>' : ''}<span class="pq-text"><b>${esc(row.name)}</b><small>${row.reference.trim() ? `<span class="pq-ref">${esc(row.reference)}</span>` : '<span class="pq-noref">No reference</span>'}<span>${esc(type)}</span></small></span></label>`;
}
function pictureSide(v) {
  const n = v.selected.size,
    files = Math.ceil(n / 100),
    maker = v.filters.manufacturer;
  return `<div class="pq-sh"><div class="eye">Your request</div><h3>${maker ? esc(maker) + ' · ' + n + ' ' + (n === 1 ? 'product' : 'products') : 'Choose a manufacturer'}</h3></div><div class="pq-sb"><div class="pq-big mono">${n}</div><p class="pq-hint" id="pictures-count" aria-live="polite">${n} selected · ${files} request file(s)</p><p class="pq-hint">Ticks are kept while you filter and page.</p>${files ? `<div class="pq-grp">Files</div><div class="pq-files">${Array.from({ length: Math.min(files, 6) }, (_, k) => `<div class="pq-file"><span class="pq-ic">JSON</span><span>${esc(maker)} pictures ${k + 1}<small>${Math.min(100, n - k * 100)} ${Math.min(100, n - k * 100) === 1 ? "entry" : "entries"}</small></span></div>`).join('')}${files > 6 ? `<p class="pq-hint">and ${files - 6} more</p>` : ''}</div>` : ''}<p class="pq-hint">Up to 100 products per file. Give each file to your AI, then use Open finished files.</p><div class="pq-grp">What goes in the file</div><ul class="pq-ok"><li>Product names, references and types</li><li>English instructions for your AI</li><li class="no">No quantities, locations, prices or notes</li><li class="no">No photos of your own items</li></ul><p class="pq-hint">Saved request mappings stay on this computer and are not in library backups. Existing pictures are not replaced by exporting.</p><p id="pictures-export-result" class="pq-result" role="status"></p></div>`;
}
function pictureBody() {
  const v = pictureRequestView,
    r = v.result,
    f = v.filters,
    option = (value, label, current) =>
      `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`,
    stats = r.makerStats || r.manufacturers.map(name => ({ name, total: 0, pictured: 0 })),
    chip = (action, id, label, on) =>
      `<button type="button" class="pq-chip ${on ? 'on' : ''}" data-action="${action}" data-id="${esc(id)}" aria-pressed="${on}">${esc(label)}</button>`;
  const rail = stats.length
    ? stats
        .map(m => {
          const missing = m.total - m.pictured,
            on = m.name === f.manufacturer;
          return `<button type="button" class="pq-maker ${on ? 'on' : ''}" data-action="pictures-maker" data-id="${esc(m.name)}" aria-pressed="${on}"><b>${esc(m.name)}</b><span class="mono">${missing} missing</span><span class="pq-bar"><i data-w="${m.total ? Math.round((m.pictured / m.total) * 100) : 0}"></i></span><small>${m.pictured} of ${m.total} have a picture</small></button>`;
        })
        .join('')
    : '<p class="pq-hint">Add a manufacturer to your parts or workshop supplies first.</p>';
  const grid = f.manufacturer
    ? r.rows.map(row => pictureCard(row, v)).join('') ||
      `<p class="pq-none">${f.missing ? 'Every matching product already has a picture. Switch on "Include ones that have a picture" to see them.' : 'No matching products.'}</p>`
    : '<p class="pq-none">Choose a manufacturer on the left.</p>';
  return `<div class="pq-win">${pictureTabs('new')}<div class="pq-body"><aside class="pq-rail"><div class="eye">Manufacturers</div><div class="pq-makers">${rail}</div></aside><div class="pq-main"><div class="pq-tool"><label class="pq-q"><span class="sr-only">Search</span><input id="pictures-query" value="${esc(f.query)}" maxlength="500" placeholder="Name, reference or type…" autocomplete="off"></label>${chip('pictures-kind-pick', '', 'All', !f.kind)}${chip('pictures-kind-pick', 'part', 'Parts', f.kind === 'part')}${chip('pictures-kind-pick', 'supply', 'Workshop supplies', f.kind === 'supply')}${r.categories.length > 1 ? r.categories.map(c => chip('pictures-cat', c, c, f.category === c)).join('') : ''}<label class="pq-switch"><input type="checkbox" id="pictures-include" ${f.missing ? '' : 'checked'}><i aria-hidden="true"></i>Include ones that have a picture</label></div><div class="pq-grid">${grid}</div><div class="pq-pager">${f.manufacturer ? btn('Select all ' + r.total, 'pictures-select', 'small') + btn('Clear', 'pictures-clear', 'small ghost') : ''}<span class="grow"></span><span class="pq-hint">${f.manufacturer && r.total ? `${r.offset + 1}–${r.offset + r.rows.length} of ${r.total}` : ''}</span>${f.manufacturer && r.offset ? pagerBtn('prev', 'Previous entries', 'pictures-prev') : ''}${f.manufacturer && r.next !== null ? pagerBtn('next', 'Next entries', 'pictures-next') : ''}</div></div><aside class="pq-side" id="pictures-side">${pictureSide(v)}</aside></div><div hidden><select id="pictures-maker">${option('', 'Choose a manufacturer', f.manufacturer)}${r.manufacturers.map(m => option(m, m, f.manufacturer)).join('')}</select><select id="pictures-kind">${option('', 'Parts and workshop supplies', f.kind)}${option('part', 'Parts', f.kind)}${option('supply', 'Workshop supplies', f.kind)}</select><select id="pictures-category">${option('', 'All categories', f.category)}${r.categories.map(c => option(c, c, f.category)).join('')}</select><input type="checkbox" id="pictures-missing" ${f.missing ? 'checked' : ''}>${btn('Apply filters', 'pictures-filter')}</div></div>`;
}
function pictureRender() {
  const box = $('#picture-content');
  if (!box) return;
  const focus = document.activeElement?.id,
    caret = focus === 'pictures-query' ? $('#pictures-query').selectionStart : null;
  box.innerHTML = pictureBody();
  box.querySelectorAll('.pq-bar i').forEach(i => (i.style.width = i.dataset.w + '%'));
  if (focus === 'pictures-query') {
    const q = $('#pictures-query');
    q.focus();
    q.setSelectionRange(caret, caret);
  }
  pictureFooter();
}
function pictureFooter() {
  const v = pictureRequestView,
    sum = $('#pictures-summary');
  if (!v || !sum) return;
  const n = v.selected.size;
  sum.innerHTML = n
    ? `<b>${n}</b> ${esc(v.filters.manufacturer)} ${n === 1 ? 'product' : 'products'} · ${Math.ceil(n / 100)} ${Math.ceil(n / 100) === 1 ? 'file' : 'files'}`
    : 'Tick the products to research';
  const save = $('#dialog .dialog-footer [data-action="pictures-export"]');
  if (save) save.disabled = !n;
}
function pictureCount() {
  const v = pictureRequestView;
  if (!v || !$('#pictures-side')) return;
  $('#pictures-side').innerHTML = pictureSide(v);
  document.querySelectorAll('[data-picture-row]').forEach(el => {
    el.closest('.pq-card')?.classList.toggle('on', el.checked);
  });
  pictureFooter();
}
async function pictureLoad(offset = 0) {
  const v = pictureRequestView,
    result = await api('file', 'pictures.browse', { filters: v.filters, offset, expected: v.result });
  if (pictureRequestView !== v || !$('#picture-content')) return;
  v.result = result;
  pictureTakeThumbs(v);
  pictureRender();
}
async function pictureSaved() {
  const expected = await api('file', 'pictures.browse', {});
  for (const row of expected.rows) delete row.picture;
  const result = await api('file', 'pictures.requests', { expected });
  pictureRequestView = { result, selected: new Map() };
  modal(
    'Picture request',
    `<div class="pq-win pq-saved">${pictureTabs('saved')}<div class="pq-list"><p class="pq-hint">Requests and downloaded previews are saved on this computer. Export again keeps the same row identities. Preview selections do not change your catalogue: open the previews, choose pictures and use Finish import at the bottom right. Dealership submissions are sent for review.</p>${
      result.requests
        .map(r => {
          const here = r.databaseId === result.databaseId && r.recoveryId === result.recoveryId;
          return `<section class="pq-req"><span class="pq-ic">JSON</span><div><b>${esc(r.manufacturer)}</b><small>${r.count} entries · ${esc(r.created)}${r.databaseId !== result.databaseId ? ' · Another collection' : r.recoveryId !== result.recoveryId ? ' · Old recovery generation' : ''}</small><small class="mono pq-id">${esc(r.id)}</small></div><div class="actions">${here ? btn('Export again…', 'pictures-again', 'small', r.id) + (r.state === 'preview' ? btn('Open previews', 'illustrated-open', 'small primary', r.id) : '') : ''}${btn('Discard request', 'pictures-discard', 'small danger', r.id)}</div></section>`;
        })
        .join('') || '<p class="pq-none">No saved picture requests on this computer.</p>'
    }<p class="pq-hint">Discard only requests you no longer need: reopening their files would need fresh manufacturer and reference matching.</p></div></div>`,
    null
  );
  $('#dialog .dialog-footer [data-action="close-modal"]').textContent = 'Close';
}
async function pictureAction(action, id) {
  if (!action.startsWith('pictures-')) return false;
  if (!local()) return true;
  if (action === 'pictures-open') {
    const result = await api('file', 'pictures.browse', {});
    pictureRequestView = {
      result,
      filters: { manufacturer: '', kind: '', category: '', query: '', missing: true },
      selected: new Map(),
      thumbs: new Map()
    };
    pictureTakeThumbs(pictureRequestView);
    modal('Picture request', '<div id="picture-content"></div>', null);
    $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="cp-summary" id="pictures-summary"></span>');
    $('#dialog .dialog-footer [data-action="close-modal"]').textContent = 'Close';
    $('#dialog .dialog-footer').insertAdjacentHTML('beforeend', btn('Save request file…', 'pictures-export', 'primary'));
    pictureRender();
    // Start with the manufacturer that has the most products still missing a picture.
    const first = (result.makerStats || []).reduce(
      (best, m) => (!best || m.total - m.pictured > best.total - best.pictured ? m : best),
      null
    );
    if (first && first.total - first.pictured > 0) await pictureAction('pictures-maker', first.name);
    return true;
  }
  if (action === 'pictures-saved') {
    await pictureSaved();
    return true;
  }
  const v = pictureRequestView;
  if (!v) return true;
  if (['pictures-maker', 'pictures-kind-pick', 'pictures-cat', 'pictures-include'].includes(action)) {
    if (!$('#pictures-maker')) return true;
    if (action === 'pictures-maker') $('#pictures-maker').value = id;
    if (action === 'pictures-kind-pick') $('#pictures-kind').value = id;
    if (action === 'pictures-cat') $('#pictures-category').value = $('#pictures-category').value === id ? '' : id;
    if (action === 'pictures-include') $('#pictures-missing').checked = !$('#pictures-include').checked;
    action = 'pictures-filter';
  }
  if (action === 'pictures-filter') {
    const manufacturer = $('#pictures-maker').value,
      missing = $('#pictures-missing').checked;
    if (manufacturer !== v.filters.manufacturer || missing !== v.filters.missing) v.selected.clear();
    v.filters = {
      manufacturer,
      missing,
      kind: $('#pictures-kind').value,
      category: manufacturer !== v.filters.manufacturer ? '' : $('#pictures-category').value,
      query: $('#pictures-query').value
    };
    await pictureLoad();
  }
  if (action === 'pictures-select') {
    const rows = await api('file', 'pictures.select', { filters: v.filters, expected: v.result });
    for (const row of rows) v.selected.set(pictureKey(row), row);
    if ($('#picture-content')) pictureRender();
  }
  if (action === 'pictures-clear') {
    v.selected.clear();
    pictureRender();
  }
  if (action === 'pictures-next') await pictureLoad(v.result.next);
  if (action === 'pictures-prev') await pictureLoad(Math.max(0, v.result.offset - 40));
  if (action === 'pictures-export') {
    const result = await api('file', 'pictures.export', {
      expected: v.result,
      manufacturer: v.filters.manufacturer,
      selected: [...v.selected.values()],
      includeExisting: !v.filters.missing
    });
    if (result) {
      v.selected.clear();
      document.querySelectorAll('[data-picture-row]').forEach(el => (el.checked = false));
      pictureCount();
      const output = $('#pictures-export-result');
      if (output)
        output.textContent = `Saved ${result.items} entries in ${result.files} request file(s) to ${result.path}. Give each JSON file to your AI; English instructions are included.`;
      toast('Picture requests saved.');
    }
  }
  if (action === 'pictures-again') {
    const result = await api('file', 'pictures.reexport', { id, expected: v.result });
    if (result) toast('Picture request saved to ' + result.path);
  }
  if (action === 'pictures-discard')
    modal(
      'Discard picture request?',
      '<p>The returned AI file for this request will no longer be usable. No products or photographs will change.</p>',
      async () => {
        await api('file', 'pictures.discard', {
          id,
          expected: v.result,
          requestDatabaseId: v.result.requests.find(r => r.id === id)?.databaseId
        });
        toast('Request discarded.');
      },
      'Discard request'
    );
  return true;
}
document.addEventListener('change', event => {
  if (event.target.id === 'pictures-include' && pictureRequestView) {
    pictureAction('pictures-include').catch(e => toast(e.message));
    return;
  }
  const key = event.target.dataset?.pictureRow,
    v = pictureRequestView;
  if (!key || !v) return;
  const row = v.result.rows.find(r => pictureKey(r) === key);
  if (!row) return;
  if (event.target.checked) v.selected.set(key, { kind: row.kind, id: row.id });
  else v.selected.delete(key);
  pictureCount();
});
// Typing in the search filters after a short pause; Enter filters at once.
let pictureSearchTimer = null;
document.addEventListener('input', event => {
  if (event.target.id !== 'pictures-query' || !pictureRequestView) return;
  clearTimeout(pictureSearchTimer);
  pictureSearchTimer = setTimeout(() => pictureAction('pictures-filter').catch(e => toast(e.message)), 350);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.target.id !== 'pictures-query' || !pictureRequestView) return;
  event.preventDefault();
  clearTimeout(pictureSearchTimer);
  pictureAction('pictures-filter').catch(e => toast(e.message));
});
