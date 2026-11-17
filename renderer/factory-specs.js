function useFactorySpecifications(id) {
  if (!local()) throw Error('Switch to your own collection to edit specifications.');
  const ctx = slotcarResearchContext(id),
    car = db.cars.find(c => c.id === id);
  const rows = FactorySpecs.preview(car, techLabels, db.installations, db.parts);
  if (!rows.length) {
    modal(
      'Use Factory specifications',
      `<p>${Object.values(car.factory || {}).some(v => typeof v === 'string' && v.trim()) ? 'There are no different Factory specifications to apply.' : 'No Factory specifications are recorded yet. Add them using Edit specifications or import slotcar research first.'}</p>`,
      null
    );
    return;
  }
  const row = r =>
    `<article class="research-proposal"><label class="check"><input type="checkbox" data-review-choice ${r.returns.length ? 'data-review-manual' : ''} name="factory-copy-${esc(r.field)}" ${r.selected ? 'checked' : ''}> <strong>${esc(r.label)}</strong></label><div class="research-values"><div><span class="tiny muted">Current specification</span><p class="prewrap">${esc(r.current || 'Not recorded')}</p></div><div><span class="tiny muted">Factory specification</span><p class="prewrap">${esc(r.value)}</p></div></div>${r.returns.length ? '<p class="note warning">Applying this field returns ' + esc(r.returns.map(i => i.quantity + ' × ' + i.name + (i.assembly ? ' (assembly component)' : '')).join(', ')) + ' to <strong>Used spares</strong>. Other assembly components stay fitted. No replacement inventory is installed.</p>' : ''}</article>`;
  modal(
    'Use Factory specifications',
    `<p><strong>${esc(car.name)}</strong></p><p>Fill empty fields or select existing values to replace. Only tick the Factory specifications that describe your car now.</p><div data-review-selection>${ReviewSelection.toolbar()}<div class="research-proposals">${rows.map(row).join('')}</div></div><p class="tiny muted mt">Empty fields are selected automatically. Stock-return replacements must be selected individually; Select all skips them. Unselected fields, Factory reference, saved setups and race snapshots remain unchanged.</p><label class="check-row mt"><input type="checkbox" name="confirmed" required>I checked the selected replacements and any returns to stock.</label>`,
    async values => {
      checkSlotcarResearch(ctx);
      if (!values.confirmed) throw Error('Confirm the selected replacements.');
      const fields = Object.keys(values)
        .filter(k => k.startsWith('factory-copy-'))
        .map(k => k.slice('factory-copy-'.length));
      await change('car.save', { id: ctx.carId, revision: ctx.revision, ...FactorySpecs.patch(rows, fields) });
    },
    'Apply selected specifications'
  );
}
