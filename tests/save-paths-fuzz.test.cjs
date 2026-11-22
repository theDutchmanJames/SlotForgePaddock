'use strict';
// Random sequences of everyday actions run through both save paths: the full in-memory one and the
// scoped one the app uses on a SQLite collection (it loads only what an action needs). Both must accept
// or refuse the same actions and end with the same collection. IDs and the clock are made repeatable
// so the two paths can be compared exactly. FUZZ_STEPS and FUZZ_SEED run longer or other sequences.
const crypto = require('node:crypto');
let uuidCounter = 0;
crypto.randomUUID = () => {
  const n = (uuidCounter++).toString(16).padStart(12, '0');
  return '00000000-0000-4000-8000-' + n;
};
let clock = Date.parse('2026-01-01T10:00:00.000Z');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) {
    a.length ? super(...a) : super(clock);
  }
  static now() {
    return clock;
  }
};
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../src/store.cjs'),
  T = require('../src/timing-integration.cjs'),
  { fixtures } = require('./support/timing-fixtures.cjs');

function random(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const FIELDS = ['motor', 'rearTyres', 'frontTyres', 'gears', 'guide', 'axle'];
function actions(db, rnd) {
  const pick = list => list[Math.floor(rnd() * list.length)],
    some = list => (list.length ? pick(list) : null),
    word = () => pick(['Alpha', 'Bravo', 'Delta', 'Echo', 'Lima', 'Zulu', '', ' ', 'Ünïcødé', 'x'.repeat(300)]),
    num = () => pick([0, 1, 2, 3, -1, 1.5, '2', 999]);
  const car = some(db.cars),
    part = some(db.parts),
    inst = some(db.installations),
    setup = some(db.setups),
    supply = some(db.supplies),
    assembly = some(db.assemblies),
    job = some(db.jobs);
  const list = [
    () => ['car.save', { data: { name: word(), manufacturer: word(), scale: pick(['1:32', '1:24', '']) } }],
    () => ['car.save', { data: { name: word(), technical: { motor: word() }, tags: [word()] } }],
    car && (() => ['car.save', { id: car.id, revision: car.revision, data: { name: word(), notes: word() } }]),
    car &&
      (() => ['car.save', { id: car.id, revision: car.revision, data: { technical: { [pick(FIELDS)]: word() } } }]),
    car && (() => ['car.save', { id: car.id, revision: car.revision - 1, data: { name: 'Stale' } }]),
    car && (() => ['car.favourite', { id: car.id, revision: car.revision }]),
    car && (() => ['car.archive', { id: car.id, revision: car.revision }]),
    car && (() => ['car.duplicate', { id: car.id }]),
    car && (() => ['car.delete', { id: car.id, revision: db.revision, confirmName: car.name, confirmed: true }]),
    car &&
      (() => [
        'work.add',
        { carId: car.id, title: word(), type: pick(['maintenance', 'repair', 'upgrade']), notes: word() }
      ]),
    car && (() => ['test.add', { carId: car.id, track: word(), laps: String(num()), best: String(num()) }]),
    car && (() => ['setup.save', { carId: car.id, name: word() }]),
    () => [
      'part.save',
      {
        data: {
          name: word(),
          quantity: num(),
          tracking: 'quantity',
          category: pick(['Tyres', 'Motors', 'Axles & bearings'])
        }
      }
    ],
    part && (() => ['part.save', { id: part.id, revision: part.revision, data: { quantity: num(), name: word() } }]),
    part &&
      (() => [
        'part.appearance',
        { id: part.id, revision: part.revision, data: { iconColour: pick(['red', 'blue', '']) } }
      ]),
    part && (() => ['part.delete', { id: part.id, revision: db.revision }]),
    car &&
      part &&
      (() => ['part.install', { carId: car.id, partId: part.id, quantity: pick([1, 2, 5]), field: pick(FIELDS) }]),
    inst && (() => ['part.remove', { id: inst.id, destination: pick(['spares', 'used', 'discard']) }]),
    part &&
      (() => [
        'assembly.create',
        {
          revision: db.revision,
          name: word(),
          components: [{ partId: part.id, quantity: 1, field: pick(FIELDS), position: 'Rear' }]
        }
      ]),
    assembly && car && (() => ['assembly.install', { id: assembly.id, carId: car.id, revision: db.revision }]),
    assembly && (() => ['assembly.dismantle', { id: assembly.id, revision: db.revision }]),
    setup && (() => ['setup.apply', { id: setup.id, revision: db.revision, selections: {}, confirmed: true }]),
    () => [
      'supply.save',
      {
        revision: db.revision,
        data: {
          name: word(),
          maker: 'NSR',
          reference: word(),
          category: 'Cleaning & lubrication',
          partType: 'Bearing oil',
          kind: 'Consumable',
          quantity: num()
        }
      }
    ],
    supply && (() => ['supply.archive', { id: supply.id, revision: supply.revision ?? 0 }]),
    supply && (() => ['supply.delete', { id: supply.id, revision: db.revision }]),
    car && (() => ['job.start', { revision: db.revision, kind: 'general', carId: car.id, name: word() }]),
    job && (() => ['job.complete', { id: job.id, revision: db.revision, confirmed: true }]),
    job && (() => ['job.cancel', { id: job.id, revision: db.revision, confirmed: true }]),
    car && (() => ['rebuild.start', { carId: car.id, revision: db.revision }]),
    () => ['settings.save', { name: word() }],
    () => ['custom.add', { label: word(), type: pick(['choice', 'text']) }]
  ].filter(Boolean);
  return pick(list)();
}
// The two paths may use generated IDs in a different order, so generated IDs are renamed by where they
// first appear. The same names are used to translate an ID chosen on one copy to the other copy.
const GENERATED = /00000000-0000-4000-8000-[0-9a-f]{12}/g;
function labels(data) {
  // Numbered without the parts that are set aside below, so they cannot shift the numbering.
  const text = JSON.stringify(data, (k, v) => (k === 'shoppingLists' ? undefined : v)),
    names = new Map();
  for (const id of text.match(GENERATED) || []) if (!names.has(id)) names.set(id, 'id#' + names.size);
  return names;
}
// A rebuild's shopping list ID is a fingerprint of its job ID, and the two copies use different generated
// IDs, so lists are compared by what they belong to. The stored name of a job's list may
// lag behind a car rename on one path; it is never shown, because the Shopping page names a job's list from
// the car and job as they are now (shopping-query.cjs). So the car-name part of those names is set aside.
function normalLists(data) {
  const p = data.planning;
  if (!p?.shoppingLists) return data;
  if (Array.isArray(p.shoppingChecklistSources) && !p.shoppingChecklistSources.length)
    delete p.shoppingChecklistSources; // none either way
  const ids = new Map();
  for (const l of p.shoppingLists)
    if (/^purchase-[0-9a-f]{64}$/.test(l.id) && l.source?.id) {
      ids.set(l.id, 'list:' + l.source.kind + ':' + l.source.id);
      l.id = ids.get(l.id);
    }
  for (const l of p.shoppingLists) if (l.source?.kind === 'job') l.name = l.name.replace(/^.*? · /, '… · ');
  for (const line of p.shopping)
    if (line.purchase && ids.has(line.purchase.listId)) line.purchase.listId = ids.get(line.purchase.listId);
  return data;
}
const comparable = (data, names = labels(data)) =>
  normalLists(JSON.parse(JSON.stringify(data).replace(GENERATED, id => names.get(id))));
function translate(payload, from, to) {
  const back = new Map([...to].map(([id, name]) => [name, id]));
  return JSON.parse(JSON.stringify(payload).replace(GENERATED, id => back.get(from.get(id)) || id));
}
function firstDifference(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference(a[k], b[k], at + '.' + k);
      if (d) return d;
    }
  }
  return at + ': ' + JSON.stringify(a)?.slice(0, 200) + ' ≠ ' + JSON.stringify(b)?.slice(0, 200);
}

async function run(t, seed, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-fuzz-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = fixtures(),
    file = path.join(dir, 'db.sqlite'),
    seedStore = new Store(file);
  seedStore.replace(f.store.snapshot());
  T.receive(seedStore, f.normal);
  let full = new Store();
  full.replace(new Store(file).snapshot());
  const findings = [];
  let scoped = new Store(file, { deferred: true });
  const rnd = random(seed),
    log = [];
  let accepted = 0,
    refused = 0;
  for (let step = 0; step < steps; step++) {
    const [action, payload] = actions(full.data, rnd);
    const start = step * 10000,
      time = Date.parse('2026-01-01T10:00:00.000Z') + step * 60000;
    // Translate before either path runs: an action may remove the record it names.
    const other = translate(payload, labels(full.data), labels(new Store(file).snapshot()));
    let a, b;
    uuidCounter = start;
    clock = time;
    try {
      full.mutate(action, JSON.parse(JSON.stringify(payload)), { snapshot: false });
      a = 'ok';
    } catch (e) {
      a = 'refused: ' + e.message;
    }
    uuidCounter = start;
    clock = time;
    try {
      await scoped.mutateAsync(action, other, { snapshot: false });
      b = 'ok';
    } catch (e) {
      b = 'refused: ' + e.message;
    }
    log.push(step + ' ' + action + ' ' + JSON.stringify(payload).slice(0, 160) + ' → ' + a);
    const context = () => '\nseed ' + seed + ', last steps:\n' + log.slice(-8).join('\n');
    if (a !== b) findings.push({ kind: 'decision', action, full: a, scoped: b, seed, step, steps: context() });
    a === 'ok' ? accepted++ : refused++;
    // Reopen now and then, as the app does between jobs, and compare what is on disk.
    if (a !== b || step % EVERY === EVERY - 1 || step === steps - 1) {
      await scoped.whenIdle?.();
      const onDisk = new Store(file).snapshot(),
        expected = full.snapshot();
      const d = firstDifference(comparable(expected), comparable(onDisk));
      if (d) {
        findings.push({ kind: 'collection', action, difference: d, seed, step, steps: context() });
        // Carry on from what was saved, so one difference does not hide the next.
        full = new Store();
        full.replace(onDisk);
      }
      scoped = new Store(file, { deferred: true });
    }
  }
  return { accepted, refused, findings };
}

const EVERY = Number(process.env.FUZZ_EVERY) || 10;
const STEPS = Number(process.env.FUZZ_STEPS) || 120;
const SEEDS = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : [1, 2, 3];
for (const seed of SEEDS)
  test('random everyday actions give the same collection through both save paths (seed ' + seed + ')', async t => {
    const r = await run(t, seed, STEPS);
    if (process.env.FUZZ_REPORT) {
      for (const x of r.findings) fs.appendFileSync(process.env.FUZZ_REPORT, JSON.stringify(x) + '\n');
      return;
    }
    assert.deepEqual(
      r.findings.map(x => x.kind + ' ' + x.action + ': ' + (x.difference || x.full + ' / ' + x.scoped) + x.steps),
      []
    );
    assert.ok(r.accepted > STEPS / 5, 'Too few actions were accepted to be a useful check: ' + JSON.stringify(r));
  });
