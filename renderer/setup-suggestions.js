// Add setup, after docs/ui-reference/add-setup-2026-11 (option D, "setup sheet"): a compact starting-point switch,
// every position as one row grouped by area with its specification you can type over, an optional catalogue part
// chosen from a search popover beside the row, and a live setup sheet of exactly what will be saved.
// Form names stay: setupSource (#setup-source), name, notes, suggest-part-<slot>, suggest-quantity-<slot>.
const setupGroups = [
  ['Drivetrain', ['motor', 'pinionPart', 'gearPart', 'pod', 'wiring']],
  [
    'Wheels & tyres',
    ['rearTyres', 'rearWheels', 'rearAxle', 'rearBearings', 'frontTyres', 'frontWheels', 'frontAxle', 'frontBearings']
  ],
  ['Chassis & guide', ['chassis', 'guide', 'braids', 'fasteners', 'suspension', 'magnets', 'ballast']],
  ['Body & electronics', ['body', 'lights', 'chip']]
];
let setupState = null;
const setupSlot = id => BuildModel.slots.find(s => s.id === id);
function setupSourceLabel(source) {
  return { factory: 'Factory specifications', current: 'Current configuration', snapshot: 'Snapshot of now' }[source];
}
function setupSpecCount(values) {
  return Object.values(values || {}).filter(v => typeof v === 'string' && v.trim()).length;
}
function setupRowHtml(slot, technical, row) {
  const value = technical[slot.field] || '';
  return `<div class="ss-row" data-slot="${slot.id}" data-field="${esc(slot.field)}"><span class="ss-pos">${esc(slot.label)}</span><span class="ss-spec"><input name="spec-${esc(slot.field)}" value="${esc(value)}" data-source="${esc(value)}" placeholder="Write the specification…" maxlength="2000" autocomplete="off" aria-label="${esc(slot.label)} specification"><span class="ss-own">your own</span></span><span class="ss-link-cell"><button type="button" class="ss-link" data-action="ss-link" data-id="${slot.id}" aria-haspopup="dialog"></button><small class="ss-why" id="suggest-reason-${slot.id}"></small><input type="hidden" name="suggest-part-${slot.id}" value=""></span><span class="ss-q"><button type="button" data-action="ss-qty" data-id="${slot.id}|-1" aria-label="One fewer">−</button><input type="number" name="suggest-quantity-${slot.id}" min="1" max="1000" step="1" value="${row?.quantity || slot.quantity || 1}" aria-label="${esc(slot.label)} pieces"><button type="button" data-action="ss-qty" data-id="${slot.id}|1" aria-label="One more">+</button></span></div>`;
}
function setupBodyHtml(model) {
  const t = model.technical || {},
    rows = new Map(model.rows.map(r => [r.slot, r])),
    shown = new Set(),
    hidden = [];
  const groups = setupGroups
    .map(([g, ids]) => {
      const html = ids
        .map(setupSlot)
        .filter(slot => slot?.field)
        .map(slot => {
          const visible = !!(t[slot.field] || '').trim() || rows.get(slot.id)?.candidates.length;
          if (!visible) hidden.push(slot);
          else shown.add(slot.id);
          return setupRowHtml(slot, t, rows.get(slot.id)).replace(
            '<div class="ss-row"',
            `<div class="ss-row"${visible ? '' : ' hidden'}`
          );
        })
        .join('');
      return `<div class="ss-group" data-group="${esc(g)}"><div class="ss-grp">${esc(g)}</div>${html}</div>`;
    })
    .join('');
  return `${groups}${hidden.length ? `<div class="ss-more"><span>Add a position</span>${hidden.map(s => `<button type="button" data-action="ss-show" data-id="${s.id}">+ ${esc(s.label)}</button>`).join('')}</div>` : ''}<p class="ss-help">${model.maker ? `Suggestions come from ${esc(model.maker)} parts in your catalogue.` : 'Set the car’s manufacturer to get catalogue suggestions.'} Type over any specification to make it your own. Linking a catalogue part is optional and fits nothing.</p>`;
}
function setupSnapshotHtml(car) {
  const t = car.technical || {},
    count = setupSpecCount(t);
  return `<div class="ss-snapshot"><h3>Snapshot of what is fitted now</h3><p>Saves the car exactly as it is today: its <b class="mono">${count}</b> current ${count === 1 ? 'specification' : 'specifications'} and the parts fitted to it, as history. There is nothing to choose.</p><p class="muted">Use it before a rebuild, a race weekend or a big change, so you can compare later.</p></div>`;
}
async function setupSuggestionEditor(id) {
  const car = db.cars.find(c => c.id === id),
    ctx = { databaseId: db.id, path: dataPath, revision: car.revision },
    counts = { factory: setupSpecCount(car.factory), current: setupSpecCount(car.technical) };
  setupState = { id, car, ctx, model: null, busy: false, generation: 0, chosen: {}, slot: null };
  const checkContext = () => {
    if (!local() || db.id !== ctx.databaseId || dataPath !== ctx.path)
      throw Error('The collection changed. Reopen Add setup.');
  };
  modal(
    'Add setup',
    `<div class="setup-sheet"><div class="ss-top"><div class="ss-start"><div class="eye">Start from</div><select name="setupSource" id="setup-source" hidden><option value="factory">Factory specifications — suggested plan</option><option value="current">Current configuration — suggested plan</option><option value="snapshot">Current fitted configuration — snapshot</option></select><div class="ss-src" role="group" aria-label="Start from">${[
      ['factory', 'Factory specifications', counts.factory + (counts.factory === 1 ? ' spec' : ' specs')],
      ['current', 'Current configuration', counts.current + (counts.current === 1 ? ' spec' : ' specs')],
      ['snapshot', 'Snapshot of now', 'as it is today']
    ]
      .map(
        ([k, l, n]) =>
          `<button type="button" class="${k === 'factory' ? 'on' : ''}" data-action="ss-source" data-id="${k}" aria-pressed="${k === 'factory'}">${l}<small>${n}</small></button>`
      )
      .join(
        ''
      )}</div></div>${field('name', 'Setup name', '')}${field('notes', 'Notes (optional)', '')}</div><div class="ss-body"><div class="ss-main" id="ss-main"><div id="setup-suggestions" aria-live="polite"></div><div id="ss-snapshot" hidden></div></div><aside class="ss-side"><div class="ss-sh"><div class="eye">Setup sheet</div><h3>As it will be saved</h3></div><div class="ss-sb" id="ss-sheet"></div></aside></div></div>`,
    async values => {
      checkContext();
      const st = setupState;
      if (st.busy) throw Error('Wait for suggestions to finish loading.');
      const source = values.setupSource;
      let suggestion;
      if (source !== 'snapshot') {
        if (!st.model || st.model.source !== source) throw Error('Reload the suggestions before saving.');
        const rows = [],
          specifications = {};
        for (const input of document.querySelectorAll('#setup-suggestions input[name^="spec-"]'))
          if (input.value.trim() !== input.dataset.source.trim())
            specifications[input.name.slice(5)] = input.value.trim();
        for (const slot of BuildModel.slots) {
          const partId = values['suggest-part-' + slot.id];
          if (!partId) continue;
          const candidate = st.model.rows.find(r => r.slot === slot.id)?.candidates.find(c => c.id === partId),
            picked = st.chosen[slot.id]?.id === partId ? st.chosen[slot.id] : null;
          if (!candidate && !picked) throw Error('Choose a part for ' + slot.label + ' from the list.');
          rows.push({
            slot: slot.id,
            partId,
            quantity: Number(values['suggest-quantity-' + slot.id]) || slot.quantity || 1,
            ...(candidate ? { signature: candidate.signature } : {})
          });
        }
        suggestion = { source, rows, ...(Object.keys(specifications).length ? { specifications } : {}) };
      }
      await change('setup.save', {
        carId: id,
        carRevision: st.model?.carRevision ?? ctx.revision,
        name: values.name,
        notes: values.notes,
        ...(suggestion ? { suggestion } : {})
      });
      section = 'Setups';
      carId = id;
      page = 'Cars';
    },
    'Save setup plan'
  );
  $('#dialog').classList.add('setup-dialog');
  $('#dialog .dialog-head h2').insertAdjacentHTML('beforebegin', `<span class="ss-car">${photo(car, true)}</span>`);
  $('#dialog .dialog-head h2').insertAdjacentHTML(
    'afterend',
    `<span class="ss-car-name">${esc([car.name, car.maker, car.scale].filter(Boolean).join(' · '))}</span>`
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="ss-summary" id="ss-summary"></span>');
  const form = $('#modal-form'),
    select = $('#setup-source'),
    target = $('#setup-suggestions'),
    button = form.querySelector('[type=submit]');
  async function load() {
    const st = setupState,
      turn = ++st.generation,
      source = select.value;
    st.model = null;
    st.chosen = {};
    closeSetupPop();
    document.querySelectorAll('[data-action="ss-source"]').forEach(b => {
      b.classList.toggle('on', b.dataset.id === source);
      b.setAttribute('aria-pressed', String(b.dataset.id === source));
    });
    button.textContent = source === 'snapshot' ? 'Save snapshot' : 'Save setup plan';
    $('#ss-snapshot').hidden = source !== 'snapshot';
    if (source === 'snapshot') {
      st.busy = false;
      button.disabled = false;
      target.innerHTML = '';
      $('#ss-snapshot').innerHTML = setupSnapshotHtml(car);
      setupRefresh();
      return;
    }
    st.busy = true;
    button.disabled = true;
    target.innerHTML = '<p class="ss-loading">Finding catalogue matches…</p>';
    try {
      const result = await api('plan', 'setup.suggest', { carId: id, source });
      if (turn !== st.generation || !form.isConnected) return;
      checkContext();
      if (result.databaseId !== ctx.databaseId) throw Error('The collection changed. Reopen Add setup.');
      st.model = result;
      target.innerHTML = setupBodyHtml(result);
      for (const row of document.querySelectorAll('#setup-suggestions .ss-row')) setupSyncRow(row.dataset.slot);
      setupRefresh();
    } catch (e) {
      if (turn === st.generation && form.isConnected) {
        target.textContent = e.message;
        st.model = null;
      }
    } finally {
      if (turn === st.generation && form.isConnected) {
        st.busy = false;
        button.disabled = !st.model;
      }
    }
  }
  select.addEventListener('change', load);
  await load();
}
// One row: the link chip, the reason line, the pieces and the "your own" mark follow the form values.
function setupSyncRow(slotId) {
  const st = setupState,
    row = $(`#setup-suggestions .ss-row[data-slot="${slotId}"]`);
  if (!st || !row) return;
  const partId = $(`#modal-form [name="suggest-part-${slotId}"]`).value,
    candidates = st.model?.rows.find(r => r.slot === slotId)?.candidates || [],
    part = candidates.find(c => c.id === partId) || (st.chosen[slotId]?.id === partId ? st.chosen[slotId] : null),
    chip = row.querySelector('.ss-link'),
    spec = row.querySelector('input[name^="spec-"]');
  row.classList.toggle('linked', !!partId);
  row.classList.toggle('own', spec.value.trim() !== spec.dataset.source.trim());
  chip.classList.toggle('empty', !partId);
  chip.innerHTML = partId
    ? `<span class="ss-link-name">${esc(part?.name || 'Chosen part')}</span>${part?.reference ? `<span class="ss-link-ref mono">${esc(part.reference)}</span>` : ''}`
    : candidates.length
      ? `<b>${candidates.length} ${candidates.length === 1 ? 'suggestion' : 'suggestions'}</b><span>· link a part</span>`
      : '<span>Link a part from your catalogue…</span>';
  $(`#suggest-reason-${slotId}`).textContent = partId ? part?.reason || (part ? 'Chosen from your catalogue' : '') : '';
}
function setupRefresh() {
  const st = setupState;
  if (!st || !$('#ss-sheet')) return;
  const source = $('#setup-source').value,
    car = st.car,
    sheet = $('#ss-sheet'),
    summary = $('#ss-summary');
  if (source === 'snapshot') {
    const t = car.technical || {};
    sheet.innerHTML = `<div class="ss-card"><div class="ss-card-top"><span class="ss-card-pic">${photo(car, true)}</span><div><h4>${esc($('#modal-form [name=name]').value.trim() || 'New snapshot')}</h4><small>${esc(car.name)} · snapshot of now</small></div></div>${setupGroups
      .map(([g, ids]) => {
        const rows = ids
          .map(setupSlot)
          .filter(s => s?.field && (t[s.field] || '').trim())
          .map(s => `<div class="r"><span>${esc(s.label)}</span><b>${esc(t[s.field])}</b><i></i></div>`)
          .join('');
        return rows ? `<div class="g">${esc(g)}</div>${rows}` : '';
      })
      .join('')}<div class="foot">Current specifications and fitted parts, saved as history.</div></div>`;
    if (summary) summary.innerHTML = '<b>Snapshot</b> of the car as it is today';
    return;
  }
  let linked = 0,
    own = 0,
    positions = 0;
  const groups = setupGroups
    .map(([g, ids]) => {
      const rows = ids
        .map(id => $(`#setup-suggestions .ss-row[data-slot="${id}"]`))
        .filter(Boolean)
        .map(row => {
          const slot = setupSlot(row.dataset.slot),
            spec = row.querySelector('input[name^="spec-"]'),
            partId = $(`#modal-form [name="suggest-part-${slot.id}"]`).value,
            value = spec.value.trim(),
            isOwn = value !== spec.dataset.source.trim();
          if (!value && !partId) return '';
          positions++;
          if (partId) linked++;
          if (isOwn && value) own++;
          const name = partId ? row.querySelector('.ss-link-name')?.textContent || value : value;
          return `<div class="r"><span>${esc(slot.label)}</span><b>${esc(name)}</b>${partId ? '<i class="p">part</i>' : isOwn ? '<i class="e">own</i>' : '<i></i>'}</div>`;
        })
        .join('');
      return rows ? `<div class="g">${esc(g)}</div>${rows}` : '';
    })
    .join('');
  sheet.innerHTML = `<div class="ss-card"><div class="ss-card-top"><span class="ss-card-pic">${photo(car, true)}</span><div><h4>${esc($('#modal-form [name=name]').value.trim() || 'New setup')}</h4><small>${esc(car.name)} · from ${esc(setupSourceLabel(source))}</small></div></div>${groups || '<p class="ss-card-empty">No specifications yet. Type one in a position on the left.</p>'}${setupOtherSpecs()}<div class="foot">${linked} ${linked === 1 ? 'part' : 'parts'} linked · ${own} written by you · nothing fitted, reserved or bought</div></div>`;
  if (summary)
    summary.innerHTML = `<b>${positions}</b> ${positions === 1 ? 'position' : 'positions'} · <b>${linked}</b> ${linked === 1 ? 'part' : 'parts'} linked · <b>${own}</b> your own`;
}

// Specifications from the source that are not positions (teeth, weight, RPM…) are kept as they are.
function setupOtherSpecs() {
  const t = setupState?.model?.technical || {},
    rowFields = new Set([...document.querySelectorAll('#setup-suggestions .ss-row')].map(r => r.dataset.field)),
    label = k => (typeof techLabels !== 'undefined' && techLabels[k]) || fieldLabel(k),
    other = Object.keys(t).filter(k => !rowFields.has(k) && typeof t[k] === 'string' && t[k].trim());
  return other.length
    ? `<div class="g">Also kept from the source</div><div class="ss-also">${other.map(k => `<span>${esc(label(k))} <b>${esc(t[k])}</b></span>`).join('')}</div>`
    : '';
}
/* the part search popover beside a row */
let setupSearchTimer = null,
  setupSearchSerial = 0;
function closeSetupPop() {
  $('#ss-pop')?.remove();
  document.querySelectorAll('.ss-link.open').forEach(b => b.classList.remove('open'));
  if (setupState) setupState.slot = null;
}
function setupOption(slotId, p, why) {
  return `<button type="button" class="ss-opt" data-action="ss-pick" data-id="${esc(slotId + '|' + p.id)}"><span class="ss-opt-pic">${p.picture ? `<img src="${esc(thumbnailSource(p.picture))}" alt="" loading="lazy">` : itemIcon({ category: p.category || '', partType: p.partType || '' })}</span><span><b>${esc(p.name)}</b><small>${esc([p.reference, why].filter(Boolean).join(' · '))}</small></span></button>`;
}
function openSetupPop(slotId) {
  const st = setupState,
    slot = setupSlot(slotId),
    anchor = $(`.ss-link[data-id="${slotId}"]`);
  if (!st || !anchor) return;
  closeSetupPop();
  st.slot = slotId;
  anchor.classList.add('open');
  const candidates = st.model?.rows.find(r => r.slot === slotId)?.candidates || [],
    spec = $(`#setup-suggestions .ss-row[data-slot="${slotId}"] input[name^="spec-"]`).value.trim();
  const pop = document.createElement('div');
  pop.id = 'ss-pop';
  pop.className = 'ss-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Choose a part for ' + slot.label);
  pop.innerHTML = `<input id="ss-search" type="search" placeholder="Search your parts catalogue…" autocomplete="off"><div class="ss-pop-list">${candidates.length ? `<div class="ss-pop-g">Suggested${spec ? ' for “' + esc(spec) + '”' : ''}</div>${candidates.map(c => setupOption(slotId, c, c.reason)).join('')}` : ''}<div id="ss-found"></div></div><div class="ss-pop-foot">${btn('No part · written spec only', 'ss-pick', 'small ghost', slotId + '|')}</div>`;
  $('#dialog').append(pop);
  setupPlacePop();
  $('#ss-search').focus();
  setupSearch('');
}
function setupPlacePop() {
  const pop = $('#ss-pop'),
    anchor = $(`.ss-link[data-id="${setupState?.slot}"]`);
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect(),
    h = pop.offsetHeight,
    below = innerHeight - r.bottom - 12;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (below >= h || below > r.top ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
}
// Search the whole catalogue for parts that fit this position (same types as Build from Scratch).
function setupSearch(query) {
  clearTimeout(setupSearchTimer);
  const serial = ++setupSearchSerial,
    slotId = setupState?.slot,
    slot = setupSlot(slotId);
  setupSearchTimer = setTimeout(
    async () => {
      const box = $('#ss-found');
      if (!box || !slot) return;
      try {
        const r = await api('read', {
          queryView: {
            page: 'Shopping List',
            shoppingFinder: { query, kind: 'part', maker: '', category: '', partType: '' }
          }
        });
        if (serial !== setupSearchSerial || !$('#ss-found')) return;
        const known = new Set((setupState.model?.rows.find(x => x.slot === slotId)?.candidates || []).map(c => c.id)),
          items = (r.data._view.shoppingFinder.items || []).filter(
            p => slot.types.includes(p.partType) && !known.has(p.id)
          );
        setupState.found = new Map(items.map(p => [p.id, p]));
        box.innerHTML = items.length
          ? `<div class="ss-pop-g">${query ? 'In your catalogue' : 'Other ' + esc(slot.label.toLowerCase()) + ' parts'}</div>${items
              .slice(0, 12)
              .map(p => setupOption(slotId, p, [p.maker, p.partType].filter(Boolean).join(' · ')))
              .join('')}`
          : query
            ? '<p class="ss-pop-none">No fitting parts match your search.</p>'
            : '';
      } catch (e) {
        if (serial === setupSearchSerial && $('#ss-found'))
          $('#ss-found').innerHTML = `<p class="ss-pop-none">${esc(e.message)}</p>`;
      }
    },
    query ? 200 : 0
  );
}
function setupAction(action, id) {
  if (!action.startsWith('ss-') || !$('.setup-sheet')) return false;
  const st = setupState;
  if (action === 'ss-source') {
    const select = $('#setup-source');
    select.value = id;
    select.dispatchEvent(new Event('change'));
  }
  if (action === 'ss-link') {
    if (st.slot === id) closeSetupPop();
    else openSetupPop(id);
  }
  if (action === 'ss-pick') {
    const [slotId, partId] = [id.slice(0, id.indexOf('|')), id.slice(id.indexOf('|') + 1)],
      found = st.found?.get(partId);
    if (found) st.chosen[slotId] = { id: found.id, name: found.name, reference: found.reference || '' };
    $(`#modal-form [name="suggest-part-${slotId}"]`).value = partId;
    closeSetupPop();
    setupSyncRow(slotId);
    setupRefresh();
    $(`.ss-link[data-id="${slotId}"]`)?.focus();
  }
  if (action === 'ss-qty') {
    const [slotId, d] = id.split('|'),
      input = $(`#modal-form [name="suggest-quantity-${slotId}"]`);
    input.value = String(Math.min(1000, Math.max(1, (Number(input.value) || 1) + Number(d))));
  }
  if (action === 'ss-show') {
    const row = $(`#setup-suggestions .ss-row[data-slot="${id}"]`);
    row.hidden = false;
    $(`.ss-more [data-id="${id}"]`)?.remove();
    if (!document.querySelector('.ss-more button')) $('.ss-more')?.remove();
    row.querySelector('input[name^="spec-"]').focus();
  }
  return true;
}
document.addEventListener('input', e => {
  if (e.target.id === 'ss-search') return setupSearch(e.target.value.trim());
  if (!e.target.closest?.('.setup-sheet')) return;
  const row = e.target.closest('.ss-row');
  if (row) setupSyncRow(row.dataset.slot);
  setupRefresh();
});
document.addEventListener('change', e => {
  const m = /^suggest-part-(.+)$/.exec(e.target.name || '');
  if (m && e.target.closest?.('.setup-sheet')) {
    setupSyncRow(m[1]);
    setupRefresh();
  }
});
document.addEventListener('keydown', e => {
  const pop = $('#ss-pop');
  if (!pop) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    const slot = setupState?.slot;
    closeSetupPop();
    $(`.ss-link[data-id="${slot}"]`)?.focus();
  }
});
document.addEventListener('mousedown', e => {
  const pop = $('#ss-pop');
  if (pop && !pop.contains(e.target) && !e.target.closest('.ss-link')) closeSetupPop();
});
document.addEventListener(
  'scroll',
  e => {
    if ($('#ss-pop') && e.target.closest?.('.ss-main')) setupPlacePop();
  },
  true
);
addEventListener('resize', () => setupPlacePop());
