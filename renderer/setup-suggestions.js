async function setupSuggestionEditor(id) {
  const car = db.cars.find(c => c.id === id),
    ctx = { databaseId: db.id, path: dataPath, revision: car.revision };
  let model = null,
    busy = false,
    generation = 0;
  const checkContext = () => {
    if (!local() || db.id !== ctx.databaseId || dataPath !== ctx.path)
      throw Error('The collection changed. Reopen Add setup.');
  };
  modal(
    'Add setup',
    `<div class="form-grid">${field('name', 'Setup name', '')}<label class="field">Build from<select name="setupSource" id="setup-source"><option value="factory">Factory specifications — suggested plan</option><option value="current">Current configuration — suggested plan</option><option value="snapshot">Current fitted configuration — snapshot</option></select></label>${field('notes', 'Notes (optional)', '', 'textarea')}</div><p class="note info" id="setup-explanation">Review catalogue suggestions below. Saving creates a setup plan only. Fitting owned parts is a separate action.</p><div id="setup-suggestions" aria-live="polite"></div>`,
    async values => {
      checkContext();
      if (busy) throw Error('Wait for suggestions to finish loading.');
      const source = values.setupSource;
      let suggestion;
      if (source !== 'snapshot') {
        if (!model || model.source !== source) throw Error('Reload the suggestions before saving.');
        const rows = [];
        for (const row of model.rows) {
          const partId = values['suggest-part-' + row.slot];
          if (!partId) continue;
          const candidate = row.candidates.find(c => c.id === partId);
          if (!candidate) throw Error('Choose a suggested part.');
          rows.push({
            slot: row.slot,
            partId,
            quantity: Number(values['suggest-quantity-' + row.slot]),
            signature: candidate.signature
          });
        }
        suggestion = { source, rows };
      }
      await change('setup.save', {
        carId: id,
        carRevision: model?.carRevision ?? ctx.revision,
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
  const form = $('#modal-form'),
    select = $('#setup-source'),
    target = $('#setup-suggestions'),
    button = form.querySelector('[type=submit]');
  async function load() {
    const turn = ++generation,
      source = select.value;
    model = null;
    button.textContent = source === 'snapshot' ? 'Save snapshot' : 'Save setup plan';
    $('#setup-explanation').textContent =
      source === 'snapshot'
        ? 'Save the car’s current specifications and fitted parts as a historical snapshot.'
        : 'Review catalogue suggestions below. Saving creates a setup plan only. Fitting owned parts is a separate action.';
    if (source === 'snapshot') {
      busy = false;
      button.disabled = false;
      target.innerHTML = '';
      return;
    }
    busy = true;
    button.disabled = true;
    target.textContent = 'Finding catalogue matches…';
    try {
      const result = await api('plan', 'setup.suggest', { carId: id, source });
      if (turn !== generation || !form.isConnected) return;
      checkContext();
      if (result.databaseId !== ctx.databaseId) throw Error('The collection changed. Reopen Add setup.');
      model = result;
      target.innerHTML = `<p class="muted">${result.maker ? 'Candidates from ' + esc(result.maker) + ' in your parts catalogue.' : 'Set the car manufacturer to find catalogue candidates.'} Matching names or specifications do not prove factory fitment. Choose only parts you have verified; leave other positions unassigned. Quantities are individual pieces.</p>${!Object.values(result.technical).some(v => v?.trim()) ? '<p class="note warning">No specifications are saved for this source. Add Factory specifications or choose Current configuration.</p>' : ''}${result.rows.map(row => `<section class="panel mt"><h3>${esc(row.label)}</h3><p class="muted prewrap">${esc(row.specification)}</p>${row.candidates.length ? `<div class="form-grid"><label class="field">Verified catalogue part<select name="suggest-part-${row.slot}"><option value="">Leave unassigned</option>${row.candidates.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.reference ? ' [' + esc(p.reference) + ']' : ''}</option>`).join('')}</select></label>${field('suggest-quantity-' + row.slot, 'Quantity (pieces)', row.quantity, 'number')}</div><p class="tiny muted" id="suggest-reason-${row.slot}">Choose a part to see why it was suggested.</p>${row.candidateCount > 8 ? '<p class="tiny muted">Showing the eight closest matches.</p>' : ''}` : '<p class="muted">No supported catalogue match. The written specification will still be saved.</p>'}</section>`).join('')}<p class="tiny muted mt">All specifications from the chosen source are saved. Unassigned positions remain written specifications. No inventory is fitted, reserved or purchased.</p>`;
      for (const row of result.rows) {
        const picker = form.elements['suggest-part-' + row.slot];
        if (picker)
          picker.addEventListener('change', () => {
            $('#suggest-reason-' + row.slot).textContent =
              row.candidates.find(p => p.id === picker.value)?.reason || 'No catalogue part assigned.';
          });
      }
    } catch (e) {
      if (turn === generation && form.isConnected) {
        target.textContent = e.message;
        model = null;
      }
    } finally {
      if (turn === generation && form.isConnected) {
        busy = false;
        button.disabled = !model;
      }
    }
  }
  select.addEventListener('change', load);
  await load();
}
