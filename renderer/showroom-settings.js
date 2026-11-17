'use strict';
// Display choices are personal to this computer and collection, not proposals.
const showroomSessions = new Map();
const showroomSeed = () => Math.floor(Math.random() * 4294967296);
function showroomPreferencesKey() {
  return 'slotforge-showroom-v2:' + showroomKey();
}
function showroomSavePreferences() {
  try {
    localStorage.setItem(showroomPreferencesKey(), JSON.stringify(showroom.preferences));
  } catch {
    toast('Showroom choices will last for this session; local preferences could not be saved.', true);
  }
}
function showroomContext() {
  const key = showroomKey();
  if (showroom.context !== key) {
    closeShowroom();
    clearTimeout(showroom.coverTimer);
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('slotforge-showroom-v2:' + key) || '{}') || {};
    } catch {
      /* Ignore damaged display preferences. */
    }
    let session = showroomSessions.get(key);
    if (!session) {
      session = {
        seed: showroomSeed(),
        coverId: '',
        avoid: typeof saved.lastShown === 'string' ? saved.lastShown : ''
      };
      showroomSessions.set(key, session);
    }
    Object.assign(showroom, {
      context: key,
      query: '',
      usage: '',
      favourites: false,
      sort: 'name',
      shelf: '',
      coverPaused: false,
      coverTimer: null,
      active: false,
      session,
      preferences: {
        cover: ShowroomModel.options(saved.cover || { carId: current().settings?.showroomFeaturedId }),
        presentation: ShowroomModel.options(saved.presentation),
        lastShown: saved.lastShown || ''
      }
    });
  }
  if (page === 'Showroom' && !showroom.active) {
    if (showroom.preferences.cover.mode === 'visit') {
      showroom.session.seed = showroomSeed();
      showroom.session.coverId = '';
      showroom.session.avoid = showroom.preferences.lastShown;
    }
    showroom.active = true;
  } else if (page !== 'Showroom' && showroom.active) {
    showroom.active = false;
    clearTimeout(showroom.coverTimer);
    showroom.coverTimer = null;
    closeShowroom();
  }
}
function showroomAllChoices() {
  return current()._view?.allShowroomChoices || ShowroomModel.cars(current());
}
function showroomGroups() {
  return local() ? db.planning.shelves : [];
}
function showroomCandidates(kind) {
  return ShowroomModel.candidates(showroomAllChoices(), showroomGroups(), showroom.preferences[kind]);
}
function showroomCoverCar() {
  if (local() && current()._view) return showroomCar(current()._view.featuredId);
  return ShowroomModel.cover(showroomAllChoices(), showroomGroups(), showroom.preferences.cover, {
    id: showroom.session.coverId,
    avoid: showroom.session.avoid,
    seed: showroom.session.seed
  });
}
function showroomRequest() {
  return {
    query: showroom.query,
    usage: showroom.usage,
    favourites: showroom.favourites,
    sort: showroom.sort,
    shelf: showroom.shelf,
    viewerId: showroom.viewer?.id || '',
    cover: showroom.preferences.cover,
    coverId: showroom.session.coverId,
    coverAvoidId: showroom.session.avoid,
    coverSeed: showroom.session.seed
  };
}
function showroomStory(c, full = false) {
  const history = c.realHistory || {},
    facts = [
      ['Team', history.team],
      ['Event', history.event],
      ['Year', history.year]
    ].filter(([, v]) => v);
  return `<section class="showroom-story"><div class="label">${icon('history')} Real Racing History</div>${facts.length ? `<dl class="showroom-story-facts">${facts.map(([label, value]) => `<div class="showroom-fact-${label.toLowerCase()}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}<p class="showroom-story-text ${full ? 'is-full' : ''}">${esc(history.history || 'Every car has a story. Add its real racing history from the car’s details.')}</p>${!full && history.history ? btn('Read full history →', 'showroom-history', 'ghost small', c.id) : ''}</section>`;
}
function showroomOptions(kind) {
  const presentation = kind === 'presentation',
    o = showroom.preferences[kind],
    all = showroomAllChoices(),
    groups = showroomGroups(),
    usages = current()._view?.usage || [...new Set(all.flatMap(c => c.usage || []))].sort();
  const select = (name, label, value, choices) =>
    `<label class="field">${label}<select name="${name}">${choices.map(([id, text]) => `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const sources = [
    ['all', 'All slotcars'],
    ['usage', 'Usage labels'],
    ...(local()
      ? [
          ['group', 'Group'],
          ['favourites', 'Favourites']
        ]
      : [])
  ];
  modal(
    presentation ? 'Presentation' : 'Cover options',
    `<p class="muted">${presentation ? 'Choose the cars and how to display them.' : 'Choose the car above your collection and when it changes.'} These choices are saved on this computer.</p><div class="form-grid">${
      !presentation
        ? select('mode', 'Change cover', o.mode, [
            ['fixed', 'Always the same car'],
            ['startup', 'New car each app startup'],
            ['visit', 'New car each Showroom visit'],
            ['rotate', 'Change every interval']
          ]) +
          `<div data-showroom-fixed>${select(
            'carId',
            'Cover car',
            o.carId,
            all.map(c => [c.id, c.name])
          )}</div>`
        : ''
    }<div data-showroom-source>${select('source', 'Show cars from', o.source, sources)}</div><div data-showroom-group>${select('groupId', 'Group', o.groupId, [['', 'Choose a group'], ...groups.map(g => [g.id, g.name])])}</div><div data-showroom-interval><label class="field">Interval (seconds)<input name="seconds" type="number" min="5" max="3600" step="1" value="${o.seconds}" required></label></div>${
      presentation
        ? select('layout', 'Display', o.layout, [
            ['history', 'Photo and racing history'],
            ['photo', 'Photo only']
          ])
        : ''
    }</div><div data-showroom-labels class="showroom-label-choices"><p class="muted">Include cars with any selected usage label.</p>${usages.map((label, i) => `<label class="check-row"><input type="checkbox" name="usage-${i}" value="${esc(label)}" ${o.labels.includes(label) ? 'checked' : ''}>${esc(label)}</label>`).join('') || '<p>No usage labels in this collection yet.</p>'}</div><div data-showroom-source><label class="check-row"><input name="photosOnly" type="checkbox" ${o.photosOnly ? 'checked' : ''}>Only cars with a main photo</label></div><div data-showroom-order><label class="check-row"><input name="shuffle" type="checkbox" ${o.shuffle ? 'checked' : ''}>Shuffle without repeats</label><p class="muted tiny">Otherwise use Group order, or car name A–Z.</p></div><p class="note info">Photos fill the frame without stretching. Edges may be cropped; existing photo framing is respected.</p><p class="muted" id="showroom-option-count" aria-live="polite"></p>`,
    async values => {
      const next = ShowroomModel.options({
        ...o,
        ...values,
        labels: [...form.querySelectorAll('[name^="usage-"]:checked')].map(x => x.value),
        photosOnly: form.elements.photosOnly.checked,
        shuffle: form.elements.shuffle.checked
      });
      const list = ShowroomModel.candidates(all, groups, next);
      if ((presentation || next.mode !== 'fixed') && !list.length)
        throw Error('No cars match these options. Choose another source or include cars without a main photo.');
      if (!presentation && next.mode === 'fixed' && !all.some(c => c.id === next.carId))
        throw Error('Choose an active car for the cover.');
      showroom.preferences[kind] = next;
      showroomSavePreferences();
      if (presentation) {
        const context = showroom.context;
        setTimeout(() => {
          if (page === 'Showroom' && context === showroomKey())
            startShowroomPresentation().catch(e => toast(e.message, true));
        }, 0);
      } else {
        showroom.session.coverId = '';
        showroom.session.seed = showroomSeed();
        showroom.session.avoid = '';
        showroom.coverPaused = false;
        clearTimeout(showroom.coverTimer);
        showroom.coverTimer = null;
      }
    },
    presentation ? 'Start presentation' : 'Save cover options'
  );
  const form = $('#modal-form');
  function update() {
    const mode = form.elements.mode?.value,
      source = form.elements.source.value,
      fixed = !presentation && mode === 'fixed',
      interval = presentation || mode === 'rotate';
    const show = (selector, yes) =>
      form.querySelectorAll(selector).forEach(el => {
        el.hidden = !yes;
        el.querySelectorAll('input,select').forEach(input => (input.disabled = !yes));
      });
    show('[data-showroom-fixed]', fixed);
    show('[data-showroom-source]', !fixed);
    show('[data-showroom-group]', !fixed && source === 'group');
    show('[data-showroom-labels]', !fixed && source === 'usage');
    show('[data-showroom-interval]', interval);
    show('[data-showroom-order]', interval);
    const selected = ShowroomModel.options({
      ...Object.fromEntries(new FormData(form)),
      labels: [...form.querySelectorAll('[name^="usage-"]:checked')].map(x => x.value),
      photosOnly: form.elements.photosOnly.checked
    });
    $('#showroom-option-count').textContent = fixed
      ? ''
      : ShowroomModel.candidates(all, groups, selected).length + ' cars match these options.';
  }
  form.addEventListener('change', update);
  update();
}
function scheduleCover() {
  if (
    showroom.coverTimer ||
    !showroom.active ||
    showroom.preferences.cover.mode !== 'rotate' ||
    showroom.coverPaused ||
    document.hidden
  )
    return;
  showroom.coverTimer = setTimeout(async () => {
    showroom.coverTimer = null;
    if (
      page !== 'Showroom' ||
      !showroom.active ||
      showroom.context !== showroomKey() ||
      showroom.coverPaused ||
      document.hidden
    )
      return;
    // Reading, editing, or inspecting photos must never be interrupted.
    if (
      $('#dialog').open ||
      showroom.viewer ||
      actionBusy ||
      viewPendingKey ||
      document.activeElement?.closest('#showroom-featured') ||
      $('#showroom-featured')?.matches(':hover')
    ) {
      scheduleCover();
      return;
    }
    const list = ShowroomModel.ordered(
        showroomCandidates('cover'),
        showroom.preferences.cover.shuffle,
        showroom.session.seed
      ),
      index = list.findIndex(c => c.id === showroomCoverCar()?.id);
    if (list.length > 1) {
      showroom.session.coverId = list[(index + 1) % list.length].id;
      try {
        await refreshShowroom();
      } catch (error) {
        showroom.coverPaused = true;
        toast(error.message, true);
      }
    }
    scheduleCover();
  }, showroom.preferences.cover.seconds * 1000);
}
async function startShowroomPresentation() {
  const list = ShowroomModel.ordered(
    showroomCandidates('presentation'),
    showroom.preferences.presentation.shuffle,
    showroomSeed()
  );
  if (!list.length) {
    toast('No cars match the presentation options.');
    return;
  }
  const opened = await openShowroom(list[0].id, true, {
    ids: list.map(c => c.id),
    presentation: true,
    layout: showroom.preferences.presentation.layout,
    seconds: showroom.preferences.presentation.seconds
  });
  if (opened && showroom.viewer === opened && !document.fullscreenElement)
    try {
      await fullscreenShowroom();
    } catch (e) {
      toast(e.message, true);
    }
}
