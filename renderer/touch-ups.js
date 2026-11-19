'use strict';
// Small touch-ups after docs/ui-reference/touch-ups-2026-11. Each one keeps the window's original controls (some
// hidden) so its saving code and the scripted checks work as before; the new controls set those.

/* ---------- Cover options and Presentation (Showroom) ---------- */
function showroomOptionsTouch(form, presentation, all) {
  const body = form.querySelector('.dialog-body');
  form.querySelector('#dialog .dialog-body > p.muted, .dialog-body > p.muted')?.classList.add('tu-hint');
  const setSelect = (name, value) => {
    const el = form.elements[name];
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (!presentation) {
    const cover = showroomCoverCar();
    body.insertAdjacentHTML(
      'afterbegin',
      `<div class="tu-cover-now">${cover ? `<span class="tu-cover-pic">${photo(cover, true)}</span><div><div class="tu-eye">Cover now</div><b>${esc(cover.name)}</b><small>${esc([cover.maker, cover.scale].filter(Boolean).join(' · '))}</small></div>` : '<div><div class="tu-eye">Cover now</div><b>No cover car yet</b></div>'}</div>`
    );
    const mode = form.elements.mode.closest('label');
    mode.hidden = true;
    mode.insertAdjacentHTML(
      'beforebegin',
      `<div class="tu-wide"><div class="tu-grp">Change the cover</div><div class="tu-cards tu-c4" role="radiogroup" aria-label="Change cover">${[
        ['fixed', 'Always the same', 'One car you pick'],
        ['startup', 'Each app start', 'A new car when Paddock opens'],
        ['visit', 'Each visit', 'A new car each time you open the Showroom'],
        ['rotate', 'On a timer', 'Every few seconds or minutes']
      ]
        .map(
          ([value, title, text]) =>
            `<button type="button" class="tu-card" role="radio" data-tu-mode="${value}"><b>${title}</b><small>${text}</small></button>`
        )
        .join('')}</div></div>`
    );
    // Always the same car: pick it from photo cards.
    const fixed = form.querySelector('[data-showroom-fixed]'),
      carSelect = form.elements.carId;
    carSelect.closest('label').hidden = true;
    fixed.classList.add('tu-wide');
    fixed.insertAdjacentHTML(
      'beforeend',
      `<div class="tu-grp">Cover car</div><div class="tu-cover-grid">${all.map(c => carPickCard(c, { action: 'tu-cover-car' })).join('')}</div>`
    );
    form.querySelectorAll('[data-tu-mode]').forEach(b =>
      b.addEventListener('click', () => setSelect('mode', b.dataset.tuMode))
    );
  }
  // Show cars from: a switch instead of a drop-down.
  const source = form.elements.source,
    sourceLabel = source.closest('label');
  sourceLabel.hidden = true;
  sourceLabel.insertAdjacentHTML(
    'beforebegin',
    `<div class="field"><span>Show cars from</span><span class="tu-seg" role="group" aria-label="Show cars from">${[...source.options].map(o => `<button type="button" data-tu-source="${esc(o.value)}">${esc(o.textContent)}</button>`).join('')}</span></div>`
  );
  form.querySelectorAll('[data-tu-source]').forEach(b =>
    b.addEventListener('click', () => setSelect('source', b.dataset.tuSource))
  );
  const sync = () => {
    const m = form.elements.mode?.value,
      s = source.value,
      car = form.elements.carId?.value;
    form.querySelectorAll('[data-tu-mode]').forEach(b => {
      b.classList.toggle('on', b.dataset.tuMode === m);
      b.setAttribute('aria-checked', String(b.dataset.tuMode === m));
    });
    form.querySelectorAll('[data-tu-source]').forEach(b => b.classList.toggle('on', b.dataset.tuSource === s));
    form.querySelectorAll('[data-action="tu-cover-car"]').forEach(b => {
      b.classList.toggle('on', b.dataset.id === car);
      b.setAttribute('aria-pressed', String(b.dataset.id === car));
    });
  };
  form.addEventListener('change', sync);
  sync();
  $('#dialog').classList.add('tu-showroom');
}

/* ---------- Instructions for your AI ---------- */
function aiInstructionsDialog(prompt) {
  modal(
    'Instructions for your AI',
    `<div class="tu-win tu-ai"><div class="tu-cards tu-c3"><div class="tu-card static"><span class="tu-em">1</span><b>Copy these instructions</b><small>Paste them into your AI chat</small></div><div class="tu-card static"><span class="tu-em">2</span><b>Attach the JSON kit</b><small>Plus the manufacturer or retailer links. For corrections, also attach the existing catalogue.</small></div><div class="tu-card static"><span class="tu-em">3</span><b>Open the finished file</b><small>You review it in Paddock before anything changes</small></div></div><textarea class="catalogue-prompt tu-prompt" readonly aria-label="AI instructions">${esc(prompt)}</textarea></div>`,
    null
  );
  const foot = $('#dialog .dialog-footer');
  foot.querySelector('[data-action="close-modal"]').textContent = 'Close';
  foot.insertAdjacentHTML(
    'afterbegin',
    `<span class="cp-summary">${prompt.length.toLocaleString()} characters · English</span><span class="tu-copied" id="tu-copied" role="status"></span>`
  );
  foot.insertAdjacentHTML('beforeend', btn('Download kit', 'catalogue-kit') + btn('Copy instructions', 'tu-copy-ai', 'primary'));
}
async function aiInstructionsCopy() {
  const text = $('.tu-prompt')?.value || '',
    out = $('#tu-copied');
  try {
    await navigator.clipboard.writeText(text);
    if (out) out.textContent = '✓ Copied';
  } catch {
    const box = $('.tu-prompt');
    box.select();
    document.execCommand('copy');
    box.setSelectionRange(0, 0);
    getSelection()?.removeAllRanges();
    if (out) out.textContent = '✓ Copied';
  }
  setTimeout(() => {
    if ($('#tu-copied') === out && out) out.textContent = '';
  }, 2500);
}

/* ---------- Start a rebuild ---------- */
function startRebuildDialog(id) {
  const cars = db.cars.filter(c => slotforgeDomain.activeCar(c) && !c.rebuild?.to),
    revision = db.revision;
  if (!cars.length) throw Error('Add an active car before starting a rebuild.');
  const first = cars.some(c => c.id === id) ? id : '';
  modal(
    'Start a rebuild',
    `<div class="tu-win tu-rebuild"><p class="tu-hint">Keep the original car's history and plan a new, linked configuration.</p><select name="carId" required hidden><option value="">Choose a car</option>${cars.map(c => `<option value="${esc(c.id)}" ${c.id === first ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><div id="tu-rebuild-car"></div><div class="tu-rebuild-pick" id="tu-rebuild-pick" ${first ? 'hidden' : ''}><div class="tu-grp">Which car</div><div class="tu-cover-grid">${cars.map(c => carPickCard(c, { action: 'tu-rebuild-car', on: c.id === first })).join('')}</div></div><div class="tu-grp">What happens next</div><div class="tu-flow"><div><b>1 · A Workshop job</b>Checklist, shopping and progress for the rebuild</div><span aria-hidden="true">→</span><div><b>2 · A build draft</b>Choose parts to reuse and replace</div><span aria-hidden="true">→</span><div><b>3 · Complete</b>The new car is created; inventory changes only then</div></div><p class="tu-hint">Already rebuilding this car? This opens the same job. No car or inventory changes until completion.</p></div>`,
    async values => {
      if (!values.carId) throw Error('Choose the car to rebuild.');
      const draft = await change('rebuild.start', { carId: values.carId, revision });
      await openRebuildJob(draft);
    },
    'Start rebuild'
  );
  $('#dialog .dialog-footer').insertAdjacentHTML('afterbegin', '<span class="cp-summary" id="tu-rebuild-sum"></span>');
  rebuildSync();
}
function rebuildSync() {
  const form = $('#modal-form');
  if (!form?.querySelector('.tu-rebuild')) return;
  const id = form.elements.carId.value,
    c = db.cars.find(c => c.id === id);
  $('#tu-rebuild-car').innerHTML = c
    ? `<div class="tu-carbig"><span class="tu-carbig-pic">${photo(c, true)}</span><div><div class="tu-eye">Rebuilding</div><b>${esc(c.name)}</b><small>${esc([c.maker, c.scale].filter(Boolean).join(' · '))} · its history, setups and tests stay with this car</small>${$('#tu-rebuild-pick').hidden ? btn('Change car…', 'tu-rebuild-change', 'small ghost') : ''}</div></div>`
    : '';
  form.querySelectorAll('[data-action="tu-rebuild-car"]').forEach(b => {
    b.classList.toggle('on', b.dataset.id === id);
    b.setAttribute('aria-pressed', String(b.dataset.id === id));
  });
  const sum = $('#tu-rebuild-sum');
  if (sum) sum.textContent = c ? `${c.name} · nothing changes until you complete the rebuild` : 'Choose the car to rebuild';
}

/* ---------- Plan & checklist ---------- */
function planTouch() {
  const form = $('#modal-form');
  if (!form?.querySelector('#checklist-editor')) return;
  form.querySelector('.dialog-body').classList.add('tu-plan');
  const priority = form.elements.priority,
    pLabel = priority.closest('label');
  pLabel.hidden = true;
  pLabel.insertAdjacentHTML(
    'beforebegin',
    `<div class="field"><span>Priority</span><span class="tu-seg" role="group" aria-label="Priority">${['Low', 'Normal', 'High'].map(v => `<button type="button" data-tu-priority="${v}">${v}</button>`).join('')}</span></div>`
  );
  const target = form.elements.targetDate;
  target.insertAdjacentHTML(
    'afterend',
    `<span class="tu-chips">${[
      ['In 1 week', 7],
      ['In 2 weeks', 14],
      ['In a month', 30],
      ['None', 0]
    ]
      .map(([label, days]) => `<button type="button" data-tu-days="${days}">${label}</button>`)
      .join('')}</span>`
  );
  const waiting = form.elements.waiting.closest('label');
  waiting.classList.add('tu-switch');
  waiting.insertBefore(document.createElement('i'), waiting.firstChild.nextSibling);
  waiting.querySelector('i').setAttribute('aria-hidden', 'true');
  const editor = $('#checklist-editor');
  editor.insertAdjacentHTML('beforebegin', '<div class="tu-progress"><i id="tu-plan-bar"></i></div><p class="tu-hint" id="tu-plan-count"></p>');
  const addButton = form.querySelector('[data-action="checklist-add"]');
  if (addButton) addButton.hidden = true;
  editor.insertAdjacentHTML(
    'afterend',
    '<label class="tu-newstep"><span aria-hidden="true">+</span><input id="tu-new-step" placeholder="Add a step and press Enter" maxlength="300" autocomplete="off"></label>'
  );
  form.querySelectorAll('[data-tu-priority]').forEach(b =>
    b.addEventListener('click', () => {
      priority.value = b.dataset.tuPriority;
      planSync();
    })
  );
  form.querySelectorAll('[data-tu-days]').forEach(b =>
    b.addEventListener('click', () => {
      const days = Number(b.dataset.tuDays);
      target.value = days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : '';
      planSync();
    })
  );
  planSync();
}
function planSync() {
  const form = $('#modal-form');
  if (!form?.querySelector('.tu-plan')) return;
  form.querySelectorAll('[data-tu-priority]').forEach(b => b.classList.toggle('on', b.dataset.tuPriority === form.elements.priority.value));
  const rows = [...form.querySelectorAll('#checklist-editor .checklist-editor-row')],
    done = rows.filter(r => r.querySelector('[data-step-done]')?.checked).length;
  $('#tu-plan-bar').style.width = rows.length ? Math.round((done / rows.length) * 100) + '%' : '0';
  $('#tu-plan-count').textContent = rows.length ? `${done} of ${rows.length} steps done` : 'No steps yet.';
  rows.forEach(r => r.setAttribute('draggable', 'true'));
  rows.forEach(r => {
    const x = r.querySelector('[data-action="checklist-remove"]');
    if (x && x.textContent !== '×') {
      x.textContent = '×';
      x.className = 'btn small ghost tu-step-x';
      x.setAttribute('aria-label', 'Remove step');
    }
  });
}
document.addEventListener('change', e => {
  if (e.target.closest?.('.tu-plan')) planSync();
});
document.addEventListener('keydown', e => {
  if (e.target.id !== 'tu-new-step' || e.key !== 'Enter') return;
  e.preventDefault();
  const text = e.target.value.trim();
  if (!text) return;
  $('[data-action="checklist-add"]')?.click();
  setTimeout(() => {
    const rows = document.querySelectorAll('#checklist-editor .checklist-editor-row'),
      last = rows[rows.length - 1]?.querySelector('[data-step-text]');
    if (last && !last.value) last.value = text;
    e.target.value = '';
    e.target.focus();
    planSync();
  }, 0);
});
// Drag steps into order.
let planDrag = null;
document.addEventListener('dragstart', e => {
  const row = e.target.closest?.('.tu-plan .checklist-editor-row');
  if (!row) return;
  planDrag = row;
  row.classList.add('drag');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'step');
});
document.addEventListener('dragover', e => {
  const row = e.target.closest?.('.tu-plan .checklist-editor-row');
  if (!row || !planDrag || row === planDrag) return;
  e.preventDefault();
  const r = row.getBoundingClientRect();
  row.parentNode.insertBefore(planDrag, e.clientY < r.top + r.height / 2 ? row : row.nextSibling);
});
document.addEventListener('drop', e => {
  if (planDrag && e.target.closest?.('.tu-plan')) e.preventDefault();
});
document.addEventListener('dragend', () => {
  planDrag?.classList.remove('drag');
  planDrag = null;
  planSync();
});

function touchUpAction(action, id) {
  if (action === 'tu-cover-car') {
    const el = $('#modal-form')?.elements.carId;
    if (el) {
      el.value = id;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  if (action === 'tu-copy-ai') {
    aiInstructionsCopy();
    return true;
  }
  if (action === 'tu-rebuild-car') {
    const form = $('#modal-form');
    if (form?.querySelector('.tu-rebuild')) {
      form.elements.carId.value = id;
      rebuildSync();
    }
    return true;
  }
  if (action === 'tu-rebuild-change') {
    $('#tu-rebuild-pick').hidden = false;
    rebuildSync();
    return true;
  }
  return false;
}

// Steps added or removed with the buttons keep the progress current.
document.addEventListener('click', e => {
  if (e.target.closest?.('.tu-plan [data-action^="checklist-"]')) setTimeout(planSync, 0);
});
