'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fields = require('./spreadsheet-fields.cjs'),
  P = require('./catalogue-picture-requests.cjs');
function preview(p) {
  return P.withReader({ file: p.file }, (r, active) => {
    P.identity(active, p.expected);
    const available = fields.fields(p.customFields),
      sheet = p.workbook.sheets[p.config.sheet];
    if (!sheet) throw Error('Choose a worksheet');
    const rows = fields.mapRows(sheet, p.config, available),
      lookup = new Map(),
      within = new Map();
    const names = ['name', 'maker', 'reference', 'number', 'revision', 'archived', 'collectionStatus'];
    const records = r.db
      .prepare(
        `SELECT r.key,substr(r.identity,4) id,${names.map(k => `(SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=r.key AND f.path='["${k}"]') AS ${k}`).join(',')} FROM records r WHERE r.bucket='["cars"]'`
      )
      .all();
    const identity = c =>
      c.maker && c.reference
        ? 'ref:' + JSON.stringify([fields.normal(c.maker), fields.normal(c.reference)])
        : c.number
          ? 'number:' + fields.normal(c.number)
          : 'name:' + fields.normal(c.name);
    for (const car of records) {
      const key = identity(car),
        found = lookup.get(key) || [];
      found.push(car);
      lookup.set(key, found);
    }
    for (const row of rows) {
      const key = identity(row.data);
      within.set(key, (within.get(key) || 0) + 1);
      row.key = key;
    }
    for (const row of rows) {
      row.candidates = (lookup.get(row.key) || [])
        .slice(0, 20)
        .map(c => ({
          id: c.id,
          name: c.name,
          revision: c.revision,
          archived: !!c.archived,
          wishlist: c.collectionStatus === 'wishlist'
        }));
      row.duplicate = within.get(row.key) > 1;
      delete row.key;
      row.choice = row.errors.length || row.candidates.length || row.duplicate ? 'skip' : 'new';
      row.fields = available
        .filter(f => {
          const [a, b] = f.id.split('.');
          return b ? Object.hasOwn(row.data[a] || {}, b) : Object.hasOwn(row.data, a);
        })
        .map(f => f.id);
    }
    return { active, rows };
  });
}
function run(method, p) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { method, p },
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(
      () => finish(Error('Spreadsheet processing timed out. Export just the car table and try again.')),
      30000
    );
    worker.once('message', m => finish(m.error ? Object.assign(Error(m.error), { code: m.code }) : null, m.value));
    worker.once('error', e => finish(e));
    worker.once('exit', code => {
      if (!done) finish(Error('Spreadsheet processing stopped (' + code + '). Try a smaller file.'));
    });
  });
}
if (!isMainThread) {
  try {
    let value;
    if (workerData.method === 'parse')
      value = require('./spreadsheet-parser.cjs').parse(
        workerData.p.bytes,
        workerData.p.extension,
        workerData.p.options
      );
    else if (workerData.method === 'preview') value = preview(workerData.p);
    else throw Error('Unknown spreadsheet operation');
    parentPort.postMessage({ value });
  } catch (e) {
    parentPort.postMessage({ error: e.message, code: e.code });
  }
}
module.exports = { run, preview };
