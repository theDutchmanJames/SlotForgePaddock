'use strict';
// The field arranger for Table columns and Choose fields, after docs/ui-reference/field-arranger-2026-11
// (option B): your fields as a row of chips you drag into order, the real table or panel right below, and the
// fields you can add in a tray. The old actions (column-up / -down / -remove / -add, overview-*) and the
// add selects stay, so the saving code and the scripted checks work as before.
const defaultTableColumns = ['name', 'maker', 'scale', 'usage', 'location', 'availability'];
let faQuery = '',
  faDrag = null;
// What is open: the table columns or one overview panel.
function faContext(kind = $('#columns-editor') ? 'columns' : $('#overview-fields-editor') ? 'overview' : '') {
  if (kind === 'columns')
    return {
      kind: 'columns',
      keys: columnDraft,
      fields: collectionMeta.columns.map(c => ({ key: c.key, group: c.group })),
      label: columnLabel,
      locked: ['name'],
      act: { up: 'column-up', down: 'column-down', remove: 'column-remove', add: 'column-add' },
      select: 'column-add-select',
      noun: ['column', 'columns']
    };
  if (kind === 'overview' && overviewDraft)
    return {
      kind: 'overview',
      keys: overviewDraft.layout[overviewDraft.section],
      fields: OverviewLayout.fields(collectionMeta.columns, overviewDraft.section).map(f => ({
        key: f.key,
        group: f.group || 'Gearing'
      })),
      label: overviewFieldLabel,
      locked: [],
      act: { up: 'overview-up', down: 'overview-down', remove: 'overview-remove', add: 'overview-add' },
      select: 'overview-field-add',
      noun: ['field', 'fields']
    };
  return null;
}
function faPreviewCars() {
  const list = db.cars.filter(c => !c.archived);
  return (list.length ? list : db.cars).slice(0, 4);
}
function faCell(c, k) {
  if (k === 'name')
    return `<td class="fa-nm">${c.picture ? `<img src="${esc(thumbnailSource(c.picture))}" alt="" loading="lazy" decoding="async">` : ''}<span>${esc(c.name)}</span></td>`;
  if (k === 'picture')
    return `<td>${c.picture ? `<img class="fa-pic" src="${esc(thumbnailSource(c.picture))}" alt="" loading="lazy" decoding="async">` : '—'}</td>`;
  const v = columnValue(c, k);
  return `<td>${Array.isArray(v) ? v.map(x => badge(x, k === 'usage' ? 'usage' : '')).join(' ') || '—' : esc(v || '—')}</td>`;
}
function faPreview(x) {
  if (x.kind === 'columns') {
    const cars = faPreviewCars();
    if (!cars.length) return '<p class="muted">Add a car to see the preview.</p>';
    return `<div class="fa-table"><table><thead><tr>${x.keys.map(k => `<th data-key="${esc(k)}">${esc(x.label(k))}</th>`).join('')}</tr></thead><tbody>${cars.map(c => `<tr>${x.keys.map(k => faCell(c, k)).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const c = db.cars.find(c => c.id === carId) || faPreviewCars()[0];
  if (!c) return '<p class="muted">Add a car to see the preview.</p>';
  return `<div class="fa-car">${c.picture ? `<img src="${esc(thumbnailSource(c.picture))}" alt="">` : ''}<div><div class="eye">Preview · this car</div><b>${esc(c.name)}</b></div></div><div class="fa-panel"><h4>${esc(overviewPanelTitles[overviewDraft.section])}</h4>${x.keys.length ? `<dl>${x.keys.map(k => `<div data-key="${esc(k)}"><dt>${esc(k === 'price' && slotforgeDomain.isWishlist(c) ? 'Price' : x.label(k))}</dt><dd>${esc(overviewFieldValue(c, k) || '—')}</dd></div>`).join('')}</dl>` : '<p class="muted">No fields selected.</p>'}</div>`;
}
function faBody(x) {
  const full = x.keys.length >= 16,
    q = faQuery.trim().toLowerCase(),
    groups = [];
  for (const f of x.fields.filter(f => !x.keys.includes(f.key))) {
    let g = groups.find(g => g[0] === f.group);
    if (!g) groups.push((g = [f.group, []]));
    g[1].push(f);
  }
  const chips = x.keys
    .map((k, i) => {
      const name = esc(x.label(k)),
        locked = x.locked.includes(k);
      return `<span class="fa-chip ${locked ? 'lock' : ''}" draggable="true" data-key="${esc(k)}"><span class="fa-grip" aria-hidden="true">⋮⋮</span><span class="fa-name">${name}</span><span class="fa-move"><button type="button" class="fa-mini" data-action="${x.act.up}" data-id="${i}" aria-label="Move ${name} left" ${i ? '' : 'disabled'}>‹</button><button type="button" class="fa-mini" data-action="${x.act.down}" data-id="${i}" aria-label="Move ${name} right" ${i < x.keys.length - 1 ? '' : 'disabled'}>›</button></span>${locked ? '' : `<button type="button" class="fa-mini fa-x" data-action="${x.act.remove}" data-id="${i}" aria-label="Remove ${name}">×</button>`}</span>`;
    })
    .join('');
  const tray = groups.length
    ? groups
        .map(
          ([g, list]) =>
            `<div class="fa-row"><div class="eye">${esc(g)}</div><div class="fa-chips">${list.map(f => `<button type="button" class="fa-add" draggable="${!full}" data-action="fa-add" data-id="${esc(f.key)}" data-search="${esc(x.label(f.key).toLowerCase() + ' ' + g.toLowerCase())}" ${full ? 'disabled' : ''} ${q && !(x.label(f.key).toLowerCase() + ' ' + g.toLowerCase()).includes(q) ? 'hidden' : ''}><i>+</i>${esc(x.label(f.key))}</button>`).join('')}</div></div>`
        )
        .join('')
    : `<p class="muted">Every ${x.noun[0]} is already shown.</p>`;
  return `<div class="fa-win" data-arranger="${x.kind}"><div class="fa-stage"><div class="eye">Your ${x.noun[1]} · drag to reorder</div><div class="fa-hdr" id="fa-chips">${chips || `<span class="muted fa-none">No ${x.noun[1]} yet. Add some from below.</span>`}<span class="fa-count"><b class="mono">${x.keys.length}</b> / 16</span></div><div class="eye">Exactly how it will look</div><div class="fa-preview" id="fa-preview">${faPreview(x)}</div></div><div class="fa-tray"><div class="fa-tray-head"><div class="eye">${full ? `16 ${x.noun[1]} is the most. Remove one to add another.` : `Add a ${x.noun[0]}`}</div><label class="fa-q"><span class="sr-only">Find a ${x.noun[0]}</span><input type="search" id="fa-search" placeholder="Find a ${x.noun[0]}…" value="${esc(faQuery)}" autocomplete="off"></label></div>${tray}</div><select id="${x.select}" hidden ${full || !groups.length ? 'disabled' : ''}>${x.fields
    .filter(f => !x.keys.includes(f.key))
    .map(f => `<option value="${esc(f.key)}">${esc(x.label(f.key))}</option>`)
    .join(
      ''
    )}</select><button type="button" data-action="${x.act.add}" hidden>Add</button></div>`;
}
// Called after every change (also by the old editor refresh paths).
function faSummary() {
  const x = faContext(),
    sum = $('#fa-summary');
  if (!x || !sum) return;
  const html = `<b>${x.keys.length}</b> of 16 ${x.noun[1]} · ${x.kind === 'columns' ? 'saved views keep their own columns' : 'applies to every car in your collection'}`;
  if (sum.innerHTML !== html) sum.innerHTML = html;
}
function faOpen() {
  const foot = $('#dialog .dialog-footer');
  foot.insertAdjacentHTML(
    'afterbegin',
    `<span class="cp-summary" id="fa-summary"></span><button type="button" class="btn ghost" data-action="${$('#columns-editor') ? 'fa-defaults' : 'overview-defaults'}">Restore defaults</button>`
  );
  faQuery = '';
  faSummary();
}
function faFilter() {
  const q = ($('#fa-search')?.value || '').trim().toLowerCase();
  faQuery = q;
  document.querySelectorAll('.fa-tray .fa-add').forEach(b => (b.hidden = !!q && !b.dataset.search.includes(q)));
  document.querySelectorAll('.fa-tray .fa-row').forEach(r => (r.hidden = !r.querySelector('.fa-add:not([hidden])')));
}
document.addEventListener('input', e => {
  if (e.target.id === 'fa-search') faFilter();
});
// The old editors re-render through these; keep the footer count in step.
new MutationObserver(() => {
  if ($('.fa-win')) {
    faSummary();
    if (faQuery) faFilter();
  }
}).observe(document.getElementById('dialog'), { childList: true, subtree: true });

function faRefresh() {
  const x = faContext();
  if (!x) return;
  if (x.kind === 'columns') refreshColumnEditor();
  else $('#overview-fields-editor').innerHTML = overviewEditorBody();
}
function faMove(key, to) {
  const x = faContext();
  if (!x) return;
  const from = x.keys.indexOf(key);
  if (from < 0) {
    if (x.keys.length >= 16 || !x.fields.some(f => f.key === key)) return;
    x.keys.splice(to, 0, key);
  } else {
    x.keys.splice(from, 1);
    x.keys.splice(from < to ? to - 1 : to, 0, key);
  }
  faRefresh();
}
// Drag a chip along the row, or drag a field from the tray into place.
function faDropIndex(e) {
  const chips = [...document.querySelectorAll('#fa-chips .fa-chip')];
  for (let i = 0; i < chips.length; i++) {
    const r = chips[i].getBoundingClientRect();
    if (e.clientY < r.top) return i;
    if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return i;
  }
  return chips.length;
}
function faMark(at) {
  document.querySelectorAll('#fa-chips .before,#fa-chips .after').forEach(c => c.classList.remove('before', 'after'));
  const chips = document.querySelectorAll('#fa-chips .fa-chip');
  if (at < chips.length) chips[at].classList.add('before');
  else chips[chips.length - 1]?.classList.add('after');
}
document.addEventListener('dragstart', e => {
  const el = e.target.closest?.('.fa-win .fa-chip, .fa-win .fa-add');
  if (!el) return;
  faDrag = el.dataset.key || el.dataset.id;
  el.classList.add('drag');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', faDrag);
  document.querySelectorAll(`#fa-preview [data-key="${CSS.escape(faDrag)}"]`).forEach(c => c.classList.add('hot'));
});
document.addEventListener('dragover', e => {
  if (!faDrag || !e.target.closest?.('#fa-chips')) return;
  e.preventDefault();
  faMark(faDropIndex(e));
});
document.addEventListener('drop', e => {
  if (!faDrag || !e.target.closest?.('#fa-chips')) return;
  e.preventDefault();
  const key = faDrag;
  faDrag = null;
  faMove(key, faDropIndex(e));
});
document.addEventListener('dragend', () => {
  faDrag = null;
  document
    .querySelectorAll('.fa-win .drag,.fa-win .hot,.fa-win .before,.fa-win .after')
    .forEach(c => c.classList.remove('drag', 'hot', 'before', 'after'));
});

function fieldArrangerAction(action, id) {
  if (action === 'fa-add') {
    const x = faContext(),
      select = x && $('#' + x.select);
    if (!select) return true;
    select.value = id;
    if (x.kind === 'overview') overviewAction('overview-add');
    else if (columnDraft.length >= 16) toast('Choose no more than 16 columns.');
    else if (id && !columnDraft.includes(id) && x.fields.some(f => f.key === id)) {
      columnDraft.push(id);
      refreshColumnEditor();
    }
    return true;
  }
  if (action === 'fa-defaults') {
    if (!$('#columns-editor')) return true;
    columnDraft.splice(0, columnDraft.length, ...defaultTableColumns);
    refreshColumnEditor();
    return true;
  }
  return false;
}
