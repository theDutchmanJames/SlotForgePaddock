'use strict';
const purchasing = require('./purchasing.cjs');
// Compact descriptors only: page filters never materialise catalogue photographs.
function project(db, filters = {}, reader = null) {
  const state = {
    purchasingVersion: db.planning.purchasingVersion,
    shopping: db.planning.shopping.map(s => ({ ...s })),
    shoppingLists: db.planning.shoppingLists?.map(l => ({ ...l }))
  };
  if (db.planning.shoppingLists === undefined) delete state.shoppingLists;
  purchasing.upgrade({
    get jobs() {
      return db.jobs;
    },
    get cars() {
      return db.cars;
    },
    planning: state
  });
  const stock = (bucket, ids) => (reader ? descriptors(reader, bucket, ids) : db[bucket]);
  const parts = new Map(stock('parts', state.shopping.map(l => l.partId).filter(Boolean)).map(p => [p.id, p])),
    supplies = new Map(
      stock(
        'supplies',
        state.shopping.filter(l => l.purchase?.item.kind === 'supply').map(l => l.purchase.item.id)
      ).map(p => [p.id, p])
    );
  const C = require('./shopping-checklist.cjs');
  const rows = state.shopping
    .filter(l => !C.deleted(l))
    .map(line => {
      const item = line.purchase.item,
        stock = item.kind === 'part' ? parts.get(item.id) : item.kind === 'supply' ? supplies.get(item.id) : item;
      return {
        line,
        name: stock?.name || 'Unavailable item',
        maker: stock?.maker || '',
        reference: stock?.reference || '',
        source: line.jobId ? 'job' : line.buildId ? 'build' : 'general',
        ...purchasing.counts(line)
      };
    });
  const unique = values =>
    [...new Map(values.filter(Boolean).map(v => [v.toLowerCase(), v])).values()].sort((a, b) => a.localeCompare(b));
  const makers = unique(rows.map(r => r.maker)),
    suppliers = unique(rows.map(r => r.line.supplier));
  const base = rows.filter(
    r =>
      (!filters.listId || r.line.purchase.listId === filters.listId) &&
      (!filters.maker || r.maker.toLowerCase() === filters.maker.toLowerCase()) &&
      (!filters.supplier || r.line.supplier.toLowerCase() === filters.supplier.toLowerCase()) &&
      (!filters.source || r.source === filters.source) &&
      [r.name, r.maker, r.reference, r.line.notes, r.line.supplier, r.line.buildName]
        .join(' ')
        .toLowerCase()
        .includes((filters.query || '').toLowerCase())
  );
  const matches = (r, status) =>
    status === 'all'
      ? true
      : status === 'done'
        ? C.done(r.line)
        : status === 'open'
          ? !C.done(r.line)
          : status === 'received'
            ? r.received === r.line.quantity
            : status === 'ordered'
              ? r.ordered > 0
              : status === 'toBuy'
                ? r.toBuy > 0
                : r.line.received < r.line.quantity;
  const counts = Object.fromEntries(
    ['outstanding', 'toBuy', 'ordered', 'received'].map(s => [s, base.filter(r => matches(r, s)).length])
  );
  let visible = base.filter(r => matches(r, filters.status || 'outstanding')).map(r => r.line);
  if (filters.groupBySupplier)
    visible.sort(
      (a, b) => a.supplier.toLowerCase().localeCompare(b.supplier.toLowerCase()) || a.id.localeCompare(b.id)
    );
  if (filters.status === 'all') {
    const order = new Map(state.shopping.map((l, i) => [l.id, i]));
    visible.sort(
      (a, b) =>
        Number(C.done(a)) - Number(C.done(b)) ||
        String(b.created).localeCompare(String(a.created)) ||
        order.get(b.id) - order.get(a.id)
    );
  }
  const listCounts = Object.fromEntries(
    ['', ...state.shoppingLists.map(l => l.id)].map(id => [
      id,
      rows.filter(r => (!id || r.line.purchase.listId === id) && !C.done(r.line)).length
    ])
  );
  return {
    totals: require('./purchase-orders.cjs').totals(visible),
    allLines: state.shopping,
    lines: visible,
    lists: state.shoppingLists,
    makers,
    suppliers,
    counts,
    listCounts
  };
}
// Read only searchable text and classification. Pictures and detailed product
// metadata are loaded only for the displayed matches, through Reader.one().
function descriptors(reader, bucket, ids = null) {
  if (ids && !ids.length) return [];
  const paths = ['name', 'maker', 'reference', 'category', 'partType', 'archived'].map(k => JSON.stringify([k]));
  return reader.db
    .prepare(
      `SELECT r.identity,json_group_object(json_extract(f.path,'$[0]'),json(f.json)) fields FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path IN (SELECT value FROM json_each(?)) ${ids ? 'AND r.key IN (SELECT value FROM json_each(?))' : ''} GROUP BY r.key`
    )
    .all(
      JSON.stringify([bucket]),
      JSON.stringify(paths),
      ...(ids ? [JSON.stringify([...new Set(ids)].map(id => JSON.stringify([bucket, 'id:' + id])))] : [])
    )
    .map(row => ({ id: row.identity.slice(3), ...JSON.parse(row.fields) }));
}
module.exports = { project, descriptors };
