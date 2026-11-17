'use strict';
const { randomUUID } = require('node:crypto');
const purchasing = require('./purchasing.cjs');
const add = (map, id, quantity) => map.set(id, (map.get(id) || 0) + quantity);
function buildDemand(draft) {
  const totals = new Map();
  for (const row of draft.data.parts) add(totals, row.partId, row.quantity);
  return totals;
}
function jobDemand(db, job) {
  const totals = new Map();
  if (job.status === 'active' && job.kind !== 'general')
    for (const row of require('./jobs.cjs').model(db, job.id, [], { choices: false, requirementsOnly: true }).rows)
      if (!row.done && row.kind === 'part') add(totals, row.partId, row.quantity);
  return totals;
}
function inventory(db, items = db.parts) {
  const parts = new Map(items.map(p => [p.id, p])),
    available = new Map(items.map(p => [p.id, p.quantity])),
    assembled = new Set();
  for (const i of db.installations) if (!i.removed) add(available, i.partId, -i.quantity);
  for (const a of db.assemblies)
    if (!a.dismantled)
      for (const c of a.components) {
        assembled.add(c.partId);
        if (!a.carId) add(available, c.partId, -c.quantity);
      }
  return { parts, available, assembled };
}
function calculate(db, origin, totals, stamp, state = 'active', stock = inventory(db)) {
  purchasing.upgrade(db);
  const matches = line =>
    origin.kind === 'build'
      ? line.buildId === origin.id
      : !line.buildId && line.purchase?.requirement?.kind === 'job' && line.purchase.requirement.id === origin.id;
  const existing = db.planning.shopping.filter(matches),
    parts = stock.parts;
  // Retain every receipt and order even if older data contains duplicate requirements.
  for (const partId of new Set([...totals.keys(), ...existing.map(l => l.partId)])) {
    const part = parts.get(partId),
      demand = totals.get(partId) || 0;
    let needed = state === 'active' && part ? Math.max(0, demand - stock.available.get(partId)) : 0;
    // An individual identity cannot be purchased twice. Transfers/substitutes require a user's choice.
    if (part?.tracking === 'individual')
      needed = Math.min(
        needed,
        Math.max(
          0,
          1 -
            part.quantity -
            db.planning.shopping
              .filter(l => l.partId === partId && !matches(l))
              .reduce((n, l) => n + require('./shopping-checklist.cjs').outstanding(l), 0)
        )
      );
    if (stock.assembled.has(partId)) needed = 0;
    const lines = existing.filter(l => l.partId === partId);
    let line = lines[0];
    if (!line && needed) {
      line = {
        id: randomUUID(),
        partId,
        jobId: origin.jobId || '',
        ...(origin.kind === 'build' ? { buildId: origin.id, buildName: origin.name } : {}),
        quantity: needed,
        received: 0,
        notes: '',
        supplier: '',
        date: '',
        created: stamp,
        updated: stamp
      };
      db.planning.shopping.push(line);
      purchasing.upgrade(db);
      lines.push(line);
    }
    if (!line) continue;
    const ordered = lines.reduce((n, l) => n + l.purchase.ordered, 0);
    for (const [index, l] of lines.entries()) {
      // Outstanding orders cover a requirement once, including orders on older duplicate lines.
      const target = l.purchase.ordered + (index === 0 ? Math.max(0, needed - ordered) : 0);
      const metadata = {
        kind: origin.kind,
        id: origin.id,
        needed: index === 0 ? needed : 0,
        state: state === 'active' && !demand ? (origin.kind === 'job' ? 'satisfied' : 'removed') : state
      };
      if (l.quantity !== l.received + target || JSON.stringify(l.purchase.requirement) !== JSON.stringify(metadata)) {
        purchasing.requirement(l, target, stamp);
        l.purchase.requirement = metadata;
      }
      if (origin.kind === 'build') l.buildName = origin.name;
    }
  }
  db.planning.shopping = db.planning.shopping.filter(
    l => !matches(l) || l.quantity > 0 || require('./purchase-orders.cjs').history(l)
  );
  // Only generated list names follow their project; manually chosen lists stay intact.
  for (const list of db.planning.shoppingLists) {
    if (origin.kind === 'build' && !origin.jobId && list.source.kind === 'build' && list.source.id === origin.id)
      list.name = origin.name;
    if (origin.jobId && list.source.kind === 'job' && list.source.id === origin.jobId) {
      const j = db.jobs.find(j => j.id === origin.jobId),
        c = j && db.cars.find(c => c.id === j.carId);
      if (j) list.name = [c?.name, j.name].filter(Boolean).join(' · ').slice(0, 200);
    }
  }
}
const key = o => o.kind + ':' + o.id;
const matches = (o, l) =>
  o.kind === 'build'
    ? l.buildId === o.id
    : !l.buildId && l.purchase?.requirement?.kind === 'job' && l.purchase.requirement.id === o.id;
function sync(db, origin, totals, stamp, state = 'active', stock = inventory(db)) {
  purchasing.upgrade(db);
  const listKind = origin.jobId ? 'job' : origin.kind,
    listKey = origin.jobId || origin.id;
  if (!db.planning.shoppingLists.some(l => l.source.kind === listKind && l.source.id === listKey))
    db.planning.shoppingLists.push({
      id:
        'purchase-' +
        require('node:crypto')
          .createHash('sha256')
          .update(JSON.stringify([listKind, listKey]))
          .digest('hex'),
      name: origin.name,
      source: { kind: listKind, id: listKey }
    });
  const sources = (db.planning.shoppingChecklistSources ??= []);
  const existing = db.planning.shopping.filter(l => matches(origin, l));
  if (!sources.some(o => key(o) === key(origin))) {
    // First generation can populate a new list. Existing lists are adopted as-is.
    if (!existing.length) calculate(db, origin, totals, stamp, state, stock);
    sources.push({ kind: origin.kind, id: origin.id });
  }
  const C = require('./shopping-checklist.cjs');
  for (const l of db.planning.shopping.filter(l => matches(origin, l))) {
    C.init(l);
    if (origin.kind === 'build') l.buildName = origin.name;
    if (state !== 'active' && l.purchase.requirement) l.purchase.requirement.state = state;
  }
  for (const list of db.planning.shoppingLists) {
    if (origin.kind === 'build' && !origin.jobId && list.source.kind === 'build' && list.source.id === origin.id)
      list.name = origin.name;
    if (origin.jobId && list.source.kind === 'job' && list.source.id === origin.jobId) {
      const j = db.jobs.find(j => j.id === origin.jobId),
        c = j && db.cars.find(c => c.id === j.carId);
      if (j) list.name = [c?.name, j.name].filter(Boolean).join(' · ').slice(0, 200);
    }
  }
}
function sourceContext(db, kind, id) {
  if (kind === 'build') {
    const d = db.buildDrafts.find(d => d.id === id);
    if (!d) throw Error('This build is no longer active.');
    return {
      origin: { kind, id, jobId: d.data.rebuild?.jobId || '', name: d.data.name || 'Untitled build' },
      totals: buildDemand(d)
    };
  }
  const j = kind === 'job' && db.jobs.find(j => j.id === id && j.status === 'active');
  if (!j || j.kind === 'general') throw Error('Choose an active setup job.');
  return { origin: { kind, id, jobId: id, name: j.name }, totals: jobDemand(db, j) };
}
function preview(db, kind, id) {
  const { origin, totals } = sourceContext(db, kind, id),
    stock = inventory(db),
    C = require('./shopping-checklist.cjs');
  const existing = db.planning.shopping.filter(l => matches(origin, l)),
    rows = [];
  for (const partId of new Set([...totals.keys(), ...existing.map(l => l.partId)])) {
    const part = stock.parts.get(partId);
    if (!part) continue;
    const lines = existing.filter(l => l.partId === partId),
      line = lines[0];
    // Deleted and completed requirements are explicit user decisions, not deficits.
    if (lines.some(l => C.deleted(l) || C.done(l))) continue;
    let needed = Math.max(0, (totals.get(partId) || 0) - (stock.available.get(partId) || 0));
    if (stock.assembled.has(partId)) needed = 0;
    if (part.tracking === 'individual')
      needed = Math.min(
        needed,
        Math.max(
          0,
          1 -
            part.quantity -
            db.planning.shopping
              .filter(l => l.partId === partId && !matches(origin, l))
              .reduce((n, l) => n + C.outstanding(l), 0)
        )
      );
    const proposed = (line?.received || 0) + needed,
      current = line ? C.quantity(line) : 0;
    if (proposed === current || (!line && !needed)) continue;
    rows.push({
      partId,
      name: part.name,
      id: line?.id || '',
      current,
      proposed,
      needed,
      manual: line?.purchase?.checklist?.manualQuantity === true,
      duplicate: lines.length > 1
    });
  }
  return { kind, id, name: origin.name, rows };
}
function apply(db, p, stamp) {
  if (!Array.isArray(p.partIds) || p.partIds.length > 1000 || new Set(p.partIds).size !== p.partIds.length)
    throw Error('Choose up to 1,000 requirement changes.');
  const offered = preview(db, p.kind, p.sourceId),
    selected = offered.rows.filter(r => p.partIds.includes(r.partId));
  if (selected.length !== p.partIds.length) throw Error('Requirements changed. Reopen the comparison.');
  const { origin } = sourceContext(db, p.kind, p.sourceId),
    C = require('./shopping-checklist.cjs');
  if (p.kind === 'job') db.jobs.find(j => j.id === p.sourceId).shoppingRequirements = true;
  purchasing.upgrade(db);
  for (const row of selected) {
    if (row.duplicate) throw Error('This plan has duplicate requirements. Manage those checklist rows individually.');
    let line = db.planning.shopping.find(l => l.id === row.id);
    if (!line) {
      line = {
        id: randomUUID(),
        partId: row.partId,
        jobId: origin.jobId || '',
        ...(origin.kind === 'build' ? { buildId: origin.id, buildName: origin.name } : {}),
        quantity: row.proposed,
        received: 0,
        notes: '',
        supplier: '',
        date: '',
        created: stamp,
        updated: stamp
      };
      db.planning.shopping.push(line);
      purchasing.upgrade(db);
    }
    const c = C.init(line);
    if (row.needed === 0) c.done = true;
    else c.quantity = row.proposed;
    c.manualQuantity = false;
    line.purchase.requirement = {
      kind: p.kind,
      id: p.sourceId,
      needed: row.needed,
      state: row.needed ? 'active' : 'satisfied'
    };
    line.updated = stamp;
  }
  const sources = (db.planning.shoppingChecklistSources ??= []);
  if (!sources.some(o => key(o) === key(origin))) sources.push({ kind: origin.kind, id: origin.id });
  return selected.length;
}
function build(db, draft, stamp, state = 'active', stock) {
  sync(
    db,
    { kind: 'build', id: draft.id, jobId: draft.data.rebuild?.jobId || '', name: draft.data.name || 'Untitled build' },
    state === 'active' ? buildDemand(draft) : new Map(),
    stamp,
    state,
    stock
  );
}
function job(db, j, stamp, stock) {
  if (db.planning.shoppingLists)
    for (const list of db.planning.shoppingLists)
      if (list.source.kind === 'job' && list.source.id === j.id)
        list.name = [db.cars.find(c => c.id === j.carId)?.name, j.name].filter(Boolean).join(' · ').slice(0, 200);
  if (j.shoppingRequirements)
    sync(
      db,
      { kind: 'job', id: j.id, jobId: j.id, name: j.name },
      jobDemand(db, j),
      stamp,
      j.status === 'active' ? 'active' : j.status,
      stock
    );
}
function refresh(db, stamp, partId = null) {
  // Stock receipts affect one dependency neighbourhood. Other stock operations
  // retain their broader refresh; explicit requirement approvals are unchanged.
  const linked = db.planning.shopping.filter(l => l.partId === partId);
  const builds = db.buildDrafts.filter(
    d => !partId || d.data.parts.some(p => p.partId === partId) || linked.some(l => l.buildId === d.id)
  );
  const jobs = db.jobs.filter(
    j =>
      j.shoppingRequirements &&
      j.status === 'active' &&
      (!partId ||
        j.target?.installations.some(i => i.partId === partId) ||
        linked.some(
          l => l.jobId === j.id || (l.purchase?.requirement?.kind === 'job' && l.purchase.requirement.id === j.id)
        ))
  );
  if (!builds.length && !jobs.length) return;
  const stock = inventory(db);
  for (const draft of builds) build(db, draft, stamp, 'active', stock);
  for (const j of jobs) job(db, j, stamp, stock);
}
function conflicts(db, partForId = null) {
  const demands = new Map();
  const collect = (name, totals) => {
    for (const [id, quantity] of totals) {
      let d = demands.get(id);
      if (!d) {
        d = { quantity: 0, plans: [] };
        demands.set(id, d);
      }
      d.quantity += quantity;
      d.plans.push(name);
    }
  };
  for (const draft of db.buildDrafts) collect(draft.data.name || 'Untitled build', buildDemand(draft));
  for (const j of db.jobs) if (j.shoppingRequirements && j.status === 'active') collect(j.name, jobDemand(db, j));
  const shared = [...demands].filter(([, d]) => d.plans.length >= 2);
  if (!shared.length) return [];
  const items = partForId ? shared.map(([id]) => partForId(id)).filter(Boolean) : db.parts;
  const result = [],
    stock = inventory(db, items);
  for (const part of items) {
    const d = demands.get(part.id);
    if (!d || d.plans.length < 2) continue;
    const available = stock.available.get(part.id);
    if (d.quantity > available)
      result.push({ partId: part.id, name: part.name, required: d.quantity, available, plans: d.plans });
  }
  return result;
}
const affects = action =>
  [
    'part.save',
    'part.install',
    'part.remove',
    'assembly.create',
    'assembly.replace',
    'assembly.install',
    'assembly.remove',
    'assembly.dismantle',
    'setup.apply',
    'build.draft.save',
    'build.draft.delete',
    'build.create',
    'job.fit',
    'job.remove',
    'job.complete',
    'job.cancel',
    'job.edit',
    'car.delete'
  ].includes(action);
module.exports = { build, job, refresh, conflicts, buildDemand, jobDemand, affects, preview, apply };
