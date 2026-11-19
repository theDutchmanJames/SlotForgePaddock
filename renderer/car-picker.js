'use strict';
// One car picker for Compare cars, Compare pace and New / Edit showroom group, after
// docs/ui-reference/car-picker-2026-11: your cars as photo cards with a search box; a click picks a car and a
// badge shows what it is picked for (A / B, or its place in a group).
function carPickCard(c, o = {}) {
  const car = db.cars.find(x => x.id === c.id) || c,
    search = [car.name, car.maker, car.reference, car.number, car.scale].filter(Boolean).join(' ').toLowerCase();
  return `<button type="button" class="cp-card ${o.on ? 'on' : ''} ${o.disabled ? 'off' : ''}" data-action="${o.action}" data-id="${esc(c.id)}" data-search="${esc(search)}" data-tone="${o.tone || ''}" aria-pressed="${!!o.on}" ${o.disabled ? 'disabled' : ''}><span class="cp-photo">${photo(car, true)}${o.badge ? `<span class="cp-badge">${esc(o.badge)}</span>` : ''}${o.info ? `<span class="cp-info">${esc(o.info)}</span>` : ''}</span><span class="cp-text"><b>${esc(car.name || 'Unnamed car')}</b><small>${esc([car.maker, car.scale].filter(Boolean).join(' · ') + (car.archived ? ' · archived' : '')) || '&nbsp;'}</small></span></button>`;
}
function carPickTool(placeholder, count, extra = '', id = 'cp-search') {
  return `<div class="cp-tool"><label class="cp-q"><span class="sr-only">${esc(placeholder)}</span><input type="search" id="${id}" placeholder="${esc(placeholder)}" autocomplete="off"></label>${extra}<span class="cp-count">${count}</span></div>`;
}
// Search and filters narrow the cards on screen (Compare cars and showroom groups have every car loaded).
function carPickFilter() {
  const q = ($('#cp-search')?.value || '').trim().toLowerCase(),
    mode = $('.cp-filter .on')?.dataset.id || 'all';
  let shown = 0;
  document.querySelectorAll('.cp-grid .cp-card').forEach(b => {
    const ok =
      (!q || b.dataset.search.includes(q)) &&
      (mode === 'all' ||
        (mode === 'picked' && b.classList.contains('on')) ||
        (mode === 'unpicked' && !b.classList.contains('on')) ||
        (mode === 'selected' && selected.has(b.dataset.id)));
    b.hidden = !ok;
    if (ok) shown++;
  });
  const none = $('.cp-none');
  if (none) none.hidden = shown > 0;
}
function carPickFilterSeg(options) {
  return `<div class="cp-filter" role="group" aria-label="Show">${options.map(([id, label], i) => `<button type="button" class="${i ? '' : 'on'}" data-action="cp-filter" data-id="${id}" aria-pressed="${!i}">${label}</button>`).join('')}</div>`;
}
document.addEventListener('input', e => {
  if (e.target.id === 'cp-search') carPickFilter();
});

/* ---------- Compare cars: A and B ---------- */
function showComparisonChooser() {
  const s = carComparison;
  modal(
    'Compare cars',
    `<div class="cp-win" data-picker="compare"><input type="hidden" name="compare-0" value="${esc(s.ids[0] || '')}"><input type="hidden" name="compare-1" value="${esc(s.ids[1] || '')}"><div class="cp-main">${carPickTool(
      'Find a car…',
      `<b class="mono">${s.choices.length}</b> cars`,
      selected.size ? carPickFilterSeg([['all', 'All'], ['selected', 'Selected on Cars']]) : ''
    )}<div class="cp-grid">${s.choices.map(c => carPickCard(c, { action: 'cp-compare' })).join('')}<p class="cp-none" hidden>No car matches your search.</p></div></div><aside class="cp-side"><div class="cp-sh"><div class="eye">Comparing</div><h3 id="cp-compare-title"></h3><p>The first click sets A, the next sets B. Click a chosen car again to clear it.</p></div><div class="cp-sb" id="cp-slots"></div></aside></div>`,
    async values => {
      const ids = [values['compare-0'], values['compare-1']];
      if (!ids[0] || !ids[1]) throw Error('Choose two cars.');
      if (ids[0] === ids[1]) throw Error('Choose two different cars.');
      const result = await api('plan', 'car.compare', { ids });
      if (result.databaseId !== s.databaseId || db.id !== s.databaseId)
        throw Error('The collection changed. Choose the cars again.');
      Object.assign(s, result, {
        ids,
        differences: false,
        runIds: ids.map(id => result.runs.find(r => r.carId === id)?.id || '')
      });
      setTimeout(showCarComparison, 0);
    },
    'Compare'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="cp-summary" id="cp-summary"></span>');
  compareSync();
}
function compareSync() {
  if (!$('[data-picker="compare"]')) return;
  const ids = [0, 1].map(i => $(`#modal-form [name="compare-${i}"]`).value),
    car = id => carComparison.choices.find(c => c.id === id) || db.cars.find(c => c.id === id),
    tones = ['blue', 'amber'];
  document.querySelectorAll('[data-picker="compare"] .cp-card').forEach(b => {
    const at = ids.indexOf(b.dataset.id);
    b.classList.toggle('on', at >= 0);
    b.setAttribute('aria-pressed', String(at >= 0));
    b.dataset.tone = at >= 0 ? tones[at] : '';
    b.querySelector('.cp-badge')?.remove();
    if (at >= 0) b.querySelector('.cp-photo').insertAdjacentHTML('beforeend', `<span class="cp-badge">${'AB'[at]}</span>`);
  });
  const slot = i => {
    const c = car(ids[i]);
    return c
      ? `<div class="cp-slot" data-tone="${tones[i]}"><span class="cp-tag">${'AB'[i]}</span><span class="cp-slot-pic">${photo(c, true)}</span><span class="cp-slot-text"><b>${esc(c.name)}</b><small>${esc([c.maker, c.scale].filter(Boolean).join(' · '))}</small></span><button type="button" class="btn small ghost" data-action="cp-compare-clear" data-id="${i}" aria-label="Clear ${'AB'[i]}">×</button></div>`
      : `<div class="cp-slot empty" data-tone="${tones[i]}"><span class="cp-tag">${'AB'[i]}</span><span class="cp-slot-pic"></span><span class="cp-slot-text"><b>Pick a car</b><small>Click a car on the left</small></span></div>`;
  };
  $('#cp-slots').innerHTML = `${slot(0)}<div class="cp-swap">${btn('⇅ Swap A and B', 'cp-compare-swap', 'small')}</div>${slot(1)}<p class="cp-hint">You can choose recorded runs to compare measured pace on the next screen.</p>`;
  const [a, b] = ids.map(car);
  $('#cp-compare-title').textContent = a && b ? `${a.name} vs ${b.name}` : 'Pick two cars';
  $('#cp-summary').innerHTML = a && b ? `<b>${esc(a.name)}</b> vs <b>${esc(b.name)}</b>` : 'Pick two cars';
}

/* ---------- showroom group: a numbered order ---------- */
function shelfEditorRows() {
  return (
    editingShelfIds
      .map((id, i) => {
        const c = db.cars.find(c => c.id === id);
        return `<div class="cp-order-row" draggable="true" data-shelf-car="${esc(id)}"><span class="cp-grip" aria-hidden="true">⋮⋮</span><span class="cp-n mono">${i + 1}</span><span class="cp-order-pic">${c ? photo(c, true) : ''}</span><b>${esc(c?.name || 'Car not in this view')}${c?.archived ? ' <small>· archived, hidden in the Showroom</small>' : ''}</b><span class="cp-order-acts">${btn('↑', 'shelf-up', 'small ghost', id)}${btn('↓', 'shelf-down', 'small ghost', id)}${btn('×', 'shelf-car-remove', 'small ghost', id)}</span></div>`;
      })
      .join('') || '<p class="cp-empty">No cars yet. Click cars on the left to add them.</p>'
  );
}
function shelfRefresh() {
  const box = $('#shelf-editor');
  if (box) box.innerHTML = shelfEditorRows();
  document.querySelectorAll('[data-picker="shelf"] .cp-card').forEach(b => {
    const at = editingShelfIds.indexOf(b.dataset.id);
    b.classList.toggle('on', at >= 0);
    b.setAttribute('aria-pressed', String(at >= 0));
    b.querySelector('.cp-badge')?.remove();
    if (at >= 0) b.querySelector('.cp-photo').insertAdjacentHTML('beforeend', `<span class="cp-badge">${at + 1}</span>`);
  });
  const n = editingShelfIds.length;
  const count = $('[data-picker="shelf"] .cp-count');
  if (count) count.innerHTML = `<b class="mono">${n}</b> of ${document.querySelectorAll('[data-picker="shelf"] .cp-card').length} picked`;
  const sum = $('#cp-summary');
  if (sum) sum.innerHTML = `<b>${n} ${n === 1 ? 'car' : 'cars'}</b> in this group`;
  if ($('.cp-filter .on')?.dataset.id !== 'all') carPickFilter();
}
function editShelf(id = '') {
  const s = db.planning.shelves.find(s => s.id === id),
    revision = db.revision,
    cars = db.cars.filter(slotforgeDomain.activeCar);
  editingShelfId = id;
  editingShelfIds = [...(s?.carIds || [])];
  modal(
    s ? 'Edit group' : 'New showroom group',
    `<div class="cp-win" data-picker="shelf"><select id="shelf-car" hidden>${cars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><button type="button" data-action="shelf-car-add" hidden>Add car</button><div class="cp-main">${carPickTool(
      'Find a car…',
      '',
      carPickFilterSeg([
        ['all', 'All'],
        ['unpicked', 'Not picked'],
        ['picked', 'Picked']
      ])
    )}<div class="cp-grid">${cars.map(c => carPickCard(c, { action: 'cp-shelf', tone: 'violet' })).join('')}<p class="cp-none" hidden>No car matches.</p></div></div><aside class="cp-side"><div class="cp-sh"><div class="eye">Your group</div><h3 id="cp-shelf-title">${esc(s?.name || 'New group')}</h3><p>Click cars to add or remove them. Drag to change the order.</p></div><div class="cp-sb">${field('name', 'Group name', s?.name || '')}<div id="shelf-editor" class="cp-order">${shelfEditorRows()}</div><p class="cp-hint">Archived cars stay saved in a group but are hidden in the Showroom.</p></div></aside></div>`,
    async v => {
      showroom.shelf = await change('planning.shelf.save', {
        revision,
        id: editingShelfId,
        name: v.name,
        carIds: editingShelfIds
      });
    },
    'Save group'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="cp-summary" id="cp-summary"></span>');
  shelfRefresh();
}
// Drag a row to a new place in the group.
let shelfDragId = null;
document.addEventListener('dragstart', e => {
  const row = e.target.closest?.('[data-shelf-car]');
  if (!row) return;
  shelfDragId = row.dataset.shelfCar;
  row.classList.add('drag');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', shelfDragId);
});
document.addEventListener('dragover', e => {
  const row = e.target.closest?.('[data-shelf-car]');
  if (!row || !shelfDragId) return;
  e.preventDefault();
  document.querySelectorAll('.cp-order-row.over').forEach(r => r.classList.remove('over'));
  row.classList.add('over');
});
document.addEventListener('drop', e => {
  const row = e.target.closest?.('[data-shelf-car]');
  if (!row || !shelfDragId) return;
  e.preventDefault();
  const from = editingShelfIds.indexOf(shelfDragId),
    to = editingShelfIds.indexOf(row.dataset.shelfCar);
  if (from >= 0 && to >= 0 && from !== to) {
    editingShelfIds.splice(to, 0, editingShelfIds.splice(from, 1)[0]);
    shelfRefresh();
  }
});
document.addEventListener('dragend', () => {
  shelfDragId = null;
  document.querySelectorAll('.cp-order-row.drag,.cp-order-row.over').forEach(r => r.classList.remove('drag', 'over'));
});
document.addEventListener('input', e => {
  if (e.target.name === 'name' && e.target.closest?.('[data-picker="shelf"]'))
    $('#cp-shelf-title').textContent = e.target.value.trim() || 'New group';
  if (/^compare-[01]$/.test(e.target.name || '')) compareSync();
});

function carPickerAction(action, id) {
  if (action === 'cp-filter') {
    document.querySelectorAll('.cp-filter [data-action="cp-filter"]').forEach(b => {
      b.classList.toggle('on', b.dataset.id === id);
      b.setAttribute('aria-pressed', String(b.dataset.id === id));
    });
    carPickFilter();
    return true;
  }
  if (action === 'cp-compare') {
    const inputs = [0, 1].map(i => $(`#modal-form [name="compare-${i}"]`)),
      at = inputs.findIndex(x => x.value === id);
    if (at >= 0) inputs[at].value = '';
    else (inputs.find(x => !x.value) || inputs[1]).value = id;
    compareSync();
    return true;
  }
  if (action === 'cp-compare-clear') {
    $(`#modal-form [name="compare-${id}"]`).value = '';
    compareSync();
    return true;
  }
  if (action === 'cp-compare-swap') {
    const [a, b] = [0, 1].map(i => $(`#modal-form [name="compare-${i}"]`));
    [a.value, b.value] = [b.value, a.value];
    compareSync();
    return true;
  }
  if (action === 'cp-shelf') {
    if (editingShelfIds.includes(id)) editingShelfIds = editingShelfIds.filter(x => x !== id);
    else editingShelfIds.push(id);
    shelfRefresh();
    return true;
  }
  return false;
}
