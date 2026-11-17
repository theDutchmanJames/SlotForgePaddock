'use strict';
// Read-only dependency selection for car details, media and manual test writes.
// Run the existing domain commands/validators on this workspace, then merge its
// changed records through the normal revision-checked SQLite transaction.
const supports = a =>
  [
    'car.save',
    'planning.focus',
    'document.add',
    'document.remove',
    'guide.add',
    'guide.edit',
    'guide.remove',
    'test.add'
  ].includes(a);
function context(store, action, p) {
  const { Store, validateDatabase } = require('./store.cjs'),
    s = new Store(),
    data = s.data,
    source = store.data,
    recordKeys = new Map();
  for (const key of [
    'schema',
    'id',
    'revision',
    'catalogueRevision',
    'settings',
    'choices',
    'choiceAliases',
    'views',
    'customFields'
  ])
    data[key] = source[key];
  store.deferredState.read(r => {
    const maps = new Map(),
      add = (bucket, id) => {
        if (!id) return null;
        let map = maps.get(bucket);
        if (!map) maps.set(bucket, (map = new Map()));
        if (map.has(id)) return map.get(id);
        const value = r.record(JSON.stringify([bucket, 'id:' + id]), { assetHandle: true });
        if (!value) throw Error('Missing ' + bucket + ' record.');
        map.set(id, value);
        data[bucket].push(value);
        return value;
      };
    // Relationships come from authoritative scalar fields, not UI search text.
    // IDs/booleans/null fit the existing small-value lookup index; state its
    // partial predicate so SQLite need not probe every record in the bucket.
    const related = (bucket, field, value, status = null) =>
      r.db
        .prepare(
          `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path=? AND f.json=? AND length(f.json)<=512 ${status ? 'AND EXISTS(SELECT 1 FROM record_fields state WHERE state.record=r.key AND state.path=? AND state.json=?)' : ''}`
        )
        .all(
          JSON.stringify([bucket]),
          JSON.stringify([field]),
          JSON.stringify(value),
          ...(status ? [JSON.stringify(['status']), JSON.stringify(status)] : [])
        )
        .map(row => add(bucket, JSON.parse(row.key)[1].slice(3)));
    const installed = (field, value, fields = null) =>
      r.db
        .prepare(
          `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key JOIN record_fields removed ON removed.record=r.key AND removed.path='["removed"]' AND removed.json IN ('null','""') WHERE r.bucket='["installations"]' AND f.path=? AND f.json=? AND length(f.json)<=512 ${fields ? "AND EXISTS(SELECT 1 FROM record_fields slot WHERE slot.record=r.key AND slot.path='[\"field\"]' AND json_extract(slot.json,'$') IN(SELECT value FROM json_each(?)))" : ''}`
        )
        .all(JSON.stringify([field]), JSON.stringify(value), ...(fields ? [JSON.stringify(fields)] : []))
        .map(row => add('installations', JSON.parse(row.key)[1].slice(3)));
    let carId = action === 'car.save' ? p.id : p.carId;
    if (['document.remove', 'guide.edit', 'guide.remove'].includes(action)) {
      const d = add('documents', p.id);
      if (d) carId = d.carId;
    }
    if (carId) add('cars', carId);
    if (action === '@choice')
      for (const id of p.ids) {
        add('cars', id);
        installed('carId', id, [p.field]);
      }
    if (action === 'guide.edit' && p.carId) add('cars', p.carId);
    if (action === 'car.save' && p.id && p.data?.technical) installed('carId', p.id, Object.keys(p.data.technical));
    if (action === 'test.add') {
      if (p.setupId) add('setups', p.setupId);
      else {
        installed('carId', p.carId);
        related('jobs', 'carId', p.carId, 'active');
      }
    }
    // Snapshots may reference old parts or assemblies that have since moved.
    // Include those dependencies without loading unrelated stock or car history.
    for (const job of data.jobs) {
      if (job.setupId) add('setups', job.setupId);
      for (const snap of [job.baseline, job.target, job.actual, ...job.log.map(e => e.actual)].filter(Boolean))
        for (const i of snap.installations) add('parts', i.partId);
    }
    for (const setup of data.setups) {
      add('cars', setup.carId);
      for (const i of setup.installations) {
        add('parts', i.partId);
        if (i.assemblyId) add('assemblies', i.assemblyId);
      }
    }
    let i = 0,
      a = 0;
    while (i < data.installations.length || a < data.assemblies.length) {
      while (i < data.installations.length) {
        const row = data.installations[i++];
        add('cars', row.carId);
        add('parts', row.partId);
        if (row.assemblyId) add('assemblies', row.assemblyId);
      }
      while (a < data.assemblies.length) {
        const assembly = data.assemblies[a++];
        if (assembly.carId) add('cars', assembly.carId);
        for (const c of [...assembly.components, ...(assembly.history || []).flatMap(h => [...h.before, ...h.after])])
          add('parts', c.partId);
        if (!assembly.dismantled && assembly.carId) installed('assemblyId', assembly.id);
      }
    }
    if (
      action === 'planning.focus' ||
      (action === 'car.save' &&
        p.id &&
        (Object.hasOwn(p.data || {}, 'picture') || Object.hasOwn(p.data || {}, 'photos')))
    ) {
      const rows = r.db
        .prepare(
          `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["planning","focus"]' AND f.path='["carId"]' AND f.json=? AND length(f.json)<=512 ORDER BY CAST(substr(r.identity,7) AS INTEGER)`
        )
        .all(JSON.stringify(carId));
      data.planning.focus = rows.map((row, index) => {
        recordKeys.set(JSON.stringify(['planning', 'focus', 'index:' + index]), row.key);
        return r.record(row.key, { assetHandle: true });
      });
      // Positional records can have gaps after a previous sparse deletion.
      const next = r.db
        .prepare(
          `SELECT coalesce(max(CAST(substr(identity,7) AS INTEGER)),-1)+1 n FROM records WHERE bucket='["planning","focus"]'`
        )
        .get().n;
      recordKeys.set(
        JSON.stringify(['planning', 'focus', 'index:' + rows.length]),
        JSON.stringify(['planning', 'focus', 'index:' + next])
      );
    }
  });
  s.data = validateDatabase(data);
  return { store: s, recordKeys };
}
function documentLimits(store, before, after) {
  store.deferredState.read(r => {
    const count = (field, value) =>
      r.db
        .prepare(
          `SELECT count(*) n FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["documents"]' AND f.path=? AND f.json=? AND length(f.json)<=512`
        )
        .get(JSON.stringify([field]), JSON.stringify(value)).n;
    if (
      count('guide', true) +
        after.documents.filter(d => d.guide).length -
        before.documents.filter(d => d.guide).length >
      5000
    )
      throw Error('Maximum 5,000 guides per collection.');
    for (const id of new Set(after.documents.map(d => d.carId))) {
      const total =
        count('carId', id) +
        after.documents.filter(d => d.carId === id).length -
        before.documents.filter(d => d.carId === id).length;
      if (total > (id === null ? 5000 : 100))
        throw Error(id === null ? 'Maximum 5,000 general guides.' : 'Maximum 100 documents per car.');
    }
  });
}
function prepare(store, action, p) {
  const scoped = require('./scoped-write.cjs');
  p = scoped.compact(store, action, p);
  const { store: s, recordKeys } = context(store, action, p),
    before = s.data,
    result = s.mutate(action, p, { snapshot: false }).result;
  if (action.startsWith('guide.') || action.startsWith('document.')) documentLimits(store, before, s.data);
  return scoped.prepare(store, before, s.data, result, recordKeys.size ? recordKeys : null);
}
module.exports = { supports, context, prepare };
