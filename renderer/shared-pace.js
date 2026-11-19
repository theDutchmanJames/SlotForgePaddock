'use strict';
let sharedPaceState = null;
const sharedPaceCurrent = s =>
  sharedPaceState === s &&
  $('#dialog').open &&
  !!$('#shared-pace') &&
  s.path === dataPath &&
  s.identity.databaseId === db.id;
async function openSharedPace(id) {
  const s = {
    identity: historyIdentity(),
    path: dataPath,
    snapshot: null,
    serial: 0,
    busy: false,
    error: '',
    result: null,
    left: {
      carId: id || '',
      query: '',
      trackQuery: '',
      carOffset: 0,
      sessionOffset: 0,
      cars: null,
      sessions: null,
      choice: null,
      lane: '',
      driver: ''
    },
    right: {
      carId: '',
      query: '',
      trackQuery: '',
      carOffset: 0,
      sessionOffset: 0,
      cars: null,
      sessions: null,
      choice: null,
      lane: '',
      driver: ''
    }
  };
  s.active = id ? 'right' : 'left';
  sharedPaceState = s;
  modal('Compare pace', '<div id="shared-pace" class="shared-history cp-win cp-pace" data-picker="pace"></div>', null);
  $('#dialog .dialog-footer [data-action="close-modal"]').textContent = 'Close';
  await sharedPaceLoad(async () => {
    await sharedPaceCars(s, 'left');
    await sharedPaceCars(s, 'right');
    if (s.left.carId) await sharedPaceSessions(s, 'left');
  });
}
async function sharedPaceRead(s, operation, input = {}) {
  return api('historyView', { ...s.identity, operation, ...(s.snapshot ? { snapshot: s.snapshot } : {}), ...input });
}
async function sharedPaceCars(s, side) {
  const p = s[side],
    result = await sharedPaceRead(s, 'pace-cars', { query: p.query, offset: p.carOffset });
  if (!sharedPaceCurrent(s) || s.stale) return;
  s.snapshot = result.snapshot;
  p.cars = result;
}
async function sharedPaceSessions(s, side) {
  const p = s[side],
    result = await sharedPaceRead(s, 'pace-sessions', { carId: p.carId, offset: p.sessionOffset, query: p.trackQuery });
  if (!sharedPaceCurrent(s) || s.stale) return;
  s.snapshot = result.snapshot;
  p.sessions = result;
}
async function sharedPaceLoad(work) {
  const s = sharedPaceState;
  if (!sharedPaceCurrent(s) || s.busy || s.stale) return;
  const serial = ++s.serial;
  s.busy = true;
  s.error = '';
  s.result = null;
  paintSharedPace();
  try {
    await work();
  } catch (e) {
    if (sharedPaceCurrent(s) && serial === s.serial) s.error = e.message;
  } finally {
    if (sharedPaceCurrent(s) && serial === s.serial) {
      s.busy = false;
      paintSharedPace();
    }
  }
}
// Compare pace on the shared car picker (docs/ui-reference/car-picker-2026-11): the cars with recorded history
// as photo cards for the side you are choosing (A or B), and each side's sessions as cards under its slot.
// The original car and session selects stay (hidden), so the change handler and the scripted checks keep working.
function sharedPaceSide(p, side) {
  const s = sharedPaceState,
    tone = side === 'left' ? 'blue' : 'amber',
    tag = side === 'left' ? 'A' : 'B',
    car =
      p.sessions?.car ||
      p.cars?.rows.find(c => c.id === p.carId) ||
      (p.carId ? db.cars.find(c => c.id === p.carId) : null),
    selected = p.choice,
    choices = p.cars?.rows || [],
    options = car && !choices.some(c => c.id === car.id) ? [car, ...choices] : choices,
    rows =
      selected && !p.sessions?.rows.some(x => sharedPaceKey(x) === sharedPaceKey(selected))
        ? [selected, ...(p.sessions?.rows || [])]
        : p.sessions?.rows || [],
    full = car ? db.cars.find(c => c.id === car.id) || car : null,
    isOn = x => selected && sharedPaceKey(x) === sharedPaceKey(selected),
    hidden = `<select data-shared-pace="car" data-side="${side}" hidden><option value="">Choose a car…</option>${options.map(c => `<option value="${esc(c.id)}" ${c.id === p.carId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>${p.carId ? `<select data-shared-pace="session" data-side="${side}" hidden><option value="">Choose a session…</option>${rows.map(x => `<option value="${esc(sharedPaceKey(x))}" ${isOn(x) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}`,
    hint = car
      ? selected
        ? esc(selected.track.name || 'Unknown track') + ' · ' + esc(historySessionDate(selected.startedAt, selected.savedAt))
        : 'Choose a recorded session below'
      : s.active === side
        ? 'Click a car on the left'
        : 'Click Choose to pick this side',
    slot = `<div class="cp-slot ${car ? '' : 'empty'} ${s.active === side ? 'active' : ''}" data-tone="${tone}"><span class="cp-tag">${tag}</span><span class="cp-slot-pic">${full ? photo(full, true) : ''}</span><span class="cp-slot-text"><b>${esc(car?.name || 'Pick a car')}</b><small>${hint}</small></span>${car ? `<button type="button" class="btn small ghost" data-action="shared-pace-clear" data-id="${side}" aria-label="Clear ${tag}">×</button>` : s.active === side ? '' : btn('Choose', 'shared-pace-side', 'small', side)}</div>`;
  if (!p.carId) return `<div class="cp-pace-side" data-tone="${tone}">${hidden}${slot}</div>`;
  const sessions = rows.length
    ? rows
        .map(
          x =>
            `<button type="button" class="cp-se ${isOn(x) ? 'on' : ''}" data-action="shared-pace-session-pick" data-id="${esc(side + '|' + sharedPaceKey(x))}"><span><b>${esc(x.track.name || 'Unknown track')}</b><small>${esc(x.name)} · ${esc(historySessionDate(x.startedAt, x.savedAt))}</small></span><b>${esc(x.sourceId)}</b></button>`
        )
        .join('')
    : `<p class="cp-pace-note">${p.sessions ? (p.trackQuery ? 'No session on a matching track.' : 'No recorded sessions.') : 'Loading sessions…'}</p>`;
  const paging =
    p.sessionOffset || p.sessions?.nextOffset != null
      ? `<div class="cp-pace-more">${p.sessionOffset ? btn('‹ Earlier', 'shared-pace-sessions-prev', 'small ghost', side) : '<span></span>'}<span class="tiny muted">${p.sessions?.total ?? 0} sessions</span>${p.sessions?.nextOffset != null ? btn('More ›', 'shared-pace-sessions-next', 'small ghost', side) : '<span></span>'}</div>`
      : '';
  const run = selected
    ? `<div class="cp-pace-run"><label class="field">Lane<select data-shared-pace="lane" data-side="${side}"><option value="">All lanes</option>${selected.track.lanes.map(l => `<option value="${l.lane}" ${p.lane === String(l.lane) ? 'selected' : ''}>Lane ${l.lane}</option>`).join('')}</select></label><label class="field">Driver<select data-shared-pace="driver" data-side="${side}"><option value="">All drivers</option>${selected.drivers.map(d => `<option value="${esc(d.id)}" ${p.driver === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label></div>`
    : '';
  return `<div class="cp-pace-side" data-tone="${tone}">${hidden}${slot}<div class="cp-pace-filter"><input id="shared-pace-track-${side}" maxlength="200" value="${esc(p.trackQuery)}" placeholder="Filter by track…" aria-label="Filter ${tag} sessions by track">${btn('Filter', 'shared-pace-track', 'small', side)}</div><div class="cp-sess">${sessions}</div>${paging}${run}</div>`;
}
const sharedPaceKey = x => JSON.stringify([x.sourceId, x.sessionId, x.participantId]);
function sharedPaceSelection(p) {
  const x = p.choice;
  return {
    carId: p.carId,
    sourceId: x.sourceId,
    sessionId: x.sessionId,
    participantId: x.participantId,
    ...(p.lane ? { lane: Number(p.lane) } : {}),
    ...(p.driver ? { driverId: p.driver } : {})
  };
}
function sharedPaceResults(result) {
  const a = result.left,
    b = result.right,
    rows = [
      ['Average valid lap', 'averageMs'],
      ['Median valid lap', 'medianMs'],
      ['Consistency · standard deviation', 'standardDeviationMs'],
      ['Best personal-eligible lap', 'bestPersonalMs'],
      ['Best track-eligible lap', 'bestTrackMs'],
      ['Best uninterrupted 5-lap average', 'sustained5Ms'],
      ['Best uninterrupted 10-lap average', 'sustained10Ms']
    ];
  const deltas = rows.map(([label, key]) => {
    const av = a.metrics[key],
      bv = b.metrics[key],
      delta = av === null || bv === null ? null : bv - av;
    return [
      label,
      HistoryViewModel.seconds(av),
      HistoryViewModel.seconds(bv),
      delta === null ? 'Unknown' : (delta > 0 ? '+' : '') + (delta / 1000).toFixed(3) + ' s'
    ];
  });
  const details = x =>
    `<section class="panel"><h3>${esc(x.car.name)}${x.car.archived ? ' · Archived' : ''}</h3><p>${esc(x.name)} · ${esc(historySessionDate(x.startedAt, x.savedAt))}</p><p>${esc(x.track.name || 'Unknown track')} · ${esc(x.sourceId)}</p><p>${x.metrics.validLaps} valid / ${x.metrics.totalLaps} selected laps · ${esc(x.driverNames.join(', ') || 'Driver unknown')} · ${esc(x.metrics.lanes.length ? 'Lanes ' + x.metrics.lanes.join(', ') : 'Lane unknown')}</p><p class="tiny muted">Accepted revision ${x.accepted.revision} · ${esc(x.provenance.kind)} · ${x.metrics.personalLaps} personal-eligible / ${x.metrics.trackLaps} track-eligible laps</p><p class="tiny muted">${x.configuration ? 'Captured configuration: ' + esc(x.configuration.revision?.slice(0, 12) || x.configuration.kind || 'historical') : 'Configuration unknown'} · ${esc(x.configuration?.capturedAt || x.configuration?.recordedAt || 'Capture date unknown')}</p></section>`;
  const changes = SharedPaceModel.differences(a.configuration, b.configuration);
  return `<div class="shared-pace-pair mt">${details(a)}${details(b)}</div><section class="panel mt"><h3>Measured pace</h3><p class="tiny muted">Difference = B − A. Negative time is faster; negative standard deviation means a smaller spread. Invalid and pit laps are excluded. Sustained runs require explicit consecutive laps in one heat, stint, driver and lane; missing timing cannot establish continuity.</p>${historyTable(['Metric', 'A', 'B', 'Difference'], deltas)}</section><div class="note warning mt"><strong>Comparison context</strong><ul>${SharedPaceModel.warnings(
    a,
    b
  )
    .map(n => '<li>' + esc(n) + '</li>')
    .join(
      ''
    )}</ul></div><section class="panel mt"><h3>Captured setup differences</h3><p class="tiny muted">The specifications recorded for these sessions. Missing values stay unknown; current car settings are never substituted. Highlighted rows differ.</p><div class="table-wrap"><table class="shared-pace-setups"><thead><tr><th>Specification</th><th>A</th><th>B</th><th>Comparison</th></tr></thead><tbody>${changes.map(r => `<tr class="${r.status === 'different' ? 'pace-different' : ''}"><th scope="row">${esc(techLabels[r.key] || r.key)}</th><td>${esc(r.left)}</td><td>${esc(r.right)}</td><td>${r.status === 'unknown' ? 'Not established' : r.status === 'different' ? 'Different' : 'Same'}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function paintSharedPace() {
  const s = sharedPaceState;
  if (!sharedPaceCurrent(s)) return;
  const root = $('#shared-pace'),
    side = s.active,
    p = s[side],
    tag = side === 'left' ? 'A' : 'B',
    tone = side === 'left' ? 'blue' : 'amber',
    cards = (p.cars?.rows || [])
      .map(c => {
        const a = s.left.carId === c.id,
          b = s.right.carId === c.id;
        return carPickCard(c, {
          action: 'shared-pace-pick',
          on: p.carId === c.id || a || b,
          tone: a && !b ? 'blue' : b && !a ? 'amber' : tone,
          badge: a && b ? 'A·B' : a ? 'A' : b ? 'B' : ''
        });
      })
      .join(''),
    ready = s.left.choice && s.right.choice,
    main = s.result
      ? `<div class="cp-tool"><div><div class="eye">Measured pace</div><b>${esc(s.result.left.car.name)} vs ${esc(s.result.right.car.name)}</b></div><span class="cp-count">${btn('‹ Back to cars', 'shared-pace-back', 'small')}</span></div><div class="cp-results" id="shared-pace-results">${sharedPaceResults(s.result)}</div>`
      : `<div class="cp-tool"><span class="cp-q"><input type="search" id="shared-pace-search-${side}" maxlength="200" value="${esc(p.query)}" placeholder="Find a car with recorded history…" aria-label="Find a car for ${tag}"></span>${btn('Search', 'shared-pace-search', 'small', side)}<span class="cp-count">Choosing <b>${tag}</b> · <b class="mono">${p.cars?.total ?? 0}</b> cars with history</span></div><div class="cp-grid">${cards || `<p class="cp-none">${p.cars ? (p.query ? 'No car with recorded history matches.' : 'No car has recorded history yet.') : 'Loading cars…'}</p>`}</div>${p.carOffset || p.cars?.nextOffset != null ? `<div class="cp-paging">${p.carOffset ? btn('‹ Previous cars', 'shared-pace-cars-prev', 'small ghost', side) : ''}<span class="grow"></span>${p.cars?.nextOffset != null ? btn('More cars ›', 'shared-pace-cars-next', 'small ghost', side) : ''}</div>` : ''}`;
  keepFocus(() => (root.innerHTML = `<div class="cp-main">${main}</div><aside class="cp-side"><div class="cp-sh"><div class="eye">Comparing</div><h3>${esc(s.left.carId ? sharedPaceName(s.left) : 'Pick A')} vs ${esc(s.right.carId ? sharedPaceName(s.right) : 'B')}</h3><p>Two recorded sessions, from the same car or different cars. Pick a car and a session for A and for B.</p></div><div class="cp-sb">${s.error ? `<p class="note warning" role="alert">${esc(s.error)} Use Refresh selections to reload current history.</p>` : ''}${sharedPaceSide(s.left, 'left')}<div class="cp-swap">${btn('⇅ Swap A and B', 'shared-pace-swap', 'small')}</div>${sharedPaceSide(s.right, 'right')}<div class="actions mt">${btn('Refresh selections', 'shared-pace-refresh', 'small ghost')}${btn('Manual & earlier Timing runs', 'shared-pace-legacy', 'small ghost')}</div></div><div class="cp-paging"><button type="button" class="btn primary" data-action="shared-pace-compare" ${s.busy || s.error || s.stale || !ready ? 'disabled' : ''}>Compare recorded pace</button>${s.busy ? '<span role="status">Loading…</span>' : `<span>${ready ? 'Ready to compare' : 'Choose a session for A and B'}</span>`}</div></aside>`));
  if (s.busy) root.querySelectorAll('button,input,select').forEach(el => (el.disabled = true));
  else if (s.stale) root.querySelectorAll('input,select,.cp-card,.cp-se').forEach(el => (el.disabled = true));
}
const sharedPaceName = p =>
  p.sessions?.car?.name ||
  p.cars?.rows.find(c => c.id === p.carId)?.name ||
  db.cars.find(c => c.id === p.carId)?.name ||
  'Car';
async function sharedPaceSetCar(s, side, id) {
  const p = s[side];
  s.result = null;
  p.carId = id;
  p.sessions = null;
  p.choice = null;
  p.trackQuery = '';
  p.sessionOffset = 0;
  p.lane = '';
  p.driver = '';
  if (p.carId) await sharedPaceLoad(() => sharedPaceSessions(s, side));
  else paintSharedPace();
}
// Enter in the car search or a track filter runs it, instead of submitting the window.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !/^shared-pace-(search|track)-(left|right)$/.test(e.target.id || '')) return;
  e.preventDefault();
  const [, kind, side] = e.target.id.match(/^shared-pace-(search|track)-(left|right)$/);
  $(`#shared-pace [data-action="shared-pace-${kind}"][data-id="${side}"]`)?.click();
});
async function sharedPaceAction(action, id) {
  if (!action.startsWith('shared-pace-')) return false;
  const s = sharedPaceState;
  if (!sharedPaceCurrent(s) || s.busy) return true;
  if (action === 'shared-pace-legacy') {
    await openLegacyPace(s.left.carId);
    return true;
  }
  if (action === 'shared-pace-refresh') {
    await openSharedPace(s.left.carId);
    return true;
  }
  if (s.stale) return true;
  if (action === 'shared-pace-compare') {
    if (s.left.choice && s.right.choice)
      await sharedPaceLoad(async () => {
        const result = await sharedPaceRead(s, 'pace-compare', {
          left: sharedPaceSelection(s.left),
          right: sharedPaceSelection(s.right)
        });
        if (sharedPaceCurrent(s) && !s.stale) s.result = result;
      });
    if (s.result) $('#shared-pace-results')?.scrollIntoView({ block: 'start' });
    return true;
  }
  if (action === 'shared-pace-back') {
    s.result = null;
    paintSharedPace();
    return true;
  }
  if (action === 'shared-pace-swap') {
    [s.left, s.right] = [s.right, s.left];
    s.result = null;
    paintSharedPace();
    return true;
  }
  if (action === 'shared-pace-pick') {
    const side = s.active,
      other = side === 'left' ? 'right' : 'left';
    await sharedPaceSetCar(s, side, s[side].carId === id ? '' : id);
    if (s[side].carId && !s[other].carId) {
      s.active = other;
      paintSharedPace();
    }
    return true;
  }
  if (action === 'shared-pace-session-pick') {
    const side = id.slice(0, id.indexOf('|')),
      el = $('#shared-pace [data-shared-pace="session"][data-side="' + side + '"]');
    if (!el) return true;
    el.value = id.slice(side.length + 1);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (!['left', 'right'].includes(id)) return true;
  const p = s[id];
  if (action === 'shared-pace-side') {
    s.active = id;
    paintSharedPace();
  }
  if (action === 'shared-pace-clear') {
    s.active = id;
    await sharedPaceSetCar(s, id, '');
  }
  if (action === 'shared-pace-track') {
    p.trackQuery = $('#shared-pace-track-' + id).value;
    p.sessionOffset = 0;
    p.choice = null;
    p.lane = '';
    p.driver = '';
    await sharedPaceLoad(() => sharedPaceSessions(s, id));
  }
  if (action === 'shared-pace-search') {
    p.query = $('#shared-pace-search-' + id).value;
    p.carOffset = 0;
    await sharedPaceLoad(() => sharedPaceCars(s, id));
  }
  if (action === 'shared-pace-cars-prev' || action === 'shared-pace-cars-next') {
    p.carOffset = action.endsWith('prev') ? Math.max(0, p.carOffset - 20) : (p.cars?.nextOffset ?? p.carOffset);
    await sharedPaceLoad(() => sharedPaceCars(s, id));
  }
  if (action === 'shared-pace-sessions-prev' || action === 'shared-pace-sessions-next') {
    p.sessionOffset = action.endsWith('prev')
      ? Math.max(0, p.sessionOffset - 20)
      : (p.sessions?.nextOffset ?? p.sessionOffset);
    await sharedPaceLoad(() => sharedPaceSessions(s, id));
  }
  return true;
}
document.addEventListener('change', async e => {
  const key = e.target.dataset.sharedPace,
    side = e.target.dataset.side,
    s = sharedPaceState;
  if (!key || !['left', 'right'].includes(side) || !sharedPaceCurrent(s) || s.busy || s.stale) return;
  const p = s[side];
  s.result = null;
  if (key === 'car') await sharedPaceSetCar(s, side, e.target.value);
  if (key === 'session') {
    p.choice =
      p.sessions?.rows.find(x => sharedPaceKey(x) === e.target.value) ||
      (p.choice && sharedPaceKey(p.choice) === e.target.value ? p.choice : null);
    p.lane = '';
    p.driver = '';
    paintSharedPace();
  }
  if (key === 'lane' || key === 'driver') {
    p[key] = e.target.value;
    paintSharedPace();
  }
});
function invalidateSharedPace(change) {
  const s = sharedPaceState;
  if (!sharedPaceCurrent(s) || (change?.databaseId && change.databaseId !== s.identity.databaseId)) return;
  s.stale = true;
  ++s.serial;
  s.busy = false;
  s.result = null;
  s.error = 'The collection changed. Refresh selections to compare the latest accepted history.';
  paintSharedPace();
}
document.getElementById('dialog').addEventListener('close', () =>
  queueMicrotask(() => {
    if (!$('#dialog').open || !$('#shared-pace')) sharedPaceState = null;
  })
);
