// Collection planning stays private to the local database.
const jobPlan = id =>
  db.planning.jobs.find(p => p.jobId === id) || {
    priority: 'Normal',
    targetDate: '',
    waiting: false,
    checklist: [],
    photos: []
  };
const planningChange = (action, p) => change('planning.' + action, { revision: db.revision, ...p });
function purchaseStockIssue(p, shopping = false) {
  if (liveAssemblies().some(a => a.components.some(c => c.partId === p.id)))
    return 'This stock belongs to an assembly. Choose its original catalogue record or add a separate stock record.';
  const pending = shopping
    ? db.planning.shopping
        .filter(s => s.partId === p.id && !shopDeleted(s) && !shopDone(s))
        .reduce((n, s) => n + Math.max(0, shopQuantity(s) - s.received), 0)
    : 0;
  return p.tracking === 'individual' && p.quantity + pending >= 1
    ? 'This individual identity is already owned or on the shopping list. Add a separate record for another identity.'
    : '';
}
function purchaseStockActions(p) {
  return (
    (purchaseStockIssue(p) ? '' : btn('Add to my stock', 'receive-stock', '', p.id)) +
    (purchaseStockIssue(p, true) ? '' : btn('Add to shopping list', 'shop-add', '', p.id))
  );
}
function shoppingList(jobId, readOnly = false) {
  const lines = db.planning.shopping.filter(s => (!jobId || s.jobId === jobId) && !shopDeleted(s)),
    pending = lines.filter(s => !shopDone(s)),
    complete = lines.filter(shopDone);
  return (
    '<section class="shopping-section ' +
    (jobId ? 'is-embedded' : 'standalone-shopping') +
    '"><div class="plan-section-heading"><h3>' +
    icon('shopping') +
    'Shopping list ' +
    badge(pending.length) +
    '</h3>' +
    (!readOnly ? btn('Add shopping item', 'shop-add', 'small', jobId ? 'job:' + jobId : '') : '') +
    '</div>' +
    (shoppingUndo && !readOnly
      ? '<div class="note shopping-undo">Item deleted. ' + btn('Undo', 'shop-undo', 'small', shoppingUndo) + '</div>'
      : '') +
    '<div class="shopping-checklist embedded-checklist">' +
    shoppingRows(pending, readOnly, !!jobId) +
    (complete.length ? '<h4>Done</h4>' + shoppingRows(complete, readOnly, !!jobId) : '') +
    '</div>' +
    (!lines.length ? '<p class="muted">No shopping items yet.</p>' : '') +
    '<p class="plan-help">Done can tick an item off or add it to stock. Fitting it to a car is a separate step.</p></section>'
  );
}
function receiveStock(partId, shoppingId = '') {
  const p = db.parts.find(p => p.id === partId),
    s = db.planning.shopping.find(s => s.id === shoppingId),
    revision = db.revision;
  const issue = purchaseStockIssue(p);
  if (issue) {
    toast(issue, true);
    return;
  }
  modal(
    'Receive · ' + p.name,
    field('quantity', 'Individual pieces received', s ? s.quantity - s.received : 1, 'number') +
      `<p>Current owned quantity: ${p.quantity}. Available: ${available(p)}.</p><label class="check-row"><input type="checkbox" name="confirmed" required>I have received these physical parts.</label>`,
    async v => {
      await change('planning.receive', {
        revision,
        partId,
        shoppingId,
        quantity: v.quantity,
        confirmed: !!v.confirmed
      });
      await refreshJob();
    },
    'Add to my stock'
  );
  $('#dialog [name=quantity]').step = '1';
  $('#dialog [name=quantity]').min = '1';
  $('#dialog [name=quantity]').required = true;
}
function jobPlanBadges(j) {
  const p = jobPlan(j.id);
  return `<span class="row planning-badges">${badge(p.priority + ' priority', p.priority === 'High' ? 'low-stock' : '')}${p.targetDate ? badge((j.status === 'active' && p.targetDate < slotforgeDomain.today() ? 'Overdue · ' : 'Target ') + date(p.targetDate), j.status === 'active' && p.targetDate < slotforgeDomain.today() ? 'low-stock' : '') : ''}${p.checklist.length ? badge(p.checklist.filter(s => s.done).length + '/' + p.checklist.length + ' steps') : ''}</span>`;
}
function jobPlanningPanel(j) {
  const p = jobPlan(j.id),
    active = j.status === 'active',
    done = p.checklist.filter(s => s.done).length,
    overdue = active && p.targetDate && p.targetDate < slotforgeDomain.today();
  const status = active
    ? p.waiting
      ? 'Waiting for parts'
      : 'Ready to work'
    : j.status === 'completed'
      ? 'Completed'
      : 'Cancelled';
  return `<section class="job-plan-panel"><header class="job-plan-heading"><div><h2>${icon('tool')}Job plan</h2><p>Checklist, purchases and progress photos in one place.</p></div>${active ? btn(icon('edit') + ' Edit plan', 'job-plan', '', j.id) : badge(status)}</header><dl class="job-plan-summary"><div><dt>Priority</dt><dd class="${p.priority === 'High' ? 'plan-attention' : ''}">${esc(p.priority)}</dd></div><div><dt>Target date</dt><dd class="${overdue ? 'plan-attention' : ''}">${p.targetDate ? esc(date(p.targetDate)) : 'Not scheduled'}${overdue ? ' · Overdue' : ''}</dd></div><div><dt>Status</dt><dd>${esc(status)}</dd></div><div><dt>Checklist</dt><dd>${p.checklist.length ? done + ' of ' + p.checklist.length + ' complete' : 'No steps yet'}</dd></div></dl>${p.waiting && active ? '<p class="job-waiting-note">Clear “Waiting for parts” in Edit plan when the job is ready to continue.</p>' : ''}<div class="job-plan-columns"><section class="plan-checklist-section"><div class="plan-section-heading"><h3>${icon('list')}Checklist</h3>${p.checklist.length ? `<span class="badge">${done} / ${p.checklist.length}</span>` : ''}${active ? btn(icon('plus') + ' Checklist item', 'job-checklist-quick', 'small', j.id) : ''}</div>${quickChecklistMarkup(j)}${p.checklist.length ? `<progress class="plan-progress" value="${done}" max="${p.checklist.length}" aria-label="Checklist completion"></progress><div class="job-checklist">${p.checklist.map(s => `<label class="check-row ${s.done ? 'is-complete' : ''}"><input type="checkbox" data-job-step="${esc(s.id)}" data-job-id="${esc(j.id)}" ${s.done ? 'checked' : ''} ${active ? '' : 'disabled'}><span>${esc(s.text)}</span></label>`).join('')}</div>` : `<div class="plan-empty">${icon('list')}<div><strong>No checklist steps yet</strong><p>${active ? 'Add a checklist item to break the work into small steps.' : 'No checklist was recorded for this job.'}</p></div></div>`}</section>${shoppingList(j.id, !active)}</div><section class="job-plan-photos"><div class="plan-section-heading"><h3>${icon('photos')}Progress photos <span class="badge">${p.photos.length} / 8</span></h3>${active ? btn(icon('plus') + ' Add before / after photo', 'job-photo', 'small', j.id) : ''}</div>${p.photos.length ? `<div class="job-photo-grid">${p.photos.map(f => `<figure><button type="button" class="job-photo-open" data-action="job-photo-view" data-id="${esc(f.id)}"><img src="${esc(f.data)}" alt="${esc(f.stage + ' · ' + f.name)}"></button><figcaption>${badge(f.stage)}<span>${esc(f.name)}</span>${active ? btn('Remove', 'job-photo-remove', 'small ghost', f.id) : ''}</figcaption></figure>`).join('')}</div>` : '<p class="plan-help">Before and after photos stay with this job as a private record of your work.</p>'}</section></section>`;
}
function checklistEditorRow(s = { id: '', text: '', done: false }) {
  return `<div class="checklist-editor-row" data-step-id="${esc(s.id)}"><label class="check-row"><input type="checkbox" data-step-done ${s.done ? 'checked' : ''} aria-label="Step complete"></label><input data-step-text value="${esc(s.text)}" maxlength="300" required aria-label="Checklist instruction">${btn('Remove', 'checklist-remove', 'small')}</div>`;
}
let quickChecklist = null,
  quickChecklistSaving = false;
const quickChecklistKey = id => JSON.stringify([db.id, dataPath, id]);
function quickChecklistMarkup(j) {
  if (j.status !== 'active' || quickChecklist?.key !== quickChecklistKey(j.id)) return '';
  return `<form class="quick-checklist" data-quick-checklist="${esc(j.id)}"><label class="field">New checklist item<input name="quickChecklistText" value="${esc(quickChecklist.text)}" maxlength="300" required placeholder="What needs doing?" autocomplete="off"></label><div class="actions"><button type="submit" class="btn small">Add item</button>${btn('Cancel', 'job-checklist-cancel', 'small ghost')}</div><p class="tiny muted">Enter saves. Keep typing to add another.</p></form>`;
}
function openQuickChecklist(id) {
  if (jobPlan(id).checklist.length >= 50) throw Error('Maximum 50 checklist steps.');
  if (quickChecklist?.key !== quickChecklistKey(id)) quickChecklist = { key: quickChecklistKey(id), text: '' };
  render();
  document.querySelector('[data-quick-checklist] input')?.focus();
}
document.addEventListener('input', e => {
  if (e.target.name === 'quickChecklistText' && quickChecklist) quickChecklist.text = e.target.value;
});
document.addEventListener('submit', async e => {
  const form = e.target;
  if (!form.matches('[data-quick-checklist]')) return;
  e.preventDefault();
  if (actionBusy || modalSaving) return;
  const id = form.dataset.quickChecklist,
    key = quickChecklistKey(id),
    text = form.elements.quickChecklistText.value.trim();
  if (!text) {
    form.elements.quickChecklistText.setCustomValidity('Enter a checklist item.');
    form.elements.quickChecklistText.reportValidity();
    form.elements.quickChecklistText.setCustomValidity('');
    return;
  }
  actionBusy = true;
  quickChecklistSaving = true;
  for (const el of form.elements) el.disabled = true;
  for (const el of document.querySelectorAll('[data-job-step]')) el.disabled = true;
  try {
    // Finish queued ticks before copying the plan, so quick entry cannot undo them.
    await checklistQueue;
    if (quickChecklistKey(id) !== key) throw Error('The collection changed. Reopen the checklist.');
    const p = jobPlan(id);
    if (p.checklist.length >= 50) throw Error('Maximum 50 checklist steps.');
    await planningChange('job.save', {
      jobId: id,
      priority: p.priority,
      targetDate: p.targetDate,
      waiting: p.waiting,
      checklist: [...p.checklist, { text, done: false }]
    });
    if (quickChecklist?.key === key) quickChecklist.text = '';
    await refreshJob();
    render();
    toast('Checklist item added.');
  } catch (error) {
    if (!finishClubQueued(error)) toast(error.message, true);
  } finally {
    actionBusy = false;
    quickChecklistSaving = false;
    for (const el of form.elements) el.disabled = false;
    for (const el of document.querySelectorAll('[data-job-step]')) el.disabled = workshopJob?.job.status !== 'active';
    document.querySelector('[data-quick-checklist] input')?.focus();
    if (pendingDatabaseChange) scheduleDatabaseChange();
  }
});
function editJobPlan(id) {
  const p = jobPlan(id),
    revision = db.revision;
  modal(
    'Plan & checklist',
    `<div class="form-grid">${field('priority', 'Priority', p.priority, 'select', ['Low', 'Normal', 'High'])}${field('targetDate', 'Target date', p.targetDate, 'date')}</div><label class="check-row mt"><input name="waiting" type="checkbox" ${p.waiting ? 'checked' : ''}>Waiting for parts</label><h3>Checklist</h3><div id="checklist-editor">${p.checklist.map(checklistEditorRow).join('')}</div>${btn('Add step', 'checklist-add', 'small')}<p class="muted">Complete all steps and clear Waiting for parts before closing the job.</p>`,
    async v => {
      const checklist = [...document.querySelectorAll('#checklist-editor .checklist-editor-row')].map(el => ({
        id: el.dataset.stepId,
        text: el.querySelector('[data-step-text]').value.trim(),
        done: el.querySelector('[data-step-done]').checked
      }));
      await change('planning.job.save', {
        revision,
        jobId: id,
        priority: v.priority,
        targetDate: v.targetDate,
        waiting: !!v.waiting,
        checklist
      });
      await refreshJob();
    },
    'Save plan'
  );
}
let comparisonCarId = '';
function openSetupComparison(id) {
  const d = current(),
    s = d.setups.find(s => s.id === id);
  if (!s) return;
  comparisonCarId = s.carId;
  const options = [
    ['current', 'Current car'],
    ...d.setups.filter(x => x.carId === s.carId).map(x => [x.id, x.name + ' · ' + date(x.date)])
  ];
  modal(
    'Compare configurations',
    `<div class="form-grid">${['left', 'right'].map((side, i) => `<label class="field">${i ? 'Compare to' : 'Baseline'}<select id="compare-${side}">${options.map(([key, label]) => `<option value="${esc(key)}" ${key === (i ? 'current' : id) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`).join('')}</div><label class="check-row mt"><input type="checkbox" id="compare-changes">Show differences only</label><div id="comparison-result"></div>`,
    null
  );
  renderSetupComparison();
}
function renderSetupComparison() {
  const d = current(),
    c = d.cars.find(c => c.id === comparisonCarId),
    ids = [$('#compare-left').value, $('#compare-right').value],
    snap = id =>
      id === 'current'
        ? {
            technical: c.technical,
            installations: d.installations
              .filter(i => i.carId === c.id && !i.removed)
              .map(i => ({ ...i, name: d.parts.find(p => p.id === i.partId)?.name || i.name }))
          }
        : d.setups.find(s => s.id === id),
    [a, b] = ids.map(snap),
    result = SetupComparison.compare(a, b),
    only = $('#compare-changes').checked;
  const table = (rows, part = false) =>
    `<div class="table-wrap"><table><thead><tr><th>${part ? 'Tracked component' : 'Setting'}</th><th>Baseline</th><th>Compared configuration</th><th>Status</th></tr></thead><tbody>${rows
      .filter(r => !only || r.changed)
      .map(
        r =>
          `<tr class="${r.changed ? 'comparison-change' : ''}"><td>${esc(part ? r.name + ' · ' + r.position : techLabels[r.key] || r.key)}</td><td>${part && r.beforeName ? esc(r.beforeName) + ' × ' : ''}${esc(r.before || (part ? '0' : '—'))}</td><td>${part && r.afterName ? esc(r.afterName) + ' × ' : ''}${esc(r.after || (part ? '0' : '—'))}</td><td>${r.changed ? 'Changed' : 'Unchanged'}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
  const jobs = local() ? db.jobs.filter(j => j.carId === c.id && ids.includes(j.setupId)) : [],
    tests = local() ? db.tests.filter(t => t.carId === c.id && ids.includes(t.setupId)) : [];
  $('#comparison-result').innerHTML =
    `<p>${result.changes} differences. Comparison does not change the car.</p>${table(result.technical)}<h3 class="mt">Tracked inventory · quantities</h3>${!result.inventoryKnown ? '<p class="note info">This historical or imported snapshot has no tracked-inventory record. Missing quantities mean unknown, not proof that nothing was fitted.</p>' : ''}${table(result.parts, true)}<h3 class="mt">Related workshop jobs and tests</h3><div class="actions">${jobs.map(j => btn(esc(j.name), 'compare-job', '', j.id)).join('')}${tests.map(t => btn(esc((t.track || 'Manual test') + ' · ' + date(t.date)), 'compare-test', '', t.id)).join('')}</div>${!jobs.length && !tests.length ? '<p class="muted">No records directly linked to the selected saved setups.</p>' : ''}`;
}
let reportIds = [],
  reportRevision = 0,
  reportPreviewRequest = 0;
function reportOptions() {
  return {
    revision: reportRevision,
    kind: $('#report-kind').value,
    ids: reportIds,
    purchase: $('#report-purchase').checked,
    setupId: $('#report-kind').value === 'setup' ? $('#report-setup')?.value || '' : ''
  };
}
async function reportPreview() {
  $('#report-setup').closest('label').hidden = $('#report-kind').value !== 'setup';
  $('#report-purchase').closest('label').hidden = $('#report-kind').value !== 'inventory';
  const ticket = ++reportPreviewRequest,
    r = await api('file', 'report.preview', reportOptions());
  if (ticket === reportPreviewRequest && $('#report-preview')) $('#report-preview').innerHTML = r.body;
}
async function openReports(ids) {
  reportIds = ids;
  reportRevision = db.revision;
  if (!ids.length) {
    toast('Select at least one car.');
    return;
  }
  const setups = ids.length === 1 ? db.setups.filter(s => s.carId === ids[0]) : [];
  modal(
    'Print & PDF',
    `<p>${ids.length} selected car(s). Preview before saving; open the PDF to print.</p><div class="form-grid"><label class="field">Report<select id="report-kind"><option value="cards">Car cards with QR links</option><option value="setup">Setup sheets</option><option value="scrutineering">Club scrutineering sheets</option><option value="inventory">Collection inventory</option></select></label><label class="field">Setup sheet configuration<select id="report-setup"><option value="">Current configuration</option>${setups.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label></div><label class="check-row mt"><input id="report-purchase" type="checkbox">Include purchase details in collection inventory</label><p class="tiny muted">QR links open this collection in the installed desktop app. They are not public web pages.</p><div id="report-preview" class="report-preview"></div>`,
    async () => {
      const result = await api('file', 'report.pdf', reportOptions());
      if (result) toast('PDF saved. Open it in your PDF viewer to print.');
    },
    'Save PDF'
  );
  await reportPreview();
}
let editingShelfIds = [],
  editingShelfId = '';
function shelfControls() {
  if (!local()) return '';
  return `<div class="toolbar"><label class="field">Group<select id="showroom-shelf"><option value="">Entire collection</option>${db.planning.shelves.map(s => `<option value="${esc(s.id)}" ${showroom.shelf === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>${btn('New group', 'shelf-new')}${showroom.shelf ? btn('Edit group', 'shelf-edit', '', showroom.shelf) + btn('Delete group', 'shelf-delete', '', showroom.shelf) : ''}</div>`;
}
function shelfEditorRows() {
  return editingShelfIds
    .map(
      (id, i) =>
        `<div class="list-row"><strong>${i + 1}. ${esc(db.cars.find(c => c.id === id)?.name)}</strong><div class="actions">${btn('↑', 'shelf-up', 'small', id)}${btn('↓', 'shelf-down', 'small', id)}${btn('Remove', 'shelf-car-remove', 'small', id)}</div></div>`
    )
    .join('');
}
function editShelf(id = '') {
  const s = db.planning.shelves.find(s => s.id === id),
    revision = db.revision;
  editingShelfId = id;
  editingShelfIds = [...(s?.carIds || [])];
  modal(
    s ? 'Edit group' : 'New showroom group',
    field('name', 'Group name', s?.name || '') +
      `<div class="row mt"><label class="field">Add car<select id="shelf-car">${db.cars
        .filter(slotforgeDomain.activeCar)
        .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
        .join(
          ''
        )}</select></label>${btn('Add car', 'shelf-car-add')}</div><p class="muted">Order cars with the arrows. Archived cars stay saved in a group but are hidden in the showroom.</p><div id="shelf-editor">${shelfEditorRows()}</div>`,
    async v => {
      showroom.shelf = await change('planning.shelf.save', {
        revision,
        id: editingShelfId,
        name: v.name,
        carIds: editingShelfIds
      });
    },
    'Save group'
  );
}
function applyPhotoFocus() {
  for (const img of document.querySelectorAll('[data-focus-car]')) {
    const f = local()
      ? db.planning.focus.find(f => f.carId === img.dataset.focusCar && f.photoKey === img.dataset.focusPhoto)
      : null;
    img.style.objectPosition = (f?.x ?? 50) + '% ' + (f?.y ?? 50) + '%';
  }
}
let focusCarId = '';
function photoKey(c, p) {
  if (c.picture === p.data) return 'main';
  const id = c.photos.find(f => f.data === p.data)?.id;
  return id === 'main' ? 'photo:main' : id;
}
function focusPhotoOptions() {
  return ShowroomModel.photos(db.cars.find(c => c.id === focusCarId));
}
function focusPreview(reset = false) {
  const c = db.cars.find(c => c.id === focusCarId),
    p = focusPhotoOptions()[Number($('#focus-photo').value)],
    key = photoKey(c, p),
    f = db.planning.focus.find(f => f.carId === c.id && f.photoKey === key);
  if (reset) {
    $('#focus-x').value = f?.x ?? 50;
    $('#focus-y').value = f?.y ?? 50;
  }
  $('#focus-image').src = p.data;
  $('#focus-image').style.objectPosition = $('#focus-x').value + '% ' + $('#focus-y').value + '%';
}
function editPhotoFocus(id, photoIndex = 0) {
  const c = db.cars.find(c => c.id === id),
    photos = ShowroomModel.photos(c),
    revision = db.revision;
  if (!photos.length) {
    toast('Add a car photograph first.');
    return;
  }
  focusCarId = id;
  modal(
    'Photo framing · ' + c.name,
    `<label class="field">Photograph<select id="focus-photo">${photos.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}</select></label><p class="muted">Choose the focal point used in Fill mode. The original image and Fit mode keep the complete photograph.</p><div class="focus-preview"><img id="focus-image" alt="Framing preview"></div><label class="field">Horizontal focal point<input type="range" id="focus-x" min="0" max="100"></label><label class="field">Vertical focal point<input type="range" id="focus-y" min="0" max="100"></label>`,
    async () => {
      const p = focusPhotoOptions()[Number($('#focus-photo').value)];
      await change('planning.focus', {
        revision,
        carId: id,
        photoKey: photoKey(c, p),
        x: Number($('#focus-x').value),
        y: Number($('#focus-y').value)
      });
    },
    'Save framing'
  );
  $('#focus-photo').value = String(Math.min(photoIndex, photos.length - 1));
  focusPreview(true);
}
async function enhancementAction(action, id, target) {
  if (await shoppingAction(action, id)) return true;
  switch (action) {
    case 'stock-scope':
      if (id === 'shopping') {
        page = 'Shopping List';
        render();
        return true;
      }
      stockScope = id;
      partMakerFilter = '';
      partCategory = '';
      partTypeFilter = '';
      partQuery = '';
      partId = null;
      render();
      return true;
    case 'shop-add': {
      const key = id || '';
      addShopping(key.startsWith('job:') ? '' : key, key.startsWith('job:') ? key.slice(4) : '');
      return true;
    }
    case 'receive-stock':
      receiveStock(id);
      return true;
    case 'shop-receive': {
      const s = db.planning.shopping.find(s => s.id === id);
      receiveStock(s.partId, id);
      return true;
    }
    case 'shop-remove': {
      const revision = db.revision;
      modal(
        'Remove shopping item',
        '<p>Remove this unreceived item from the shopping list?</p>',
        async () => {
          await change('planning.shopping.remove', { revision, id });
          await refreshJob();
        },
        'Remove'
      );
      return true;
    }
    case 'job-shopping': {
      await change('job.shopping', { id: workshopJob.job.id, revision: workshopJob.revision });
      await refreshJob();
      render();
      toast('Shopping requirements updated. Existing orders and receipts kept.');
      return true;
    }
    case 'job-plan':
      editJobPlan(id);
      return true;
    case 'job-checklist-quick':
      openQuickChecklist(id);
      return true;
    case 'job-checklist-cancel':
      quickChecklist = null;
      render();
      return true;
    case 'checklist-add':
      if ($('#checklist-editor').children.length >= 50) throw Error('Maximum 50 checklist steps.');
      $('#checklist-editor').insertAdjacentHTML('beforeend', checklistEditorRow());
      $('#checklist-editor').lastElementChild.querySelector('[data-step-text]').focus();
      return true;
    case 'checklist-remove':
      target.closest('.checklist-editor-row')?.remove();
      return true;
    case 'job-photo': {
      const photo = await api('file', 'image');
      if (!photo) return true;
      const revision = db.revision;
      modal(
        'Job photograph',
        field('stage', 'Stage', 'Before', 'select', ['Before', 'After']) + field('name', 'Caption', photo.name),
        async v => {
          await change('planning.job.photo', { revision, jobId: id, stage: v.stage, name: v.name, data: photo.data });
          await refreshJob();
        },
        'Add photograph'
      );
      return true;
    }
    case 'job-photo-view': {
      const f = jobPlan(workshopJob.job.id).photos.find(f => f.id === id);
      modal(f.stage + ' · ' + f.name, `<img class="job-photo-full" src="${esc(f.data)}" alt="${esc(f.name)}">`, null);
      return true;
    }
    case 'job-photo-remove': {
      const revision = db.revision,
        jobId = workshopJob.job.id;
      modal(
        'Remove job photograph',
        '<p>Remove this photograph from the job?</p>',
        async () => {
          await change('planning.job.photo.remove', { revision, jobId, id });
          await refreshJob();
        },
        'Remove photograph'
      );
      return true;
    }
    case 'compare-job':
      $('#dialog').close();
      await openJob(id);
      return true;
    case 'compare-test':
      $('#dialog').close();
      page = 'Cars';
      carId = comparisonCarId;
      section = 'Performance';
      render();
      document
        .querySelector('[data-action="test-snapshot"][data-id="' + CSS.escape(id) + '"]')
        ?.closest('.panel')
        ?.scrollIntoView({ block: 'center' });
      return true;
    case 'reports':
      await openReports(id ? [id] : selected.size ? [...selected] : filteredCars().map(c => c.id));
      return true;
    case 'viewer-photo-focus': {
      const photoIndex = showroom.viewer.photo;
      pauseShowroom();
      closeShowroom();
      editPhotoFocus(id, photoIndex);
      return true;
    }
    case 'photo-focus':
      editPhotoFocus(id);
      return true;
    case 'shelf-new':
      editShelf();
      return true;
    case 'shelf-edit':
      editShelf(id);
      return true;
    case 'shelf-delete': {
      const revision = db.revision;
      modal(
        'Delete showroom group',
        '<p>Delete this group? The cars stay in your collection.</p>',
        async () => {
          await change('planning.shelf.remove', { revision, id });
          showroom.shelf = '';
        },
        'Delete group'
      );
      return true;
    }
    case 'shelf-car-add': {
      const value = $('#shelf-car').value;
      if (value && !editingShelfIds.includes(value)) editingShelfIds.push(value);
      $('#shelf-editor').innerHTML = shelfEditorRows();
      return true;
    }
    case 'shelf-car-remove':
      editingShelfIds = editingShelfIds.filter(x => x !== id);
      $('#shelf-editor').innerHTML = shelfEditorRows();
      return true;
    case 'shelf-up':
    case 'shelf-down': {
      const i = editingShelfIds.indexOf(id),
        next = i + (action === 'shelf-up' ? -1 : 1);
      if (i >= 0 && next >= 0 && next < editingShelfIds.length)
        [editingShelfIds[i], editingShelfIds[next]] = [editingShelfIds[next], editingShelfIds[i]];
      $('#shelf-editor').innerHTML = shelfEditorRows();
      return true;
    }
  }
  return false;
}
// Persist rapid clicks in order, taking a fresh revision for each one.
let checklistQueue = Promise.resolve(),
  pendingChecklistChanges = 0;
function saveChecklistStep(el) {
  if (quickChecklistSaving) {
    el.checked = jobPlan(el.dataset.jobId).checklist.find(s => s.id === el.dataset.jobStep)?.done ?? false;
    return checklistQueue;
  }
  const payload = { jobId: el.dataset.jobId, id: el.dataset.jobStep, done: el.checked };
  el.disabled = true;
  pendingChecklistChanges++;
  checklistQueue = checklistQueue
    .then(async () => {
      try {
        await planningChange('job.check', payload);
      } catch (error) {
        if (!finishClubQueued(error)) toast(error.message, true);
      } finally {
        pendingChecklistChanges--;
        if (!pendingChecklistChanges && page === 'Workshop' && workshopJob?.job.id === payload.jobId) {
          await refreshJob();
          if (!quickChecklistSaving) render();
        }
        if (el.isConnected) {
          el.disabled = quickChecklistSaving;
          el.checked = jobPlan(payload.jobId).checklist.find(s => s.id === payload.id)?.done ?? !payload.done;
        }
      }
    })
    .catch(error => toast(error.message, true));
  return checklistQueue;
}
document.addEventListener('change', async e => {
  const el = e.target;
  try {
    if (el.dataset.jobStep) await saveChecklistStep(el);
    if (['compare-left', 'compare-right', 'compare-changes'].includes(el.id)) renderSetupComparison();
    if (['report-kind', 'report-setup', 'report-purchase'].includes(el.id)) await reportPreview();
    if (el.id === 'showroom-shelf') {
      showroom.shelf = el.value;
      render();
    }
    if (el.id === 'focus-photo') focusPreview(true);
  } catch (error) {
    toast(error.message, true);
    if (el.dataset.jobStep) {
      el.disabled = false;
      el.checked = !el.checked;
    }
  }
});
document.addEventListener('input', e => {
  if (['focus-x', 'focus-y'].includes(e.target.id)) focusPreview();
});
