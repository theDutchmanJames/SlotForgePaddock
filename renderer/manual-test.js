'use strict';
// Record a manual test, after docs/ui-reference/manual-test-2026-11 option A: the result as a scoreboard on top,
// track, lane and driver with the ones you used before, switches for direction and magnets, the configuration as
// a short list, and the car's earlier tests on the same track and lane beside it. The form keeps its field names
// (setupId, track, lane, driver, voltage, direction, magnetStatus, laps, best, average, notes).
let manualTestCar = null;
const mtNumber = v => {
  const n = Number(String(v ?? '').trim().replace(',', '.'));
  return String(v ?? '').trim() && Number.isFinite(n) ? n : null;
};
const mtSame = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
function mtChips(name, values, current) {
  return values.length
    ? `<span class="mt-sugg">${values
        .slice(0, 6)
        .map(
          v =>
            `<button type="button" class="${mtSame(v, current) ? 'on' : ''}" data-action="mt-pick" data-id="${esc(name + '|' + v)}">${esc(v)}</button>`
        )
        .join('')}</span>`
    : '';
}
function mtSeg(name, label, options) {
  return `<div class="mt-segw"><span>${label}</span><input type="hidden" name="${name}" value="Unknown"><span class="mt-seg" role="group" aria-label="${label}">${options
    .map(
      ([value, text]) =>
        `<button type="button" class="${value === 'Unknown' ? 'on' : ''}" data-action="mt-seg" data-id="${esc(name + '|' + value)}" aria-pressed="${value === 'Unknown'}">${esc(text)}</button>`
    )
    .join('')}</span></div>`;
}
function mtScore(name, label, unit, extra = '') {
  return `<label class="mt-score" data-score="${name}"><span class="eye">${label}</span><span class="mt-v"><input name="${name}" inputmode="decimal" autocomplete="off" placeholder="—">${unit ? `<small>${unit}</small>` : ''}</span>${extra}</label>`;
}
function addTest(id) {
  const c = db.cars.find(c => c.id === id),
    setups = db.setups.filter(s => s.carId === id),
    tests = (db.tests || []).filter(t => t.carId === id),
    all = db.tests || [],
    t = c?.technical || {},
    recent = key => [...new Set(all.map(x => x[key]).filter(v => typeof v === 'string' && v.trim()))],
    tracks = choiceSuggestions('track', recent('track')),
    drivers = choiceSuggestions('driver', recent('driver')),
    lanes = [...new Set([...recent('lane'), '1', '2', '3', '4'])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    now = [t.motor, t.pinion || t.gear ? (t.pinion || '—') + ' / ' + (t.gear || '—') : '', t.weight ? t.weight + (/^\d+([.,]\d+)?$/.test(t.weight) ? ' g' : '') : '']
      .filter(Boolean)
      .join(' · ');
  manualTestCar = { id, tests };
  const configs = [
    ['', 'The car as it is now', 'Including unfinished work' + (now ? ' · ' + now : ''), 'Now'],
    ...setups.map(s => [s.id, s.name, 'Saved snapshot · ' + date(s.date), 'Snapshot'])
  ];
  modal(
    'Record a manual test',
    `<div class="mt-win"><div class="mt-main"><div class="mt-grp">Result</div><div class="mt-board">${mtScore('best', 'Best lap', 's', '<span class="mt-delta" id="mt-delta"></span>')}${mtScore('average', 'Average lap', 's')}${mtScore('laps', 'Laps', '')}</div><div class="mt-grp">Where and who</div><div class="mt-row3"><label class="field">Track<input name="track" maxlength="200" autocomplete="off">${mtChips('track', tracks, '')}</label><label class="field">Lane<input name="lane" maxlength="50" autocomplete="off">${mtChips('lane', lanes, '')}</label><label class="field">Driver<input name="driver" maxlength="200" autocomplete="off">${mtChips('driver', drivers, '')}</label></div><div class="mt-grp">Conditions</div><div class="mt-cond"><label class="field">Track voltage<span class="mt-unit"><input name="voltage" inputmode="decimal" autocomplete="off"><small>V</small></span></label>${mtSeg('direction', 'Direction', [
      ['Unknown', 'Unknown'],
      ['Clockwise', 'Clockwise'],
      ['Anticlockwise', 'Anticlockwise']
    ])}${mtSeg('magnetStatus', 'Traction magnets', [
      ['Unknown', 'Unknown'],
      ['With magnets', 'With magnets'],
      ['Without magnets', 'Without']
    ])}</div><div class="mt-grp">Car configuration</div><select name="setupId" hidden><option value="">Actual current car (including unfinished work)</option>${setups.map(s => `<option value="${s.id}">Saved historical snapshot: ${esc(s.name)} · ${date(s.date)}</option>`).join('')}</select><div class="mt-cfg" role="radiogroup" aria-label="Car configuration">${configs
      .map(
        ([value, name, sub, tag], i) =>
          `<button type="button" class="mt-cf ${i ? '' : 'on'}" role="radio" aria-checked="${!i}" data-action="mt-setup" data-id="${esc(value)}"><span class="mt-rd" aria-hidden="true"></span><span><b>${esc(name)}</b><small>${esc(sub)}</small></span><span class="mt-tag">${tag}</span></button>`
      )
      .join(
        ''
      )}</div><div class="mt-grp">Observations</div><textarea name="notes" class="mt-notes" placeholder="How did it feel? Grip, braking, anything to change next time…"></textarea></div><aside class="mt-side"><div class="mt-car"><span class="mt-car-pic">${c ? photo(c, true) : ''}</span><div><b>${esc(c?.name || 'Car')}</b><small>${esc([c?.maker, c?.scale].filter(Boolean).join(' · '))}</small></div></div><div class="mt-grp" id="mt-hist-title">Earlier tests</div><div class="mt-hist" id="mt-hist"></div><p class="mt-hint" id="mt-compare"></p><div class="mt-grp">Do not double count</div><p class="mt-hint">Races from SlotForge Timing are recorded automatically. Record only tests that Timing did not measure.</p></aside></div>`,
    async values => {
      for (const k of ['best', 'average', 'laps', 'voltage']) values[k] = String(values[k] || '').trim().replace(',', '.');
      await change('test.add', { carId: id, ...values });
    },
    'Save test'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="cp-summary" id="mt-summary"></span>');
  mtSync();
}
function mtSync() {
  const form = $('#modal-form');
  if (!manualTestCar || !form?.querySelector('.mt-win')) return;
  const v = name => form.querySelector(`[name="${name}"]`)?.value || '',
    track = v('track'),
    lane = v('lane'),
    best = mtNumber(v('best')),
    same = manualTestCar.tests.filter(
      t => (!track || mtSame(t.track, track)) && (!lane || mtSame(t.lane, lane))
    ),
    rows = [...same].sort((a, b) => (mtNumber(a.best) ?? 1e9) - (mtNumber(b.best) ?? 1e9)).slice(0, 6),
    earlierBest = same.map(t => mtNumber(t.best)).filter(n => n !== null).sort((a, b) => a - b)[0] ?? null;
  // Suggestion chips follow what is typed.
  for (const name of ['track', 'lane', 'driver'])
    form.querySelectorAll(`[data-action="mt-pick"][data-id^="${name}|"]`).forEach(b =>
      b.classList.toggle('on', mtSame(b.dataset.id.slice(name.length + 1), v(name)))
    );
  const where = [track, lane && 'lane ' + lane].filter(Boolean).join(', ');
  $('#mt-hist-title').textContent = 'Earlier tests' + (where ? ' · ' + where : '');
  $('#mt-hist').innerHTML =
    (best !== null
      ? `<div class="mt-hi new"><span>This test<small>${esc(date(new Date().toISOString()))}${v('driver') ? ' · ' + esc(v('driver')) : ''}</small></span><b>${best.toFixed(3)}</b></div>`
      : '') +
    (rows
      .map(
        t =>
          `<div class="mt-hi"><span>${esc(t.track || 'Unknown track')}${t.lane ? ' · lane ' + esc(t.lane) : ''}<small>${esc(date(t.date))}${t.driver ? ' · ' + esc(t.driver) : ''}</small></span><b>${t.best ? esc(t.best) : '—'}</b></div>`
      )
      .join('') || `<p class="mt-hint">${manualTestCar.tests.length ? 'No earlier test on this track and lane.' : 'This is the first manual test for this car.'}</p>`);
  const delta = best !== null && earlierBest !== null ? best - earlierBest : null,
    deltaText =
      delta === null ? '' : Math.abs(delta) < 0.0005 ? 'Equals your best here' : (delta < 0 ? '−' : '+') + Math.abs(delta).toFixed(3) + ' s vs your best here';
  const d = $('#mt-delta');
  d.textContent = track && lane ? deltaText : '';
  d.dataset.tone = delta === null ? '' : delta < 0 ? 'faster' : delta > 0 ? 'slower' : '';
  form.querySelector('[data-score="best"]').classList.toggle('faster', !!(track && lane) && delta !== null && delta < 0);
  $('#mt-compare').textContent =
    track && lane && delta !== null
      ? delta < 0
        ? `${Math.abs(delta).toFixed(3)} s faster than your best on this track and lane.`
        : delta > 0
          ? `${delta.toFixed(3)} s slower than your best on this track and lane.`
          : 'The same as your best on this track and lane.'
      : 'Fill in the track and lane to compare with your earlier tests there.';
  const laps = v('laps').trim();
  $('#mt-summary').innerHTML =
    best !== null || laps || track
      ? [best !== null ? `<b>${best.toFixed(3)} s</b> best` : '', laps ? esc(laps) + ' laps' : '', esc(where)].filter(Boolean).join(' · ')
      : 'Type the result and where you tested';
}
document.addEventListener('input', e => {
  if (e.target.closest?.('.mt-win')) mtSync();
});
function manualTestAction(action, id) {
  if (!['mt-pick', 'mt-seg', 'mt-setup'].includes(action)) return false;
  const form = $('#modal-form');
  if (!form?.querySelector('.mt-win')) return true;
  if (action === 'mt-pick' || action === 'mt-seg') {
    const at = id.indexOf('|'),
      name = id.slice(0, at),
      value = id.slice(at + 1),
      input = form.querySelector(`[name="${name}"]`);
    input.value = value;
    if (action === 'mt-seg')
      form.querySelectorAll(`[data-action="mt-seg"][data-id^="${name}|"]`).forEach(b => {
        b.classList.toggle('on', b.dataset.id === id);
        b.setAttribute('aria-pressed', String(b.dataset.id === id));
      });
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (action === 'mt-setup') {
    form.querySelector('[name="setupId"]').value = id;
    form.querySelectorAll('.mt-cf').forEach(b => {
      b.classList.toggle('on', b.dataset.id === id);
      b.setAttribute('aria-checked', String(b.dataset.id === id));
    });
  }
  mtSync();
  return true;
}
