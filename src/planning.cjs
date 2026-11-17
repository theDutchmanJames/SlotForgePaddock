const validPhoto = f => {
  const m = require('./lazy-assets.cjs').property(f, 'data')?.meta;
  return m
    ? m.photo && m.chars <= 12 * 1024 * 1024
    : typeof f.data === 'string' &&
        f.data.length <= 12 * 1024 * 1024 &&
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(f.data);
};
const { randomUUID } = require('node:crypto');
const { assemblyForPart } = require('./workshop.cjs');
const purchasing = require('./purchasing.cjs');
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const text = (x, max = 200) => typeof x === 'string' && x.length <= max;
const date = x =>
  x === '' ||
  (typeof x === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(x) &&
    Number.isFinite(Date.parse(x)) &&
    new Date(x).toISOString().slice(0, 10) === x);
const id = x =>
  typeof x === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x) && !Object.hasOwn(Object.prototype, x) && x !== 'prototype';
const empty = () => ({ shopping: [], jobs: [], shelves: [], focus: [] });
// Imported extra-photo IDs may be 'main'; keep that identity separate from the cover photo.
const photoData = (car, key) => {
  const object = key === 'main' ? car : car?.photos.find(p => p.id === (key === 'photo:main' ? 'main' : key)),
    field = key === 'main' ? 'picture' : 'data',
    lazy = require('./lazy-assets.cjs'),
    asset = lazy.property(object, field);
  return asset?.meta.hash || (object?.[field] ? lazy.digest(object[field]) : null);
};
const number = value => {
  check(typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''), 'Enter a numeric value.');
  return Number(value);
};
function purchasePart(db, partId) {
  const part = db.parts.find(p => p.id === partId);
  check(part, 'Choose a catalogue part.');
  check(
    !assemblyForPart(db, partId),
    'This stock belongs to an assembly. Choose its original catalogue record or add a separate stock record.'
  );
  return part;
}
function validate(db) {
  const p = db.planning;
  check(object(p), 'Invalid collection planning.');
  if (p.shoppingChecklistSources !== undefined) {
    check(
      Array.isArray(p.shoppingChecklistSources) && p.shoppingChecklistSources.length <= 20000,
      'Invalid checklist sources.'
    );
    const seen = new Set();
    for (const s of p.shoppingChecklistSources) {
      check(
        object(s) && ['build', 'job'].includes(s.kind) && id(s.id) && !seen.has(s.kind + ':' + s.id),
        'Invalid checklist source.'
      );
      seen.add(s.kind + ':' + s.id);
    }
  }
  for (const s of p.shopping || []) {
    check(s.buildId === undefined || id(s.buildId), 'Invalid shopping build link.');
    check(s.buildName === undefined || text(s.buildName), 'Invalid shopping build name.');
    check(s.buildCarId === undefined || id(s.buildCarId), 'Invalid completed build link.');
  }
  for (const [key, max] of [
    ['shopping', 10000],
    ['jobs', 10000],
    ['shelves', 100],
    ['focus', 50000]
  ])
    check(
      Array.isArray(p[key]) && p[key].length <= max,
      'Too many ' + (key === 'shelves' ? 'showroom groups' : key) + ' records.'
    );
  for (const key of ['shopping', 'shelves']) {
    const seen = new Set();
    for (const r of p[key]) {
      check(object(r) && id(r.id) && !seen.has(r.id), 'Invalid planning identity.');
      seen.add(r.id);
    }
  }
  for (const r of p.shopping) {
    check(
      ((r.purchase?.item.kind && r.purchase.item.kind !== 'part') || db.parts.some(x => x.id === r.partId)) &&
        (!r.jobId || db.jobs.some(j => j.id === r.jobId)),
      'Shopping item has a missing part or job.'
    );
    check(
      Number.isSafeInteger(r.quantity) &&
        (r.quantity > 0 || (r.quantity === 0 && require('./purchase-orders.cjs').history(r))) &&
        r.quantity <= 1000000 &&
        Number.isSafeInteger(r.received) &&
        r.received >= 0 &&
        r.received <= r.quantity,
      'Invalid shopping quantity.'
    );
    check(
      text(r.notes, 2000) && text(r.supplier) && date(r.date) && text(r.created, 100) && text(r.updated, 100),
      'Invalid shopping details.'
    );
  }
  purchasing.validate(db);
  const jobs = new Set();
  for (const r of p.jobs) {
    check(object(r) && db.jobs.some(j => j.id === r.jobId) && !jobs.has(r.jobId), 'Invalid job plan.');
    jobs.add(r.jobId);
    check(
      ['Low', 'Normal', 'High'].includes(r.priority) && date(r.targetDate) && typeof r.waiting === 'boolean',
      'Invalid job schedule.'
    );
    check(Array.isArray(r.checklist) && r.checklist.length <= 50, 'Maximum 50 checklist steps.');
    const steps = new Set();
    for (const s of r.checklist) {
      check(
        object(s) && id(s.id) && !steps.has(s.id) && text(s.text, 300) && s.text.trim() && typeof s.done === 'boolean',
        'Invalid checklist step.'
      );
      steps.add(s.id);
    }
    check(Array.isArray(r.photos) && r.photos.length <= 8, 'Maximum eight job photographs.');
    const photos = new Set();
    for (const f of r.photos) {
      check(
        object(f) &&
          id(f.id) &&
          !photos.has(f.id) &&
          ['Before', 'After'].includes(f.stage) &&
          text(f.name) &&
          validPhoto(f),
        'Invalid job photograph.'
      );
      photos.add(f.id);
    }
  }
  for (const s of p.shelves)
    check(
      text(s.name, 100) &&
        s.name.trim() &&
        Array.isArray(s.carIds) &&
        s.carIds.length <= 10000 &&
        new Set(s.carIds).size === s.carIds.length &&
        s.carIds.every(i => db.cars.some(c => c.id === i)),
      'Invalid showroom group.'
    );
  const focuses = new Set();
  for (const f of p.focus) {
    check(object(f), 'Invalid photograph focus.');
    const car = db.cars.find(c => c.id === f.carId),
      key = JSON.stringify([f.carId, f.photoKey]);
    check(
      object(f) &&
        car &&
        photoData(car, f.photoKey) &&
        !focuses.has(key) &&
        [f.x, f.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100),
      'Invalid photograph focus.'
    );
    focuses.add(key);
  }
}
function mutate(db, action, p) {
  check(p.revision === db.revision, 'The database changed. Reopen this action.');
  const state = db.planning,
    stamp = new Date().toISOString();
  if (action.startsWith('planning.checklist.')) return require('./shopping-checklist.cjs').mutate(db, action, p, stamp);
  if (action === 'planning.shopping.applyRequirements')
    return require('./shopping-requirements.cjs').apply(db, p, stamp);
  if (
    ['planning.order.place', 'planning.order.cancel', 'planning.delivery.receive', 'planning.receipt.correct'].includes(
      action
    )
  )
    return require('./purchase-orders.cjs').mutate(db, action, p, stamp);
  if (action === 'planning.shopping.reconcile') {
    require('./shopping-requirements.cjs').refresh(db, stamp);
    return true;
  }
  if (action === 'planning.shopping.migrate') {
    purchasing.upgrade(db);
    return 1;
  }
  if (action === 'planning.shopping.add') {
    const item = p.item || { kind: 'part', id: p.partId },
      quantity = number(p.quantity);
    purchasing.validateItem(item);
    check(!p.jobId || db.jobs.some(j => j.id === p.jobId && j.status === 'active'), 'Choose an active job.');
    if (item.kind === 'part') {
      const part = purchasePart(db, item.id),
        outstanding = state.shopping
          .filter(s => s.partId === part.id)
          .reduce((n, s) => n + require('./shopping-checklist.cjs').outstanding(s), 0);
      check(
        part.tracking !== 'individual' || part.quantity + outstanding + quantity <= 1,
        'An individually tracked part can only contain one item. Use a separate record for another identity.'
      );
    }
    if (item.kind === 'supply')
      check(
        db.supplies.some(s => s.id === item.id && !s.archived),
        'Choose an active workshop supply.'
      );
    const r = {
      id: randomUUID(),
      partId: item.kind === 'part' ? item.id : '',
      jobId: p.jobId || '',
      quantity,
      received: 0,
      notes: p.notes || '',
      supplier: p.supplier || '',
      date: p.date || '',
      url: p.url || '',
      created: stamp,
      updated: stamp
    };
    state.shopping.push(r);
    purchasing.upgrade(db);
    r.purchase.item = JSON.parse(JSON.stringify(item));
    if (p.unitPrice !== undefined) {
      const price = require('./purchase-orders.cjs').price(p.unitPrice, p.currency);
      if (price) r.purchase.price = price;
    }
    if (p.listId) r.purchase.listId = p.listId;
    return r.id;
  }
  if (action === 'planning.list.save') {
    purchasing.upgrade(db);
    const list = p.id ? state.shoppingLists.find(l => l.id === p.id) : null;
    check(!p.id || list?.source.kind === 'manual', 'Only custom lists can be renamed.');
    check(text(p.name) && p.name.trim(), 'Enter a list name.');
    if (list) {
      list.name = p.name.trim();
      return list.id;
    }
    const value = { id: randomUUID(), name: p.name.trim(), source: { kind: 'manual' } };
    state.shoppingLists.push(value);
    return value.id;
  }
  if (action === 'planning.shopping.edit') {
    purchasing.upgrade(db);
    const line = state.shopping.find(s => s.id === p.id);
    check(line, 'Shopping item not found.');
    if (p.checklistQuantity !== undefined)
      require('./shopping-checklist.cjs').mutate(
        db,
        'planning.checklist.edit',
        { id: line.id, quantity: p.checklistQuantity },
        stamp
      );
    if (p.listId !== undefined) line.purchase.listId = p.listId;
    if (p.unitPrice !== undefined) {
      const price = require('./purchase-orders.cjs').price(p.unitPrice, p.currency);
      if (price) line.purchase.price = price;
      else delete line.purchase.price;
    }
    for (const key of ['supplier', 'date', 'notes', 'url']) if (p[key] !== undefined) line[key] = p[key];
    if (p.quantity !== undefined) {
      check(
        !line.buildId && !line.purchase.requirement,
        'Required quantities are managed by the linked build or workshop plan.'
      );
      const quantity = number(p.quantity);
      check(quantity >= line.received + line.purchase.ordered, 'Keep quantities already received or ordered.');
      const part = db.parts.find(x => x.id === line.partId);
      if (part?.tracking === 'individual') {
        const other = state.shopping
          .filter(s => s.id !== line.id && s.partId === part.id)
          .reduce((n, s) => n + require('./shopping-checklist.cjs').outstanding(s), 0);
        check(
          part.quantity + other + quantity - line.received <= 1,
          'An individually tracked part can only contain one item.'
        );
      }
      line.quantity = quantity;
    }
    if (p.item !== undefined) {
      check(
        line.purchase.item.kind === 'free' && !line.received,
        'Only an unreceived free-text item can be changed or linked.'
      );
      purchasing.validateItem(p.item);
      if (p.item.kind === 'part') {
        const part = purchasePart(db, p.item.id),
          other = state.shopping
            .filter(s => s.partId === part.id)
            .reduce((n, s) => n + require('./shopping-checklist.cjs').outstanding(s), 0);
        check(
          part.tracking !== 'individual' ||
            part.quantity + other + require('./shopping-checklist.cjs').quantity(line) <= 1,
          'An individually tracked part can only contain one item.'
        );
        line.partId = part.id;
      }
      if (p.item.kind === 'supply')
        check(
          db.supplies.some(s => s.id === p.item.id && !s.archived),
          'Choose an active workshop supply.'
        );
      if (p.item.kind !== 'free') line.purchase.originalItem = line.purchase.item;
      line.purchase.item = JSON.parse(JSON.stringify(p.item));
    }
    line.updated = stamp;
    return line.id;
  }
  if (action === 'planning.receive') {
    const supplyLine = p.shoppingId
      ? state.shopping.find(s => s.id === p.shoppingId && s.purchase?.item.kind === 'supply')
      : null;
    if (supplyLine) {
      check(p.confirmed === true, 'Confirm that these supplies have been received.');
      const supply = db.supplies.find(s => s.id === supplyLine.purchase.item.id),
        amount = number(p.quantity);
      check(supply, 'Workshop supply not found.');
      check(!p.partId, 'Supply receipt cannot target a part.');
      purchasing.upgrade(db);
      purchasing.receipt(supplyLine, amount, stamp);
      const before = Object.fromEntries(['kind', 'quantity', 'remaining', 'minimum', 'unit'].map(k => [k, supply[k]]));
      supply.quantity += amount;
      supply.updated = stamp;
      supply.history.push({ date: stamp, before, after: { ...before, quantity: supply.quantity } });
      return supply.id;
    }
    check(p.confirmed === true, 'Confirm that these parts have been received.');
    const part = purchasePart(db, p.partId),
      amount = number(p.quantity);
    check(Number.isSafeInteger(amount) && amount > 0 && amount <= 1000000, 'Enter a positive whole quantity.');
    const line = p.shoppingId ? state.shopping.find(x => x.id === p.shoppingId && x.partId === part.id) : null;
    check(!p.shoppingId || line, 'Shopping item not found.');
    if (line) {
      check(amount <= line.quantity - line.received, 'Quantity exceeds the remaining shopping quantity.');
      purchasing.upgrade(db);
      purchasing.receipt(line, amount, stamp);
    }
    check(
      part.tracking !== 'individual' || part.quantity + amount <= 1,
      'An individually tracked part can only contain one item.'
    );
    part.quantity += amount;
    part.updated = stamp;
    require('./shopping-requirements.cjs').refresh(db, stamp, part.id);
    return part.id;
  }
  if (action === 'planning.shopping.remove') {
    const r = state.shopping.find(x => x.id === p.id);
    check(r, 'Shopping item not found.');
    check(!r.received, 'Keep received purchases as history.');
    check(!r.purchase?.ordered, 'Cancel the outstanding order before removing this purchase.');
    check(r.purchase?.requirement?.state !== 'active', 'Change the linked plan to remove its generated requirement.');
    check(!require('./purchase-orders.cjs').history(r), 'Keep order and receipt history.');
    state.shopping = state.shopping.filter(x => x.id !== p.id);
    return p.id;
  }
  if (action.startsWith('planning.job.')) {
    const job = db.jobs.find(j => j.id === p.jobId);
    check(job && job.status === 'active', 'Reopen an active workshop job.');
    let plan = state.jobs.find(j => j.jobId === job.id);
    if (!plan) {
      plan = { jobId: job.id, priority: 'Normal', targetDate: '', waiting: false, checklist: [], photos: [] };
      state.jobs.push(plan);
    }
    if (action === 'planning.job.save') {
      check(Array.isArray(p.checklist), 'Enter a checklist.');
      check(
        p.checklist.every(s => object(s) && (s.done === undefined || typeof s.done === 'boolean')),
        'Invalid checklist step.'
      );
      Object.assign(plan, {
        priority: p.priority,
        targetDate: p.targetDate,
        waiting: p.waiting,
        checklist: p.checklist.map(s => ({ id: s.id || randomUUID(), text: s.text, done: s.done === true }))
      });
    } else if (action === 'planning.job.check') {
      const step = plan.checklist.find(s => s.id === p.id);
      check(step && typeof p.done === 'boolean', 'Checklist step missing.');
      step.done = p.done;
    } else if (action === 'planning.job.photo') {
      plan.photos.push({ id: randomUUID(), stage: p.stage, name: p.name, data: p.data });
    } else if (action === 'planning.job.photo.remove') {
      check(
        plan.photos.some(f => f.id === p.id),
        'Photo not found.'
      );
      plan.photos = plan.photos.filter(f => f.id !== p.id);
    } else throw Error('Unknown job planning action.');
    job.updated = stamp;
    return job.id;
  }
  if (action === 'planning.shelf.save') {
    check(
      Array.isArray(p.carIds) &&
        p.carIds.every(id => !require('./car-membership.cjs').isWishlist(db.cars.find(c => c.id === id))),
      'Wishlist cars cannot be added to Showroom groups.'
    );
    check(!p.id || state.shelves.some(s => s.id === p.id), 'Group not found.');
    const s = { id: p.id || randomUUID(), name: p.name, carIds: p.carIds };
    const i = state.shelves.findIndex(x => x.id === s.id);
    if (i < 0) state.shelves.push(s);
    else state.shelves[i] = s;
    return s.id;
  }
  if (action === 'planning.shelf.remove') {
    check(
      state.shelves.some(s => s.id === p.id),
      'Group not found.'
    );
    state.shelves = state.shelves.filter(s => s.id !== p.id);
    return p.id;
  }
  if (action === 'planning.focus') {
    const car = db.cars.find(c => c.id === p.carId);
    check(car && photoData(car, p.photoKey), 'Photograph not found.');
    const focus = { carId: p.carId, photoKey: p.photoKey, x: number(p.x), y: number(p.y) };
    state.focus = state.focus.filter(f => f.carId !== p.carId || f.photoKey !== p.photoKey);
    state.focus.push(focus);
    return p.carId;
  }
  throw Error('Unknown planning operation.');
}
function pruneFocus(db, previous) {
  db.planning.focus = db.planning.focus.filter(f => {
    const c = db.cars.find(c => c.id === f.carId),
      old = previous?.cars.find(c => c.id === f.carId);
    if (!c) return false;
    const data = photoData(c, f.photoKey),
      oldData = photoData(old, f.photoKey);
    return !!data && (!oldData || oldData === data);
  });
}
module.exports = { empty, validate, mutate, pruneFocus, photoData };
