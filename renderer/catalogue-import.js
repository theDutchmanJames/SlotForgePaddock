function cataloguePrice(p) {
  const price = p?.price;
  if (!price) return '';
  return (
    '<div class="note info"><strong>Indicative price · ' +
    esc(price.currency) +
    ' ' +
    esc(price.amount) +
    ' / ' +
    esc(price.basis) +
    '</strong> ' +
    badge(price.status === 'estimate' ? 'Estimated' : 'Published', price.status === 'estimate' ? 'warn' : '') +
    (price.explanation ? '<p>' + esc(price.explanation) + '</p>' : '') +
    (price.sourceUrl ? '<p class="tiny">Price source: ' + esc(price.sourceUrl) + '</p>' : '') +
    (price.checkedDate ? '<p class="tiny">Checked: ' + esc(price.checkedDate) + '</p>' : '') +
    '<p class="tiny muted">For guidance only. Stock values and shopping costs are unchanged. To correct this price, edit the JSON and import it again.</p></div>'
  );
}
let catalogueReview = null,
  catalogueSelected = new Set(),
  catalogueDecisions = new Map(),
  catalogueQuery = '',
  catalogueStatus = '',
  catalogueOpen = new Set(),
  catalogueLimits = new Map();
const catalogueStatusNames = {
  new: 'New product',
  update: 'Proposed update',
  unchanged: 'Already up to date',
  possible: 'Possible match',
  ambiguous: 'Multiple stock matches',
  invalid: 'Needs correction',
  conflict: 'Choose a file version'
};
function catalogueDetails(item) {
  const p = item.catalogue?.product;
  if (!p) return '';
  return `<details class="catalogue-facts mt"><summary>Manufacturer catalogue information</summary><div class="mt">${dl(
    [
      ['Product', p.name],
      ['Manufacturer', p.manufacturer],
      ['Reference', p.reference],
      ['Sold pack', p.packSize === null ? 'Unknown' : [p.packSize, p.packUnit].filter(Boolean).join(' ')],
      ['Packaging', p.packDescription],
      ['Source checked', p.checkedDate]
    ]
  )}<p class="tiny muted">${p.kind === 'part' ? 'Owned quantities count individual pieces.' : 'Owned quantities count items / containers.'} A sold pack is not an owned quantity.</p>${cataloguePrice(p)}${p.specifications.length ? dl(p.specifications.map(s => [s.name, [s.value, s.unit].filter(Boolean).join(' ')])) : ''}${p.sourceUrl ? `<p class="catalogue-source tiny">Source: ${esc(p.sourceUrl)}</p>` : ''}${p.reviewNotes ? `<p class="note">${esc(p.reviewNotes)}</p>` : ''}<p class="tiny muted">Catalogue facts are source information. Your stock details and personal notes are managed separately.</p></div></details>`;
}
function catalogueImportCard() {
  return (
    `<section class="panel catalogue-intro mt"><div class="row">${uiTile('box', 'blue')}<div><h2>Standard Catalogue · product information</h2><p class="muted">Give the import kit to your AI with a manufacturer's website, then review the completed JSON here.</p></div></div><div class="actions mt">${btn('Download research templates', 'catalogue-kit')}${btn('AI instructions', 'catalogue-instructions')}${btn('Import catalogue files…', 'catalogue-pick', 'primary')}${catalogueReview ? btn('Continue catalogue review', 'catalogue-resume') : ''}</div><p class="tiny muted">Complete or per-group templates with detailed specifications, variant checklists and indicative prices in EUR, USD or GBP. Select multiple completed JSON files for one combined review. New entries start at zero owned stock. Text and specifications only; no website scraping or image downloads.</p></section>` +
    pictureRequestCard()
  );
}
function catalogueSource(index) {
  const sources = catalogueReview.sources?.[index] || [];
  return (
    sources
      .slice(0, 8)
      .map(s => s.file + ' · row ' + s.row)
      .join('; ') + (sources.length > 8 ? ' · ' + (sources.length - 8) + ' more source rows' : '')
  );
}
function catalogueDecorate() {
  for (const conflict of catalogueReview.conflicts || []) {
    if (catalogueReview.input.products[conflict.index] !== null) continue;
    const row = catalogueReview.preview.rows[conflict.index];
    row.status = 'conflict';
    row.product = conflict.variants[0].product;
    row.errors = ['Choose one source version before selecting this product.'];
  }
}
async function catalogueKitDialog() {
  const groups = await api('file', 'catalogue.groups');
  modal(
    'Download catalogue research templates',
    `<p>Use a complete kit, or give your AI one focused group at a time. Tyres have their own research file; the app keeps Wheels &amp; tyres together.</p><label class="field">Indicative price currency<select name="currency" required><option value="">Choose currency…</option><option value="EUR">EUR — Euro</option><option value="USD">USD — US dollar</option><option value="GBP">GBP — Pound sterling</option></select></label><label class="field">Templates<select name="scope" id="catalogue-kit-scope"><option value="all">Complete catalogue</option><option value="groups">Selected research groups</option></select></label><details class="mt" id="catalogue-kit-groups" hidden open><summary>Research groups</summary><div class="form-grid">${groups.map(g => `<label class="check-row"><input type="checkbox" name="group-${esc(g.id)}">${esc(g.label)} <small class="muted">${g.kind === 'supply' ? 'Workshop supply' : 'Part'}</small></label>`).join('')}</div></details><p class="tiny muted">Selected groups are saved as separate JSON files in a new folder. English output and detailed coverage apply to every template. Each product gets an indicative price in your chosen currency: published when available, otherwise clearly labelled as an estimate. Specifications are never guessed.</p>`,
    async values => {
      if (values.scope === 'all') {
        if (!(await api('file', 'catalogue.kit', { currency: values.currency })))
          throw Error('Save cancelled. Choose a destination or close this window.');
        toast('Complete research kit saved.');
      } else {
        const ids = groups.filter(g => values['group-' + g.id]).map(g => g.id);
        if (!ids.length) throw Error('Select at least one research group.');
        const result = await api('file', 'catalogue.kits', { groups: ids, currency: values.currency });
        if (!result) throw Error('Save cancelled. Choose a folder or close this window.');
        toast(result.count + ' templates saved in ' + result.directory);
      }
    },
    'Save templates'
  );
}
function catalogueVersionPreview(index, version) {
  const variant = catalogueReview?.conflicts?.find(c => c.index === index)?.variants[version];
  if (!variant) return '<p class="muted">Choose a version to inspect its contents.</p>';
  const text = JSON.stringify(variant.product, null, 2);
  return (
    '<p class="tiny muted">' +
    esc(
      variant.sources
        .slice(0, 20)
        .map(s => s.file + ' · row ' + s.row)
        .join('; ')
    ) +
    (variant.sources.length > 20 ? ' · ' + (variant.sources.length - 20) + ' more source rows' : '') +
    '</p><pre class="catalogue-version">' +
    esc(text.slice(0, 32000)) +
    '</pre>' +
    (text.length > 32000
      ? '<p class="note">Long preview shortened. Check the complete product in its source JSON before choosing.</p>'
      : '')
  );
}
function catalogueConflictDialog(index) {
  const conflict = catalogueReview.conflicts.find(c => c.index === index);
  if (!conflict) return;
  modal(
    'Choose a product version',
    `<p>These files describe the same product differently. Inspect each version, then choose the one to use. You can still correct its fields afterwards. Nothing is imported here.</p><label class="field mt">Version to inspect and use<select name="version" id="catalogue-version-choice" data-index="${index}" required><option value="">Choose a version…</option>${conflict.variants.map((v, i) => `<option value="${i}">Version ${i + 1} · ${esc([...new Set(v.sources.map(s => s.file))].slice(0, 3).join(', '))} · ${v.sources.length} source row(s)</option>`).join('')}</select></label><div id="catalogue-version-preview">${catalogueVersionPreview(index, -1)}</div>`,
    async values => {
      const variant = conflict.variants[Number(values.version)];
      if (values.version === '' || !variant) throw Error('Choose a version.');
      catalogueReview.input.products[index] = structuredClone(variant.product);
      catalogueDecisions.delete(index);
      catalogueSelected.delete(index);
      await refreshCatalogueMatches();
    },
    'Use this version'
  );
}
function catalogueGroup(row) {
  return row.product
    ? (row.product.kind === 'supply' ? 'Workshop supplies' : 'Parts') + ' · ' + (row.product.category || 'Unclassified')
    : 'Invalid records';
}
function catalogueFiltered() {
  return catalogueReview.preview.rows.filter(
    r =>
      (!catalogueStatus || r.status === catalogueStatus) &&
      (!catalogueQuery ||
        [r.product?.name, r.product?.manufacturer, r.product?.reference, r.product?.category]
          .join(' ')
          .toLowerCase()
          .includes(catalogueQuery.toLowerCase()))
  );
}
function catalogueChoice(r) {
  if (catalogueDecisions.has(r.index)) return catalogueDecisions.get(r.index);
  if (r.status === 'new') return { create: true };
  if (r.status === 'update' && r.matches.length === 1) return { targetId: r.matches[0].id };
  return null;
}
function catalogueSelectable(r) {
  return !r.errors.length && r.status !== 'unchanged' && !!catalogueChoice(r);
}
function catalogueGroupRows() {
  const groups = new Map();
  for (const row of catalogueFiltered()) {
    const key = catalogueGroup(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return (
    [...groups]
      .map(([name, rows]) => {
        const selectable = rows.filter(catalogueSelectable),
          selected = selectable.filter(r => catalogueSelected.has(r.index)),
          limit = catalogueLimits.get(name) || 50;
        return `<details class="panel catalogue-group" data-catalogue-group="${esc(name)}" ${catalogueOpen.has(name) || catalogueQuery ? 'open' : ''}><summary><input type="checkbox" aria-label="Select ${esc(name)}" data-catalogue-select-group="${esc(name)}" ${selectable.length && selected.length === selectable.length ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}><strong>${esc(name)}</strong><span class="badge">${rows.length}</span><span class="tiny muted">${selected.length} selected</span></summary><div class="catalogue-product-list">${rows
          .slice(0, limit)
          .map(
            r =>
              `<div class="catalogue-product"><input type="checkbox" aria-label="Select ${esc(r.product?.name || 'invalid row ' + (r.index + 1))}" data-catalogue-select="${r.index}" ${catalogueSelected.has(r.index) ? 'checked' : ''} ${catalogueSelectable(r) ? '' : 'disabled'}><button type="button" data-action="catalogue-product" data-id="${r.index}"><strong>${esc(r.product?.name || 'Invalid product · row ' + (r.index + 1))}</strong><small>${esc([r.product?.manufacturer, r.product?.reference].filter(Boolean).join(' · '))}</small><small>${esc(catalogueSource(r.index))}</small><span>${badge(catalogueStatusNames[r.status], r.status === 'invalid' ? 'warn' : r.status === 'new' ? 'good' : '')}${r.warnings.length ? badge(r.warnings.length + ' notes', 'warn') : ''}${catalogueChoice(r) && ['possible', 'ambiguous'].includes(r.status) ? badge('Match resolved', 'good') : ''}</span></button>${btn('Review', 'catalogue-product', 'small', String(r.index))}${catalogueReview.conflicts?.some(c => c.index === r.index) && r.status !== 'conflict' ? btn('Choose another version', 'catalogue-version', 'small', String(r.index)) : ''}</div>`
          )
          .join(
            ''
          )}${rows.length > limit ? `<button type="button" class="btn small" data-action="catalogue-more" data-id="${esc(name)}">Show 50 more (${rows.length - limit} remaining)</button>` : ''}</div></details>`;
      })
      .join('') || '<div class="empty"><h2>No matching products</h2><p>Change the search or status filter.</p></div>'
  );
}
function renderCatalogueReview() {
  if (catalogueReview.databaseId !== db.id) {
    catalogueReview = null;
    catalogueSelected.clear();
    return renderExchangeDesign();
  }
  return (
    heading(
      'Review manufacturer catalogue',
      catalogueReview.name,
      btn('Back to Import & Export', 'catalogue-back') +
        btn('Refresh matches', 'catalogue-refresh') +
        btn('Discard review', 'catalogue-discard', 'danger')
    ) +
    `<div class="note info">Nothing has been imported yet. New products start at <strong>zero owned quantity</strong>. Updates change manufacturer catalogue information only; local names, stock quantities, fitted parts, photographs, notes and history stay intact. Source accuracy and physical compatibility need your review.</div>${catalogueReview.files ? `<p class="tiny muted">${catalogueReview.files.length} file(s) · ${catalogueReview.originalRows} source rows · ${catalogueReview.collapsed} identical duplicates combined. Conflicting versions require an explicit choice.</p>${catalogueReview.coverage?.length ? `<details class="note info"><summary>Research coverage notes</summary>${catalogueReview.coverage.map(c => `<p><strong>${esc(c.name)}</strong><br>${esc(c.notes)}</p>`).join('')}</details>` : ''}` : ''}<div class="toolbar"><label class="search">${icon('search')}<input id="catalogue-search" placeholder="Find products, references or categories…" value="${esc(catalogueQuery)}" aria-label="Search catalogue"></label><select id="catalogue-status" aria-label="Filter product status"><option value="">All statuses</option>${Object.entries(
      catalogueStatusNames
    )
      .map(([key, label]) => `<option value="${key}" ${catalogueStatus === key ? 'selected' : ''}>${label}</option>`)
      .join(
        ''
      )}</select>${btn('Select all selectable results', 'catalogue-select-all')}${btn('Select all new products', 'catalogue-select-new')}${btn('Clear selection', 'catalogue-clear')}</div><div class="catalogue-import-bar"><span id="catalogue-selection-count">${catalogueSelected.size} selected · ${catalogueReview.preview.rows.length} products in review</span>${btn('Review selected import →', 'catalogue-confirm', 'primary')}</div><div id="catalogue-groups">${catalogueGroupRows()}</div>`
  );
}
function refreshCatalogueGroups() {
  const container = $('#catalogue-groups');
  if (!container) return;
  container.innerHTML = catalogueGroupRows();
  $('#catalogue-selection-count').textContent =
    catalogueSelected.size + ' selected · ' + catalogueReview.preview.rows.length + ' products in review';
}
async function refreshCatalogueMatches() {
  const previousChoices = new Map(
    catalogueReview.preview.rows.map(row => [row.index, JSON.stringify(catalogueChoice(row))])
  );
  const r = await readScreen();
  acceptSnapshot(r.data);
  if (catalogueReview.databaseId !== db.id) {
    catalogueReview = null;
    throw Error('Database changed. Import the catalogue again.');
  }
  catalogueReview.preview = await api('plan', 'catalogue.preview', { input: catalogueReview.input });
  catalogueDecorate();
  for (const row of catalogueReview.preview.rows) {
    const choice = catalogueDecisions.get(row.index);
    if (
      choice &&
      ((choice.targetId && !row.matches.some(m => m.id === choice.targetId)) ||
        (choice.create && !['new', 'possible'].includes(row.status)))
    )
      catalogueDecisions.delete(row.index);
    if (!catalogueSelectable(row) || previousChoices.get(row.index) !== JSON.stringify(catalogueChoice(row)))
      catalogueSelected.delete(row.index);
  }
}
function catalogueProductDialog(index) {
  const row = catalogueReview.preview.rows[index],
    p = row.product;
  if (row.status === 'conflict') {
    catalogueConflictDialog(index);
    return;
  }
  if (!p) {
    modal(
      'Invalid product',
      `<p>${esc(row.errors.join(' '))}</p><p>Correct this row in the JSON file and import the file again. Other valid products can still be selected.</p>`,
      null
    );
    return;
  }
  const categories = p.kind === 'supply' ? slotforgeCatalogue.supplies : slotforgeCatalogue.parts,
    decision = catalogueChoice(row);
  const text = (key, label, max = 200) =>
    `<label class="field">${label}<input name="${key}" maxlength="${max}" value="${esc(p[key] || '')}"></label>`;
  const options = (list, value) =>
    '<option value="">Choose…</option>' +
    list.map(v => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('');
  modal(
    'Review product · ' + p.name,
    `<p class="tiny muted">${esc(catalogueSource(index))}</p>${row.errors.length ? `<div class="note">${row.errors.map(esc).join('<br>')}</div>` : ''}${row.warnings.length ? `<div class="note info">${row.warnings.map(esc).join('<br>')}</div>` : ''}<div class="form-grid">${text('name', 'Product name')}${text('manufacturer', 'Manufacturer')}${text('reference', 'Product reference / SKU')}<label class="field">Destination<select name="kind" id="catalogue-kind"><option value="part" ${p.kind === 'part' ? 'selected' : ''}>Part</option><option value="supply" ${p.kind === 'supply' ? 'selected' : ''}>Workshop supply</option></select></label><label class="field">Category<select name="category" id="catalogue-category">${options(Object.keys(categories), p.category)}</select></label><label class="field">Part / item type<select name="partType" id="catalogue-type">${options(Object.hasOwn(categories, p.category) ? categories[p.category] : [], p.partType)}</select></label><label class="field">Supply kind<select name="supplyKind">${options(['Tool / equipment', 'Consumable'], p.supplyKind)}</select></label><label class="field">Pieces / items in sold pack (unknown: blank)<input name="packSize" type="number" min="1" max="1000000" step="1" value="${p.packSize === null ? '' : esc(p.packSize)}"></label>${text('packUnit', 'Pack unit', 80)}${text('packDescription', 'Packaging description', 500)}${text('sourceUrl', 'Product source URL', 2048)}${text('checkedDate', 'Source checked (YYYY-MM-DD)', 10)}<label class="field wide">Source uncertainty / review notes<textarea name="reviewNotes" maxlength="4000">${esc(p.reviewNotes)}</textarea></label></div>${cataloguePrice(p)}<details class="mt"><summary>Specifications (${p.specifications.length})</summary>${dl(p.specifications.map(s => [s.name, [s.value, s.unit].filter(Boolean).join(' ')]))}<p class="tiny muted">To correct specification values or unsupported source fields, edit the JSON file and import it again.</p></details><section class="mt"><h3>Existing stock matches</h3>${
      row.matches.length
        ? row.matches
            .map(m => {
              const old = (m.kind === 'part' ? db.parts : db.supplies).find(v => v.id === m.id);
              return `<details class="catalogue-match"><summary>${esc(m.name)} · ${m.quantity} owned${m.location ? ' · ' + esc(m.location) : ''}${m.archived ? ' · archived' : ''}</summary><p class="tiny muted">${esc(m.maker)} · ${esc(m.reference)} · ${esc(m.id)}</p>${old ? catalogueDetails(old) : ''}<p class="tiny muted">The incoming values above will replace this record's catalogue information only.</p></details>`;
            })
            .join('')
        : '<p class="muted">No existing match found.</p>'
    }<label class="field mt">When selected for import<select name="decision"><option value="">Leave unresolved / do not import</option>${['new', 'possible', 'invalid'].includes(row.status) ? `<option value="new" ${decision?.create ? 'selected' : ''}>Create a new zero-stock entry</option>` : ''}${row.matches.map(m => `<option value="${m.id}" ${decision?.targetId === m.id ? 'selected' : ''}>Update catalogue information · ${esc(m.name)} · ${esc(m.reference || m.id.slice(0, 8))}</option>`).join('')}</select></label></section><p class="tiny muted">Saving corrections does not import the product. If its identity or classification changes, matching is checked again.</p>`,
    async values => {
      const original = catalogueReview.input.products[index],
        next = { ...original };
      for (const key of [
        'name',
        'manufacturer',
        'reference',
        'kind',
        'category',
        'partType',
        'supplyKind',
        'packUnit',
        'packDescription',
        'sourceUrl',
        'checkedDate',
        'reviewNotes'
      ])
        next[key] = values[key];
      next.packSize = values.packSize === '' ? null : Number(values.packSize);
      const identityChanged = ['name', 'manufacturer', 'reference', 'kind', 'category', 'partType'].some(
        k => next[k] !== original[k]
      );
      catalogueReview.input.products[index] = next;
      catalogueDecisions.delete(index);
      catalogueSelected.delete(index);
      await refreshCatalogueMatches();
      const fresh = catalogueReview.preview.rows[index];
      if (!identityChanged) {
        if (!values.decision) catalogueDecisions.set(index, null);
        else if (values.decision === 'new' && ['new', 'possible'].includes(fresh.status))
          catalogueDecisions.set(index, { create: true });
        else if (fresh.matches.some(m => m.id === values.decision))
          catalogueDecisions.set(index, { targetId: values.decision });
      }
    },
    'Save review choices'
  );
}
async function pickCatalogueFile() {
  const result = await api('file', 'catalogue.pick');
  if (!result) return;
  if (result.picturePreview) {
    setTimeout(() => previewOpen(result.picturePreview), 0);
    return;
  }
  catalogueReview = { ...result, databaseId: db.id, active: true };
  catalogueDecorate();
  catalogueSelected = new Set();
  catalogueDecisions = new Map();
  catalogueQuery = '';
  catalogueStatus = '';
  catalogueOpen = new Set(result.preview.rows.length <= 30 ? result.preview.rows.map(catalogueGroup) : []);
  catalogueLimits = new Map();
  page = 'Import & Export';
}
async function catalogueAction(action, id) {
  if (!action.startsWith('catalogue-')) return false;
  if (!local()) return true;
  if (action === 'catalogue-kit') await catalogueKitDialog();
  if (action === 'catalogue-instructions') {
    const prompt = await api('file', 'catalogue.instructions');
    modal(
      'Instructions for your AI',
      `<p>Give your AI the downloaded JSON kit and the manufacturer or retailer URLs. For corrections, also attach the existing catalogue. The kit includes English output requirements and classification guidance.</p><textarea class="catalogue-prompt" readonly aria-label="AI instructions">${esc(prompt)}</textarea><p class="tiny muted">Select the text to copy it, or provide the complete kit file directly.</p>`,
      null
    );
  }
  if (action === 'catalogue-pick') {
    if (catalogueReview) {
      modal(
        'Replace the current catalogue review?',
        '<p>Choosing another file replaces your current selections and corrections. Cancel the file chooser to keep this review. No stock has changed.</p>',
        async () => pickCatalogueFile(),
        'Choose another file'
      );
      return true;
    }
    await pickCatalogueFile();
    render();
  }
  if (action === 'catalogue-resume' && catalogueReview) {
    catalogueReview.active = true;
    render();
  }
  if (action === 'catalogue-back') {
    catalogueReview.active = false;
    render();
  }
  if (action === 'catalogue-discard')
    modal(
      'Discard catalogue review?',
      '<p>Discard these selections and corrections? Nothing has been imported.</p>',
      async () => {
        catalogueReview = null;
        catalogueSelected.clear();
      },
      'Discard review'
    );
  if (action === 'catalogue-refresh') {
    await refreshCatalogueMatches();
    render();
    toast('Matches refreshed. Check the selected import before confirming.');
  }
  if (action === 'catalogue-product') catalogueProductDialog(Number(id));
  if (action === 'catalogue-version') catalogueConflictDialog(Number(id));
  if (action === 'catalogue-more') {
    catalogueLimits.set(id, (catalogueLimits.get(id) || 50) + 50);
    catalogueOpen.add(id);
    refreshCatalogueGroups();
  }
  if (action === 'catalogue-select-all') {
    for (const r of catalogueFiltered()) if (catalogueSelectable(r)) catalogueSelected.add(r.index);
    refreshCatalogueGroups();
  }
  if (action === 'catalogue-select-new') {
    for (const r of catalogueReview.preview.rows)
      if (r.status === 'new' && catalogueSelectable(r)) catalogueSelected.add(r.index);
    refreshCatalogueGroups();
  }
  if (action === 'catalogue-clear') {
    catalogueSelected.clear();
    refreshCatalogueGroups();
  }
  if (action === 'catalogue-confirm') {
    const payload = {
      revision: catalogueReview.preview.revision,
      input: structuredClone(catalogueReview.input),
      selections: [...catalogueSelected].map(index => ({
        index,
        ...catalogueChoice(catalogueReview.preview.rows[index])
      }))
    };
    const summary = await api('plan', 'catalogue.selection', payload);
    modal(
      'Confirm catalogue import',
      `<p><strong>${summary.created} new zero-stock entries</strong> and <strong>${summary.updated} catalogue updates</strong>.</p><div class="note info">No owned quantities will be added or changed. Existing local fields, fitted inventory and history remain intact. Only the selected products are imported.</div><ul class="catalogue-confirm-list">${summary.chosen.map(c => `<li>${esc(c.product.name)} · ${c.targetId ? 'Update catalogue information' : 'New · 0 owned'}${c.product.reviewNotes ? ' · has source review notes' : ''}</li>`).join('')}</ul><label class="check-row"><input name="confirmed" type="checkbox" required>I have reviewed the selected products, source information and matches.</label>`,
      async values => {
        let result;
        try {
          result = await change('catalogue.apply', { ...payload, confirmed: !!values.confirmed });
        } catch (e) {
          if (e.clubQueued) {
            catalogueReview = null;
            catalogueSelected.clear();
            catalogueDecisions.clear();
          }
          throw e;
        }
        catalogueReview = null;
        catalogueSelected.clear();
        catalogueDecisions.clear();
        toast(
          result.created + ' products added with zero owned stock; ' + result.updated + ' catalogue records updated.'
        );
      },
      'Import selected products'
    );
  }
  return true;
}
document.addEventListener(
  'toggle',
  e => {
    const key = e.target.dataset?.catalogueGroup;
    if (key) {
      if (e.target.open) catalogueOpen.add(key);
      else catalogueOpen.delete(key);
    }
  },
  true
);
document.addEventListener('input', e => {
  if (e.target.id === 'catalogue-search') {
    catalogueQuery = e.target.value;
    refreshCatalogueGroups();
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'catalogue-version-choice')
    $('#catalogue-version-preview').innerHTML = catalogueVersionPreview(
      Number(el.dataset.index),
      el.value === '' ? -1 : Number(el.value)
    );
  if (el.id === 'catalogue-kit-scope') $('#catalogue-kit-groups').hidden = el.value !== 'groups';
  if (el.id === 'catalogue-status') {
    catalogueStatus = el.value;
    refreshCatalogueGroups();
  }
  if (el.dataset.catalogueSelect !== undefined) {
    const i = Number(el.dataset.catalogueSelect);
    if (el.checked && catalogueSelectable(catalogueReview.preview.rows[i])) catalogueSelected.add(i);
    else catalogueSelected.delete(i);
    refreshCatalogueGroups();
  }
  if (el.dataset.catalogueSelectGroup) {
    for (const row of catalogueFiltered().filter(
      r => catalogueGroup(r) === el.dataset.catalogueSelectGroup && catalogueSelectable(r)
    )) {
      if (el.checked) catalogueSelected.add(row.index);
      else catalogueSelected.delete(row.index);
    }
    refreshCatalogueGroups();
  }
  if (['catalogue-kind', 'catalogue-category'].includes(el.id)) {
    const categories = $('#catalogue-kind').value === 'supply' ? slotforgeCatalogue.supplies : slotforgeCatalogue.parts;
    if (el.id === 'catalogue-kind')
      $('#catalogue-category').innerHTML =
        '<option value="">Choose…</option>' +
        Object.keys(categories)
          .map(k => `<option>${esc(k)}</option>`)
          .join('');
    $('#catalogue-type').innerHTML =
      '<option value="">Choose…</option>' +
      (Object.hasOwn(categories, $('#catalogue-category').value) ? categories[$('#catalogue-category').value] : [])
        .map(k => `<option>${esc(k)}</option>`)
        .join('');
  }
});
