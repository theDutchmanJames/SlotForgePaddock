function slotcarResearchTools(c) {
  return panel(
    'Research this slotcar',
    `<p>Identify the miniature by its manufacturer and exact product reference. Give the template to your own AI, then choose which suggestions to import.</p><p><strong>${esc(c.maker || 'Manufacturer not set')}</strong> · ${esc(c.reference || 'Product reference not set')} · ${esc(c.scale || 'Scale not set')}</p><div class="actions">${btn('Download slotcar template', 'slotcar-kit', '', c.id)}${btn('Import slotcar research…', 'slotcar-pick', '', c.id)}</div><p class="tiny muted mt">English instructions ask for five independent sources, with three agreeing per verified specification. Source URLs are optional. Factory specifications stay separate from your modifications. No built-in AI or automatic website lookup.</p>`
  );
}
function slotcarResearchContext(id) {
  const c = db.cars.find(c => c.id === id);
  if (!c) throw Error('Car not found.');
  return {
    databaseId: db.id,
    carId: id,
    revision: c.revision,
    path: dataPath,
    car: {
      maker: c.maker,
      reference: c.reference,
      scale: c.scale,
      factory: structuredClone(c.factory || {}),
      technical: structuredClone(c.technical || {}),
      ...Object.fromEntries(Object.keys(SlotcarResearch.identity).map(k => [k, c[k] || '']))
    }
  };
}
function checkSlotcarResearch(ctx) {
  if (
    !local() ||
    db.id !== ctx.databaseId ||
    dataPath !== ctx.path ||
    db.cars.find(c => c.id === ctx.carId)?.revision !== ctx.revision
  )
    throw Error('The car or collection changed. Reopen slotcar research.');
}
function reviewSlotcarResearch(ctx, result) {
  checkSlotcarResearch(ctx);
  const m = result.identification;
  const returns = p =>
    (result.installedParts || []).filter(
      i => i.field === p.field.slice(8) && p.value !== ctx.car.technical[i.field] && p.value !== i.name
    );
  const row = (p, i, current = false) => {
    const factory = p.field.startsWith('factory.'),
      key = p.field.slice(8),
      old = current ? ctx.car.technical[key] : factory ? ctx.car.factory[key] : ctx.car[p.field],
      stock = current ? returns(p) : [];
    return `<article class="research-proposal"><label class="check"><input type="checkbox" data-review-choice ${stock.length ? 'data-review-manual' : ''} name="${current ? 'slotcar-current-' : 'slotcar-field-'}${i}"> <strong>${esc(SlotcarResearch.labels[p.field])}</strong> ${badge(current ? 'Current configuration' : factory ? 'Factory reference' : 'Car identity')}</label><div class="research-values"><div><span class="tiny muted">Saved value</span><p class="prewrap">${esc(old || '—')}</p></div><div><span class="tiny muted">Proposed value</span><p class="prewrap">${esc(p.value)}</p></div></div>${stock.length ? '<p class="note warning">Selecting this replacement returns ' + esc(stock.map(i => i.quantity + ' × ' + i.name + (i.assembly ? ' (assembly component)' : '')).join(', ')) + ' to <strong>Used spares</strong>. Other assembly components stay fitted. No replacement inventory is installed automatically.</p>' : ''}<p class="tiny muted prewrap">${esc(p.uncertainty || 'No verification details supplied. Check this specification before accepting.')}</p>${p.sourceUrls.map(url => historySourceButton(url, result.sources.find(s => s.url === url)?.title || url)).join('')}</article>`;
  };
  modal(
    'Review slotcar product research',
    `<p><strong>${esc(m.maker)} · ${esc(m.reference)}</strong>${m.scale ? ' · ' + esc(m.scale) : ''}</p><p class="note info">Check the exact product variant. AI verification statements are not independently checked by Paddock. Select the fields to replace, even when they already contain a value. Unknown and unchecked fields stay unchanged.</p>${m.uncertainty ? '<p class="note">' + esc(m.uncertainty) + '</p>' : ''}<div class="actions">${m.sourceUrls.map(url => historySourceButton(url, result.sources.find(s => s.url === url)?.title || url)).join('')}</div><h3>Identity and Factory reference</h3><p class="muted">Original product information. This section does not change your current setup or installed parts.</p><div data-review-selection>${ReviewSelection.toolbar()}<div class="research-proposals">${result.proposals.map((p, i) => row(p, i)).join('')}</div></div>${result.proposals.some(p => p.field.startsWith('factory.')) ? '<h3 class="mt">Current configuration — optional overrides</h3><p class="muted">Copy only the specifications that describe your car now. Existing values can be replaced individually. Stock-return replacements must be selected individually; Select all skips them.</p><div data-review-selection>' + ReviewSelection.toolbar() + '<div class="research-proposals">' + result.proposals.map((p, i) => (p.field.startsWith('factory.') ? row(p, i, true) : '')).join('') + '</div></div>' : ''}<p class="tiny muted mt">Saved setups and race snapshots remain unchanged. Evidence notes are appended to Factory reference → Technical notes.</p><label class="check-row mt"><input type="checkbox" name="confirmed" required>I checked the product variant, selected replacements and any returns to stock.</label>`,
    async values => {
      checkSlotcarResearch(ctx);
      if (!values.confirmed) throw Error('Confirm the product match.');
      const selected = prefix =>
          Object.keys(values)
            .filter(k => k.startsWith(prefix))
            .map(k => Number(k.slice(prefix.length))),
        indices = selected('slotcar-field-'),
        current = selected('slotcar-current-');
      const data = SlotcarResearch.patch(ctx.car, result, indices, current),
        stockOverrides = current
          .filter(i => returns(result.proposals[i]).length)
          .map(i => result.proposals[i].field.slice(8));
      await change('car.save', {
        id: ctx.carId,
        revision: ctx.revision,
        data,
        ...(stockOverrides.length ? { stockOverrides } : {})
      });
    },
    'Import selected fields'
  );
}
async function slotcarResearchAction(action, id) {
  if (!['slotcar-research', 'slotcar-kit', 'slotcar-pick'].includes(action)) return false;
  if (!local()) throw Error('Switch to your own collection to research a slotcar.');
  const ctx = slotcarResearchContext(id);
  if (action === 'slotcar-research') {
    modal('Slotcar product research', slotcarResearchTools(db.cars.find(c => c.id === id)), null);
    return true;
  }
  const request = { databaseId: ctx.databaseId, carId: id, revision: ctx.revision };
  if (action === 'slotcar-kit') {
    if (await api('file', 'slotcar.kit', request))
      toast('Slotcar template saved. Give it to your own AI, then import its completed JSON.');
    return true;
  }
  const result = await api('file', 'slotcar.pick', request);
  if (result) reviewSlotcarResearch(ctx, result);
  return true;
}
