function jobCards(jobs) {
  return `<div class="job-queue">${jobs
    .map(j => {
      const c = db.cars.find(c => c.id === j.carId),
        image = ShowroomModel.photos(c)[0],
        general = j.kind === 'general',
        category = JobTypes.get(j.category),
        status =
          j.status === 'active' && jobPlan(j.id).waiting
            ? 'Waiting for parts'
            : { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' }[j.status],
        note =
          j.log.filter(e => e.action !== 'job.edit').at(-1)?.note ||
          j.notes ||
          (general ? 'No work instructions added yet.' : 'Work towards the saved configuration.');
      return `<article class="job-queue-card ${general ? 'general-job' : 'setup-job'} job-tone-${category.tone} ${j.status}" data-action="open-job" data-id="${esc(j.id)}" aria-label="${j.status === 'active' ? 'Resume' : 'View'} ${esc(j.name)} for ${esc(c.name)}"><span class="job-queue-top"><span class="job-kind">${icon(category.icon)}${category.label}</span><span class="job-status ${j.status} ${j.status === 'active' && jobPlan(j.id).waiting ? 'waiting' : ''}">${status}</span></span><span class="job-queue-identity"><span class="job-car-photo">${image ? `<img src="${esc(thumbnailSource(image.data))}" alt="" loading="lazy">` : icon('car')}</span><span class="job-queue-names"><strong class="job-car-name">${esc(c.name)}</strong><span class="job-name">${esc(j.name)}</span>${general ? '' : '<span class="tiny muted">Saved setup plan</span>'}${c.number ? `<span class="tiny muted">${esc(c.number)}</span>` : ''}</span></span><span class="job-preview">${esc(note)}</span>${jobPlanBadges(j)}<span class="job-queue-footer"><span class="tiny muted">Updated ${date(j.updated)}</span><span class="actions">${j.status === 'active' ? btn('Edit', 'edit-job', 'small', j.id) : ''}${btn(j.status === 'active' ? 'Resume job →' : 'View record →', 'open-job', 'small', j.id)}</span></span></article>`;
    })
    .join('')}</div>`;
}
let workshopJob = null,
  recentWorkLimit = 3,
  jobCategory = '';
function jobCategoryField(value = 'general') {
  return (
    '<label class="field wide">Category<select name="category">' +
    JobTypes.types
      .map(t => '<option value="' + t.id + '" ' + (t.id === value ? 'selected' : '') + '>' + t.label + '</option>')
      .join('') +
    '</select></label>'
  );
}
function jobCategoryFilter() {
  return (
    '<label class="field job-category-filter">Category<select id="job-category-filter"><option value="">All categories</option>' +
    JobTypes.types
      .map(
        t => '<option value="' + t.id + '" ' + (jobCategory === t.id ? 'selected' : '') + '>' + t.label + '</option>'
      )
      .join('') +
    '</select></label>'
  );
}
function editWorkshopJob(id) {
  const j = db.jobs.find(j => j.id === id),
    revision = db.revision;
  if (!j || j.status !== 'active') {
    toast('This job is already closed or missing.', true);
    return;
  }
  modal(
    'Edit workshop job',
    `<div class="form-grid"><label class="field wide">Job name<input name="name" value="${esc(j.name)}" maxlength="200" required></label>${jobCategoryField(j.category)}<label class="field wide">Planned work / instructions<textarea name="notes" maxlength="20000">${esc(j.notes || '')}</textarea></label></div>${dl(
      [
        ['Car', db.cars.find(c => c.id === j.carId).name],
        ['Work plan', j.kind === 'general' ? 'Free-form work' : 'Saved setup · ' + j.target.name]
      ]
    )}<p class="muted mt">The car, setup target and recorded progress stay attached to this job.</p>`,
    async values => {
      await change('job.edit', { id, revision, name: values.name, notes: values.notes, category: values.category });
      if (workshopJob?.job.id === id) await refreshJob();
    },
    'Save changes'
  );
}
async function openJob(id) {
  workshopJob = await api('plan', 'job.view', { id });
  toolboxTab = 'Jobs';
  page = 'Workshop';
  render();
}
async function refreshJob() {
  if (workshopJob) workshopJob = await api('plan', 'job.view', { id: workshopJob.job.id });
}
function jobOverview() {
  if (db._view?.jobCounts) {
    const counts = db._view.jobCounts;
    return `<section class="workshop-queue"><div class="job-queue-heading"><h2>${closedJobs ? 'Completed & cancelled jobs' : 'Active jobs'} <span class="badge">${closedJobs ? counts.closed : counts.active}</span></h2><div class="actions job-queue-controls">${jobCategoryFilter()}${btn(closedJobs ? 'Show active jobs' : 'Completed & cancelled (' + counts.closed + ')', 'query-closed-jobs')}</div></div>${db.jobs.length ? jobCards(db.jobs) : '<div class="panel"><p class="muted">No jobs here.</p></div>'}${viewPager(db._view.list)}</section>`;
  }
  const jobs = db.jobs.filter(j => !jobCategory || (j.category || 'general') === jobCategory),
    active = jobs.filter(j => j.status === 'active'),
    closed = jobs.filter(j => j.status !== 'active');

  return `<section class="workshop-queue"><div class="job-queue-heading"><h2>Active jobs <span class="badge">${active.length}</span></h2>${jobCategoryFilter()}<p class="muted">Choose a car’s job to continue its work.</p></div>${active.length ? jobCards(active) : '<div class="panel"><p class="muted">No active jobs. Start one with New workshop job.</p></div>'}${closed.length ? `<details class="job-history"><summary>Completed & cancelled jobs <span class="badge">${closed.length}</span></summary>${jobCards(closed)}</details>` : ''}</section>`;
}
function snapshotDetails(snap) {
  return `${dl([
    ...Object.entries(snap.technical)
      .filter(([, v]) => v)
      .map(([k, v]) => [techLabels[k] || k, v]),
    ...ratioRows(snap.technical)
  ])}<h3 class="mt">Fitted inventory at this point</h3>${(snap.installations || []).map(i => `<p>${esc(i.name)} · ${i.quantity} piece(s) · ${esc(techLabels[i.field] || i.position)}</p>`).join('') || '<p class="muted">' + (snap.installations ? 'No tracked inventory fitted.' : 'This earlier record has no inventory snapshot.') + '</p>'}`;
}
function renderJob() {
  const m = workshopJob,
    j = m.job;
  let head = heading(
    j.name,
    `${m.carName} · ${JobTypes.get(j.category).label} · ${j.status}`,
    (j.status === 'active' ? btn(icon('edit') + ' Edit details', 'edit-job', '', j.id) : '') +
      btn('All workshop jobs', 'jobs-back', 'outline')
  );
  if (m.revision !== db.revision)
    return (
      head +
      panel(
        'The database changed',
        `<p>Recheck the current car and available parts before continuing.</p>${btn('Refresh job', 'open-job', 'primary', j.id)}`
      )
    );
  head += rebuildJobCard(j) + jobPlanningPanel(j);
  if (j.status === 'active' && j.kind !== 'general')
    head += `<div class="note info mt">${btn('Review parts from job', 'shop-requirements', '', 'job:' + j.id)}<p>Calculate missing loose parts for all outstanding setup steps. Fitted substitutes count as completed. Assemblies need an explicit choice; they are not ordered automatically. Plans share available stock and do not reserve it.</p></div>`;
  if (j.kind === 'general') return renderGeneralJobDesign(m, head);
  if (j.status !== 'active')
    return (
      head +
      `<div class="note info">${j.status === 'completed' ? 'Completed' : 'Cancelled'} ${date(j.finished)}. This record preserves the actual configuration when the job closed.</div><div class="two-col mt">${panel('Actual configuration', snapshotDetails(j.actual))}${panel('Original target', snapshotDetails(j.target))}</div>` +
      jobLog(j)
    );
  const uniqueExtras = m.extras.filter(
    (i, index, all) => !i.assemblyId || all.findIndex(x => x.assemblyId === i.assemblyId) === index
  );
  return (
    head +
    (j.notes ? panel('Planned work', `<p class="prewrap">${esc(j.notes)}</p>`) : '') +
    `<div class="note info mt"><strong>${m.remaining} outstanding step${m.remaining === 1 ? '' : 's'}</strong> · Progress is saved after each confirmed change. The car’s current configuration always describes what is actually fitted. You can leave this page and resume later.</div><div class="actions mt">${btn('Record test of current car', 'add-test', '', j.carId)}${m.remaining === 0 ? btn('Complete job…', 'finish-job', 'primary', j.id) : ''}${btn('Cancel job…', 'cancel-job', '', j.id)}</div>` +
    `<div class="two-col mt">${panel('Target components', m.rows.length ? m.rows.map(r => `<section class="job-step"><div class="row">${badge(r.done ? 'Fitted' : 'Outstanding', r.done ? 'good' : '')}<strong>${esc(r.name)}</strong></div><p class="tiny muted">${r.kind === 'assembly' ? 'Complete assembly' : r.quantity + ' piece(s) · ' + esc(techLabels[r.field] || r.position)}</p><p>${r.done ? 'Actually fitted: ' + esc(r.actual) : 'Choose available stock or record an already fitted substitute.'}</p>${btn(r.done ? 'Review / change…' : 'Fit / confirm…', 'job-fit', 'small', r.key)}${r.done ? btn('Return to used spares…', 'job-remove', 'small', r.installationIds[0]) : ''}</section>`).join('') : '<p class="muted">No tracked components in the target.</p>')}${panel('Fitted parts still to resolve', uniqueExtras.length ? uniqueExtras.map(i => `<section class="job-step"><strong>${esc(i.assemblyId ? db.assemblies.find(a => a.id === i.assemblyId)?.name : i.name)}</strong><p class="tiny muted">${i.assemblyId ? 'Complete assembly' : i.quantity + ' piece(s) · ' + esc(techLabels[i.field] || i.position)}</p><p class="tiny muted">Confirm it against a target step if it is a substitute, or return it to used spares. Clear occupied positions before fitting replacements.</p>${btn('Return to used spares…', 'job-remove', 'small', i.id)}</section>`).join('') : '<p class="muted">No extra tracked inventory to resolve.</p>')}</div>` +
    `<div class="mt">${panel('Settings and untracked specifications', m.settings.length ? `<div class="table-wrap"><table><thead><tr><th>Setting</th><th>Actual car</th><th>Target</th><th>Status</th></tr></thead><tbody>${m.settings.map(s => `<tr><td>${esc(techLabels[s.key] || s.key)}</td><td>${esc(s.actual || '—')}</td><td>${esc(s.target || '—')}</td><td>${s.done ? badge('Matches', 'good') : btn('Record adjustment…', 'job-setting', 'small', s.key)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No other settings to check.</p>')}</div>` +
    jobLog(j)
  );
}
function jobLog(j) {
  return `<div class="mt">${panel(
    'Recorded work',
    j.log.length
      ? j.log
          .slice()
          .reverse()
          .map(
            e =>
              `<div class="list-row"><div><strong>${esc(e.note)}</strong><div class="tiny muted">${date(e.date)}</div></div></div>`
          )
          .join('')
      : '<p class="muted">No physical changes recorded for this job yet.</p>'
  )}</div>`;
}
function startJob(id) {
  const s = db.setups.find(s => s.id === id),
    revision = db.revision;
  modal(
    'Start staged setup job',
    `<p>Use <strong>${esc(s.name)}</strong> as the target for ${esc(db.cars.find(c => c.id === s.carId).name)}.</p><p>You can complete parts and settings in separate sessions. Starting the job does not move stock or change the car.</p>${jobCategoryField()}`,
    async values => {
      const jobId = await change('job.start', { setupId: id, revision, category: values.category });
      workshopJob = await api('plan', 'job.view', { id: jobId });
      toolboxTab = 'Jobs';
      page = 'Workshop';
    },
    'Start job'
  );
}
// New workshop job, after docs/ui-reference/new-job-2026-11 (option A, one screen): your cars as photo cards,
// the kind of work as tiles, the plan as three cards and quick-pick job names. The car, category and plan stay
// in hidden form controls (#job-car, [name=category], #job-kind) that the cards set, so saving is unchanged.
const jobNameIdeas = {
  general: ['Check and clean', 'Fix a fault', 'Prepare for club night'],
  maintenance: [
    'Clean and oil bearings',
    'Replace braids',
    'Clean motor and check brushes',
    'Full service before race day'
  ],
  upgrades: ['Fit a new motor', 'Upgrade gearing', 'Fit new tyres and rims'],
  overhaul: ['Strip, clean and rebuild', 'Full overhaul after the season'],
  rebuild: ['Winter rebuild', 'Rebuild into a racer'],
  chassis: ['Straighten and check chassis', 'Adjust body float', 'Change motor pod'],
  tyres: ['True and glue tyres', 'Fit new rear tyres', 'Clean and treat tyres'],
  motor: ['Run in new motor', 'Clean motor and check brushes', 'Replace motor'],
  braids: ['Replace braids', 'Clean and flatten braids'],
  balancing: ['Add lead weight', 'Balance the car'],
  'front-assembly': ['True front tyres', 'Check front axle and hubs'],
  'rear-assembly': ['Check gear mesh', 'Replace rear axle', 'Check bearings'],
  bodywork: ['Repair body', 'Refit body mounts', 'Touch up paint and decals']
};
function newJobPicker(cars, first, busy) {
  return `<div class="nj-cars" role="group" aria-label="Car">${cars
    .map(
      c =>
        `<button type="button" class="nj-car ${c.id === first.id ? 'on' : ''} ${busy(c.id) ? 'busy' : ''}" data-action="nj-car" data-id="${esc(c.id)}" data-search="${esc([c.name, c.maker, c.reference, c.number].filter(Boolean).join(' ').toLowerCase())}" aria-pressed="${c.id === first.id}" ${busy(c.id) ? 'disabled' : ''}><span class="nj-car-photo">${photo(c, true)}${busy(c.id) ? '<span class="nj-tag">Active job</span>' : ''}</span><span class="nj-car-text"><b>${esc(c.name)}</b><small>${esc([c.maker, c.scale].filter(Boolean).join(' · ')) || '&nbsp;'}</small></span></button>`
    )
    .join('')}<p class="nj-none" hidden>No car matches your search.</p></div>`;
}
function newJobTiles(value) {
  return `<div class="nj-kinds" role="group" aria-label="What kind of work">${JobTypes.types
    .map(
      t =>
        `<button type="button" class="nj-kind ${t.id === value ? 'on' : ''}" data-action="nj-category" data-id="${t.id}" data-tone="${t.tone}" aria-pressed="${t.id === value}"><i aria-hidden="true">${icon(t.icon)}</i>${esc(t.label)}</button>`
    )
    .join('')}</div>`;
}
function newJobPlans() {
  const card = (id, title, text) =>
    `<button type="button" class="nj-plan" data-action="nj-kind" data-id="${id}" aria-pressed="false"><b>${title}</b><small${id === 'setup' ? ' id="nj-setup-note"' : ''}>${text}</small></button>`;
  return `<div class="nj-plans" role="group" aria-label="How you plan it">${card('general', 'Free-form work', 'Write what you plan to do and record your progress as you go.')}${card('setup', 'Towards a saved setup', '')}${card('rebuild', 'Rebuild', 'Turn this car into a linked new car. Its history stays.')}</div>`;
}
function newWorkshopJob(preferredCarId, task = '') {
  const cars = db.cars.filter(slotforgeDomain.activeCar),
    revision = db.revision;
  if (!cars.length) {
    modal(
      'Add a car first',
      `<p>A workshop job belongs to a car in your collection.</p>${btn('Add car', 'add-car', 'primary')}`,
      null
    );
    return;
  }
  const busy = id => db.jobs.some(j => j.carId === id && j.status === 'active'),
    first = cars.find(c => c.id === preferredCarId && !busy(c.id)) || cars.find(c => !busy(c.id));
  if (!first) {
    modal(
      'Your cars already have active jobs',
      '<p>Resume or close an existing job before starting another for the same car.</p>',
      null
    );
    return;
  }
  const category = task ? 'maintenance' : 'general',
    busyCount = cars.filter(c => busy(c.id)).length;
  modal(
    'New workshop job',
    `<div class="new-job"><aside class="nj-left"><div class="nj-tool"><span class="eye">Which car</span><span class="grow"></span><input type="search" id="nj-car-search" placeholder="Find a car…" aria-label="Find a car" autocomplete="off"></div>${newJobPicker(cars, first, busy)}${busyCount ? `<p class="nj-busy-note">${busyCount === 1 ? '1 car already has' : busyCount + ' cars already have'} an active job. Resume or close it to start another.</p>` : ''}</aside><div class="nj-right"><select name="carId" id="job-car" required hidden>${cars.map(c => `<option value="${esc(c.id)}" ${c.id === first.id ? 'selected' : ''} ${busy(c.id) ? 'disabled' : ''}>${esc(c.name)}${busy(c.id) ? ' · Active job already' : ''}</option>`).join('')}</select><select name="category" hidden>${JobTypes.types.map(t => `<option value="${t.id}" ${t.id === category ? 'selected' : ''}>${t.label}</option>`).join('')}</select><select name="kind" id="job-kind" hidden><option value="general">Free-form work</option><option value="setup">Work towards a saved setup</option><option value="rebuild">Rebuild into a linked new car</option></select><section class="nj-sec"><h3>What kind of work</h3>${newJobTiles(category)}</section><section class="nj-sec"><h3>How you plan it</h3>${newJobPlans()}</section><section class="nj-sec"><h3>The job <small id="nj-ideas-label"></small></h3><div class="field wide" id="general-job-fields"><label class="field nj-name">Job name<input name="name" maxlength="200" required placeholder="For example: Replace braids and clean motor"></label><div class="nj-ideas" id="nj-ideas"></div>${field('notes', 'Planned work / instructions', '', 'textarea')}</div><div class="field wide" id="setup-job-fields" hidden></div></section></div></div>`,
    async values => {
      if (values.kind === 'rebuild') {
        const draftId = await change('rebuild.start', {
          revision,
          carId: values.carId,
          name: values.name,
          notes: values.notes
        });
        await openRebuildJob(draftId);
        return;
      }
      const id = await change('job.start', { revision, ...values });
      workshopJob = await api('plan', 'job.view', { id });
      toolboxTab = 'Jobs';
      page = 'Workshop';
    },
    'Start job'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="nj-summary" id="nj-summary"></span>');
  if (task) $('#dialog [name=name]').value = task.slice(0, 200);
  updateJobChoices();
  $('.nj-car.on')?.scrollIntoView({ block: 'nearest' });
}
// Bring the cards, tiles, quick picks and summary in line with the hidden controls.
function syncNewJob() {
  if (!$('.new-job')) return;
  const car = $('#job-car').value,
    category = $('#dialog [name=category]').value,
    kind = $('#job-kind').value,
    on = (el, yes) => {
      el.classList.toggle('on', yes);
      el.setAttribute('aria-pressed', String(yes));
    };
  document.querySelectorAll('.nj-car').forEach(b => on(b, b.dataset.id === car));
  document.querySelectorAll('.nj-kind').forEach(b => on(b, b.dataset.id === category));
  document.querySelectorAll('.nj-plan').forEach(b => on(b, b.dataset.id === kind));
  const carName = db.cars.find(c => c.id === car)?.name || '',
    setups = db.setups.filter(s => s.carId === car).length,
    type = JobTypes.get(category);
  $('#nj-setup-note').textContent = setups
    ? `${carName} has ${setups} saved ${setups === 1 ? 'setup' : 'setups'} to work towards.`
    : `${carName} has no saved setups yet.`;
  document.querySelector('.nj-plan[data-id="setup"]').classList.toggle('dim', !setups);
  const ideas = jobNameIdeas[category] || [],
    name = $('#dialog [name=name]')?.value || '';
  $('#nj-ideas-label').textContent = ideas.length && kind !== 'setup' ? 'Quick picks for ' + type.label : '';
  $('#nj-ideas').innerHTML = ideas
    .map(
      n =>
        `<button type="button" class="${n === name ? 'on' : ''}" data-action="nj-name" data-id="${esc(n)}" aria-pressed="${n === name}">${esc(n)}</button>`
    )
    .join('');
  $('#nj-summary').innerHTML =
    `<b>${esc(carName)}</b> · ${esc(type.label)} · ${{ general: 'Free-form work', setup: 'Towards a saved setup', rebuild: 'Rebuild' }[kind]}. Starting a job changes nothing on the car and moves no stock.`;
}
function newJobAction(action, id) {
  if (!['nj-car', 'nj-category', 'nj-kind', 'nj-name'].includes(action) || !$('.new-job')) return false;
  const set = (selector, value) => {
    const el = $(selector);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (action === 'nj-car') set('#job-car', id);
  if (action === 'nj-category') set('#dialog [name=category]', id);
  if (action === 'nj-kind') set('#job-kind', id);
  if (action === 'nj-name') {
    const input = $('#dialog [name=name]');
    input.value = id;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    syncNewJob();
  }
  return true;
}
document.addEventListener('input', event => {
  if (event.target.id === 'nj-car-search') {
    const q = event.target.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('.nj-car').forEach(b => {
      b.hidden = !!q && !b.dataset.search.includes(q);
      if (!b.hidden) shown++;
    });
    $('.nj-none').hidden = shown > 0;
  }
  if (event.target.name === 'name' && $('.new-job')) syncNewJob();
});
function updateJobChoices() {
  const general = $('#job-kind').value !== 'setup',
    car = $('#job-car').value,
    setups = db.setups.filter(s => s.carId === car);
  $('#job-rebuild-warning')?.remove();
  if ($('#job-kind').value === 'rebuild')
    $('#general-job-fields').insertAdjacentHTML(
      'beforeend',
      '<p id="job-rebuild-warning" class="note info">Start in Workshop to organise the rebuild. Open its build editor when you are ready to choose parts.</p>'
    );
  $('#general-job-fields').hidden = !general;
  for (const el of $('#general-job-fields').querySelectorAll('input,textarea')) el.disabled = !general;
  $('#setup-job-fields').hidden = general;
  $('#setup-job-fields').innerHTML =
    `<label class="field">Saved setup<select name="setupId" ${general ? 'disabled' : 'required'}><option value="">Choose a setup</option>${setups.map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${date(s.date)}</option>`).join('')}</select></label>${setups.length ? '' : '<p class="muted">This car has no saved setups. Use General work, or save a configuration from the car’s Setups section first.</p>'}`;
  syncNewJob();
}
function recordJobProgress() {
  const { job, revision } = workshopJob;
  modal(
    'Record job progress',
    field('note', 'Work performed / observations', '', 'textarea') +
      '<p class="muted">This adds to the job history. Update physical parts and specifications on the car page when needed.</p>',
    async values => {
      await change('job.note', { id: job.id, revision, note: values.note });
      await refreshJob();
    },
    'Save progress'
  );
}
document.addEventListener('change', event => {
  if (event.target.id === 'record-work-category') {
    updateRecordWork();
    return;
  }
  if (event.target.id === 'job-category-filter') {
    jobCategory = event.target.value;
    render();
    return;
  }
  if (event.target.name === 'category' && $('#job-kind')) {
    if (event.target.value === 'rebuild') $('#job-kind').value = 'rebuild';
    else if ($('#job-kind').value === 'rebuild') $('#job-kind').value = 'general';
    updateJobChoices();
  }
  if (['job-kind', 'job-car'].includes(event.target.id)) {
    if ($('#job-kind').value === 'rebuild') $('#dialog [name=category]').value = 'rebuild';
    else if (event.target.id === 'job-kind' && $('#dialog [name=category]').value === 'rebuild')
      $('#dialog [name=category]').value = 'general';
    updateJobChoices();
  }
});
function jobAction(action, key) {
  const m = workshopJob,
    j = m.job,
    payload = { id: j.id, revision: m.revision },
    confirm = `<label class="check-row mt"><input type="checkbox" name="confirmed" required>I have made and checked this physical change.</label>`;
  let title, body;
  if (action === 'job-fit') {
    const r = m.rows.find(r => r.key === key);
    title = 'Fit / confirm · ' + r.name;
    payload.key = key;
    body = `<p>Target: <strong>${esc(r.name)}</strong>. Existing components in an occupied position must be returned first.</p><label class="field">Actual component or assembly<select name="selection" required><option value="">Choose stock or an installed item</option>${r.choices.map(c => `<option value="${esc(c.value)}" ${r.selected === c.value ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label><label class="check-row mt"><input type="checkbox" name="allowTransfer">If this item is on another car, I confirm its physical transfer.</label>${confirm}`;
  } else if (action === 'job-remove') {
    const i = m.actual.installations.find(i => i.id === key);
    title = 'Return fitted stock';
    payload.installationId = key;
    body = `<p>Return <strong>${esc(i.assemblyId ? db.assemblies.find(a => a.id === i.assemblyId).name : i.name)}</strong> to Used spares. ${i.assemblyId ? 'The complete assembly stays together.' : 'Quantity stock is kept separate from unused stock.'}</p>${confirm}`;
  } else if (action === 'job-setting') {
    const s = m.settings.find(s => s.key === key);
    title = 'Record adjustment';
    payload.key = key;
    body =
      dl([
        ['Setting', techLabels[key] || key],
        ['Current', s.actual || '—'],
        ['Target', s.target || '—']
      ]) + confirm;
  } else {
    title = action === 'finish-job' ? 'Complete workshop job' : 'Cancel workshop job';
    body = `<p>${action === 'finish-job' ? (j.kind === 'general' ? 'Mark the planned work complete and save the car’s current configuration as the finished result.' : 'Save the actual configuration as the finished result. The original target remains unchanged.') : 'Close this job. All recorded physical changes stay on the car; cancelling does not undo work or move stock.'}</p><label class="check-row mt"><input type="checkbox" name="confirmed" required>${action === 'finish-job' ? 'I have checked the finished car.' : 'I understand that completed work will remain.'}</label>`;
  }
  const operation = {
    'job-fit': 'job.fit',
    'job-remove': 'job.remove',
    'job-setting': 'job.setting',
    'finish-job': 'job.complete',
    'cancel-job': 'job.cancel'
  }[action];
  modal(
    title,
    body,
    async values => {
      await change(operation, {
        ...payload,
        ...values,
        confirmed: !!values.confirmed,
        allowTransfer: !!values.allowTransfer
      });
      await refreshJob();
    },
    'Record'
  );
}
function replaceAssemblyDialog(id) {
  const a = liveAssemblies().find(a => a.id === id),
    revision = db.revision;
  modal(
    'Replace an assembly component',
    `<p><strong>${esc(a.name)}</strong> · ${a.carId ? 'Installed on ' + esc(db.cars.find(c => c.id === a.carId).name) : 'In storage'}</p><p>Keep the group together and replace one member. The replacement uses the same quantity and position. The removed component returns to used spares; saved setups keep their original parts.</p><label class="field">Component to remove<select name="componentId">${a.components.map(c => `<option value="${c.partId}">${esc(db.parts.find(p => p.id === c.partId).name)} · ${c.quantity} piece(s) · ${esc(techLabels[c.field] || c.position)}</option>`).join('')}</select></label><label class="field">Replacement stock<select name="partId" required><option value="">Choose available stock</option>${db.parts
      .filter(p => available(p) > 0)
      .map(
        p => `<option value="${p.id}">${esc(componentLabel(p))} · ${available(p)} free · ${esc(p.condition)}</option>`
      )
      .join(
        ''
      )}</select></label>${field('location', 'Removed component location', 'Used spares')}<label class="check-row mt"><input name="confirmed" type="checkbox" required>I have physically replaced this component.</label>`,
    async values => change('assembly.replace', { id, revision, ...values, confirmed: !!values.confirmed }),
    'Record replacement'
  );
}

function renderRecentWork() {
  const events = db.events.filter(e => ['maintenance', 'modification', 'installation', 'removal'].includes(e.type));
  const shown = Math.min(recentWorkLimit, events.length),
    total = db._view?.recentTotal ?? events.length;
  return (
    timeline(events.slice(0, shown)) +
    (total > 3
      ? '<div class="recent-work-footer"><p class="tiny muted" role="status">Showing ' +
        shown +
        ' of ' +
        events.length +
        ' entries</p><div class="actions">' +
        (shown < total && recentWorkLimit < 200 ? btn('Show more', 'recent-work-more', 'small') : '') +
        (recentWorkLimit > 3 ? btn('Show less', 'recent-work-less', 'small') : '') +
        '</div></div>'
      : '')
  );
}
