'use strict';
const shoppingFilters = { listId: '', status: 'all' };
const shoppingFinder = { query: '', maker: '', category: '', partType: '', kind: 'part', open: false };
let shoppingUndo = null,
  shoppingContext = '',
  finderSerial = 0,
  finderTimer = null,
  finderRequest = null,
  // The manufacturer choices from the last catalogue search, per collection and item kind.
  // Every redraw of the page rebuilds the search box; while it is closed it only needs these
  // choices back, not a new search of the whole catalogue (see loadShoppingMatches).
  finderMakers = null;
function fillFinderMakers(root, makers, selected) {
  root.querySelector('[name=finderMaker]').innerHTML =
    '<option value="">All manufacturers</option>' +
    makers.map(m => `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}</option>`).join('');
}
const shopQuantity = s => s.purchase?.checklist?.quantity ?? s.quantity;
const shopDone = s => s.purchase?.checklist?.done ?? s.received >= s.quantity;
const shopDeleted = s => s.purchase?.checklist?.deleted === true;
const shoppingItem = s =>
  s.purchase?.item.kind === 'free'
    ? s.purchase.item
    : s.purchase?.item.kind === 'supply'
      ? db.supplies.find(p => p.id === s.purchase.item.id) || { name: 'Unavailable supply' }
      : db.parts.find(p => p.id === s.partId) || { name: 'Unavailable part' };
const shoppingLists = () =>
  db.planning.shoppingLists || [{ id: 'general', name: 'General shopping', source: { kind: 'general' } }];
function shoppingSelect(name, label, options, value = '', blank = 'All') {
  return `<label class="field">${esc(label)}<select name="${esc(name)}">${blank !== null ? `<option value="">${esc(blank)}</option>` : ''}${options.map(([id, title]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`;
}
function shoppingConflicts(rows = []) {
  return rows.length
    ? '<details class="note info"><summary>Shared stock needs attention · ' +
        rows.length +
        ' part(s)</summary><p>Plans do not reserve stock. Check the combined need across these plans.</p>' +
        rows
          .map(
            r =>
              '<p><strong>' +
              esc(r.name) +
              '</strong> · ' +
              r.required +
              ' planned / ' +
              r.available +
              ' available<br><span class="tiny">' +
              esc(r.plans.join(' · ')) +
              '</span></p>'
          )
          .join('') +
        '</details>'
    : '';
}
function shoppingSource(s) {
  const job = db.jobs.find(j => j.id === s.jobId);
  return `<div class="shopping-source">${job ? btn(esc(job.name), 'open-job', 'small ghost', job.id) : ''}${s.buildId ? (s.buildAvailable ? btn('Build · ' + esc(s.buildName || 'Saved build'), 'build-load-draft', 'small ghost', s.buildId) : `<span class="tiny muted">Build · ${esc(s.buildName || 'Saved build')}</span>`) : ''}</div>`;
}
function shoppingCompactRow(s, readOnly) {
  const item = shoppingItem(s),
    done = shopDone(s),
    name = esc(item.name),
    n = shopQuantity(s),
    free = s.purchase?.item.kind === 'free';
  const category = item.category || '',
    types = slotforgeCatalogue.parts[category] || slotforgeCatalogue.supplies[category] || [];
  const visual = free ? icon('box') : itemIcon({ category, partType: types[0] || item.partType || '' });
  return `<article class="shopping-compact-row ${done ? 'is-done' : ''}" data-shopping-row="${esc(s.id)}"><button class="shopping-tick" type="button" data-action="${done ? 'shop-reopen' : 'shop-done'}" data-id="${esc(s.id)}" aria-label="${done ? 'Reopen' : 'Mark done'}: ${name}" aria-pressed="${done}" ${readOnly ? 'disabled' : ''}>${done ? icon('check') : ''}</button><span class="shopping-category-icon" title="${esc(category || 'Free-text item')}" aria-hidden="true">${visual}</span><div class="shopping-compact-copy">${readOnly ? `<strong title="${name}">${name}</strong>` : `<button type="button" class="shopping-item-name" data-action="shop-edit" data-id="${esc(s.id)}" title="${name}" aria-label="Edit shopping item: ${name}">${name}</button>`}${readOnly && (s.received || purchaseHasHistory(s)) ? btn('Stock history', 'shop-history', 'small ghost', s.id) : ''}</div><span class="shopping-reference" title="${esc(item.reference || 'No product reference')}">${esc(item.reference || '—')}</span><div class="shopping-quantity"><button type="button" class="btn small" data-action="shop-minus" data-id="${esc(s.id)}" aria-label="Decrease quantity for ${name}" ${readOnly || n <= 1 ? 'disabled' : ''}>−</button><input type="number" min="1" max="1000000" step="1" value="${n}" data-shop-quantity="${esc(s.id)}" aria-label="Quantity for ${name}" ${readOnly ? 'disabled' : ''}><button type="button" class="btn small" data-action="shop-plus" data-id="${esc(s.id)}" aria-label="Increase quantity for ${name}" ${readOnly ? 'disabled' : ''}>+</button></div>${readOnly ? '' : `<button type="button" class="btn small ghost shopping-delete" data-action="shop-delete" data-id="${esc(s.id)}" aria-label="Delete ${name}">${icon('trash')}</button>`}</article>`;
}
function shoppingRows(lines, readOnly = false, compact = false) {
  return lines
    .filter(s => !shopDeleted(s))
    .map(s => {
      if (compact) return shoppingCompactRow(s, readOnly);
      const item = shoppingItem(s),
        done = shopDone(s),
        name = esc(item.name),
        n = shopQuantity(s);
      return `<article class="shopping-check-row ${done ? 'is-done' : ''}" data-shopping-row="${esc(s.id)}"><button class="shopping-tick" type="button" data-action="${done ? 'shop-reopen' : 'shop-done'}" data-id="${esc(s.id)}" aria-label="${done ? 'Reopen' : 'Mark done'}: ${name}" aria-pressed="${done}" ${readOnly ? 'disabled' : ''}>${done ? icon('check') : ''}</button>${s.purchase?.item.kind === 'free' ? uiTile('box', 'shopping') : itemVisual(item)}<div class="shopping-row-copy"><strong>${name}</strong><p class="tiny muted">${esc([item.maker, item.reference, s.purchase?.item.kind === 'free' ? 'Free-text item' : ''].filter(Boolean).join(' · '))}</p>${shoppingSource(s)}${s.notes ? '<p class="tiny muted">' + esc(s.notes) + '</p>' : ''}<div class="actions">${readOnly ? '' : btn('Details', 'shop-edit', 'small ghost', s.id)}${s.received || purchaseHasHistory(s) ? btn('Stock history', 'shop-history', 'small ghost', s.id) : ''}</div></div><div class="shopping-quantity"><button type="button" class="btn small" data-action="shop-minus" data-id="${esc(s.id)}" aria-label="Decrease quantity for ${name}" ${readOnly || n <= 1 ? 'disabled' : ''}>−</button><input type="number" min="1" max="1000000" step="1" value="${n}" data-shop-quantity="${esc(s.id)}" aria-label="Quantity for ${name}" ${readOnly ? 'disabled' : ''}><button type="button" class="btn small" data-action="shop-plus" data-id="${esc(s.id)}" aria-label="Increase quantity for ${name}" ${readOnly ? 'disabled' : ''}>+</button></div><label class="shopping-assignment"><span class="tiny muted">Shopping list</span><select data-shop-list="${esc(s.id)}" aria-label="Shopping list for ${name}" ${readOnly ? 'disabled' : ''}>${shoppingLists()
        .map(
          l =>
            `<option value="${esc(l.id)}" ${l.id === (s.purchase?.listId || 'general') ? 'selected' : ''}>${esc(l.name)}</option>`
        )
        .join(
          ''
        )}</select></label>${readOnly ? '' : `<button type="button" class="btn small ghost shopping-delete" data-action="shop-delete" data-id="${esc(s.id)}" aria-label="Delete ${name}">${icon('trash')}</button>`}</article>`;
    })
    .join('');
}
function shoppingFinderMarkup(modalPicker = false, kind = 'part') {
  const f = modalPicker ? { query: '', maker: '', category: '', partType: '', kind } : shoppingFinder,
    groups = kind === 'supply' ? slotforgeCatalogue.supplies : slotforgeCatalogue.parts,
    where = modalPicker ? 'picker' : 'page';
  return `<div class="shopping-finder" data-shopping-finder="${where}" data-kind="${kind}"><div class="shop-finder-bar"><label class="search shop-finder-search">${icon('search')}<span class="sr-only">${modalPicker ? 'Search the catalogue' : 'Find a Part'}</span><input name="finderQuery" ${modalPicker ? '' : 'id="shopping-finder-query"'} type="search" value="${esc(f.query)}" placeholder="Name, manufacturer or product reference…" maxlength="500" autocomplete="off" aria-label="Find a Part" aria-expanded="false" aria-controls="${where}-part-matches"></label><div class="purchase-filters">${shoppingSelect('finderMaker', 'Manufacturer', f.maker ? [[f.maker, f.maker]] : [], f.maker, 'All manufacturers')}${shoppingSelect(
    'finderCategory',
    'Main group',
    Object.keys(groups).map(x => [x, x]),
    f.category,
    'All groups'
  )}${shoppingSelect(
    'finderType',
    'Part type',
    (f.category ? groups[f.category] || [] : Object.values(groups).flat()).map(x => [x, x]),
    f.partType,
    'All types'
  )}</div></div><div id="${where}-part-matches" class="shopping-matches" aria-live="polite" hidden></div></div>`;
}
// The lists as a side list: your own lists first, then the lists that come from car jobs and builds.
function shoppingListRail(lists, active, counts, openCount) {
  const item = (name, count, cls, id) =>
    btn(
      `<span class="shop-rail-name">${esc(name)}</span><span class="shop-rail-count mono">${count}</span>`,
      'shop-list',
      cls,
      id
    );
  const one = l => item(l.name, counts[l.id] || 0, l.id === active?.id ? 'active' : '', l.id);
  const own = lists.filter(l => !['job', 'build'].includes(l.source?.kind)),
    work = lists.filter(l => ['job', 'build'].includes(l.source?.kind));
  return (
    item('All Items', counts[''] ?? openCount, active ? '' : 'active') +
    (own.length ? '<span class="shop-rail-label">Lists</span>' + own.map(one).join('') : '') +
    (work.length ? '<span class="shop-rail-label">For jobs and builds</span>' + work.map(one).join('') : '')
  );
}
function renderShoppingPage() {
  if (!local()) return empty('Shopping List', 'Select your local collection to manage your shopping lists.');
  const context = db.id + '|' + dataPath;
  if (shoppingContext !== context) {
    shoppingContext = context;
    shoppingUndo = null;
    shoppingFilters.listId = '';
    Object.assign(shoppingFinder, { query: '', maker: '', category: '', partType: '', open: false });
  }
  const info = db._view?.shopping || {},
    lists = shoppingLists(),
    active = lists.find(l => l.id === shoppingFilters.listId),
    lines = db.planning.shopping.filter(l => !shopDeleted(l)),
    open = lines.filter(l => !shopDone(l)),
    done = lines.filter(shopDone),
    counts = info.listCounts || {},
    requirementSource =
      active &&
      (info.sources || []).find(o => o.listKind === active.source.kind && o.listSourceId === active.source.id);
  queueMicrotask(() => {
    const el = $('#main [data-shopping-finder]');
    if (el) void loadShoppingMatches(el, shoppingFinder.open);
  });
  return `<div class="shopping-page">${heading('Shopping List', 'Find it. List it. Tick it off.', btn(icon('plus') + ' Add shopping item', 'shop-add', 'primary'))}<div class="purchasing-layout"><aside class="purchasing-lists"><h2>Your lists</h2>${shoppingListRail(lists, active, counts, open.length)}${btn(icon('plus') + ' New list', 'shop-new-list', 'small')}${active?.source.kind === 'manual' ? btn('Rename list', 'shop-rename-list', 'small', active.id) : ''}</aside><section class="purchasing-main"><section class="shopping-search-panel"><div class="shopping-search-heading"><h2>Find a Part</h2><span class="tiny muted shop-finder-hint">Searches the whole catalogue; your list below stays as it is.</span><span class="tiny muted">Adding to <strong>${esc(active?.name || 'General shopping')}</strong></span></div>${shoppingFinderMarkup()}</section>${requirementSource ? `<div class="shopping-build-update"><span>Changed your ${requirementSource.kind === 'build' ? 'build' : 'job'}? Check its latest parts requirements.</span>${btn('Review ' + (requirementSource.kind === 'build' ? 'build' : 'job') + ' changes', 'shop-requirements', '', requirementSource.kind + ':' + requirementSource.id)}</div>` : ''}<div class="shopping-list-heading"><h2>${esc(active?.name || 'All Items')}</h2><span class="tiny muted">${counts[active?.id || ''] ?? open.length} to do</span></div>${shoppingConflicts(info.conflicts)}${shoppingUndo ? `<div class="note shopping-undo" role="status">Item deleted. Stock and history are unchanged. ${btn('Undo', 'shop-undo', 'small', shoppingUndo)}</div>` : ''}<div class="shopping-checklist">${shoppingRows(open)}${done.length ? '<h3 class="shopping-completed-heading">' + icon('check') + ' Done</h3>' + shoppingRows(done) : ''}${!lines.length ? empty('Your list is ready', 'Find a part above, or add a free-text item.') : ''}</div>${viewPager(db._view?.list)}</section></div></div>`;
}
async function loadShoppingMatches(root, expand = true) {
  if (!root?.isConnected) return;
  const serial = ++finderSerial,
    origin = db.id + '|' + dataPath,
    out = root.querySelector('.shopping-matches'),
    kind = root.dataset.kind;
  const f = {
    kind,
    query: root.querySelector('[name=finderQuery]').value.trim(),
    maker: root.querySelector('[name=finderMaker]').value,
    category: root.querySelector('[name=finderCategory]').value,
    partType: root.querySelector('[name=finderType]').value
  };
  if (root.dataset.shoppingFinder === 'page') Object.assign(shoppingFinder, f);
  const makersKey = origin + '|' + kind;
  // Closed search box (after a redraw, such as a quantity change): nothing is shown, so do
  // not search. It searches afresh as soon as it gets the focus or is typed in.
  // Only the page's own box: a dialog's picker loads its matches once, when it opens.
  if (!expand && root.dataset.shoppingFinder === 'page' && finderMakers?.key === makersKey) {
    fillFinderMakers(root, finderMakers.makers, f.maker);
    return;
  }
  if (expand) {
    out.hidden = false;
    out.textContent = 'Searching…';
    root.querySelector('[name=finderQuery]').setAttribute('aria-expanded', 'true');
  }
  const version = JSON.stringify([origin, db.revision, db._view?.token?.epoch]),
    key = JSON.stringify([version, f]);
  try {
    // Rendering and restoring input focus can request the same matches together.
    // Share that request, retaining at most one result for this exact revision.
    if (finderRequest?.key !== key) {
      const entry = { key };
      entry.promise = api('read', { queryView: { page: 'Shopping List', shoppingFinder: f } }).catch(e => {
        if (finderRequest === entry) finderRequest = null;
        throw e;
      });
      finderRequest = entry;
    }
    const result = await finderRequest.promise;
    if (serial !== finderSerial || !root.isConnected || origin !== db.id + '|' + dataPath) return;
    if (version !== JSON.stringify([origin, db.revision, db._view?.token?.epoch])) {
      void loadShoppingMatches(root, expand);
      return;
    }
    const data = result.data._view.shoppingFinder;
    finderMakers = { key: makersKey, makers: data.makers };
    fillFinderMakers(root, data.makers, f.maker);
    const picking = root.dataset.shoppingFinder === 'picker';
    const card = p =>
      `<button type="button" class="shopping-match" ${picking ? `data-pick-stock="${esc(p.id)}" data-pick-name="${esc(p.name)}"` : `data-action="shop-quick-add" data-id="${esc(p.id)}"`} title="${esc(p.name)}"><span class="shop-match-pic">${itemVisual(p)}${p.quantity > 0 ? `<span class="shop-match-stock">In stock <b class="mono">${p.quantity}</b></span>` : ''}</span><span class="shop-match-copy"><strong>${esc(p.name)}</strong><small>${esc([p.maker, p.reference].filter(Boolean).join(' · '))}</small>${p.partType ? `<small class="shop-match-type">${esc(p.partType)}</small>` : ''}</span><span class="shopping-match-action">${picking && !root.closest('.sb-win') ? 'Choose' : icon('plus') + 'Add'}</span></button>`;
    out.innerHTML = data.items.length
      ? `<div class="shop-match-head"><span><b class="mono">${data.total}</b> ${data.total === 1 ? 'match' : 'matches'}${data.total > data.items.length ? ` · showing the first <b class="mono">${data.items.length}</b>, type more to narrow it down` : ''}</span><span class="tiny muted">${root.closest('.sb-win') ? 'Each click adds one to your basket' : picking ? 'Choose one · Esc closes' : 'Each click adds one · Esc closes'}</span></div><div class="shop-match-grid">${data.items.map(card).join('')}</div>`
      : '<p>No matching parts. Try another name, reference or filter.</p>';
  } catch (e) {
    if (serial === finderSerial && root.isConnected) {
      out.hidden = false;
      out.textContent = e.message;
    }
  }
}
function shoppingPicker(kind = 'part', id = '', name = '') {
  return `<div id="shopping-picker">${shoppingFinderMarkup(true, kind)}<input type="hidden" name="stockId" value="${esc(id)}"><p id="shopping-picked" class="note">${name ? 'Selected: ' + esc(name) : 'Choose a matching item above.'}</p></div>`;
}
function styleShoppingDialog() {
  $('#dialog').classList.add('shopping-dialog');
}
async function shoppingChanged() {
  if (page === 'Workshop') await refreshJob();
  if ($('#dialog').open) return; // Closing an editor reloads its page through queryGate.
  const info = db._view?.list;
  if (page === 'Shopping List' && info && viewOffset > 0 && viewOffset >= info.total)
    viewOffset = Math.max(0, Math.floor((info.total - 1) / info.limit) * info.limit);
  if (db._view && (db._view.editor || viewKey(db._view.request) !== viewKey(desiredView()))) await loadView();
  else render();
}
function shoppingOptional(s = {}, jobId = '') {
  return `<details class="shopping-optional"><summary>Optional details</summary><div class="form-grid">${shoppingSelect(
    'jobId',
    'Linked workshop job',
    db.jobs.filter(j => j.status === 'active').map(j => [j.id, j.name]),
    jobId,
    'No linked job'
  )}${field('supplier', 'Supplier', s.supplier || '')}${purchasePriceFields(s)}${field('url', 'Purchase link', s.url || '')}${field('notes', 'Notes', s.notes || '', 'textarea')}</div></details>`;
}
// Add to shopping list, after docs/ui-reference/shopping-add-2026-11 (option B, basket): search the catalogue or
// your workshop supplies; every click on a result adds one to a basket on the right; adjust the numbers, choose
// the list once and add everything together. "Something else" adds an item of your own.
// Form names stay as before: kind, finderQuery, stockId, quantity (the line you touched last, or your own
// item's number), listId, jobId, supplier, unitPrice, currency, url and notes.
let shopBasket = [],
  shopBasketActive = -1;
function shopBasketLines() {
  const box = $('#sb-lines');
  if (!box) return;
  const free = $('#dialog [name=kind]')?.value === 'free';
  box.innerHTML = shopBasket.length
    ? shopBasket
        .map(
          (l, i) =>
            `<div class="sb-line ${i === shopBasketActive ? 'on' : ''}" data-line="${i}"><span class="sb-th">${l.visual}</span><span class="sb-copy"><b>${esc(l.name)}</b><small>${esc(l.sub || (l.kind === 'supply' ? 'Workshop supply' : 'Catalogue part'))}</small></span><span class="sb-qty"><button type="button" data-action="sb-qty" data-id="${i}|-1" aria-label="One fewer">−</button><input type="number" min="1" max="1000000" step="1" value="${l.quantity}" ${i === shopBasketActive && !free ? 'name="quantity"' : ''} data-sb-line="${i}" aria-label="How many: ${esc(l.name)}"><button type="button" data-action="sb-qty" data-id="${i}|1" aria-label="One more">+</button></span><button type="button" class="sb-remove" data-action="sb-remove" data-id="${i}" aria-label="Remove ${esc(l.name)}">×</button></div>`
        )
        .join('')
    : '<p class="sb-empty">Nothing in the basket yet. Click a part on the left; every click adds one.</p>';
  const pieces = shopBasket.reduce((n, l) => n + l.quantity, 0),
    title = $('#sb-title');
  if (title)
    title.textContent = shopBasket.length
      ? `${shopBasket.length} ${shopBasket.length === 1 ? 'item' : 'items'} · ${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`
      : 'Empty basket';
  $('#sb-empty-btn').hidden = !shopBasket.length;
  const counts = new Map(shopBasket.map(l => [l.kind + '|' + l.id, l.quantity]));
  document.querySelectorAll('#dialog .sb-win [data-pick-stock]').forEach(b => {
    const n = counts.get(($('#dialog [name=kind]').value === 'supply' ? 'supply' : 'part') + '|' + b.dataset.pickStock);
    b.classList.toggle('in-basket', !!n);
    b.querySelector('.sb-in')?.remove();
    if (n)
      b.querySelector('.shop-match-pic')?.insertAdjacentHTML('beforeend', `<span class="sb-in">${n} in basket</span>`);
  });
  const stock = $('#dialog [name=stockId]');
  if (stock) stock.value = shopBasket[shopBasketActive]?.id || '';
  const freeQty = $('#sb-free-qty');
  if (freeQty) freeQty.name = free ? 'quantity' : 'freeQuantity';
  shopBasketSummary();
}
function shopBasketSummary() {
  const free = $('#dialog [name=kind]')?.value === 'free',
    own = free && $('#dialog [name=name]')?.value.trim(),
    count = shopBasket.length + (own ? 1 : 0),
    list = $('#dialog [name=listId]'),
    listName = list?.selectedOptions[0]?.textContent || '',
    pieces = shopBasket.reduce((n, l) => n + l.quantity, 0);
  const submit = $('#dialog .dialog-footer [type=submit]');
  if (submit) submit.textContent = count > 1 ? `Add ${count} items to list` : 'Add to list';
  const sum = $('#sb-summary');
  if (sum)
    sum.innerHTML = count
      ? `<b>${pieces + (own ? Number($('#sb-free-qty')?.value) || 1 : 0)} ${pieces === 1 && !own ? 'piece' : 'pieces'}</b> across <b>${count} ${count === 1 ? 'item' : 'items'}</b> → <b>${esc(listName)}</b>`
      : 'Pick parts on the left, or choose “Something else” for an item of your own.';
  document.querySelectorAll('.sb-list').forEach(b => {
    const on = b.dataset.id === (list?.value ?? '');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function shopBasketAdd(pick) {
  const kind = $('#dialog [name=kind]').value === 'supply' ? 'supply' : 'part',
    id = pick.dataset.pickStock,
    at = shopBasket.findIndex(l => l.kind === kind && l.id === id);
  if (at >= 0) {
    shopBasket[at].quantity++;
    shopBasketActive = at;
  } else {
    const pic = pick.querySelector('.shop-match-pic')?.cloneNode(true);
    pic?.querySelectorAll('.shop-match-stock,.sb-in').forEach(e => e.remove());
    shopBasket.push({
      kind,
      id,
      name: pick.dataset.pickName,
      sub: pick.querySelector('.shop-match-copy small')?.textContent || '',
      visual: pic?.innerHTML || '',
      quantity: 1
    });
    shopBasketActive = shopBasket.length - 1;
  }
  shopBasketLines();
}
function shopListButtons(lists, value, automatic) {
  const counts = new Map();
  for (const s of db.planning?.shopping || [])
    if (!s.done) counts.set(s.purchase?.listId || 'general', (counts.get(s.purchase?.listId || 'general') || 0) + 1);
  return `<div class="sb-lists" role="group" aria-label="Shopping list">${automatic ? `<button type="button" class="sb-list" data-action="sb-list" data-id=""><i></i>${esc(automatic)}</button>` : ''}${lists
    .map(
      ([id, name]) =>
        `<button type="button" class="sb-list" data-action="sb-list" data-id="${esc(id)}" data-tone="${/rebuild|build|·/i.test(name) ? 'amber' : id === 'general' ? 'muted' : 'blue'}"><i></i>${esc(name)}<small class="mono">${counts.get(id) || 0}</small></button>`
    )
    .join('')}</div>`;
}
function addShopping(partId = '', jobId = '', quantity = 1) {
  const part = db.parts.find(p => p.id === partId),
    revision = db.revision,
    lists = shoppingLists().map(l => [l.id, l.name]),
    listValue = page === 'Shopping List' ? shoppingFilters.listId || 'general' : '',
    automatic = jobId ? 'Automatic: linked job list' : null;
  shopBasket = part
    ? [
        {
          kind: 'part',
          id: part.id,
          name: part.name,
          sub: [part.maker, part.reference].filter(Boolean).join(' · '),
          visual: itemVisual(part),
          quantity: Number(quantity) || 1
        }
      ]
    : [];
  shopBasketActive = part ? 0 : -1;
  modal(
    'Add to shopping list',
    `<div class="sb-win"><div class="sb-main"><div class="sb-kinds"><select name="kind" hidden><option value="part">Catalogue part</option><option value="supply">Workshop supply</option><option value="free">Free-text item</option></select><div class="sb-seg" role="group" aria-label="What are you adding">${[
      ['part', 'Catalogue parts'],
      ['supply', 'Workshop supplies'],
      ['free', 'Something else']
    ]
      .map(
        ([k, l]) =>
          `<button type="button" class="${k === 'part' ? 'on' : ''}" data-action="sb-kind" data-id="${k}" aria-pressed="${k === 'part'}">${l}</button>`
      )
      .join(
        ''
      )}</div></div><div data-purchase-kind="stock">${shoppingPicker('part', part?.id || '', part?.name || '')}</div><div class="sb-own" data-purchase-kind="free"><h3>Something else</h3><p class="muted">For anything that is not in your catalogue or supplies yet: name it, and add the manufacturer and reference if you know them.</p><div class="form-grid">${field('name', 'Item name')}${field('maker', 'Manufacturer (optional)')}${field('reference', 'Reference (optional)')}<label class="field">How many<input id="sb-free-qty" name="freeQuantity" type="number" min="1" max="1000000" step="1" value="1"></label></div></div></div><aside class="sb-side"><div class="sb-head"><div class="eye">Your basket</div><h3 id="sb-title"></h3><p>Every click on a part adds one. Adjust the numbers here, then add them all at once.</p></div><div class="sb-body"><div id="sb-lines" class="sb-lines"></div><div class="sb-lbl">Put them on</div><div class="sb-listbox">${shoppingSelect('listId', 'Shopping list', lists, listValue, automatic)}${shopListButtons(lists, listValue, automatic)}</div>${shoppingOptional({}, jobId)}<p class="plan-help">Adding items does not change stock. When you tick one off, you can choose to add it to your parts.</p></div><div class="sb-foot"><button type="button" class="btn small ghost" data-action="sb-empty" id="sb-empty-btn">Empty basket</button></div></aside></div>`,
    async v => {
      const free = v.kind === 'free',
        lines = [...document.querySelectorAll('#sb-lines [data-sb-line]')].map(input => ({
          ...shopBasket[Number(input.dataset.sbLine)],
          quantity: input.value
        })),
        own = free && v.name?.trim();
      if (!lines.length && !own)
        throw Error(
          free
            ? 'Name your item, or pick parts from the catalogue.'
            : 'Choose a catalogue item from the search results.'
        );
      const extra = {
          jobId: v.jobId,
          listId: v.listId,
          supplier: v.supplier,
          url: v.url,
          notes: v.notes,
          unitPrice: v.unitPrice,
          currency: v.currency
        },
        items = [
          ...lines.map(l => ({ item: { kind: l.kind, id: l.id }, quantity: l.quantity })),
          ...(own
            ? [
                {
                  item: { kind: 'free', name: v.name.trim(), maker: v.maker.trim(), reference: v.reference.trim() },
                  quantity: v.quantity
                }
              ]
            : [])
        ];
      // The first add checks the revision the window opened with; the rest follow on from it.
      for (const [i, x] of items.entries())
        await change('planning.shopping.add', { revision: i ? db.revision : revision, ...x, ...extra });
      shopBasket = [];
      shopBasketActive = -1;
      viewOffset = 0;
      await shoppingChanged();
      toast(items.length === 1 ? 'Added to your shopping list.' : `${items.length} items added to your shopping list.`);
    },
    'Add to list'
  );
  styleShoppingDialog();
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="sb-summary" id="sb-summary"></span>');
  purchaseKindFields();
  shopBasketLines();
  void loadShoppingMatches($('#dialog [data-shopping-finder]'), true);
}
function shopBasketAction(action, id) {
  if (!['sb-kind', 'sb-qty', 'sb-remove', 'sb-empty', 'sb-list'].includes(action) || !$('#dialog .sb-win'))
    return false;
  if (action === 'sb-kind') {
    const kind = $('#dialog [name=kind]');
    kind.value = id;
    kind.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (action === 'sb-qty') {
    const [i, d] = id.split('|').map(Number),
      input = $(`#sb-lines [data-sb-line="${i}"]`);
    shopBasket[i].quantity = Math.max(1, (Number(input?.value) || shopBasket[i].quantity) + d);
    shopBasketActive = i;
    shopBasketLines();
  }
  if (action === 'sb-remove') {
    shopBasket.splice(Number(id), 1);
    shopBasketActive = Math.min(shopBasketActive, shopBasket.length - 1);
    shopBasketLines();
  }
  if (action === 'sb-empty') {
    shopBasket = [];
    shopBasketActive = -1;
    shopBasketLines();
  }
  if (action === 'sb-list') {
    const list = $('#dialog [name=listId]');
    list.value = id;
    list.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}
function shoppingQuantityInput() {
  const q = $('#dialog [name=quantity]');
  if (q) {
    q.min = '1';
    q.max = '1000000';
    q.step = '1';
    q.required = true;
  }
}
function purchaseKindFields() {
  const kind = $('#dialog [name=kind]')?.value;
  if (!kind) return;
  for (const el of document.querySelectorAll('[data-purchase-kind]')) {
    el.hidden = el.dataset.purchaseKind === 'free' ? kind !== 'free' : kind === 'free';
    for (const input of el.querySelectorAll('input,select')) input.disabled = el.hidden;
  }
  const name = $('#dialog [name=name]');
  if (name) name.required = kind === 'free' && !($('#dialog .sb-win') && shopBasket.length);
  document.querySelectorAll('#dialog .sb-seg [data-action="sb-kind"]').forEach(b => {
    b.classList.toggle('on', b.dataset.id === kind);
    b.setAttribute('aria-pressed', String(b.dataset.id === kind));
  });
  const picker = $('#dialog [data-shopping-finder]');
  if (picker && kind !== 'free' && picker.dataset.kind !== kind) {
    $('#shopping-picker').outerHTML = shoppingPicker(kind);
    void loadShoppingMatches($('#dialog [data-shopping-finder]'));
  }
  if ($('#dialog .sb-win')) shopBasketLines();
}
function editShopping(id) {
  const s = db.planning.shopping.find(s => s.id === id);
  if (!s) throw Error('Shopping item not found.');
  const revision = db.revision,
    item = s.purchase?.item;
  modal(
    'Shopping item · ' + shoppingItem(s).name,
    `<div class="form-grid">${item?.kind === 'free' ? field('name', 'Item name', item.name) + field('maker', 'Manufacturer', item.maker) + field('reference', 'Reference', item.reference) : ''}${field('quantity', 'Quantity', shopQuantity(s), 'number')}${shoppingSelect(
      'listId',
      'Shopping list',
      shoppingLists().map(l => [l.id, l.name]),
      s.purchase?.listId || 'general',
      null
    )}</div><details class="shopping-optional"><summary>Optional details</summary><div class="form-grid">${field('supplier', 'Supplier', s.supplier)}${purchasePriceFields(s)}${field('url', 'Purchase link', s.url || '')}${field('notes', 'Notes', s.notes, 'textarea')}</div></details><p class="plan-help">Moving lists preserves the build or workshop link. Stock already added: ${s.received}. Changing the quantity does not change inventory.</p>${s.received || purchaseHasHistory(s) ? btn('Stock history', 'shop-history', 'small', s.id) : ''}`,
    async v => {
      const p = {
        revision,
        id,
        checklistQuantity: v.quantity,
        listId: v.listId,
        supplier: v.supplier,
        url: v.url,
        notes: v.notes,
        unitPrice: v.unitPrice,
        currency: v.currency
      };
      if (item?.kind === 'free')
        p.item = { kind: 'free', name: v.name.trim(), maker: v.maker.trim(), reference: v.reference.trim() };
      await change('planning.shopping.edit', p);
      await shoppingChanged();
    },
    'Save changes'
  );
  styleShoppingDialog();
  shoppingQuantityInput();
}
function linkShopping(id) {
  const s = db.planning.shopping.find(s => s.id === id),
    revision = db.revision;
  if (!s) throw Error('Shopping item not found.');
  modal(
    'Choose stock record · ' + shoppingItem(s).name,
    shoppingSelect(
      'kind',
      'Stock type',
      [
        ['part', 'Part'],
        ['supply', 'Workshop supply']
      ],
      'part',
      null
    ) +
      shoppingPicker() +
      '<p>This links your free-text item to an inventory record. No stock is added yet.</p><p class="muted">Need a new record? Add it in Parts or Workshop supplies with zero owned quantity, then choose it here.</p>',
    async v => {
      if (!v.stockId) throw Error('Choose a matching stock record.');
      await change('planning.shopping.edit', { revision, id, item: { kind: v.kind, id: v.stockId } });
      await shoppingChanged();
      toast('Stock record linked. You can now mark the item done and add stock.');
    },
    'Link stock record'
  );
  styleShoppingDialog();
  void loadShoppingMatches($('#dialog [data-shopping-finder]'));
}
function doneShopping(id) {
  const s = db.planning.shopping.find(s => s.id === id);
  if (!s) throw Error('Shopping item not found.');
  const revision = db.revision,
    free = s.purchase?.item.kind === 'free',
    remaining = Math.max(0, shopQuantity(s) - s.received);
  modal(
    'Done · ' + shoppingItem(s).name,
    `<p>How would you like to finish this item?</p><label class="shopping-done-choice"><input type="radio" name="doneMode" value="tick" checked><span><strong>Mark done</strong><small>Tick off this item. Keep inventory unchanged.</small></span></label><label class="shopping-done-choice"><input type="radio" name="doneMode" value="stock" ${free || !remaining ? 'disabled' : ''}><span><strong>Add to stock & mark done</strong><small>Stock already added: ${s.received}. ${remaining} remaining.</small></span></label><div id="shopping-done-stock" hidden>${field('quantity', 'Quantity to add', remaining || 1, 'number')}<label class="check-row"><input name="confirmed" type="checkbox" disabled>I have these parts and want to add this quantity to inventory.</label></div>${free ? '<p class="note">Choose a stock record first to add this free-text item to inventory.</p>' + btn('Choose stock record…', 'shop-link', '', id) : ''}<p class="plan-help">Reopening a done item never removes inventory. Parts remain available to all builds.</p>`,
    async v => {
      await change('planning.checklist.done', {
        revision,
        id,
        done: true,
        addStock: v.doneMode === 'stock',
        quantity: v.quantity,
        confirmed: !!v.confirmed
      });
      await shoppingChanged();
      toast('Item marked done.');
    },
    'Mark done'
  );
  styleShoppingDialog();
  shoppingQuantityInput();
  const q = $('#dialog [name=quantity]');
  q.max = String(remaining || 1);
  q.disabled = true;
}
function reviewShoppingRequirements() {
  const offered = db._view?.shoppingRequirements;
  if (!offered) throw Error('Reopen the build changes.');
  const revision = db.revision;
  modal(
    'Review parts · ' + offered.name,
    `<p>Choose the changes to apply. Your manual quantities, deleted items and Done ticks stay as they are unless you explicitly select a change.</p><div class="shopping-requirements" data-review-selection>${ReviewSelection.toolbar()}${offered.rows.map((r, i) => `<label class="shopping-requirement"><input type="checkbox" name="requirement${i}" data-review-choice ${r.manual ? 'data-review-manual' : ''} ${r.duplicate ? 'disabled' : ''}><span><strong>${esc(r.name)}</strong><small>${r.id ? r.current + ' → ' + (r.needed ? r.proposed : 'Done (no longer needed)') : 'Add ' + r.proposed}${r.manual ? ' · manually adjusted' : ''}${r.duplicate ? ' · duplicate entries: manage individually' : ''}</small></span></label>`).join('') || '<p>No changes to apply. Completed and deleted items are kept as you left them.</p>'}</div>`,
    offered.rows.length
      ? async v => {
          const partIds = offered.rows.filter((r, i) => v['requirement' + i]).map(r => r.partId);
          if (!partIds.length) throw Error('Select the changes you want to apply.');
          await change('planning.shopping.applyRequirements', {
            revision,
            kind: offered.kind,
            sourceId: offered.id,
            partIds
          });
          await shoppingChanged();
          toast('Selected requirement changes applied.');
        }
      : null,
    'Apply selected changes'
  );
  styleShoppingDialog();
}
async function shoppingAction(action, id) {
  if (action === 'shop-requirements') {
    reviewShoppingRequirements();
    return true;
  }
  if (action === 'shop-list') {
    shoppingFilters.listId = id || '';
    viewOffset = 0;
    render();
    return true;
  }
  if (action === 'shop-new-list' || action === 'shop-rename-list') {
    const list = shoppingLists().find(l => l.id === id),
      revision = db.revision;
    modal(
      list ? 'Rename shopping list' : 'New shopping list',
      field('name', 'List name', list?.name || ''),
      async v => {
        const key = await change('planning.list.save', { revision, ...(list ? { id } : {}), name: v.name });
        shoppingFilters.listId = key;
        await shoppingChanged();
      },
      'Save list'
    );
    styleShoppingDialog();
    $('#dialog [name=name]').required = true;
    return true;
  }
  if (action === 'shop-quick-add') {
    await change('planning.shopping.add', {
      revision: db.revision,
      item: { kind: 'part', id },
      quantity: 1,
      listId: shoppingFilters.listId || 'general'
    });
    viewOffset = 0;
    await shoppingChanged();
    toast('Added one to your shopping list.');
    return true;
  }
  if (action === 'shop-edit') {
    editShopping(id);
    return true;
  }
  if (action === 'shop-link') {
    linkShopping(id);
    return true;
  }
  if (action === 'shop-done') {
    doneShopping(id);
    return true;
  }
  if (action === 'shop-delete' || action === 'shop-undo' || action === 'shop-reopen') {
    await change(
      'planning.checklist.' + (action === 'shop-delete' ? 'delete' : action === 'shop-undo' ? 'restore' : 'done'),
      { revision: db.revision, id, ...(action === 'shop-reopen' ? { done: false } : {}) }
    );
    shoppingUndo = action === 'shop-delete' ? id : null;
    await shoppingChanged();
    if (action === 'shop-reopen') toast('Reopened. Inventory is unchanged.');
    return true;
  }
  if (action === 'shop-plus' || action === 'shop-minus') {
    const s = db.planning.shopping.find(s => s.id === id);
    if (!s) throw Error('Shopping item not found.');
    await change('planning.checklist.edit', {
      revision: db.revision,
      id,
      quantity: shopQuantity(s) + (action === 'shop-plus' ? 1 : -1)
    });
    await shoppingChanged();
    return true;
  }
  if (await shoppingOrderAction(action, id)) return true; // Historical receipt tools remain accessible.
  return false;
}
document.addEventListener('input', e => {
  const root = e.target.closest('[data-shopping-finder]');
  if (root && e.target.name === 'finderQuery') {
    if (root.dataset.shoppingFinder === 'page') {
      shoppingFinder.query = e.target.value;
      shoppingFinder.open = true;
    }
    clearTimeout(finderTimer);
    ++finderSerial;
    finderTimer = setTimeout(() => loadShoppingMatches(root), 180);
  }
});
document.addEventListener('focusin', e => {
  if (e.target.name === 'finderQuery') {
    const root = e.target.closest('[data-shopping-finder]');
    if (root?.dataset.shoppingFinder === 'page') shoppingFinder.open = true;
    void loadShoppingMatches(root);
  }
});
document.addEventListener('keydown', e => {
  const root = e.target.closest('[data-shopping-finder]');
  if (!root) return;
  if (e.key === 'Escape' && !root.closest('.sb-win')) {
    if (root.dataset.shoppingFinder === 'page') shoppingFinder.open = false;
    e.preventDefault();
    e.stopPropagation();
    root.querySelector('.shopping-matches').hidden = true;
    root.querySelector('[name=finderQuery]').setAttribute('aria-expanded', 'false');
  }
  if (e.key === 'ArrowDown' && e.target.name === 'finderQuery') {
    e.preventDefault();
    root.querySelector('.shopping-match')?.focus();
  }
  if (e.key === 'Enter' && e.target.name === 'finderQuery') {
    e.preventDefault();
    root.querySelector('.shopping-match')?.focus();
  }
});
document.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick-stock]');
  if (pick?.closest('#dialog .sb-win')) {
    shopBasketAdd(pick);
    return;
  }
  if (pick) {
    $('#dialog [name=stockId]').value = pick.dataset.pickStock;
    $('#shopping-picked').textContent = 'Selected: ' + pick.dataset.pickName;
    pick.closest('.shopping-matches').hidden = true;
    $('#dialog [name=quantity]')?.focus();
  }
  if (!e.target.closest('[data-shopping-finder]')) {
    shoppingFinder.open = false;
  }
  if (!e.target.closest('[data-shopping-finder]'))
    for (const root of document.querySelectorAll('[data-shopping-finder]')) {
      if (root.closest('.sb-win')) continue;
      root.querySelector('.shopping-matches').hidden = true;
      root.querySelector('[name=finderQuery]').setAttribute('aria-expanded', 'false');
    }
});
document.addEventListener('change', async e => {
  const root = e.target.closest('[data-shopping-finder]');
  if (root && e.target.tagName === 'SELECT') {
    if (e.target.name === 'finderCategory') {
      const groups = root.dataset.kind === 'supply' ? slotforgeCatalogue.supplies : slotforgeCatalogue.parts,
        group = e.target.value;
      root.querySelector('[name=finderType]').innerHTML =
        '<option value="">All types</option>' +
        (group ? groups[group] || [] : Object.values(groups).flat())
          .map(t => '<option>' + esc(t) + '</option>')
          .join('');
    }
    void loadShoppingMatches(root);
  }
  if (e.target.matches('#dialog [name=kind]')) purchaseKindFields();
  if (e.target.name === 'doneMode') {
    const adding = e.target.value === 'stock';
    $('#shopping-done-stock').hidden = !adding;
    for (const el of $('#shopping-done-stock').querySelectorAll('input')) {
      el.disabled = !adding;
      el.required = adding;
    }
    $('#modal-form [type=submit]').textContent = adding ? 'Add to stock & mark done' : 'Mark done';
  }
  const id = e.target.dataset.shopQuantity || e.target.dataset.shopList;
  if (!id) return;
  if (actionBusy || modalSaving) {
    render();
    return;
  }
  actionBusy = true;
  try {
    if (e.target.dataset.shopQuantity && !e.target.reportValidity()) return;
    await change('planning.checklist.edit', {
      revision: db.revision,
      id,
      ...(e.target.dataset.shopQuantity ? { quantity: e.target.value } : { listId: e.target.value })
    });
    await shoppingChanged();
  } catch (error) {
    toast(error.message, true);
    await loadView();
  } finally {
    actionBusy = false;
  }
});
document.getElementById('dialog').addEventListener('close', () => {
  if (!$('#dialog').open) $('#dialog').classList.remove('shopping-dialog');
});

// Basket window: typing a number, naming your own item or choosing a list updates the basket and summary.
document.addEventListener('input', e => {
  if (!e.target.closest?.('#dialog .sb-win')) return;
  const line = e.target.dataset?.sbLine;
  if (line !== undefined) {
    shopBasket[Number(line)].quantity = Math.max(1, Number(e.target.value) || 1);
    if (shopBasketActive !== Number(line)) {
      shopBasketActive = Number(line);
      shopBasketLines();
      $(`#sb-lines [data-sb-line="${line}"]`)?.focus();
    } else shopBasketSummary();
  } else if (['name', 'quantity', 'freeQuantity'].includes(e.target.name)) shopBasketSummary();
});
document.addEventListener('change', e => {
  if (e.target.name === 'listId' && e.target.closest?.('#dialog .sb-win')) shopBasketSummary();
});
