'use strict';
// Collection value for the Overview page: reads only the few money and date fields of each
// car straight from the database (no car records are loaded), then summarizes them with
// renderer/collection-value-model.js. Private values stay on this computer's screen.
const model = require('../renderer/collection-value-model.js');

const FIELDS = ['price', 'currency', 'costs', 'valuation', 'acquired', 'collectionStatus', 'merge'];

function summary(reader) {
  const rows = reader.db
    .prepare(
      `SELECT q.key key,q.archived archived,f.path path,json_extract(f.json,'$') value
    FROM query_records q LEFT JOIN record_fields f ON f.record=q.key AND f.path IN (${FIELDS.map(k => `'${JSON.stringify([k])}'`).join(',')})
    WHERE q.bucket='["cars"]'`
    )
    .all();
  const cars = new Map();
  for (const row of rows) {
    if (!cars.has(row.key)) cars.set(row.key, { archived: !!row.archived });
    if (row.path) cars.get(row.key)[JSON.parse(row.path)[0]] = row.value;
  }
  // Cars merged into another car are history, not part of the collection.
  const list = [...cars.values()]
    .filter(c => c.merge === undefined || c.merge === null)
    .map(c => ({ ...c, wishlist: c.collectionStatus === 'wishlist' }));
  return model.summarize(list);
}

/** The same for an in-memory collection (older JSON collections). */
function fromData(db) {
  return model.summarize(model.fromCars(db.cars));
}

module.exports = { summary, fromData };
