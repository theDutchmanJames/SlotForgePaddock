'use strict';
// Share ledger/reference checks between checklist edits and scoped receipts.
// Stock additions have a separate workspace with their linked dependencies.
const planning = require('./planning.cjs');
function supports(action, p = {}) {
  return (
    action === 'planning.list.save' ||
    (action === 'planning.shopping.edit' &&
      p.quantity === undefined &&
      p.checklistQuantity === undefined &&
      p.item === undefined) ||
    action === 'planning.receive' ||
    action === 'planning.shopping.add' ||
    [
      'planning.checklist.delete',
      'planning.checklist.restore',
      'planning.checklist.edit',
      'planning.checklist.done'
    ].includes(action)
  );
}
function context(store, action, p) {
  const source = store.data,
    state = store.deferredState,
    roots = new Map(JSON.parse(state.manifest).object);
  const before = {
    schema: source.schema,
    id: source.id,
    revision: source.revision,
    catalogueRevision: source.catalogueRevision,
    planning: { shopping: source.planning.shopping }
  };
  for (const key of ['purchasingVersion', 'shoppingLists'])
    if (source.planning[key] !== undefined) before.planning[key] = source.planning[key];
  const receiving = action === 'planning.receive' || (action === 'planning.checklist.done' && p.addStock);
  const receiptLine = before.planning.shopping.find(
    l => l.id === (action === 'planning.receive' ? p.shoppingId : p.id)
  );
  const receiptItem =
    receiptLine?.purchase?.item ||
    (receiptLine?.partId ? { kind: 'part', id: receiptLine.partId } : { kind: 'part', id: p.partId });
  const partIds = new Set(),
    supplyIds = new Set(),
    jobIds = new Set();
  for (const line of before.planning.shopping) {
    if (line.partId) partIds.add(line.partId);
    if (line.purchase?.item.kind === 'supply') supplyIds.add(line.purchase.item.id);
    if (line.jobId) jobIds.add(line.jobId);
  }
  if (action === 'planning.shopping.add') {
    const item = p.item || { kind: 'part', id: p.partId };
    require('./purchasing.cjs').validateItem(item);
    if (item.kind === 'part') partIds.add(item.id);
    if (item.kind === 'supply') supplyIds.add(item.id);
    if (p.jobId) jobIds.add(p.jobId);
  }
  if (receiving && receiptItem.id) {
    if (receiptItem.kind === 'part') partIds.add(receiptItem.id);
    if (receiptItem.kind === 'supply') supplyIds.add(receiptItem.id);
  }
  const dependencies = state.read(reader => {
    // Unchanged ledger references need an existence check only. Read stock
    // quantities/tracking for the edited item, and job names for legacy upgrades.
    const records = (section, ids, full = ids) => {
      const existing = new Set(roots.get(section).array.map(n => n.record));
      return [...ids]
        .filter(id => existing.has(JSON.stringify([section, 'id:' + id])))
        .map(id =>
          full.has(id) ? reader.record(JSON.stringify([section, 'id:' + id]), { assetHandle: true }) : { id }
        );
    };
    const item = p.item || { kind: 'part', id: p.partId },
      line = before.planning.shopping.find(l => l.id === p.id);
    const fullParts = new Set(
      action === 'planning.shopping.add' && item.kind === 'part'
        ? [item.id]
        : action === 'planning.checklist.edit' && p.quantity !== undefined
          ? [line?.partId]
          : []
    );
    const fullSupplies = new Set(action === 'planning.shopping.add' && item.kind === 'supply' ? [item.id] : []);
    if (receiving) {
      if (receiptItem.kind === 'part') fullParts.add(receiptItem.id);
      if (receiptItem.kind === 'supply') fullSupplies.add(receiptItem.id);
    }
    const fullJobs = new Set(
      before.planning.shopping.filter(l => !Object.hasOwn(l, 'purchase') && l.jobId).map(l => l.jobId)
    );
    if (action === 'planning.shopping.add' && p.jobId) fullJobs.add(p.jobId);
    const jobs = records('jobs', jobIds, fullJobs);
    return {
      parts: records('parts', partIds, fullParts),
      supplies: records('supplies', supplyIds, fullSupplies),
      jobs,
      cars: records('cars', new Set(jobs.map(j => j.carId).filter(Boolean)))
    };
  });
  // Assembly-backed stock is not a purchaseable catalogue part.
  dependencies.assemblies = action === 'planning.shopping.add' ? source.assemblies : [];
  return { before, dependencies, receiptItem };
}
function prepare(store, action, p) {
  if (action === 'planning.receive' || (action === 'planning.checklist.done' && p.addStock))
    return require('./shopping-stock-write.cjs').prepare(store, action, p);
  const { before, dependencies } = context(store, action, p);
  const updated = require('./record-draft.cjs').produce(before, draft =>
    planning.mutate({ ...dependencies, revision: draft.revision, planning: draft.planning }, action, p)
  );
  planning.validate({ ...dependencies, planning: { ...updated.data.planning, jobs: [], shelves: [], focus: [] } });
  const after = { ...updated.data, revision: before.revision + 1 };
  return require('./scoped-write.cjs').prepare(store, before, after, updated.result);
}
module.exports = { supports, prepare, context };
