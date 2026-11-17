'use strict';
// Additive purchasing v1. Legacy shopping identities and links remain authoritative.
// Upgrade inside a normal write transaction, never by rewriting a collection on read.
const { createHash, randomUUID } = require('node:crypto');
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 200) => typeof x === 'string' && x.length <= max;
const id = x => text(x, 100) && /^[a-zA-Z0-9_-]+$/.test(x) && !Object.hasOwn(Object.prototype, x) && x !== 'prototype';
const whole = x => Number.isSafeInteger(x) && x >= 0 && x <= 1000000;
const iso = x =>
  typeof x === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString() === x;
const listId = (kind, key) =>
  kind === 'general'
    ? 'general'
    : 'purchase-' +
      createHash('sha256')
        .update(JSON.stringify([kind, key]))
        .digest('hex');

// Free-text purchases do not acquire a stock identity until explicitly linked.
function validateItem(item) {
  check(object(item), 'Invalid purchase item.');
  check(['part', 'supply', 'free'].includes(item.kind), 'Invalid purchase item type.');
  if (item.kind === 'free') {
    check(
      text(item.name) && item.name.trim() && text(item.maker) && text(item.reference),
      'Invalid free-text purchase.'
    );
    check(!Object.hasOwn(item, 'id'), 'Free-text purchases have no inventory identity.');
  } else check(id(item.id), 'Invalid purchase stock identity.');
}
function counts(line) {
  const ordered = line.purchase?.ordered ?? 0;
  return { toBuy: line.quantity - line.received - ordered, ordered, received: line.received };
}
function source(index, line) {
  // A rebuild's workshop and build purchases belong together, not in duplicate lists.
  if (line.jobId) {
    const job = index.jobs.get(line.jobId),
      car = job && index.cars.get(job.carId);
    return {
      kind: 'job',
      id: line.jobId,
      name: [car?.name, job?.name].filter(Boolean).join(' · ').slice(0, 200) || 'Workshop purchases'
    };
  }
  if (line.buildId) return { kind: 'build', id: line.buildId, name: line.buildName || 'Untitled build' };
  return { kind: 'general', name: 'General shopping' };
}
function upgrade(db) {
  const state = db.planning;
  if (state.purchasingVersion !== undefined) check(state.purchasingVersion === 1, 'Unsupported purchasing version.');
  if (state.purchasingVersion === undefined) {
    check(
      state.shoppingLists === undefined && !state.shopping.some(s => Object.hasOwn(s, 'purchase')),
      'Incomplete purchasing metadata.'
    );
    state.purchasingVersion = 1;
    state.shoppingLists = [{ id: 'general', name: 'General shopping', source: { kind: 'general' } }];
  }
  check(Array.isArray(state.shoppingLists), 'Invalid shopping lists.');
  const lists = new Map(state.shoppingLists.map(l => [l.id, l]));
  let index;
  for (const line of state.shopping) {
    if (Object.hasOwn(line, 'purchase')) continue;
    index ??= { jobs: new Map(db.jobs.map(j => [j.id, j])), cars: new Map(db.cars.map(c => [c.id, c])) };
    const origin = source(index, line),
      key = listId(origin.kind, origin.id);
    if (!lists.has(key)) {
      const list = {
        id: key,
        name: origin.name,
        source: { kind: origin.kind, ...(origin.id ? { id: origin.id } : {}) }
      };
      state.shoppingLists.push(list);
      lists.set(key, list);
    }
    line.purchase = {
      version: 1,
      item: { kind: 'part', id: line.partId },
      listId: key,
      ordered: 0,
      legacyReceived: line.received,
      receipts: []
    };
  }
}
function validate(db) {
  const state = db.planning;
  if (state.purchasingVersion === undefined) {
    check(
      state.shoppingLists === undefined && !state.shopping.some(s => Object.hasOwn(s, 'purchase')),
      'Incomplete purchasing metadata.'
    );
    return;
  }
  check(state.purchasingVersion === 1, 'Unsupported purchasing version.');
  check(Array.isArray(state.shoppingLists) && state.shoppingLists.length <= 20000, 'Invalid shopping lists.');
  const lists = new Set(),
    sources = new Set();
  for (const list of state.shoppingLists) {
    check(
      object(list) && id(list.id) && !lists.has(list.id) && text(list.name) && list.name.trim(),
      'Invalid shopping list.'
    );
    lists.add(list.id);
    const s = list.source;
    check(object(s) && ['general', 'job', 'build', 'manual'].includes(s.kind), 'Invalid shopping list source.');
    if (['job', 'build'].includes(s.kind))
      check(id(s.id) && list.id === listId(s.kind, s.id), 'Invalid shopping list source identity.');
    else
      check(
        !Object.hasOwn(s, 'id') &&
          (s.kind === 'general' ? list.id === 'general' : list.id !== 'general' && !list.id.startsWith('purchase-')),
        'Invalid shopping list identity.'
      );
    if (s.kind !== 'manual') {
      const key = JSON.stringify([s.kind, s.id || '']);
      check(!sources.has(key), 'Duplicate shopping source list.');
      sources.add(key);
    }
  }
  check(
    state.shoppingLists.some(l => l.id === 'general' && l.source.kind === 'general'),
    'General shopping list missing.'
  );
  const receipts = new Set();
  for (const line of state.shopping) {
    // Old clients can append a legacy line. It is upgraded on the next purchasing write.
    if (!Object.hasOwn(line, 'purchase')) continue;
    const p = line.purchase;
    check(object(p) && p.version === 1, 'Invalid purchase metadata.');
    validateItem(p.item);
    require('./shopping-checklist.cjs').validate(line);
    check(p.item.kind === 'part' ? p.item.id === line.partId : !line.partId, 'Purchase stock identity does not match.');
    if (p.item.kind === 'supply')
      check(
        db.supplies.some(s => s.id === p.item.id),
        'Shopping item has a missing supply.'
      );
    if (p.item.kind === 'free') check(line.received === 0, 'Link a free-text purchase to stock before receiving it.');
    if (p.requirement !== undefined) {
      const r = p.requirement;
      check(
        object(r) &&
          ['build', 'job'].includes(r.kind) &&
          id(r.id) &&
          whole(r.needed) &&
          ['active', 'satisfied', 'removed', 'completed', 'cancelled'].includes(r.state) &&
          p.item.kind === 'part' &&
          (r.kind === 'build'
            ? line.buildId === r.id
            : !line.buildId && (line.jobId === r.id || (!line.jobId && r.state === 'cancelled'))),
        'Invalid generated purchase requirement.'
      );
    }
    if (p.originalItem !== undefined) {
      validateItem(p.originalItem);
      check(p.originalItem.kind === 'free', 'Invalid original purchase description.');
    }
    if (line.url !== undefined)
      check(
        text(line.url, 2000) &&
          (!line.url ||
            (/^https?:\/\//i.test(line.url) &&
              (() => {
                try {
                  const u = new URL(line.url);
                  return !!u.hostname && !u.username && !u.password;
                } catch {
                  return false;
                }
              })())),
        'Enter a valid HTTP or HTTPS purchase link.'
      );
    check(
      lists.has(p.listId) && whole(p.ordered) && whole(p.legacyReceived) && p.ordered <= line.quantity - line.received,
      'Invalid purchase quantities or list.'
    );
    check(Array.isArray(p.receipts) && p.receipts.length <= 10000, 'Too many purchase receipts.');
    let received = p.legacyReceived;
    for (const r of p.receipts) {
      check(
        object(r) &&
          id(r.id) &&
          !receipts.has(r.id) &&
          whole(r.quantity) &&
          r.quantity > 0 &&
          whole(r.fromOrdered) &&
          r.fromOrdered <= r.quantity &&
          iso(r.receivedAt),
        'Invalid purchase receipt.'
      );
      receipts.add(r.id);
      received += r.quantity;
    }
    received -= require('./purchase-orders.cjs').validate(line, receipts);
    check(received === line.received, 'Purchase receipt history does not match received stock.');
  }
}
function receipt(line, quantity, stamp) {
  const p = line.purchase;
  check(p && p.version === 1, 'Upgrade the purchase before receiving stock.');
  check(
    whole(quantity) && quantity > 0 && quantity <= line.quantity - line.received && iso(stamp),
    'Invalid purchase receipt quantity or date.'
  );
  check(p.receipts.length < 10000, 'Too many purchase receipts.');
  const fromOrdered = Math.min(quantity, p.ordered);
  p.receipts.push({
    id: randomUUID(),
    quantity,
    fromOrdered,
    receivedAt: stamp,
    supplier: line.supplier,
    ...(p.price ? { price: { ...p.price } } : {})
  });
  p.ordered -= fromOrdered;
  line.received += quantity;
  line.updated = stamp;
}
function requirement(line, needed, stamp) {
  check(whole(needed), 'Invalid purchase requirement.');
  // A plan edit may reduce an unplaced requirement, never an outstanding order.
  line.quantity = line.received + Math.max(needed, line.purchase?.ordered || 0);
  line.updated = stamp;
}
function cancelBuild(db, buildId, stamp) {
  upgrade(db);
  for (const line of db.planning.shopping.filter(s => s.buildId === buildId)) {
    require('./shopping-checklist.cjs').init(line);
    line.purchase.requirement = { kind: 'build', id: buildId, needed: 0, state: 'cancelled' };
  }
  db.planning.shopping = db.planning.shopping.filter(
    s => s.buildId !== buildId || s.purchase?.checklist || s.quantity > 0 || require('./purchase-orders.cjs').history(s)
  );
}
module.exports = { upgrade, validate, validateItem, counts, receipt, requirement, cancelBuild };
