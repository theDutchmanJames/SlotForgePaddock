'use strict';
// Quick archive and delete: the icons on a car card, and the same actions for the selected cars.
// Both use the normal car.archive and car.delete steps, one car at a time.

// A selected car can be on another page of the list, so it may not be loaded.
async function carActionTarget(id) {
  const loaded = db.cars.find(c => c.id === id);
  if (loaded || !db._view) return loaded;
  const r = await api('read', { queryView: { page: 'Cars', carId: id, section: 'Overview' } });
  return r.data.cars.find(c => c.id === id);
}
async function refreshCarsAfterAction() {
  if (db._view) await loadView();
  else render();
}
const carQuickActionsAvailable = () => local() && !db.club && !clubState?.active;
function carCardActions(c) {
  if (!carQuickActionsAvailable()) return '';
  const restore = !!c.archived;
  return (
    (c.rebuild?.to
      ? ''
      : iconBtn(
          restore ? 'restore' : 'archive',
          (restore ? 'Restore ' : 'Archive ') + c.name,
          'car-quick-archive',
          'ghost',
          c.id
        )) + binBtn('Delete ' + c.name + '…', 'car-quick-delete', c.id)
  );
}
function carSelectionActions() {
  if (!carQuickActionsAvailable()) return '';
  return (
    btn(
      icon(archived ? 'restore' : 'archive') + (archived ? ' Restore selected' : ' Archive selected'),
      'cars-archive-selected',
      'small'
    ) + btn(icon('trash') + ' Delete selected…', 'cars-delete-selected', 'small danger')
  );
}
function carDeleteDetails(plan) {
  const c = plan.counts,
    parts = [
      c.setups && `${c.setups} ${c.setups === 1 ? 'setup' : 'setups'}`,
      c.tests && `${c.tests} manual ${c.tests === 1 ? 'test' : 'tests'}`,
      c.jobs && `${c.jobs} workshop ${c.jobs === 1 ? 'job' : 'jobs'}`,
      c.documents && `${c.documents} ${c.documents === 1 ? 'document' : 'documents'}`,
      c.events > 1 && `${c.events} history entries`
    ].filter(Boolean);
  return parts;
}
function carNameList(names) {
  const shown = names.slice(0, 8);
  return `<ul class="car-action-list">${shown.map(n => `<li>${esc(n)}</li>`).join('')}${names.length > shown.length ? `<li class="muted">and ${names.length - shown.length} more</li>` : ''}</ul>`;
}
async function deleteCarNow(id) {
  // Plan again right before each delete: it checks the car and gives the current revision.
  const plan = await api('plan', 'car.delete', { id });
  await change('car.delete', { id, revision: plan.revision, confirmName: plan.name, confirmed: true });
  selected.delete(id);
}
async function carActionsAction(action, id) {
  if (action === 'car-quick-archive') {
    const c = await carActionTarget(id);
    if (!c) throw Error('This car is no longer in the collection.');
    await change('car.archive', { id, revision: c.revision });
    selected.delete(id);
    toast(c.archived ? `${c.name} restored.` : `${c.name} archived. Show archived cars in Filters to find it again.`);
    await refreshCarsAfterAction();
    return true;
  }
  if (action === 'car-quick-delete') {
    const plan = await api('plan', 'car.delete', { id });
    const details = carDeleteDetails(plan);
    modal(
      'Delete ' + plan.name,
      `<p>This permanently deletes <strong>${esc(plan.name)}</strong>${details.length ? ', with its ' + esc(details.join(', ')) : ' and its photos'}. It cannot be undone.</p>${plan.loosePieces ? `<p>${plan.loosePieces} fitted ${plan.loosePieces === 1 ? 'piece goes' : 'pieces go'} back to Used spares.</p>` : ''}${plan.assemblies ? `<p>${plan.assemblies} ${plan.assemblies === 1 ? 'assembly goes' : 'assemblies go'} back to Used assemblies.</p>` : ''}<p class="muted">To keep the car but hide it, archive it instead.</p>`,
      async () => {
        await change('car.delete', { id, revision: plan.revision, confirmName: plan.name, confirmed: true });
        selected.delete(id);
        if (db._view) await loadView();
      },
      'Delete permanently'
    );
    return true;
  }
  if (action === 'cars-archive-selected') {
    const ids = [...selected],
      restore = archived;
    let done = 0;
    const failed = [];
    for (const carIdToChange of ids) {
      const c = await carActionTarget(carIdToChange);
      if (!c || !!c.archived === !restore || c.rebuild?.to) continue;
      try {
        await change('car.archive', { id: c.id, revision: c.revision });
        selected.delete(c.id);
        done++;
      } catch (e) {
        failed.push(`${c.name}: ${e.message}`);
      }
    }
    toast(
      `${restore ? 'Restored' : 'Archived'} ${done} ${done === 1 ? 'car' : 'cars'}.` +
        (failed.length ? ` Not changed: ${failed.join('; ')}` : ''),
      !!failed.length
    );
    await refreshCarsAfterAction();
    return true;
  }
  if (action === 'cars-delete-selected') {
    const ids = [...selected],
      plans = [];
    for (const one of ids) plans.push(await api('plan', 'car.delete', { id: one }));
    const sum = key => plans.reduce((n, p) => n + (p.counts[key] || 0), 0),
      total = carDeleteDetails({
        counts: {
          setups: sum('setups'),
          tests: sum('tests'),
          jobs: sum('jobs'),
          documents: sum('documents'),
          events: sum('events')
        }
      }),
      pieces = plans.reduce((n, p) => n + p.loosePieces, 0),
      assemblies = plans.reduce((n, p) => n + p.assemblies, 0);
    modal(
      `Delete ${plans.length} ${plans.length === 1 ? 'car' : 'cars'}`,
      `<p>This permanently deletes these cars with their photos and history. It cannot be undone.</p>${carNameList(plans.map(p => p.name))}${total.length ? `<p>Also deleted with them: ${esc(total.join(', '))}.</p>` : ''}${pieces ? `<p>${pieces} fitted ${pieces === 1 ? 'piece goes' : 'pieces go'} back to Used spares.</p>` : ''}${assemblies ? `<p>${assemblies} ${assemblies === 1 ? 'assembly goes' : 'assemblies go'} back to Used assemblies.</p>` : ''}<p class="muted">To keep cars but hide them, use Archive selected instead.</p>`,
      async () => {
        const failed = [];
        let done = 0;
        for (const p of plans) {
          try {
            await deleteCarNow(p.id);
            done++;
          } catch (e) {
            failed.push(`${p.name}: ${e.message}`);
          }
        }
        if (db._view) await loadView();
        if (failed.length) throw Error(`Deleted ${done}. Not deleted: ${failed.join('; ')}`);
        toast(`Deleted ${done} ${done === 1 ? 'car' : 'cars'}.`);
      },
      'Delete permanently'
    );
    return true;
  }
  return false;
}
