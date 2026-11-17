'use strict';
const { slots } = require('../renderer/build-model.js');
const { createHash } = require('node:crypto');
const normal = v =>
  String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const specs = p => p.catalogue?.product?.specifications || [];
const fingerprint = p =>
  createHash('sha256')
    .update(JSON.stringify([p.name, p.maker, p.reference, p.partType, specs(p)]))
    .digest('hex');
const sourceMap = (car, source) => {
  check(['factory', 'current'].includes(source), 'Choose Factory specifications or Current configuration.');
  return source === 'factory' ? car.factory || {} : car.technical || {};
};
function planInfo(value) {
  check(
    value &&
      ['factory', 'current'].includes(value.source) &&
      Number.isSafeInteger(value.carRevision) &&
      value.carRevision > 0,
    'Invalid setup plan source.'
  );
  return { source: value.source, carRevision: value.carRevision };
}
function sameMeasure(label, value, spec) {
  const units = {
    RPM: ['', 'rpm', 'r/min'],
    Voltage: ['', 'v', 'volt', 'volts'],
    Teeth: ['', 't', 'tooth', 'teeth'],
    Diameter: ['', 'mm']
  };
  if (
    !units[label].includes(
      String(spec.unit || '')
        .trim()
        .toLowerCase()
    )
  )
    return false;
  // No guessing units or interpreting ambiguous thousands separators.
  const number = v => (/^\d+(?:\.\d+)?$/.test(String(v).trim()) ? Number(v) : null);
  const a = number(value),
    b = number(spec.value);
  return a !== null && b !== null && a === b;
}
function target(slot, technical) {
  const value = technical[slot.field] || '';
  const numeric =
    slot.id === 'motor'
      ? [
          ['RPM', technical.ratedRpm],
          ['Voltage', technical.ratedVoltage]
        ]
      : slot.id === 'pinionPart'
        ? [['Teeth', technical.pinion]]
        : slot.id === 'gearPart'
          ? [['Teeth', technical.gear]]
          : slot.id === 'frontTyres'
            ? [['Diameter', technical.frontDiameter]]
            : slot.id === 'rearTyres'
              ? [['Diameter', technical.rearDiameter]]
              : [];
  return { value, numeric: numeric.filter(([, v]) => v) };
}
function rank(p, t) {
  const text = normal(t.value),
    name = normal(p.name),
    ref = normal(p.reference);
  let score = 0;
  const reasons = [];
  if (text && text === name) {
    score += 100;
    reasons.push('Exact saved part name');
  }
  if (ref && ref.length >= 2 && text && (' ' + text + ' ').includes(' ' + ref + ' ')) {
    score += 80;
    reasons.push('Product reference appears in specifications');
  }
  const words = text.split(' ').filter(w => w.length > 2),
    matches = words.filter(w => (' ' + name + ' ').includes(' ' + w + ' '));
  if (matches.length) {
    score += matches.length * 3;
    reasons.push('Name contains ' + matches.join(', '));
  }
  for (const [label, value] of t.numeric) {
    const aliases = {
      RPM: ['rpm', 'rated rpm', 'speed', 'no load speed', 'motor rpm'],
      Voltage: ['voltage', 'rated voltage'],
      Teeth: ['teeth', 'tooth count', 'number of teeth'],
      Diameter: ['diameter', 'outer diameter', 'tyre diameter']
    };
    const candidates = specs(p).filter(s => aliases[label].includes(normal(s.name)));
    if (candidates.some(s => sameMeasure(label, value, s))) {
      score += 15;
      reasons.push(label + ' matches ' + value);
    } else if (candidates.length) {
      score -= 30;
      reasons.push(label + ' differs: ' + candidates.map(s => [s.value, s.unit].filter(Boolean).join(' ')).join(' / '));
    }
  }
  return { score, reasons };
}
function model(car, parts, source) {
  check(car, 'Car not found.');
  check(!car.rebuild?.to, 'Save new setups on the rebuilt successor car.');
  const technical = { ...sourceMap(car, source) },
    maker = String(car.maker || '').toLowerCase();
  const rows = slots
    .map(slot => ({ slot, t: target(slot, technical), count: 0, candidates: [] }))
    .filter(r => r.t.value || r.t.numeric.length);
  for (const p of maker && rows.length ? parts : []) {
    if (!maker || String(p.maker || '').toLowerCase() !== maker) continue;
    for (const row of rows) {
      if (!row.slot.types.includes(p.partType)) continue;
      const match = rank(p, row.t);
      if (match.score <= 0) continue;
      row.count++;
      row.candidates.push({
        id: p.id,
        name: p.name,
        reference: p.reference || '',
        signature: fingerprint(p),
        reason: match.reasons.join('; '),
        score: match.score
      });
      row.candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      row.candidates.length = Math.min(row.candidates.length, 8);
    }
  }
  return {
    carId: car.id,
    carRevision: car.revision,
    source,
    maker: car.maker || '',
    technical,
    rows: rows.map(({ slot, t, count, candidates }) => ({
      slot: slot.id,
      label: slot.label,
      quantity: slot.quantity,
      specification: [t.value, ...t.numeric.map(([k, v]) => k + ': ' + v)].filter(Boolean).join(' · '),
      candidateCount: count,
      candidates: candidates.map(({ score, ...p }) => p)
    }))
  };
}
function* catalogueParts(r, maker) {
  // Stream only matching manufacturer fields. Keep one part and eight candidates
  // per position in memory; do not hydrate photographs, stock users or the model.
  const paths = ['name', 'maker', 'reference', 'partType']
    .map(k => JSON.stringify([k]))
    .concat(JSON.stringify(['catalogue', 'product', 'specifications']));
  const query = r.db.prepare(
    `SELECT r.identity,f.path,f.json FROM records r JOIN query_records q ON q.key=r.key JOIN record_fields f ON f.record=r.key WHERE r.bucket='["parts"]' AND q.maker=? AND f.path IN (SELECT value FROM json_each(?)) ORDER BY r.key`
  );
  let part = null;
  for (const row of query.iterate(maker, JSON.stringify(paths))) {
    const id = row.identity.slice(3);
    if (part && part.id !== id) {
      yield part;
      part = null;
    }
    if (!part) part = { id };
    const keys = JSON.parse(row.path);
    let owner = part;
    for (const key of keys.slice(0, -1)) owner = owner[key] ??= {};
    owner[keys.at(-1)] = JSON.parse(row.json);
  }
  if (part) yield part;
}
function plan(store, p) {
  const source = p.source || 'factory';
  if (!store.deferredState)
    return {
      ...model(
        store.data.cars.find(c => c.id === p.carId),
        store.data.parts,
        source
      ),
      databaseId: store.data.id
    };
  return store.deferredState.read(r => {
    const car = r.one('cars', p.carId);
    check(car, 'Car not found.');
    return { ...model(car, catalogueParts(r, (car.maker || '').toLowerCase()), source), databaseId: r.id };
  });
}
function save(db, car, p) {
  const proposal = p.suggestion,
    technical = sourceMap(car, proposal?.source);
  check(p.carRevision === car.revision, 'The car changed. Reopen the setup suggestions.');
  check(
    Object.values(technical).some(v => typeof v === 'string' && v.trim()),
    'No specifications are saved for this source.'
  );
  check(Array.isArray(proposal.rows) && proposal.rows.length <= slots.length, 'Invalid suggested setup parts.');
  const used = new Set(),
    installations = [];
  for (const row of proposal.rows) {
    const slot = slots.find(s => s.id === row?.slot);
    check(slot && !used.has(slot.id), 'Invalid or duplicate setup position.');
    used.add(slot.id);
    const part = db.parts.find(v => v.id === row.partId);
    check(
      part && slot.types.includes(part.partType),
      'The selected catalogue part is missing or has changed type. Reopen suggestions.'
    );
    check(fingerprint(part) === row.signature, 'A selected catalogue part changed. Reopen suggestions.');
    check(
      Number.isSafeInteger(row.quantity) && row.quantity > 0 && row.quantity <= 1000,
      'Enter a whole quantity from 1 to 1000.'
    );
    const field = require('./store.cjs').TECH_FIELDS.includes(slot.field) ? slot.field : '';
    installations.push({ partId: part.id, quantity: row.quantity, position: slot.label, field, name: part.name });
  }
  const snapshot = { ...technical };
  for (const i of installations) if (i.field) snapshot[i.field] = i.name;
  return { technical: snapshot, installations, plan: { source: proposal.source, carRevision: car.revision } };
}
module.exports = { plan, model, save, fingerprint, planInfo };
