let partCategory = '',
  partTypeFilter = '',
  partMakerFilter = '',
  toolboxTab = 'Jobs',
  supplyQuery = '',
  supplyCategory = '',
  supplyArchived = false,
  supplyLow = false,
  inventoryPhoto = '';
function itemVisual(p, large = false) {
  return (
    '<div class="item-visual ' +
    (large ? 'large ' : '') +
    (p.picture ? 'has-photo' : '') +
    '" data-icon-colour="' +
    iconColour(p) +
    '">' +
    (p.picture ? '<img src="' + esc(p.picture) + '" alt="' + esc(p.name) + '">' : itemIcon(p)) +
    '</div>'
  );
}
function categorySelect(name, label, value, values, blank = false) {
  return (
    '<label class="field">' +
    esc(label) +
    '<select name="' +
    name +
    '" id="' +
    name +
    '">' +
    (blank ? '<option value="">All categories</option>' : '') +
    values
      .map(v => '<option value="' + esc(v) + '" ' + (v === value ? 'selected' : '') + '>' + esc(v) + '</option>')
      .join('') +
    '</select></label>'
  );
}
function photoEditor(item) {
  return (
    '<div class="row mt"><div id="item-photo-preview">' +
    itemVisual({ ...item, name: 'Selected photograph', picture: inventoryPhoto }) +
    '</div>' +
    btn('Choose photograph', 'item-photo') +
    btn('Remove photograph', 'item-photo-remove') +
    '</div>'
  );
}
function stockSuggestions(kind, key) {
  return (
    db._view?.[kind === 'parts' ? 'partSuggestions' : 'supplySuggestions']?.[key] ||
    db[kind].map(p => p[key]).filter(Boolean)
  );
}
function partTypeInput(category, value = '') {
  return field('partType', 'Part type', value, 'text', [
    ...(slotforgeCatalogue.parts[category] || []),
    ...(db._view?.partSuggestions?.typesByCategory || db.parts)
      .filter(p => p.category === category)
      .map(p => p.partType)
      .filter(Boolean)
  ]);
}
function editPart(id) {
  const fromLibrary = page === 'Library' && libraryTab === 'parts',
    revision = db.revision,
    p = id
      ? db.parts.find(p => p.id === id)
      : { quantity: 1, tracking: 'quantity', condition: 'New', category: partCategory || 'Other & custom parts' };
  inventoryPhoto = p.picture || '';
  modal(
    id ? 'Edit part' : fromLibrary ? 'Add catalogue entry' : 'Add parts',
    '<div class="form-grid">' +
      field('name', 'Part name', p.name || '', 'text', stockSuggestions('parts', 'name')) +
      categorySelect('category', 'Category', p.category, Object.keys(slotforgeCatalogue.parts)) +
      '<div id="part-type-field">' +
      partTypeInput(p.category, p.partType || '') +
      '</div>' +
      field('maker', 'Manufacturer', p.maker || '', 'text', stockSuggestions('parts', 'maker').filter(Boolean)) +
      field('tracking', 'Tracking', p.tracking, 'select', ['quantity', 'individual']) +
      field('quantity', 'Owned quantity (individual pieces)', p.quantity, 'number') +
      field('reference', 'Product reference / individual identifier', p.reference || '') +
      field('scale', 'Scale', p.scale || '', 'text', ['1:24', '1:32', '1:43', 'HO']) +
      field('dimensions', 'Dimensions', p.dimensions || '') +
      field(
        'material',
        'Material / compound',
        p.material || '',
        'text',
        stockSuggestions('parts', 'material').filter(Boolean)
      ) +
      field('compatibility', 'Compatibility notes', p.compatibility || '') +
      field('condition', 'Condition', p.condition, 'text', ['New', 'Used', 'Needs inspection']) +
      field('location', 'Storage location', p.location || '', 'text', stockSuggestions('parts', 'location')) +
      field('notes', 'Notes', p.notes || '', 'textarea') +
      '</div>' +
      appearanceEditor(p) +
      photoEditor(p),
    async values => {
      partId = await change('part.save', { id, revision, data: { ...values, picture: inventoryPhoto } });
      if (fromLibrary) {
        page = 'Library';
        libraryTab = 'parts';
        return;
      }
      page = 'Parts';
      partsTab = 'Stock';
      const saved = db.parts.find(item => item.id === partId) || {
        quantity: Number(values.quantity) || 0,
        category: values.category || ''
      };
      if (saved.quantity === 0) stockScope = 'catalogue';
      partCategory = saved.category;
      partTypeFilter = '';
      partMakerFilter = '';
      partQuery = '';
    },
    'Save part'
  );
  const quantityInput = $('#dialog [name=quantity]');
  quantityInput.required = true;
  quantityInput.step = '1';
}
let stockScope = 'owned',
  partsLayout = 'list';
const stockItems = () => db.parts.filter(p => stockScope !== 'owned' || p.quantity > 0);
// The one control row of the Parts page (Control Strip): what to show, then search and manufacturer.
function partsScopeSwitch() {
  const assemblies = db._view?.assemblies ?? liveAssemblies().length,
    on = (kind, id) =>
      kind === 'tab'
        ? id === 'Stock'
          ? partsTab === 'Stock' && stockScope === 'owned'
          : partsTab === id
        : partsTab === 'Stock' && stockScope === id;
  const one = (kind, id, label, extra = '') =>
    `<button type="button" class="btn ${on(kind, id) ? 'on active' : ''}" data-action="${kind === 'tab' ? 'parts-tab' : 'stock-scope'}" data-id="${id}" aria-pressed="${on(kind, id)}">${label}${extra}</button>`;
  return `<span class="segment parts-scope" role="group" aria-label="Show">${one('tab', 'Stock', 'My stock')}${one('scope', 'catalogue', 'Catalogue')}${one('tab', 'Assemblies', 'Assemblies', ` <span class="mono">${assemblies}</span>`)}</span>`;
}
function stockTabs() {
  return partsScopeSwitch();
}
function partsHeading() {
  const note =
    partsTab === 'Assemblies'
      ? 'Components joined into one physical unit, ready to install, transfer or dismantle.'
      : stockScope === 'catalogue'
        ? 'Every part record, owned or not: references, manufacturers and catalogue details.'
        : 'The parts you own, sorted into main groups. Open a group, or search everything at once.';
  const actions =
    partsTab === 'Assemblies'
      ? btn(icon('plus') + ' Build assembly', 'add-assembly', 'primary') +
        btn('Import Parts List', 'nav', 'outline', 'Import & Export')
      : btn(icon('plus') + ' Add parts', 'add-part', 'primary') +
        btn('Import Parts List', 'nav', 'outline', 'Import & Export');
  return heading('Parts', note, actions);
}
function partGroups() {
  return [
    ...new Set([
      ...Object.keys(slotforgeCatalogue.parts),
      ...(db._view?.groups?.map(g => g.category) || db.parts.map(p => p.category))
    ])
  ];
}
function partGroupFigures(category) {
  const items = stockItems().filter(p => p.category === category),
    g = db._view?.groups?.find(g => g.category === category),
    count = g?.count ?? items.length,
    free = g?.available ?? items.reduce((n, p) => n + available(p), 0),
    total = g?.quantity ?? items.reduce((n, p) => n + p.quantity, 0);
  return { count, free, fitted: total - free };
}
// The overview: one Entry Card per main group.
function partGroupCards() {
  return (
    '<div class="part-group-grid ' +
    (stockScope === 'catalogue' ? 'catalogue-groups' : 'stock-groups') +
    '">' +
    partGroups()
      .map(category => {
        const types = slotforgeCatalogue.parts[category] || [],
          { count, free, fitted } = partGroupFigures(category);
        return (
          '<button type="button" class="part-group-card ' +
          (count ? '' : 'is-empty') +
          '" data-action="part-group" data-id="' +
          esc(category) +
          '"><span class="pg-head">' +
          itemVisual({ category, partType: types[0] || '' }) +
          '<span class="pg-title"><span class="pg-eye">' +
          types.length +
          ' part ' +
          (types.length === 1 ? 'type' : 'types') +
          '</span><strong>' +
          esc(category) +
          '</strong></span></span><span class="pg-types">' +
          esc(types.slice(0, 4).join(' · ')) +
          (types.length > 4 ? '…' : '') +
          '</span><span class="pg-facts"><span class="pg-count"><b class="mono">' +
          count +
          '</b> part record' +
          (count === 1 ? '' : 's') +
          '</span><span class="pg-stock">' +
          (count
            ? '<span class="mono">' +
              free +
              '</span> available · <span class="mono">' +
              fitted +
              '</span> fitted / reserved'
            : stockScope === 'catalogue'
              ? 'No catalogue entries yet'
              : 'Ready for your first part') +
          '</span></span><span class="pg-foot">Open' +
          icon('next') +
          '</span></button>'
        );
      })
      .join('') +
    '</div>'
  );
}
// Inside a group: the main groups as a side list (Paddock Rail).
function partGroupRail() {
  const current = !partQuery.trim() ? partCategory : '';
  return (
    '<nav class="parts-rail" aria-label="Main groups"><span class="parts-rail-label">Main groups</span>' +
    '<button type="button" class="parts-rail-item" data-action="part-groups">' +
    icon('grid') +
    '<span>All groups</span></button>' +
    partGroups()
      .map(category => {
        const { count } = partGroupFigures(category),
          on = category === current;
        return (
          '<button type="button" class="parts-rail-item ' +
          (on ? 'on' : '') +
          '" data-action="part-group" data-id="' +
          esc(category) +
          '" aria-current="' +
          (on ? 'true' : 'false') +
          '">' +
          itemVisual({ category, partType: (slotforgeCatalogue.parts[category] || [])[0] || '' }) +
          '<span>' +
          esc(category) +
          '</span><b class="mono">' +
          count +
          '</b></button>'
        );
      })
      .join('') +
    '</nav>'
  );
}
function partLayoutSwitch() {
  return (
    '<span class="segment" role="group" aria-label="Layout">' +
    [
      ['list', 'List', 'list'],
      ['grid', 'Grid', 'grid']
    ]
      .map(
        ([id, label, ic]) =>
          '<button type="button" class="btn ' +
          (partsLayout === id ? 'on' : '') +
          '" data-action="parts-layout" data-id="' +
          id +
          '" aria-pressed="' +
          (partsLayout === id) +
          '">' +
          icon(ic) +
          label +
          '</button>'
      )
      .join('') +
    '</span>'
  );
}
function partSubline(p, searching) {
  return [searching ? p.category : '', p.location].filter(Boolean).join(' · ');
}
function partList(list, searching) {
  if (partsLayout === 'grid')
    return (
      '<div class="part-cards">' +
      list
        .map(
          p =>
            '<button type="button" class="part-card part-select-row ' +
            (p.id === partId ? 'selected' : '') +
            '" data-action="select-part" data-id="' +
            esc(p.id) +
            '"><span class="part-card-visual">' +
            itemVisual(p) +
            '</span><span class="part-card-body"><strong>' +
            esc(p.name) +
            '</strong>' +
            [
              ['Type', p.partType, ''],
              ['Manufacturer', p.maker, ''],
              ['Reference', p.reference, 'mono'],
              ['Available', String(available(p)), 'mono']
            ]
              .filter(([, v]) => v)
              .map(
                ([l, v, k]) =>
                  '<span class="card-row"><span>' + l + '</span><b class="' + k + '">' + esc(v) + '</b></span>'
              )
              .join('') +
            '</span></button>'
        )
        .join('') +
      '</div>'
    );
  return (
    '<div class="table-wrap part-sheet"><table><thead><tr><th>Part</th><th>Type</th><th>Manufacturer</th><th>Reference</th><th class="num">Available</th><th class="num">Fitted / reserved</th></tr></thead><tbody>' +
    list
      .map(
        p =>
          '<tr data-action="select-part" data-id="' +
          esc(p.id) +
          '" class="part-select-row ' +
          (p.id === partId ? 'selected' : '') +
          '"><td><div class="item-row">' +
          itemVisual(p) +
          '<div>' +
          btn(esc(p.name), 'select-part', 'table-name', p.id) +
          (partSubline(p, searching) ? '<div class="tiny muted">' + esc(partSubline(p, searching)) + '</div>' : '') +
          '</div></div></td><td>' +
          esc(p.partType || '—') +
          '</td><td>' +
          esc(p.maker || '—') +
          '</td><td class="mono">' +
          esc(p.reference || '—') +
          '</td><td class="num mono">' +
          available(p) +
          '</td><td class="num mono">' +
          (p.quantity - available(p)) +
          '</td></tr>'
      )
      .join('') +
    '</tbody></table></div>'
  );
}
function partInspector(p) {
  if (!p)
    return '<aside class="part-inspector is-empty"><p class="muted">Choose a part to see its photograph, specifications, stock and where it is fitted.</p></aside>';
  const rows = [
    ['Manufacturer', p.maker, ''],
    ['Reference', p.reference, 'mono'],
    ['Scale', p.scale, 'mono'],
    ['Dimensions', p.dimensions, 'mono'],
    ['Material / compound', p.material, ''],
    ['Compatibility', p.compatibility, ''],
    ['Condition', p.condition, ''],
    ['Tracking', p.tracking, ''],
    ['Location', p.location, ''],
    ['Available', String(available(p)), 'mono'],
    ['Fitted / reserved', String(p.quantity - available(p)), 'mono']
  ].filter(([, v]) => v);
  const history = db.installations.filter(i => i.partId === p.id);
  return (
    '<aside class="part-inspector">' +
    itemVisual(p, true) +
    '<div class="part-inspector-body"><span class="part-inspector-eye">' +
    esc([p.category, p.partType].filter(Boolean).join(' · ')) +
    '</span><h3>' +
    esc(p.name) +
    '</h3>' +
    rows
      .map(([l, v, k]) => '<div class="card-row"><span>' + l + '</span><b class="' + k + '">' + esc(v) + '</b></div>')
      .join('') +
    catalogueDetails(p) +
    (p.notes ? '<p class="prewrap part-inspector-notes">' + esc(p.notes) + '</p>' : '') +
    '</div><div class="part-inspector-actions">' +
    (available(p) > 0 ? btn('Install on car', 'install-stock', 'primary small', p.id) : '') +
    stockEditAction(p) +
    purchaseStockActions(p) +
    btn('Icon & colour', 'part-appearance', 'small ghost', p.id) +
    binBtn('Delete part…', 'delete-part', p.id) +
    '</div><div class="part-inspector-history"><h4>Installation history</h4>' +
    (history.length
      ? history
          .map(
            i =>
              '<div class="list-row"><div>' +
              esc(db.cars.find(c => c.id === i.carId)?.name) +
              '<div class="tiny muted">' +
              i.quantity +
              ' piece(s) · ' +
              date(i.installed) +
              ' · ' +
              (i.removed ? 'Removed' : 'Installed') +
              '</div></div></div>'
          )
          .join('')
      : '<p class="tiny muted">Not fitted to a car yet.</p>') +
    viewPager(db._view?.partHistory) +
    '</div></aside>'
  );
}
function renderStock() {
  if (!local()) return empty('Inventory stays with its owner', 'Switch to your local database to manage parts.');
  if (stockScope === 'shopping')
    return (
      heading('Shopping list', 'Plan purchases, then record parts as they arrive.') +
      stockTabs() +
      shoppingList() +
      viewPager(db._view?.list)
    );
  const searching = !!partQuery.trim(),
    folders = !partCategory && !searching && !partTypeFilter && !partMakerFilter,
    list = stockItems().filter(
      p =>
        (!db._view?.partIds || db._view.partIds.includes(p.id)) &&
        (!partCategory || p.category === partCategory) &&
        (!partTypeFilter || p.partType === partTypeFilter) &&
        (!partMakerFilter || (p.maker || '').toLowerCase() === partMakerFilter.toLowerCase()) &&
        [p.name, p.category, p.partType, p.maker, p.reference, p.location, p.compatibility]
          .join(' ')
          .toLowerCase()
          .includes(partQuery.trim().toLowerCase())
    ),
    p = folders ? null : db.parts.find(p => p.id === partId);
  const makers =
    db._view?.partMakers ||
    [
      ...new Map(
        stockItems()
          .filter(p => p.maker)
          .map(p => [p.maker.toLowerCase(), p.maker])
      ).values()
    ].sort((a, b) => a.localeCompare(b));
  const makerFilter =
    '<label class="parts-field"><span class="sr-only">Manufacturer</span><select id="part-maker-filter" aria-label="Manufacturer"><option value="">All manufacturers</option>' +
    [...new Map([...makers, ...(partMakerFilter ? [partMakerFilter] : [])].map(m => [m.toLowerCase(), m])).values()]
      .map(
        m => '<option value="' + esc(m) + '" ' + (m === partMakerFilter ? 'selected' : '') + '>' + esc(m) + '</option>'
      )
      .join('') +
    '</select></label>';
  const strip =
    '<div class="parts-strip">' +
    stockTabs() +
    '<div class="parts-strip-tools"><label class="search parts-search">' +
    icon('search') +
    '<input id="part-search" value="' +
    esc(partQuery) +
    '" placeholder="' +
    (stockScope === 'catalogue' ? 'Search the catalogue…' : 'Search all parts, references or locations…') +
    '" aria-label="Search all parts"></label>' +
    makerFilter +
    '</div></div>';
  const total = db._view?.groups?.reduce((n, g) => n + g.count, 0) ?? stockItems().length;
  if (folders)
    return (
      partsHeading() +
      strip +
      '<div class="section-heading parts-groups-head"><h2>Main groups</h2><span class="muted"><span class="mono">' +
      total +
      '</span> part records · <span class="mono">' +
      partGroups().length +
      '</span> groups</span></div>' +
      (stockScope === 'owned' && !total
        ? '<div class="parts-empty-note"><div><strong>No parts in your stock yet</strong><span>Add the parts you own, or find them in the catalogue and choose Add to my stock.</span></div>' +
          btn('Browse the catalogue', 'stock-scope', 'outline', 'catalogue') +
          '</div>'
        : '') +
      partGroupCards() +
      '<p class="footer-note">Counts show part records; stock quantities count individual pieces. Assemblies have their own view.</p>'
    );
  const shown = db._view?.list?.total ?? list.length;
  const types = (
    db._view?.partTypes ||
    [
      ...new Set(
        db.parts
          .filter(p => !partCategory || p.category === partCategory)
          .map(p => p.partType)
          .filter(Boolean)
      )
    ].sort()
  )
    .map(t => '<option ' + (t === partTypeFilter ? 'selected' : '') + '>' + esc(t) + '</option>')
    .join('');
  const groupHead =
    '<div class="parts-group-head"><div><span class="parts-group-eye">' +
    (stockScope === 'catalogue' ? 'Catalogue' : 'My stock') +
    '</span><h2>' +
    (searching ? 'Search results' : esc(partCategory || 'All parts')) +
    '</h2><span class="muted"><span class="mono">' +
    shown +
    '</span> part record' +
    (shown === 1 ? '' : 's') +
    '</span></div><div class="parts-group-tools">' +
    categorySelect('part-category-filter', 'Group', partCategory, partGroups(), true) +
    '<label class="field">Part type<select id="part-type-filter"><option value="">All types</option>' +
    types +
    '</select></label>' +
    partLayoutSwitch() +
    '</div></div>';
  const body = list.length
    ? partList(list, searching)
    : empty(
        searching || partTypeFilter || partMakerFilter ? 'No matching parts' : 'This group is empty',
        searching || partTypeFilter
          ? 'Try another search, manufacturer or part type.'
          : 'Add a part to start filling this group.',
        btn('Add parts', 'add-part', 'primary')
      );
  return (
    partsHeading() +
    strip +
    '<div class="parts-shell">' +
    partGroupRail() +
    '<div class="parts-main">' +
    groupHead +
    '<div class="part-layout ' +
    (p ? '' : 'no-selection') +
    '"><div>' +
    body +
    viewPager(db._view?.list) +
    '</div>' +
    partInspector(p) +
    '</div></div></div><p class="footer-note">Stock quantities count individual pieces. Tools and consumables live in Workshop → Workshop supplies.</p>'
  );
}

function toolboxTabs() {
  return (
    '<div class="tabs">' +
    ['Jobs', 'Workshop supplies', 'Manuals and Part Guides']
      .map(
        t =>
          '<button data-action="toolbox-tab" data-id="' +
          t +
          '" class="' +
          (toolboxTab === t ? 'active' : '') +
          '">' +
          icon(t === 'Jobs' ? 'tool' : t === 'Workshop supplies' ? 'box' : 'photos') +
          t +
          '</button>'
      )
      .join('') +
    '</div>'
  );
}
function renderWorkshop() {
  if (!local()) return empty('Workshop records are local', 'Switch to your local database to use your toolbox.');
  if (workshopJob) return renderJob();
  return toolboxTab === 'Manuals and Part Guides'
    ? renderGuides()
    : toolboxTab === 'Workshop supplies'
      ? renderSupplies()
      : renderWorkshopJobs();
}
const lowSupply = s =>
  s.kind === 'Consumable' && s.remaining !== null && s.minimum !== null && s.remaining <= s.minimum;
function supplyAmount(s) {
  return s.kind === 'Consumable'
    ? s.remaining === null
      ? 'Amount not recorded'
      : s.remaining + ' ' + s.unit
    : s.quantity + ' item(s)';
}
function supplyCards() {
  const list = db.supplies.filter(
    s =>
      s.archived === supplyArchived &&
      (!supplyCategory || s.category === supplyCategory) &&
      (!supplyLow || lowSupply(s)) &&
      [s.name, s.partType, s.maker, s.reference, s.location].join(' ').toLowerCase().includes(supplyQuery.toLowerCase())
  );
  return list.length
    ? '<div class="toolbox-grid">' +
        list
          .map(
            s =>
              '<section class="panel"><div class="item-row">' +
              itemVisual(s) +
              '<div><h2>' +
              esc(s.name) +
              '</h2><div class="tiny muted">' +
              esc(s.category) +
              ' · ' +
              esc(s.partType || s.kind) +
              '</div></div></div><div class="row mt">' +
              badge(supplyAmount(s), lowSupply(s) ? 'low-stock' : '') +
              (lowSupply(s) ? badge('Low stock', 'low-stock') : '') +
              '</div>' +
              dl([
                ['Quantity', String(s.quantity)],
                ['Location', s.location],
                ['Condition', s.condition],
                ['Low-stock threshold', s.minimum === null ? 'Not set' : s.minimum + ' ' + s.unit]
              ]) +
              catalogueDetails(s) +
              '<p class="prewrap muted">' +
              esc(s.notes) +
              '</p><div class="actions">' +
              btn(s.kind === 'Consumable' ? 'Update amount / edit' : 'Edit item', 'edit-supply', 'small', s.id) +
              btn(s.archived ? 'Restore' : 'Archive…', 'archive-supply', 'small', s.id) +
              binBtn('Delete supply…', 'delete-supply', s.id) +
              '</div>' +
              (s.history.length
                ? '<details class="mt"><summary>Amount history (' +
                  s.history.length +
                  ')</summary>' +
                  s.history
                    .slice()
                    .reverse()
                    .map(
                      h =>
                        '<p class="tiny">' +
                        date(h.date) +
                        ' · ' +
                        esc(supplyAmount(h.before)) +
                        ' → ' +
                        esc(supplyAmount(h.after)) +
                        ' · item quantity ' +
                        h.before.quantity +
                        ' → ' +
                        h.after.quantity +
                        '</p>'
                    )
                    .join('') +
                  '</details>'
                : '') +
              '</section>'
          )
          .join('') +
        '</div>'
    : empty(
        'Your digital toolbox',
        'Add tools and consumables, or adjust the filters.',
        btn('Add toolbox item', 'add-supply', 'primary')
      );
}
function renderSupplies() {
  return (
    heading(
      'Workshop supplies',
      'Tools, equipment and consumables, ready for your next session.',
      btn(icon('plus') + ' Add toolbox item', 'add-supply', 'primary')
    ) +
    toolboxTabs() +
    '<div class="toolbar"><label class="search">' +
    icon('search') +
    '<input id="supply-search" aria-label="Search toolbox" placeholder="Find tools or supplies…" value="' +
    esc(supplyQuery) +
    '"></label>' +
    categorySelect(
      'supply-category-filter',
      'Category',
      supplyCategory,
      Object.keys(slotforgeCatalogue.supplies),
      true
    ) +
    '<label class="check-row"><input type="checkbox" id="supply-low" ' +
    (supplyLow ? 'checked' : '') +
    '>Low stock only</label><label class="check-row"><input type="checkbox" id="supply-archived" ' +
    (supplyArchived ? 'checked' : '') +
    '>Archived</label></div><div id="supply-results">' +
    supplyCards() +
    viewPager(db._view?.list) +
    '</div>'
  );
}
function editSupply(id) {
  const revision = db.revision,
    s = id
      ? db.supplies.find(s => s.id === id)
      : {
          category: 'Hand tools',
          kind: 'Tool / equipment',
          quantity: 1,
          condition: 'Good',
          remaining: null,
          minimum: null
        };
  inventoryPhoto = s.picture || '';
  modal(
    id ? 'Edit toolbox item' : 'Add toolbox item',
    '<div class="form-grid">' +
      field('name', 'Item name', s.name || '') +
      categorySelect('supply-category', 'Category', s.category, Object.keys(slotforgeCatalogue.supplies)) +
      field('partType', 'Item type', s.partType || '', 'text', [
        ...Object.values(slotforgeCatalogue.supplies).flat(),
        ...stockSuggestions('supplies', 'partType')
      ]) +
      field('kind', 'Kind', s.kind, 'select', ['Tool / equipment', 'Consumable']) +
      field('quantity', 'Item / container count', s.quantity, 'number') +
      field('maker', 'Manufacturer', s.maker || '', 'text', stockSuggestions('supplies', 'maker')) +
      field('reference', 'Reference', s.reference || '') +
      field('location', 'Location', s.location || '', 'text', stockSuggestions('supplies', 'location')) +
      field('condition', 'Condition', s.condition, 'text', ['New', 'Good', 'Used', 'Needs repair']) +
      field('notes', 'Notes', s.notes || '', 'textarea') +
      '</div><section id="consumable-fields" class="mt" ' +
      (s.kind === 'Consumable' ? '' : 'hidden') +
      '><p class="muted">Track the total remaining amount across your containers. Leave it blank if unknown; zero means empty.</p><div class="form-grid">' +
      field('remaining', 'Remaining amount', s.remaining ?? '', 'number') +
      field('unit', 'Amount unit', s.unit || '', 'text', ['ml', 'g', 'pieces', 'bottles', 'metres', 'sheets']) +
      field('minimum', 'Low-stock threshold', s.minimum ?? '', 'number') +
      '</div><p class="tiny muted">Keep the same unit when updating amounts. Changes are retained in history.</p></section>' +
      appearanceEditor(s) +
      photoEditor(s),
    async values => {
      await change('supply.save', {
        id,
        revision,
        data: { ...values, category: values['supply-category'], picture: inventoryPhoto }
      });
      supplyQuery = '';
      supplyCategory = '';
      supplyLow = false;
      toolboxTab = 'Workshop supplies';
      page = 'Workshop';
    },
    'Save toolbox item'
  );
  for (const name of ['remaining', 'minimum']) {
    const input = $('[name="' + name + '"]');
    input.step = 'any';
    input.min = '0';
  }
}
async function inventoryAction(action, id) {
  switch (action) {
    case 'parts-layout':
      partsLayout = id === 'grid' ? 'grid' : 'list';
      render();
      return true;
    case 'part-groups':
      partMakerFilter = '';
      partCategory = '';
      partTypeFilter = '';
      partQuery = '';
      partId = null;
      render();
      return true;
    case 'part-group':
      if (!partGroups().includes(id)) return true;
      partCategory = id;
      partTypeFilter = '';
      partQuery = '';
      partId = null;
      render();
      return true;
    case 'part-appearance':
      editPartAppearance(id);
      return true;
    case 'delete-part': {
      const plan = await api('plan', 'part.delete', { id });
      if (plan.reasons.length) {
        modal(
          'This part is linked to your records',
          '<p><strong>' +
            esc(plan.name) +
            '</strong> is referenced by ' +
            esc(plan.reasons.join(', ')) +
            '.</p><p>Keep this part record to preserve those links. Unused parts can be deleted.</p>',
          null
        );
        return true;
      }
      modal(
        'Delete part?',
        '<p>Permanently delete <strong>' +
          esc(plan.name) +
          '</strong> and its ' +
          plan.quantity +
          ' piece(s) of stock?</p><p>This cannot be undone here.</p>',
        async () => {
          await change('part.delete', { id, revision: plan.revision });
          if (partId === id) partId = null;
          catalogueManagerSelected.delete(id);
        },
        'Delete part'
      );
      return true;
    }
    case 'delete-supply': {
      const item = db.supplies.find(s => s.id === id),
        revision = db.revision;
      modal(
        'Delete workshop supply?',
        '<p>Permanently delete <strong>' +
          esc(item.name) +
          '</strong>, its photograph and all ' +
          item.history.length +
          ' amount history entries?</p><p>Use Archive instead if you want to keep its history. Deletion cannot be undone here.</p>',
        async () => change('supply.delete', { id, revision }),
        'Delete supply'
      );
      return true;
    }
    case 'toolbox-tab':
      toolboxTab = id;
      workshopJob = null;
      render();
      return true;
    case 'add-supply':
      editSupply();
      return true;
    case 'edit-supply':
      editSupply(id);
      return true;
    case 'archive-supply': {
      const s = db.supplies.find(s => s.id === id),
        revision = db.revision;
      modal(
        s.archived ? 'Restore toolbox item' : 'Archive toolbox item',
        '<p>' +
          esc(s.name) +
          (s.archived
            ? ' will return to your toolbox.'
            : ' will be hidden from active items. Its history is retained.') +
          '</p>',
        async () => change('supply.archive', { id, revision }),
        s.archived ? 'Restore' : 'Archive'
      );
      return true;
    }
    case 'item-photo': {
      const image = await api('file', 'image');
      if (image) {
        inventoryPhoto = image.data;
        refreshItemAppearance();
      }
      return true;
    }
    case 'item-photo-remove':
      inventoryPhoto = '';
      refreshItemAppearance();
      return true;
  }
  return false;
}
document.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'category' && $('#part-type-field')) $('#part-type-field').innerHTML = partTypeInput(el.value);
  if (el.name === 'kind' && $('#consumable-fields')) $('#consumable-fields').hidden = el.value !== 'Consumable';
  if (el.id === 'part-category-filter') {
    partCategory = el.value;
    partTypeFilter = '';
    if (db.parts.find(p => p.id === partId)?.category !== partCategory) partId = null;
    render();
  }
  if (el.id === 'part-maker-filter') {
    partMakerFilter = el.value;
    partId = null;
    render();
  }
  if (el.id === 'part-type-filter') {
    partTypeFilter = el.value;
    if (partTypeFilter && db.parts.find(p => p.id === partId)?.partType !== partTypeFilter) partId = null;
    render();
  }
  if (el.id === 'supply-category-filter') {
    supplyCategory = el.value;
    render();
  }
  if (el.id === 'supply-low') {
    supplyLow = el.checked;
    render();
  }
  if (el.id === 'supply-archived') {
    supplyArchived = el.checked;
    render();
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'supply-search') {
    supplyQuery = event.target.value;
    if (local() && db._view) scheduleView();
    else $('#supply-results').innerHTML = supplyCards();
  }
});
