'use strict';
uiIcons.sliders = '<path d="M4 6h5m4 0h7M4 12h9m4 0h3M4 18h2m4 0h10M9 3v6m4 0V3m0 6v6m4 0V9M6 15v6m4 0v-6"/>';
let carFiltersOpen = false,
  carSavedView = '';
function carCollectionTabs() {
  if (!local() || !wishlistUi) return '';
  const counts =
    db._view?.carCounts ||
    Object.fromEntries(
      ['collection', 'wishlist'].map(s => [
        s,
        current().cars.filter(c => !c.archived && (c.collectionStatus || 'collection') === s).length
      ])
    );
  return `<div class="car-membership-tabs" aria-label="Car collection">${[
    ['collection', 'car', 'My Cars'],
    ['wishlist', 'bookmark', 'Wishlist']
  ]
    .map(
      ([s, i, label]) =>
        `<button type="button" class="btn ${carListStatus() === s ? 'active' : ''}" data-action="cars-tab" data-id="${s}" aria-pressed="${carListStatus() === s}">${icon(i)}${label}<span class="cars-tab-count">${counts[s] ?? 0}</span></button>`
    )
    .join('')}</div>`;
}
function carPageInfo() {
  const list = local() && db._view?.list;
  return list || { offset: 0, limit: 48, total: filteredCars().length, nextOffset: null };
}
function carRange() {
  const i = carPageInfo();
  return i.total
    ? `<strong>${i.offset + 1}–${Math.min(i.total, i.offset + (local() && db._view?.list ? i.limit : i.total))}</strong> of ${i.total} cars`
    : 'No matching cars';
}
function carPagination(position) {
  const i = carPageInfo();
  if (!local() || !db._view?.list || i.total <= i.limit) return '';
  const pageNumber = Math.floor(i.offset / i.limit) + 1,
    pages = Math.ceil(i.total / i.limit),
    numbers = [
      ...new Set([1, pages, pageNumber - 1, pageNumber, pageNumber + 1].filter(n => n >= 1 && n <= pages))
    ].sort((a, b) => a - b);
  let previous = 0;
  return `<nav class="cars-pagination" aria-label="Car pages ${position}"><button type="button" class="btn" data-action="query-prev" ${i.offset ? '' : 'disabled'} aria-label="Previous page">${icon('arrow')} Previous</button>${numbers
    .map(n => {
      const gap = previous && n - previous > 1;
      previous = n;
      return `${gap ? '<span class="muted" aria-hidden="true">…</span>' : ''}<button type="button" class="btn ${n === pageNumber ? 'primary' : ''}" data-action="cars-page" data-id="${(n - 1) * i.limit}" aria-label="Page ${n}" ${n === pageNumber ? 'aria-current="page"' : ''}>${n}</button>`;
    })
    .join(
      ''
    )}<button type="button" class="btn" data-action="query-next" ${i.nextOffset === null ? 'disabled' : ''} aria-label="Next page">Next ${icon('next')}</button></nav>`;
}
function carFilterChips() {
  return `${query ? btn('Search: ' + esc(query) + ' ×', 'cars-clear-query', 'small') : ''}${usage.map(u => btn(esc(u) + ' ×', 'usage', 'small', u)).join('')}${archived ? btn((wishlistTab() ? 'Archived' : 'Archived / rebuilt') + ' ×', 'cars-clear-archived', 'small') : ''}${query || usage.length || archived ? btn('Clear filters', 'cars-clear-filters', 'small ghost') : ''}`;
}
function renderCarsBrowser() {
  const allUsage = [
      ...new Set([
        ...usageDefaults,
        ...(local() && db._view?.usage
          ? db._view.usage
          : current()
              .cars.filter(c => (c.collectionStatus || 'collection') === carListStatus())
              .flatMap(c => c.usage || []))
      ])
    ],
    i = carPageInfo();
  const sortOptions = Object.entries(CarSort.fields)
    .flatMap(([key, label]) =>
      ['asc', 'desc'].map(direction => {
        const temporal = ['created', 'updated'].includes(key),
          name = key === 'created' ? 'Date added' : key === 'updated' ? 'Date changed' : label;
        return `<option value="${key}:${direction}" ${sort === key && sortDirection === direction ? 'selected' : ''}>${esc(name)} · ${temporal ? (direction === 'desc' ? 'Newest first' : 'Oldest first') : direction === 'desc' ? 'Z–A' : 'A–Z'}</option>`;
      })
    )
    .join('');
  return `<section class="cars-browser" aria-label="Car collection browser"><div class="cars-heading"><div class="page-heading">${uiTile(wishlistTab() ? 'bookmark' : 'car', 'accent')}<div><h1>${wishlistTab() ? 'Wishlist' : 'Cars'}</h1><p>${wishlistTab() ? 'Plan your collection.' : 'Your collection, organised.'}</p></div></div>${carCollectionTabs()}${local() ? `<div class="cars-add">${btn(icon('plus') + (wishlistTab() ? ' Add to Wishlist' : ' Add car'), 'add-car', 'primary')}</div>` : ''}</div>
 <div class="cars-toolbar"><label class="search cars-search">${icon('search')}<input id="car-search" value="${esc(query)}" placeholder="Search name, manufacturer or reference…" aria-label="Search cars"></label><button type="button" class="btn" data-action="cars-filters" aria-expanded="${carFiltersOpen}" aria-controls="cars-filter-panel">${icon('sliders')} Filters</button><label class="cars-sort">Sort <select id="cars-sort" aria-label="Sort cars">${sortOptions}</select></label><div class="segment" aria-label="Car display"><button type="button" class="btn ${mode === 'gallery' ? 'on' : ''}" data-action="mode" data-id="gallery" aria-pressed="${mode === 'gallery'}">${icon('grid')} Gallery</button><button type="button" class="btn ${mode === 'table' ? 'on' : ''}" data-action="mode" data-id="table" aria-pressed="${mode === 'table'}">${icon('list')} Table</button></div></div>
 <div id="cars-filter-panel" class="cars-filter-panel" ${carFiltersOpen ? '' : 'hidden'}><label class="cars-saved-view">Saved view <select id="saved-view" aria-label="Saved view"><option value="">All cars</option>${current()
   .views.filter(v => (v.collectionStatus || 'collection') === carListStatus())
   .map(v => `<option value="${esc(v.id)}" ${carSavedView === v.id ? 'selected' : ''}>${esc(v.name)}</option>`)
   .join(
     ''
   )}</select></label><div class="cars-usage" aria-label="Usage filters">${allUsage.map(u => `<button type="button" class="chip ${usage.includes(u) ? 'on' : ''}" aria-pressed="${usage.includes(u)}" data-action="usage" data-id="${esc(u)}">${esc(u)}</button>`).join('')}</div><select id="match" aria-label="Usage match"><option value="any">Match any</option><option value="all" ${matchAll ? 'selected' : ''}>Match all</option></select><label class="check-row tiny"><input id="archived" type="checkbox" ${archived ? 'checked' : ''}>${wishlistTab() ? 'Archived' : 'Archived / rebuilt'}</label></div>
 <div class="cars-active-filters" ${query || usage.length || archived ? '' : 'hidden'}>${carFilterChips()}</div>
 <div class="cars-results-bar"><div class="cars-results-tools"><span class="cars-result-range" aria-live="polite">${carRange()}</span>${local() ? `<details class="cars-menu"><summary>Select ▾</summary><div class="cars-menu-items">${btn('Select this page (' + Math.min(i.limit, i.total - i.offset) + ')', 'cars-select-page')}${btn('Select all matching cars (' + i.total + ')', 'select-filtered')}${btn('Clear selection', 'clear-selection')}</div></details><details class="cars-menu"><summary>View options ▾</summary><div class="cars-menu-items">${btn('Columns…', 'configure-columns')}${btn('Save current view…', 'save-view')}${btn('Print / PDF…', 'reports')}${btn('Compare cars…', 'car-compare')}${wishlistTab() ? '' : btn('Compare pace…', 'compare-pace')}</div></details>` : ''}</div>${carPagination('top')}</div>
 <div id="cars-results">${renderCarResults()}</div>${local() && i.total > i.limit ? `<div class="cars-results-bar cars-results-bottom"><span class="cars-result-range">${carRange()}</span>${carPagination('bottom')}</div>` : ''}</section>`;
}
async function carBrowserAction(action, id) {
  if (action === 'cars-filters') {
    carFiltersOpen = !carFiltersOpen;
    const panel = $('#cars-filter-panel');
    if (panel) panel.hidden = !carFiltersOpen;
    document.querySelector('[data-action="cars-filters"]')?.setAttribute('aria-expanded', String(carFiltersOpen));
    return true;
  }
  if (action === 'cars-select-page') {
    if (local()) {
      clearTimeout(viewTimer);
      await loadView();
    }
    selected = new Set(filteredCars().map(c => c.id));
    render();
    return true;
  }
  if (action === 'cars-page') {
    const info = carPageInfo(),
      offset = Number(id);
    if (!local() || !Number.isSafeInteger(offset) || offset < 0 || offset >= info.total || offset % info.limit)
      return true;
    viewOffset = offset;
    await loadView(desiredView(), db._view.token);
    $('.cars-results-bar')?.scrollIntoView({ block: 'start' });
    return true;
  }
  if (['cars-clear-query', 'cars-clear-archived', 'cars-clear-filters'].includes(action)) {
    if (action !== 'cars-clear-archived') query = '';
    if (action !== 'cars-clear-query') archived = false;
    if (action === 'cars-clear-filters') {
      usage = [];
      matchAll = false;
    }
    selected.clear();
    carSavedView = '';
    render();
    return true;
  }
  return false;
}
function refreshRemoteCarsSearch() {
  const input = $('#car-search'),
    position = input?.selectionStart;
  render();
  $('#car-search')?.focus();
  if (position !== null && position !== undefined) $('#car-search')?.setSelectionRange(position, position);
}
document.addEventListener('click', event => {
  const menu = event.target.closest('.cars-menu');
  for (const other of document.querySelectorAll('.cars-menu[open]'))
    if (other !== menu || event.target.closest('button')) other.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const menu = event.target.closest('.cars-menu[open]');
    if (menu) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  }
});
