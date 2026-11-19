let buildState = null,
  buildContext = '',
  buildDraftId = null,
  buildDirty = false,
  buildSlot = 'motor',
  buildZoom = 1,
  buildSearch = '',
  buildAll = false;
// Bounds limit each contour filter's drawing surface; they are never visible or clickable.
const buildOutlineBounds = {
  guideScrew: [[749, 6, 102, 88]],
  guide: [[747, 94, 106, 133]],
  braids: [
    [503, 102, 244, 88],
    [849, 102, 56, 87]
  ],
  frontTyres: [
    [150, 184, 128, 204],
    [1323, 227, 117, 166]
  ],
  frontWheels: [
    [309, 196, 117, 190],
    [1185, 242, 91, 140]
  ],
  frontBearings: [
    [445, 218, 105, 130],
    [1051, 273, 97, 76]
  ],
  frontAxle: [[550, 244, 498, 99]],
  chassis: [[626, 389, 348, 697]],
  fasteners: [[274, 431, 168, 152]],
  pod: [[228, 583, 251, 379]],
  wiring: [[1137, 414, 205, 222]],
  motor: [[1164, 639, 326, 217]],
  pinionPart: [[1179, 872, 140, 107]],
  rearTyres: [
    [142, 1058, 147, 240],
    [1299, 1058, 155, 194]
  ],
  rearWheels: [
    [302, 1080, 133, 201],
    [1178, 1080, 106, 150]
  ],
  rearBearings: [
    [444, 1109, 109, 138],
    [1052, 1109, 95, 84]
  ],
  rearAxle: [
    [549, 1126, 254, 119],
    [883, 1125, 166, 50]
  ],
  gearPart: [[802, 1080, 143, 191]]
};
function ensureBuild() {
  if (!buildState || buildContext !== db.id) {
    buildState = BuildModel.blank();
    buildContext = db.id;
    buildDraftId = null;
    buildDirty = false;
    buildSlot = 'motor';
    buildSearch = '';
    buildAll = false;
    buildPopOpen = false;
  }
}
function buildSlotInfo() {
  return BuildModel.slots.find(s => s.id === buildSlot);
}
function buildAssigned(slot) {
  const meta = BuildModel.slots.find(s => s.id === slot);
  return (
    buildState.parts.find(r => r.slot === slot) ||
    rebuildAssignments().find(r => r.slot === slot) ||
    buildState.assemblies.find(selected =>
      db.assemblies
        .find(a => a.id === selected.id && !a.dismantled)
        ?.components.some(c => meta?.field && c.field === meta.field)
    )
  );
}
// Reuse every original component and its inherited SVG styles, leaving the source file intact.
// Child indices split combined axle / motor drawings into their selectable inventory positions.
const buildShapeSources = [
  ['chassis', 'chassis', null, 12],
  ['frontTyres', 'front-wheel-assembly', [0, 7, 8, 9], 3],
  ['frontWheels', 'front-wheel-assembly', [1, 6], 4],
  ['frontBearings', 'front-wheel-assembly', [2, 5], 5],
  ['frontAxle', 'front-wheel-assembly', [3, 4], 6],
  ['rearTyres', 'rear-wheel-assembly', [0, 8, 9, 10], 13],
  ['rearWheels', 'rear-wheel-assembly', [1, 7], 14],
  ['rearBearings', 'rear-wheel-assembly', [2, 6], 15],
  ['rearAxle', 'rear-wheel-assembly', [3, 4], 16],
  ['gearPart', 'rear-wheel-assembly', [5], 17],
  ['guideScrew', 'guide-and-braids', [0, 1], 0],
  ['guide', 'guide-and-braids', [2, 3], 1],
  ['braids', 'guide-and-braids', [4], 2],
  ['fasteners', 'mounting-screws', null, 7],
  ['pod', 'motor-pod', null, 8],
  ['wiring', 'motor-and-leads', [0, 1, 2, 3], 9],
  ['motor', 'motor-and-leads', [4, 5, 6, 7, 8, 9, 10], 10],
  ['pinionPart', 'motor-pinion', null, 11]
];
function buildDiagram() {
  const template = document.createElement('template');
  template.innerHTML = `<svg>${BuildDiagramArt}</svg>`;
  const source = template.content.firstElementChild,
    labels = source.querySelector('.build-diagram-labels');
  const shapes = buildShapeSources
    .map(([slot, sourceId, indices, labelIndex]) => {
      const original = source.querySelector('#' + sourceId),
        art = original.cloneNode(false);
      art.removeAttribute('id');
      art.classList.add('build-part-art');
      art.setAttribute('filter', `url(#build-outline-${slot})`);
      for (const index of indices || [...original.children].map((_, i) => i))
        art.append(original.children[index].cloneNode(true));
      const label = labels.cloneNode(false);
      label.append(labels.children[labelIndex].cloneNode(true));
      const meta = BuildModel.slots.find(s => s.id === slot),
        assigned = buildAssigned(slot),
        areas = buildOutlineBounds[slot];
      const x = Math.min(...areas.map(a => a[0])) - 24,
        y = Math.min(...areas.map(a => a[1])) - 24;
      const width = Math.max(...areas.map(a => a[0] + a[2])) - x + 24,
        height = Math.max(...areas.map(a => a[1] + a[3])) - y + 24;
      if (assigned) {
        const tick = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tick.setAttribute('class', 'build-assigned-tick');
        tick.textContent = ' ✓';
        label.firstElementChild.append(tick);
      }
      return `<g class="build-hotspot ${assigned ? 'assigned' : ''} ${slot === buildSlot ? 'selected' : ''}" tabindex="0" role="button" data-action="build-slot" data-id="${slot}" aria-label="${meta.label}${assigned ? ', assigned' : ''}" aria-pressed="${slot === buildSlot}"><title>${meta.label}${assigned ? ' · assigned' : ''}</title><defs><filter id="build-outline-${slot}" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="5" result="expanded"/><feComposite in="expanded" in2="SourceAlpha" operator="out" result="edge"/><feFlood class="build-outline-colour" result="colour"/><feComposite in="colour" in2="edge" operator="in" result="outline"/><feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${art.outerHTML}${label.outerHTML}</g>`;
    })
    .join('');
  return `<div class="build-diagram-scroll"><svg class="build-diagram zoom-${buildZoom}" viewBox="0 0 1600 1360" role="group" aria-label="Exploded chassis. Choose a part position.">${source.querySelector('#assembly-guides').outerHTML}${shapes}</svg></div>`;
}
function buildQuantity(partId, exceptKey) {
  return buildState.parts.filter(r => r.partId === partId && r.key !== exceptKey).reduce((n, r) => n + r.quantity, 0);
}
// The groups of the build sheet: the diagram positions by area, then the parts beyond the drawing.
const buildSheetGroups = [
  ['Chassis & mounting', ['chassis', 'pod', 'fasteners']],
  ['Front end', ['frontTyres', 'frontWheels', 'frontBearings', 'frontAxle']],
  ['Rear end', ['rearTyres', 'rearWheels', 'rearBearings', 'rearAxle']],
  ['Drivetrain', ['motor', 'pinionPart', 'gearPart']],
  ['Guide & electrics', ['guide', 'guideScrew', 'braids', 'wiring']],
  ['Beyond the drawing', ['body', 'lights', 'chip', 'magnets', 'ballast', 'suspension']]
];
// Where a part comes from: your stock (enough available), a planned purchase, or the original car.
function buildSource(assigned) {
  if (!assigned) return '';
  if (assigned.reuse) return 'reuse';
  if (assigned.signature) return 'stock';
  const p = db.parts.find(p => p.id === assigned.partId);
  return !p || available(p) < buildQuantity(assigned.partId) ? 'buy' : 'stock';
}
function buildAssignedName(assigned) {
  if (!assigned) return '';
  if (assigned.signature) return db.assemblies.find(a => a.id === assigned.id)?.name || assigned.name;
  return db.parts.find(p => p.id === assigned.partId)?.name || assigned.name;
}
function buildSheetRow(slot) {
  const meta = BuildModel.slots.find(s => s.id === slot),
    assigned = buildAssigned(slot),
    source = buildSource(assigned),
    row = buildState.parts.find(r => r.slot === slot),
    on = slot === buildSlot,
    name = buildAssignedName(assigned);
  const detail =
    on && row && !assigned?.reuse
      ? `<div class="build-sheet-detail"><label class="build-sheet-qty">Pieces<input id="build-quantity" type="number" min="1" step="1" value="${row.quantity}" aria-label="Pieces of ${esc(meta.label)}"></label>${btn('Remove', 'build-remove', 'small ghost', row.key)}</div>`
      : '';
  return `<div class="build-sheet-item ${on ? 'on' : ''}"><button type="button" class="build-sheet-row" data-action="build-slot" data-id="${slot}" data-sheet-slot="${slot}" aria-pressed="${on}"><span class="build-sheet-name">${esc(meta.label)}</span><span class="build-sheet-part ${name ? '' : 'is-empty'}">${esc(name || 'Empty')}${assigned?.reuse ? ' · reused' : assigned?.signature ? ' · assembly' : ''}</span>${source ? `<span class="build-dot ${source}" title="${source === 'buy' ? 'To buy' : source === 'reuse' ? 'Reused from the original' : 'From stock'}"></span>` : ''}</button>${detail}</div>`;
}
function buildSheet() {
  const rows = buildState.parts,
    reused = rebuildAssignments(),
    groups = buildState.assemblies,
    loose = rows.filter(r => !r.slot),
    all = [...rows, ...reused],
    stock = all.filter(r => buildSource(r) !== 'buy').length + groups.length,
    buy = all.filter(r => buildSource(r) === 'buy').length,
    chosen = new Set([...rows.map(r => r.slot), ...reused.map(r => r.slot)].filter(Boolean));
  for (const s of BuildModel.slots) if (buildAssigned(s.id)) chosen.add(s.id);
  const pieces =
    reused.reduce((n, r) => n + r.quantity, 0) +
    rows.reduce((n, r) => n + r.quantity, 0) +
    groups.reduce(
      (n, g) => n + (db.assemblies.find(a => a.id === g.id)?.components.reduce((n, c) => n + c.quantity, 0) || 0),
      0
    );
  const other =
    loose.length || groups.length
      ? `<span class="build-sheet-group">Other parts</span>${groups
          .map(g => {
            const a = db.assemblies.find(a => a.id === g.id && !a.dismantled);
            return `<div class="build-sheet-item"><div class="build-sheet-row static"><span class="build-sheet-name">${icon('assembly')}Assembly</span><span class="build-sheet-part">${esc(a?.name || g.name)}${a && !a.carId ? '' : ' · unavailable'}</span></div><div class="build-sheet-detail">${btn('Remove', 'build-remove-assembly', 'small ghost', g.id)}</div></div>`;
          })
          .join('')}${loose
          .map(
            r =>
              `<div class="build-sheet-item"><div class="build-sheet-row static"><span class="build-sheet-name">${esc(r.position || 'Additional part')}</span><span class="build-sheet-part">${r.quantity} × ${esc(db.parts.find(p => p.id === r.partId)?.name || r.name)}</span><span class="build-dot ${buildSource(r)}"></span></div><div class="build-sheet-detail">${btn('Edit', 'build-edit-row', 'small ghost', r.key)}${btn('Remove', 'build-remove', 'small ghost', r.key)}</div></div>`
          )
          .join('')}`
      : '';
  return `<section class="build-sheet" id="build-summary" aria-label="Build sheet"><header><h2>Build sheet</h2><span class="muted"><span class="mono">${chosen.size}</span> of <span class="mono">${BuildModel.slots.length}</span> · <span class="mono">${pieces}</span> piece${pieces === 1 ? '' : 's'}</span></header><div class="build-sheet-list">${buildSheetGroups
    .map(([title, slots]) => `<span class="build-sheet-group">${title}</span>${slots.map(buildSheetRow).join('')}`)
    .join(
      ''
    )}${other}</div><div class="build-sheet-totals"><span><span class="build-dot stock"></span><span class="mono">${stock}</span> from stock</span><span><span class="build-dot buy"></span><span class="mono">${buy}</span> to buy</span></div><div class="build-sheet-tools">${btn(icon('plus') + ' Other part', 'build-slot', 'small ghost build-other-add', '')}${btn(icon('assembly') + ' Use an assembly', 'build-assemblies', 'small ghost')}</div></section>`;
}
// The matches in the search box next to a part: your stock first, then the catalogue.
function buildPickerRows() {
  const slot = buildSlotInfo(),
    existing = buildState.parts.find(r => r.slot && r.slot === buildSlot);
  const parts = db.parts.filter(
    p =>
      (!db._view?.buildIds || db._view.buildIds.includes(p.id)) &&
      (buildAll || !slot || slot.types.includes(p.partType)) &&
      [p.name, p.reference, p.maker, p.location, p.partType].join(' ').toLowerCase().includes(buildSearch.toLowerCase())
  );
  if (!parts.length)
    return `<p class="build-pop-empty muted">${buildAll ? 'No matching parts. Add or import catalogue entries in Parts, then return to this build.' : 'No suggested parts for this position. Tick All part types to search everything.'}</p>`;
  const row = p => {
    const remaining = available(p) - buildQuantity(p.id, existing?.key),
      reserved = liveAssemblies().some(a => a.components.some(c => c.partId === p.id)),
      current = existing?.partId === p.id;
    const tag = reserved
      ? '<span class="build-pop-src">In an assembly</span>'
      : current
        ? '<span class="build-pop-src stock">On the car</span>'
        : remaining > 0
          ? `<span class="build-pop-src stock">In stock <b class="mono">${remaining}</b></span>`
          : '<span class="build-pop-src buy">Catalogue</span>';
    return `<button type="button" class="build-stock-item" data-action="build-pick" data-id="${p.id}" ${reserved ? 'disabled' : ''}>${itemVisual(p)}<span class="build-pop-copy"><strong>${esc(p.name)}</strong><small>${esc([p.reference, p.maker].filter(Boolean).join(' · '))}</small></span>${tag}</button>`;
  };
  const owned = parts.filter(p => available(p) > 0 || existing?.partId === p.id),
    rest = parts.filter(p => !owned.includes(p));
  return (
    (owned.length ? '<span class="build-pop-group">My stock</span>' + owned.map(row).join('') : '') +
    (rest.length ? '<span class="build-pop-group">Catalogue · plan to buy</span>' + rest.map(row).join('') : '')
  );
}
let buildPopOpen = false;
function buildPicker() {
  if (!buildPopOpen) return '';
  const slot = buildSlotInfo(),
    assigned = slot && buildAssigned(slot.id),
    row = buildState.parts.find(r => r.slot && r.slot === buildSlot),
    assembly = assigned?.signature && db.assemblies.find(a => a.id === assigned.id),
    label = slot?.label || 'Additional part';
  const now = assigned
    ? `Now: <b>${esc(buildAssignedName(assigned))}</b>`
    : slot
      ? 'Empty position'
      : 'A part that is not in the drawing';
  const body = assigned?.reuse
    ? `<p class="build-pop-note">Reusing <strong>${esc(assigned.name)}</strong> from the original. Deselect it in the rebuild project above before choosing a replacement.</p>`
    : assembly
      ? `<p class="build-pop-note">Provided by <strong>${esc(assembly.name)}</strong>. Remove the complete assembly from this build before changing its positions.</p><div class="build-pop-actions">${btn('Remove assembly from build', 'build-remove-assembly', 'small', assembly.id)}</div>`
      : `<label class="build-pop-search">${icon('search')}<input id="build-stock-search" type="search" autocomplete="off" aria-label="Search stock and catalogue for ${esc(label)}" placeholder="Type a name or reference…" value="${esc(buildSearch)}"></label><div class="build-pop-list" id="build-stock-list" role="listbox">${buildPickerRows()}${viewPager(db._view?.list)}</div><div class="build-pop-foot"><span>↑ ↓ move · Enter choose · Esc close</span><label class="check-row"><input id="build-all" type="checkbox" ${buildAll || !slot ? 'checked' : ''} ${!slot ? 'disabled' : ''}>All part types</label></div>`;
  return `<div class="build-picker build-pop" id="build-pop" role="dialog" aria-label="Choose ${esc(label)}"><div class="build-pop-head"><span class="build-pop-label">${esc(label)}</span><span class="build-pop-now">${now}</span>${row ? btn('Clear', 'build-remove', 'small ghost', row.key) : ''}<button type="button" class="btn small icon ghost" data-action="build-pop-close" aria-label="Close" title="Close">✕</button></div>${body}</div>`;
}
// Keep the search box next to the part (on the diagram or in the build sheet) it belongs to.
function placeBuildPop() {
  const pop = $('#build-pop');
  if (!pop) return;
  const anchor =
    (buildSlot && document.querySelector(`.build-hotspot[data-id="${CSS.escape(buildSlot)}"] .build-part-art`)) ||
    (buildSlot && document.querySelector(`[data-sheet-slot="${CSS.escape(buildSlot)}"]`)) ||
    document.querySelector('.build-other-add');
  if (!anchor) return;
  const r = anchor.getBoundingClientRect(),
    w = pop.offsetWidth,
    h = pop.offsetHeight,
    gap = 14;
  let left = r.right + gap,
    side = 'right';
  if (left + w > innerWidth - 8) {
    left = r.left - w - gap;
    side = 'left';
  }
  if (left < 8) {
    left = Math.max(8, Math.min(innerWidth - w - 8, r.left));
    side = 'below';
  }
  let top = side === 'below' ? r.bottom + gap : r.top + r.height / 2 - 80;
  top = Math.max(8, Math.min(top, innerHeight - h - 8));
  pop.dataset.side = side;
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.style.setProperty('--arrow', Math.round(Math.max(16, Math.min(h - 28, r.top + r.height / 2 - top - 6))) + 'px');
}
function closeBuildPop() {
  if (!buildPopOpen) return;
  buildPopOpen = false;
  $('#build-pop')?.remove();
}
function buildBoard() {
  const values = BuildModel.gearing(effectiveBuildState(), db),
    m = PerformanceModel.calculate(buildPerformanceInput()),
    line = (label, value, unit) =>
      `<div class="build-board-line"><span>${label}</span><strong>${value}${unit ? `<small>${unit}</small>` : ''}</strong></div>`;
  return (
    `<div class="build-board-line accent"><span>Gear ratio</span><strong id="build-gear-ratio" aria-live="polite">${slotforgeDomain.gearRatioText(values.pinion.value, values.gear.value) || '—'}</strong></div>` +
    line('Top speed', performanceValue(m, 'speedKmh', 1), 'km/h') +
    line('Rear axle', performanceValue(m, 'axleRpm', 0), 'rpm') +
    line('Per motor turn', performanceValue(m, 'rollout', 1), 'mm')
  );
}
function buildGearingPanel() {
  const values = BuildModel.gearing(effectiveBuildState(), db);
  return `<div class="build-gearing"><div class="build-gear-inputs">${[
    ['pinion', 'Pinion'],
    ['gear', 'Crown / axle gear']
  ]
    .map(
      ([key, label]) =>
        `<label class="field">${label}<input type="number" min="1" step="1" inputmode="numeric" data-build-tooth="${key}" aria-describedby="build-teeth-help" value="${esc(buildState.gearing?.[key] || '')}" placeholder="${esc(values[key].automatic || 'Teeth')}"></label>`
    )
    .join(
      '<span class="build-gear-x" aria-hidden="true">×</span>'
    )}</div><p class="tiny muted" id="build-teeth-help">${values.pinion.automatic || values.gear.automatic ? 'Empty fields use the tooth counts of the chosen parts.' : 'Tooth counts are optional; part names are not used to guess them.'} ${btn('Use part specifications', 'build-gearing-reset', 'small ghost')}</p><div class="build-board" id="build-board">${buildBoard()}</div></div>`;
}
function buildCarDetails(count) {
  return `<div class="build-details">${[
    ['name', 'Car name'],
    ['maker', 'Manufacturer'],
    ['scale', 'Scale']
  ]
    .map(
      ([k, label]) =>
        `<label class="field ${k === 'name' ? 'wide' : ''}">${label}<input name="build-${k}" data-build-value="${k}" value="${esc(buildState[k])}" maxlength="200" ${k === 'name' ? 'required' : ''}></label>`
    )
    .join(
      ''
    )}<label class="field wide">Usage labels (comma separated)<input data-build-value="usage" value="${esc(buildState.usage.join(', '))}" placeholder="Club racing, Home racing…"></label><label class="field wide">Private build notes<textarea data-build-value="notes" maxlength="20000" rows="3">${esc(buildState.notes)}</textarea></label><label class="check-row tiny wide"><input id="build-setup" type="checkbox" ${buildState.saveSetup ? 'checked' : ''}>Save an “As built” setup snapshot</label><p class="tiny muted wide">Saving the plan starts a shopping list for the parts to buy. ${count ? '' : 'Choose at least one part before saving to Cars.'}</p></div>`;
}
function renderBuild(tabs = '') {
  ensureBuild();
  const count = buildState.parts.length + buildState.assemblies.length + rebuildAssignments().length,
    state = buildDirty ? 'Unsaved changes' : buildDraftId ? 'Saved · stock is not reserved' : 'Not saved yet';
  queueMicrotask(() => requestAnimationFrame(placeBuildPop));
  return (
    heading(
      'Build from Scratch',
      'Plan a car with stock or catalogue parts. Buy what is missing, then build.',
      `<button type="button" class="build-draft-switch" data-action="build-drafts" title="Saved drafts (${db.buildDrafts.length})"><span class="muted">Draft</span><b>${esc(buildState.name || 'Untitled build')}</b><span id="build-save-state" class="tiny muted">${state}</span><span class="build-draft-count mono">${db.buildDrafts.length}</span>${icon('next')}</button>` +
        btn('New build', 'build-new', 'outline small') +
        btn('Rebuild a car…', 'rebuild-start', 'outline small') +
        (buildDraftId ? btn('Shopping changes', 'shop-requirements', 'ghost small', 'build:' + buildDraftId) : '') +
        btn('Save plan', 'build-save-draft', 'small') +
        btn('Review & save to Cars', 'build-review', 'primary small' + (!count ? ' is-empty' : ''))
    ) +
    tabs +
    renderRebuildEditor() +
    `<div class="build-workbench">${buildSheet()}<section class="build-canvas"><div class="build-canvas-toolbar"><span class="build-legend"><span><span class="build-dot selected"></span>Selected</span><span><span class="build-dot stock"></span>From stock</span><span><span class="build-dot buy"></span>To buy</span></span><span class="build-canvas-tools">${btn('Refresh stock', 'build-refresh-stock', 'small ghost')}<label class="tiny">Zoom <select id="build-zoom" aria-label="Diagram zoom"><option value="1" ${buildZoom === 1 ? 'selected' : ''}>Fit</option><option value="2" ${buildZoom === 2 ? 'selected' : ''}>150%</option><option value="3" ${buildZoom === 3 ? 'selected' : ''}>200%</option></select></label></span></div>${buildDiagram()}<p class="tiny muted build-caption">Click a part to choose it. Paired parts share one choice. Check fit and compatibility yourself.</p></section><aside class="build-numbers"><header><h2>Numbers</h2><span class="muted tiny">Ideal, no losses</span></header>${buildGearingPanel()}<details class="build-fold"><summary><h3>Motor &amp; tyres</h3><span>RPM, torque, tyre size</span></summary>${buildPerformanceEditor()}</details><details class="build-fold"><summary><h3>Performance &amp; curves</h3><span>All figures, torque and power, compare</span></summary>${buildPerformancePanel()}</details><details class="build-fold" open><summary><h3>Your new car</h3><span>Name, maker, scale</span></summary>${buildCarDetails(count)}</details></aside></div>${buildPicker()}`
  );
}
function markBuildDirty() {
  buildDirty = true;
  const label = $('#build-save-state');
  if (label) label.textContent = 'Unsaved changes';
}
function buildRefresh() {
  const scroller = $('.build-diagram-scroll'),
    position = scroller && [scroller.scrollLeft, scroller.scrollTop];
  render();
  const next = $('.build-diagram-scroll');
  if (position && next) {
    next.scrollLeft = position[0];
    next.scrollTop = position[1];
  }
}
async function reviewBuild() {
  // Read current stock before reviewing; the commit uses this exact revision.
  const latest = await readScreen();
  acceptSnapshot(latest.data);
  if (buildContext !== db.id) throw Error('The database changed. Reopen Build from Scratch.');
  const payload = { data: structuredClone(buildState), draftId: buildDraftId || undefined };
  let preview;
  try {
    preview = await api('plan', 'build.preview', payload);
  } catch (e) {
    render();
    throw e;
  }
  modal(
    'Review build · ' + preview.data.name,
    `${preview.rebuild ? `<div class="note info">Rebuild <strong>${esc(preview.rebuild.name)}</strong>. Its original history and a Before rebuild setup are preserved. ${preview.rebuild.returnedPieces} unselected piece(s) return to Used spares. The original is archived and linked to this new car.</div>` : ''}<p>Create <strong>${esc(preview.data.name)}</strong> with ${preview.pieces} piece(s). Empty positions stay empty.</p>${slotforgeDomain.gearRatioText(preview.gearing.pinion, preview.gearing.gear) ? `<p><strong>Gearing:</strong> ${esc(preview.gearing.pinion)} / ${esc(preview.gearing.gear)} · ${slotforgeDomain.gearRatioText(preview.gearing.pinion, preview.gearing.gear)}</p>` : ''}${Object.keys(PerformanceModel.numbers).some(k => preview.data.performance[k]) ? `<details class="mt"><summary>Review motor & tyre specifications</summary>${dl(PerformanceModel.keys.map(k => [PerformanceModel.numbers[k]?.[0] || (k === 'motorType' ? 'Motor type' : 'Torque rating type'), preview.data.performance[k]]))}${performanceStats({ ...preview.data.performance, ...preview.gearing })}</details>` : ''}<div class="table-wrap"><table><thead><tr><th>Part</th><th>Position</th><th>Pieces</th></tr></thead><tbody>${preview.rows.map(r => `<tr><td>${esc(r.name)}${r.reuse ? ' · reused' : ''}${r.assemblyName ? `<small class="muted"> · ${esc(r.assemblyName)}</small>` : ''}</td><td>${esc(r.position)}</td><td>${r.quantity}</td></tr>`).join('')}</tbody></table></div><p class="note info mt">These parts will be recorded as fitted to this car. Owned quantities stay the same; available stock decreases. ${preview.data.saveSetup ? 'An As built setup snapshot will also be saved.' : ''}</p><label class="check-row"><input name="confirmed" type="checkbox" required>I have checked the selected parts and quantities and want to record them on this car.</label>`,
    async values => {
      const id = await change('build.create', {
        ...payload,
        revision: preview.revision,
        confirmed: !!values.confirmed
      });
      buildState = BuildModel.blank();
      buildDraftId = null;
      buildDirty = false;
      carId = id;
      page = 'Cars';
      section = 'Overview';
      toast('Car created with its fitted inventory.');
    },
    'Save to Cars'
  );
}
function chooseBuildAssembly() {
  modal(
    'Use a stored assembly',
    `<p class="muted">Its components stay together and populate their saved technical positions. No stock moves until you save the car.</p>${
      liveAssemblies()
        .filter(a => !a.carId)
        .map(
          a =>
            `<div class="list-row"><div><strong>${esc(a.name)}</strong><p class="tiny muted">${a.components.map(c => esc(db.parts.find(p => p.id === c.partId)?.name) + ' × ' + c.quantity).join(' · ')}</p></div>${btn(buildState.assemblies.some(g => g.id === a.id) ? 'Selected' : 'Use assembly', 'build-use-assembly', 'small', a.id)}</div>`
        )
        .join('') || '<p class="muted">No assemblies in storage. Build one in Assemblies or select loose parts.</p>'
    }`,
    null
  );
}
function editBuildRow(key) {
  const r = buildState.parts.find(r => r.key === key);
  if (!r) return;
  modal(
    'Edit assigned part',
    `<p>${esc(db.parts.find(p => p.id === r.partId)?.name || r.name)}</p><label class="field">Quantity<input name="quantity" type="number" min="1" step="1" value="${r.quantity}" required></label>${!r.slot ? `<label class="field mt">Position / description<input name="position" value="${esc(r.position)}" maxlength="160"></label>` : ''}`,
    async values => {
      const n = Number(values.quantity);
      if (!Number.isSafeInteger(n) || n < 1) throw Error('Choose a positive whole quantity.');
      r.quantity = n;
      if (!r.slot) r.position = values.position;
      markBuildDirty();
    },
    'Update assignment'
  );
}
async function buildAction(action, id) {
  if (!action.startsWith('build-')) return false;
  if (!local()) return true;
  ensureBuild();
  if (action === 'build-slot') {
    buildSlot = id || '';
    buildAll = !id;
    buildSearch = '';
    buildPopOpen = true;
    buildRefresh();
    ($('#build-stock-search') || document.querySelector('.build-hotspot.selected'))?.focus({ preventScroll: true });
  }
  if (action === 'build-pop-close') {
    closeBuildPop();
    document.querySelector('.build-hotspot.selected')?.focus({ preventScroll: true });
  }
  if (action === 'build-gearing-reset') {
    buildState.gearing = { pinion: '', gear: '' };
    markBuildDirty();
    buildRefresh();
  }
  if (action === 'build-performance-reference') {
    const input = buildPerformanceInput();
    if (!Object.keys(PerformanceModel.numbers).some(k => input[k]) && !input.pinion && !input.gear)
      throw Error('Enter some specifications or tooth counts before keeping a reference.');
    buildState.performanceBaseline = PerformanceModel.baseline(input);
    markBuildDirty();
    refreshBuildPerformance();
  }
  if (action === 'build-performance-clear') {
    buildState.performanceBaseline = null;
    markBuildDirty();
    refreshBuildPerformance();
  }
  if (action === 'build-refresh-stock') {
    const result = await readScreen();
    acceptSnapshot(result.data);
    render();
    toast('Stock refreshed. Your selections are kept.');
  }
  if (action === 'build-pick') {
    const p = db.parts.find(p => p.id === id),
      slot = buildSlotInfo(),
      existing = buildState.parts.find(r => r.slot && r.slot === buildSlot);
    if (!p) return true;
    if (liveAssemblies().some(a => a.components.some(c => c.partId === p.id)))
      throw Error('Choose the complete assembly.');
    const row = {
      key: existing?.key || crypto.randomUUID(),
      partId: id,
      name: p.name,
      slot: slot?.id || '',
      position: slot?.label || 'Additional part',
      quantity: slot?.quantity || 1
    };
    if (existing) buildState.parts.splice(buildState.parts.indexOf(existing), 1, row);
    else buildState.parts.push(row);
    buildPopOpen = false;
    markBuildDirty();
    buildRefresh();
  }
  if (action === 'build-remove') {
    buildState.parts = buildState.parts.filter(r => r.key !== id);
    markBuildDirty();
    buildRefresh();
  }
  if (action === 'build-remove-assembly') {
    buildState.assemblies = buildState.assemblies.filter(a => a.id !== id);
    markBuildDirty();
    buildRefresh();
  }
  if (action === 'build-edit-row') editBuildRow(id);
  if (action === 'build-assemblies') chooseBuildAssembly();
  if (action === 'build-use-assembly') {
    const a = liveAssemblies().find(a => a.id === id);
    if (!a || a.carId) throw Error('This assembly is no longer in storage.');
    if (buildState.assemblies.some(g => g.id === id)) {
      toast('This assembly is already selected.');
      return true;
    }
    const fields = new Set(a.components.map(c => c.field).filter(Boolean));
    if (
      buildState.parts.some(r => fields.has(BuildModel.slots.find(s => s.id === r.slot)?.field)) ||
      buildState.assemblies.some(g =>
        liveAssemblies()
          .find(a => a.id === g.id)
          ?.components.some(c => fields.has(c.field))
      )
    )
      throw Error('Some positions already have parts assigned. Remove those assignments before adding this assembly.');
    buildState.assemblies.push({ id: a.id, name: a.name, signature: BuildModel.signature(a) });
    markBuildDirty();
    $('#dialog').close();
    buildRefresh();
  }
  if (action === 'build-save-draft') {
    const revision = db.revision,
      data = structuredClone(buildState);
    buildDraftId = await change('build.draft.save', { id: buildDraftId || undefined, revision, data });
    buildDirty = JSON.stringify(buildState) !== JSON.stringify(data);
    buildRefresh();
    toast(
      buildDirty
        ? 'Draft saved. Your newer changes are still unsaved.'
        : 'Plan saved. Use Review shopping changes to check its parts list.'
    );
  }
  if (action === 'build-review') await reviewBuild();
  if (action === 'build-new') {
    const reset = () => {
      buildState = BuildModel.blank();
      buildDraftId = null;
      buildDirty = false;
      buildSlot = 'motor';
      buildSearch = '';
      buildAll = false;
      buildPopOpen = false;
    };
    if (buildDirty)
      modal(
        'Start a new build?',
        '<p>Unsaved changes to this build will be discarded. Cancel and choose Save plan to keep them.</p>',
        async () => reset(),
        'Discard changes & start'
      );
    else {
      reset();
      render();
    }
  }
  if (action === 'build-drafts')
    modal(
      'Saved builds',
      `<p class="muted">Drafts are plans with linked shopping items. They do not reserve stock and are included in complete backups.</p>${db.buildDrafts.map(d => `<div class="list-row"><div><strong>${esc(d.data.name || 'Untitled build')}</strong><div class="tiny muted">${date(d.updated)} · ${d.data.parts.length} part assignments · ${d.data.assemblies.length} assemblies</div></div><div class="actions">${btn('Open', 'build-load-draft', 'small', d.id)}${d.rebuildJobId || d.data.rebuild ? '<span class="tiny muted">Cancel in Workshop</span>' : binBtn('Delete draft', 'build-delete-draft', d.id)}</div></div>`).join('') || '<p class="muted">No saved drafts yet.</p>'}`,
      null
    );
  if (action === 'build-load-draft') {
    const d = db.buildDrafts.find(d => d.id === id);
    if (!d) throw Error('Draft no longer exists.');
    const load = () => {
      page = 'Build from Scratch';
      carId = null;
      buildContext = db.id;
      buildState = structuredClone(d.data);
      buildDraftId = d.id;
      buildDirty = false;
      buildSlot = 'motor';
      buildSearch = '';
      buildAll = false;
      buildPopOpen = false;
    };
    if (buildDirty)
      modal(
        'Open another draft?',
        '<p>Unsaved changes to your current build will be discarded. Cancel and save them first if needed.</p>',
        async () => load(),
        'Discard changes & open'
      );
    else {
      load();
      $('#dialog').close();
      render();
    }
  }
  if (action === 'build-delete-draft') {
    const revision = db.revision;
    modal(
      'Delete build draft?',
      '<p>This removes only the saved plan. Cars and inventory stay unchanged.</p>',
      async () => {
        await change('build.draft.delete', { id, revision });
        if (buildDraftId === id) {
          buildDraftId = null;
          buildDirty = true;
        }
      },
      'Delete draft'
    );
  }
  return true;
}
document.addEventListener('input', e => {
  if (e.target.dataset.buildTooth) {
    const key = e.target.dataset.buildTooth;
    buildState.gearing ??= { pinion: '', gear: '' };
    buildState.gearing[key] = e.target.validity.badInput ? 'invalid' : e.target.value;
    markBuildDirty();
    refreshBuildPerformance();
  }
  const el = e.target;
  if (el.dataset.buildValue) {
    const k = el.dataset.buildValue;
    buildState[k] =
      k === 'usage'
        ? el.value
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : el.value;
    markBuildDirty();
  }
  if (el.id === 'build-stock-search') {
    buildSearch = el.value;
    if (local() && db._view) scheduleView();
    else $('#build-stock-list').innerHTML = buildPickerRows();
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'build-all') {
    buildAll = el.checked;
    if (local() && db._view) void loadView();
    else $('#build-stock-list').innerHTML = buildPickerRows();
  }
  if (el.id === 'build-setup') {
    buildState.saveSetup = el.checked;
    markBuildDirty();
  }
  if (el.id === 'build-zoom') {
    buildZoom = Number(el.value);
    $('.build-diagram').setAttribute('class', 'build-diagram zoom-' + buildZoom);
  }
  if (el.id === 'build-quantity') {
    const r = buildState.parts.find(r => r.slot === buildSlot),
      quantity = Number(el.value);
    if (!r) return;
    if (!el.value || !Number.isSafeInteger(quantity) || quantity < 1) {
      el.value = r.quantity;
      toast('Choose a positive whole quantity.', true);
      return;
    }
    r.quantity = quantity;
    markBuildDirty();
    buildRefresh();
  }
});
document.addEventListener('keydown', e => {
  if (buildPopOpen && e.key === 'Escape' && !$('#dialog')?.open) {
    e.preventDefault();
    closeBuildPop();
    document.querySelector('.build-hotspot.selected')?.focus({ preventScroll: true });
    return;
  }
  if (e.target.id === 'build-stock-search' && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    const items = [...document.querySelectorAll('#build-stock-list .build-stock-item:not([disabled])')];
    if (!items.length) return;
    e.preventDefault();
    const at = items.findIndex(i => i.classList.contains('hi'));
    if (e.key === 'Enter') return void (items[at] || items[0]).click();
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
    items.forEach((item, i) => item.classList.toggle('hi', i === next));
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.target.matches('.build-hotspot') && ['Enter', ' '].includes(e.key)) {
    e.preventDefault();
    e.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});
document.addEventListener('click', e => {
  if (!buildPopOpen || page !== 'Build from Scratch') return;
  if (e.target.closest('#build-pop, [data-action="build-slot"], #dialog')) return;
  closeBuildPop();
});
window.addEventListener('scroll', () => buildPopOpen && placeBuildPop(), true);
window.addEventListener('resize', () => buildPopOpen && placeBuildPop());
