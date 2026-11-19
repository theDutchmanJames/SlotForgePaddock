const historyClassifications = ['Unverified', 'Real Racing Car', 'Fantasy Livery', 'Tribute Livery', 'Road / Show Car'];
const historyFields = [
  ['team', 'Racing team'],
  ['drivers', 'Drivers'],
  ['event', 'Event / circuit'],
  ['year', 'Year'],
  ['raceNumber', 'Race number'],
  ['qualifying', 'Qualifying result'],
  ['finish', 'Finishing result (including DNF / DNS)'],
  ['history', 'History of the represented entry']
];
function liveryClassification(value) {
  const styles = {
      'Unverified': [
        'unverified',
        'history',
        'Ready for research',
        'The original car or livery has not been classified yet.'
      ],
      'Real Racing Car': [
        'racing',
        'flag',
        'Race-inspired history',
        'Recorded as representing a real racing car and livery.'
      ],
      'Fantasy Livery': ['fantasy', 'palette', 'Creative by design', 'Recorded as an imagined racing colour scheme.'],
      'Tribute Livery': [
        'tribute',
        'bookmark',
        'A nod to racing history',
        'Recorded as a tribute to another car, team or era.'
      ],
      'Road / Show Car': ['road', 'car', 'Beyond the race circuit', 'Recorded as a road car or show-car appearance.']
    },
    name = Object.hasOwn(styles, value) ? value : 'Unverified',
    [tone, symbol, kicker, description] = styles[name];
  return `<section class="livery-classification livery-${tone}"><span class="livery-emblem">${icon(symbol)}</span><div><div class="label">Livery classification · ${esc(kicker)}</div><h3>${esc(name)}</h3><p>${esc(description)}</p><small>Collector classification · not independently verified</small></div></section>`;
}
function historySourceButton(url, label) {
  return url
    ? `<button type="button" class="btn ghost small" data-action="history-source" data-url="${esc(url)}">${esc(label || url)} ${icon('next')}</button>`
    : '';
}
function renderRealHistorySummary(c) {
  const h = c.realHistory || {},
    hasEntry = historyFields.some(([key]) => String(h[key] ?? '').trim()),
    classification = historyClassifications.includes(h.classification) ? h.classification : 'Unverified';
  const tones = {
      'Real Racing Car': ['racing', 'flag'],
      'Fantasy Livery': ['fantasy', 'palette'],
      'Tribute Livery': ['tribute', 'bookmark'],
      'Road / Show Car': ['road', 'car'],
      'Unverified': ['unverified', 'history']
    },
    [tone, symbol] = tones[classification];
  const classificationCard = `<div class="overview-livery livery-${tone}">${icon(symbol)}<div><strong>${esc(classification)}</strong><small>Collector classification · not independently verified</small></div></div>`;
  const entry = hasEntry
    ? `<div class="overview-racing-entry">${String(h.raceNumber ?? '').trim() ? `<span class="overview-race-number" aria-label="Race number ${esc(h.raceNumber)}">${esc(h.raceNumber)}</span>` : ''}<div><div class="label">The car behind the model</div><h3>${esc(h.team || 'Racing team not recorded')}</h3><p class="muted">${esc(h.event || 'Event not recorded')}</p></div></div><dl class="overview-racing-facts">${[
        ['Year', h.year],
        ['Qualifying', h.qualifying],
        ['Finish', h.finish]
      ]
        .map(
          ([label, value]) =>
            `<div><dt>${label}</dt><dd>${esc(String(value ?? '').trim() || 'Not recorded')}</dd></div>`
        )
        .join(
          ''
        )}</dl><div class="overview-racing-drivers"><span class="tiny muted">Drivers</span><p>${esc(h.drivers || 'Not recorded')}</p></div>`
    : `<div class="overview-history-empty">${icon('history')}<h3>The story starts here</h3><p class="muted">Add the team, drivers and race represented by this slotcar.</p></div>`;
  return `<section class="panel section-panel overview-racing-history"><div class="panel-heading"><h2>${icon('flag')}Real Racing History</h2></div><div class="panel-content">${entry}${hasEntry || classification !== 'Unverified' ? classificationCard : ''}<div class="actions">${btn((hasEntry || classification !== 'Unverified' ? 'View full history' : local() ? 'Add real car history' : 'View history') + ' ' + icon('next'), 'section', 'small ghost', 'Real Car History')}</div></div></section>`;
}
function renderRealHistory(c) {
  const h = c.realHistory || {},
    photos = h.photos || [];
  return (
    `<div class="page-head"><div><h2>Real Car History</h2><p class="muted">The full-size car and livery represented by this model.</p></div>${local() ? btn('Edit history', 'history-edit', 'primary', c.id) : ''}</div>` +
    liveryClassification(h.classification) +
    (local() ? historyResearchTools(c) : '') +
    `<div class="two-col mt">${panel('Represented racing entry', dl(historyFields.filter(([key]) => key !== 'history').map(([key, label]) => [label, h[key]])))}${panel('Research notes', `<p class="prewrap">${esc(h.history || 'Add the story of the original car, or leave this section empty.')}</p>`)}</div>` +
    `<div class="mt">${panel('Sources', h.sources?.length ? `<ul class="history-sources">${h.sources.map(s => `<li>${historySourceButton(s.url, s.title || s.url)}${s.title ? `<div class="tiny muted">${esc(s.url)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No sources recorded. Add event results, manufacturer references or historical photographs as evidence.</p>')}</div>` +
    (h.evidence?.length
      ? `<details class="mt"><summary>Imported research · sources and uncertainty</summary>${h.evidence.map(e => `<div class="research-proposal"><strong>${esc(HistoryResearch.labels[e.field])}</strong> ${badge(e.method === 'webpage' ? 'Webpage extraction' : 'External research file', 'info')}<p class="prewrap">${esc(e.uncertainty || 'No uncertainty supplied; not automatically verified.')}</p>${e.sourceUrls.length ? e.sourceUrls.map(url => historySourceButton(url, url)).join('') : '<p class="tiny muted">No source supplied.</p>'}</div>`).join('')}</details>`
      : '') +
    `<div class="mt">${panel('Full-size car photographs', `<div class="actions">${local() ? btn('Add reference photograph', 'history-photo', '', c.id) : ''}</div>${photos.length ? `<div class="history-photo-grid mt">${photos.map(p => `<figure><img src="${esc(p.data)}" alt="${esc(p.caption || p.name)}"><figcaption><strong>${esc(p.name)}</strong><p class="prewrap">${esc(p.caption)}</p>${historySourceButton(p.sourceUrl, 'Photograph source')}${local() ? btn('Remove', 'history-photo-remove', 'small ghost', p.id) : ''}</figcaption></figure>`).join('')}</div>` : '<p class="muted mt">Keep reference photographs separate from pictures of your slotcar. Add a source or credit when available.</p>'}`)}</div>`
  );
}
// The editor, after docs/ui-reference/real-history-2026-11 option A: classification cards, the facts grouped as
// the entry, the race and the story, drivers as name chips, sources as cards, and a live preview of the card
// the car's overview shows. The form keeps its field names, so saving is unchanged.
const historyClassText = {
  'Unverified': ['history', 'Not classified yet'],
  'Real Racing Car': ['flag', 'A real car and livery'],
  'Fantasy Livery': ['palette', 'Imagined colours'],
  'Tribute Livery': ['bookmark', 'A nod to another car'],
  'Road / Show Car': ['car', 'Road or show car']
};
const historyTone = {
  'Unverified': 'unverified',
  'Real Racing Car': 'racing',
  'Fantasy Livery': 'fantasy',
  'Tribute Livery': 'tribute',
  'Road / Show Car': 'road'
};
function historyDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
function historySourceRow(source = { title: '', url: '' }) {
  const host = historyDomain(source.url);
  return `<div class="history-source-editor"><span class="rh-fav" aria-hidden="true">${esc((host || '?').slice(0, 2).toUpperCase())}</span><span class="rh-src-fields"><input data-history-title value="${esc(source.title)}" maxlength="200" placeholder="What is this source?" aria-label="Source title"><input data-history-url type="url" value="${esc(source.url)}" maxlength="2000" placeholder="https://…" aria-label="Source link"></span><button type="button" class="rh-x" data-action="history-source-remove" aria-label="Remove source">×</button></div>`;
}
function historyField(key, label, value, extra = '', attrs = '') {
  return `<label class="field rh-f-${key}">${label}<input name="${key}" value="${esc(value || '')}" autocomplete="off" ${attrs}>${extra}</label>`;
}
function historyQuick(key, values) {
  return `<span class="rh-quick">${values.map(v => `<button type="button" data-action="history-quick" data-id="${esc(key + '|' + v)}">${esc(v)}</button>`).join('')}</span>`;
}
function editRealHistory(id) {
  const ctx = researchContext(id),
    c = db.cars.find(c => c.id === id),
    h = ctx.history,
    revision = ctx.revision,
    current = historyClassifications.includes(h.classification) ? h.classification : 'Unverified';
  modal(
    'Real Car History',
    `<div class="rh-win" data-car="${esc(id)}"><div class="rh-main"><p class="rh-hint rh-lead">${esc(c.name)} · the full-size car and livery this model represents. Optional research: it does not change the model's own details or race results.</p><div class="rh-grp">Livery classification</div><input type="hidden" name="classification" value="${esc(current)}"><div class="rh-cls" role="radiogroup" aria-label="Livery classification">${historyClassifications
      .map(
        name =>
          `<button type="button" class="rh-cl livery-${historyTone[name]} ${name === current ? 'on' : ''}" role="radio" aria-checked="${name === current}" data-action="history-class" data-id="${esc(name)}"><span class="rh-em">${icon(historyClassText[name][0])}</span><b>${esc(name)}</b><small>${esc(historyClassText[name][1])}</small></button>`
      )
      .join('')}</div><div class="rh-grp">The entry</div><div class="rh-entry">${historyField('raceNumber', 'Race number', h.raceNumber, '', 'maxlength="20"')}${historyField('team', 'Racing team', h.team)}${historyField('year', 'Year', h.year, '', 'maxlength="20"')}</div><label class="field rh-drivers-field">Drivers<input type="hidden" name="drivers" value="${esc(h.drivers || '')}"><span class="rh-drivers" id="rh-drivers"><input id="rh-driver-input" placeholder="Add a driver…" aria-label="Add a driver" autocomplete="off"></span><small class="rh-hint">Enter or a comma adds the name.</small></label><div class="rh-grp">The race</div><div class="rh-race">${historyField('event', 'Event / circuit', h.event)}${historyField('qualifying', 'Qualifying', h.qualifying, historyQuick('qualifying', ['Pole position', 'Did not qualify']))}${historyField('finish', 'Finish', h.finish, historyQuick('finish', ['Winner', 'DNF', 'DNS']))}</div><div class="rh-grp">The story</div><textarea name="history" class="rh-story" placeholder="What happened to the original car? Its drivers, results and what makes it special…">${esc(h.history || '')}</textarea><div class="rh-grp">Sources</div><div id="history-source-editor">${(h.sources || []).map(historySourceRow).join('')}</div><button type="button" class="rh-add-src" data-action="history-source-add">+ Add a source</button><p class="rh-hint">Event results, manufacturer references or historical photographs. History text and sources travel with a Paddock car export; reference photographs only when exporting additional photos.</p></div><aside class="rh-side"><div class="rh-eye">Live preview · on the car's overview</div><div id="rh-preview"></div><div class="rh-grp">How complete</div><div class="rh-meter" id="rh-meter"></div><p class="rh-hint" id="rh-complete"></p><p class="rh-hint">Reference photographs are added on the Real Car History page.</p></aside></div>`,
    async values => {
      historyDriversCommit();
      values.drivers = $('#modal-form [name="drivers"]').value;
      const sources = [...document.querySelectorAll('.history-source-editor')]
        .map(row => ({
          title: row.querySelector('[data-history-title]').value.trim(),
          url: row.querySelector('[data-history-url]').value.trim()
        }))
        .filter(s => s.title || s.url);
      checkResearchContext(ctx);
      const evidence = HistoryResearch.editedEvidence(h, values, sources);
      await change('car.save', { id, revision, data: { realHistory: { ...h, ...values, sources, evidence } } });
    },
    'Save history'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="cp-summary" id="rh-summary"></span>');
  historyDriversPaint();
  historySync();
}
const historyDriverList = () =>
  ($('#modal-form [name="drivers"]')?.value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
function historyDriversPaint() {
  const box = $('#rh-drivers');
  if (!box) return;
  box.querySelectorAll('.rh-chip').forEach(x => x.remove());
  box.insertAdjacentHTML(
    'afterbegin',
    historyDriverList()
      .map(
        (d, i) =>
          `<span class="rh-chip">${esc(d)}<button type="button" data-action="history-driver-remove" data-id="${i}" aria-label="Remove ${esc(d)}">×</button></span>`
      )
      .join('')
  );
}
// A typed name that was not added yet still counts when saving.
function historyDriversCommit() {
  const input = $('#rh-driver-input'),
    hidden = $('#modal-form [name="drivers"]');
  if (!input || !hidden) return;
  const names = input.value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!names.length) return;
  hidden.value = [...historyDriverList(), ...names].join(', ');
  input.value = '';
  historyDriversPaint();
  historySync();
}
function historySync() {
  const form = $('#modal-form');
  if (!form?.querySelector('.rh-win')) return;
  const v = k => (form.querySelector(`[name="${k}"]`)?.value || '').trim(),
    c = db.cars.find(c => c.id === form.querySelector('.rh-win').dataset.car),
    cls = v('classification') || 'Unverified',
    drivers = historyDriverList(),
    sources = [...form.querySelectorAll('.history-source-editor')].filter(
      r => r.querySelector('[data-history-title]').value.trim() || r.querySelector('[data-history-url]').value.trim()
    ).length;
  $('#rh-preview').innerHTML = `<div class="rh-card"><div class="rh-card-pic">${c ? photo(c) : ''}${v('raceNumber') ? `<span class="rh-num">${esc(v('raceNumber'))}</span>` : ''}<div class="rh-card-title"><span>The car behind the model</span><b>${esc(v('team') || 'Racing team not recorded')}</b></div></div><div class="rh-card-body"><p>${esc(v('event') || 'Event not recorded')}</p><dl class="rh-facts">${[
    ['Year', v('year')],
    ['Qualifying', v('qualifying')],
    ['Finish', v('finish')]
  ]
    .map(([l, x]) => `<div><dt>${l}</dt><dd>${esc(x || '—')}</dd></div>`)
    .join('')}</dl><p class="rh-card-drivers">Drivers · ${esc(drivers.join(', ') || 'not recorded')}</p><span class="rh-badge livery-${historyTone[cls] || 'unverified'}">${icon(historyClassText[cls]?.[0] || 'history')}${esc(cls)}</span></div></div>`;
  const facts = ['team', 'drivers', 'event', 'year', 'raceNumber', 'qualifying', 'finish', 'history'],
    done = facts.filter(k => (k === 'drivers' ? drivers.length : v(k))).length;
  $('#rh-meter').innerHTML = facts.map((_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('');
  $('#rh-complete').textContent = `${done} of 8 facts filled in · ${sources} ${sources === 1 ? 'source' : 'sources'}.`;
  $('#rh-summary').innerHTML = `<b>${esc(cls)}</b> · ${done} of 8 facts · ${sources} ${sources === 1 ? 'source' : 'sources'}`;
  form.querySelectorAll('.history-source-editor').forEach(row => {
    const host = historyDomain(row.querySelector('[data-history-url]').value.trim());
    row.querySelector('.rh-fav').textContent = (host || '?').slice(0, 2).toUpperCase();
  });
}
document.addEventListener('input', e => {
  if (e.target.id === 'rh-driver-input' && e.target.value.includes(',')) historyDriversCommit();
  else if (e.target.closest?.('.rh-win')) historySync();
});
document.addEventListener('keydown', e => {
  if (e.target.id !== 'rh-driver-input') return;
  if (e.key === 'Enter') {
    e.preventDefault();
    historyDriversCommit();
  } else if (e.key === 'Backspace' && !e.target.value && historyDriverList().length) {
    const list = historyDriverList();
    list.pop();
    $('#modal-form [name="drivers"]').value = list.join(', ');
    historyDriversPaint();
    historySync();
  }
});
document.addEventListener('focusout', e => {
  if (e.target.id === 'rh-driver-input') historyDriversCommit();
});
function historyEditorAction(action, id) {
  const form = $('#modal-form');
  if (!form?.querySelector('.rh-win')) return true;
  if (action === 'history-class') {
    form.querySelector('[name="classification"]').value = id;
    form.querySelectorAll('.rh-cl').forEach(b => {
      b.classList.toggle('on', b.dataset.id === id);
      b.setAttribute('aria-checked', String(b.dataset.id === id));
    });
  }
  if (action === 'history-quick') {
    const at = id.indexOf('|');
    form.querySelector(`[name="${id.slice(0, at)}"]`).value = id.slice(at + 1);
  }
  if (action === 'history-driver-remove') {
    const list = historyDriverList();
    list.splice(Number(id), 1);
    form.querySelector('[name="drivers"]').value = list.join(', ');
    historyDriversPaint();
  }
  historySync();
  return true;
}
async function historyAction(action, id, target) {
  if (!action.startsWith('history-')) return false;
  if (await historyResearchAction(action, id)) return true;
  if (action === 'history-source') {
    await api('file', 'history.source', { url: target.dataset.url });
    return true;
  }
  if (!local()) throw Error('Switch to your local collection to edit its history.');
  if (['history-class', 'history-quick', 'history-driver-remove'].includes(action)) return historyEditorAction(action, id);
  if (action === 'history-edit') {
    editRealHistory(id);
    return true;
  }
  if (action === 'history-source-add') {
    const list = $('#history-source-editor');
    if (list.children.length >= 20) throw Error('Maximum 20 sources.');
    list.insertAdjacentHTML('beforeend', historySourceRow());
    list.lastElementChild.querySelector('input').focus();
    historySync();
    return true;
  }
  if (action === 'history-source-remove') {
    target.closest('.history-source-editor').remove();
    historySync();
    return true;
  }
  if (action === 'history-photo') {
    const ctx = researchContext(id),
      c = db.cars.find(c => c.id === id),
      h = { ...ctx.history, photos: structuredClone(c.realHistory?.photos || []) },
      revision = ctx.revision;
    h.photos ??= [];
    if (h.photos.length >= 8) throw Error('Maximum eight reference photographs.');
    const picked = await api('file', 'image');
    if (!picked) return true;
    checkResearchContext(ctx);
    simpleForm(
      'Reference photograph',
      field('name', 'Photograph title', picked.name) +
        field('caption', 'Caption / credit', '', 'textarea') +
        field('sourceUrl', 'Source URL (optional)', '', 'url'),
      async values => {
        checkResearchContext(ctx);
        const photos = [...h.photos, { id: crypto.randomUUID(), data: picked.data, ...values }];
        await change('car.save', { id, revision, data: { realHistory: { ...h, photos } } });
      }
    );
    return true;
  }
  if (action === 'history-photo-remove') {
    const c = car(),
      ctx = researchContext(c.id),
      h = structuredClone(c.realHistory),
      revision = c.revision,
      p = h.photos.find(p => p.id === id);
    modal(
      'Remove reference photograph',
      `<p>Remove ${esc(p.name)} from Real Car History?</p>`,
      async () => {
        checkResearchContext(ctx);
        await change('car.save', {
          id: c.id,
          revision,
          data: { realHistory: { ...h, photos: h.photos.filter(p => p.id !== id) } }
        });
      },
      'Remove photograph'
    );
    return true;
  }
  return false;
}
