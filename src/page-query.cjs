'use strict';
// Read-only UI projections. Scalar fields come from the same Reader transaction
// as counts and visible records; no attachment or complete collection hydration.

function relatedIds(r, bucket, carId, { active = false } = {}) {
  const rows = r.db
    .prepare(
      `WITH ordinals AS MATERIALIZED (SELECT json_extract(a.value,'$.record') key,CAST(a.key AS INTEGER) position
 FROM json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')=?),'$[1].array') a)
 SELECT r.identity FROM ordinals o CROSS JOIN records r ON r.key=o.key CROSS JOIN query_records q ON q.key=r.key WHERE r.bucket=? AND q.car_id=? ${active ? "AND json_extract(q.aux,'$.removed')=0" : ''} ORDER BY o.position`
    )
    .all(bucket, JSON.stringify([bucket]), carId);
  return rows.map(row => row.identity.slice(3));
}
function descriptors(r, bucket, fields, ids = null) {
  if (ids && !ids.length) return [];
  const paths = fields.map(f => (Array.isArray(f) ? f : [f]));
  const rows = r.db
    .prepare(
      `SELECT r.identity,f.path,f.json FROM records r JOIN record_fields f ON f.record=r.key
 WHERE r.bucket=? AND f.path IN (SELECT value FROM json_each(?))
 ${ids ? 'AND r.key IN (SELECT value FROM json_each(?))' : ''} ORDER BY r.key`
    )
    .all(
      JSON.stringify([bucket]),
      JSON.stringify(paths.map(JSON.stringify)),
      ...(ids ? [JSON.stringify([...new Set(ids)].map(id => JSON.stringify([bucket, 'id:' + id])))] : [])
    );
  const map = new Map();
  for (const row of rows) {
    const id = row.identity.slice(3);
    let item = map.get(id);
    if (!item) {
      item = { id };
      map.set(id, item);
    }
    const path = JSON.parse(row.path);
    let owner = item;
    for (const k of path.slice(0, -1)) owner = owner[k] ??= {};
    owner[path.at(-1)] = JSON.parse(row.json);
  }
  // Existing selectors and builds follow manifest order, including imported IDs.
  const order = r.db
    .prepare(
      `SELECT json_extract(a.value,'$.record') key FROM json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')=?),'$[1].array') a`
    )
    .all(bucket);
  return order.map(row => map.get(JSON.parse(row.key)[1].slice(3))).filter(Boolean);
}
const carFields = [
  'name',
  'number',
  'maker',
  'marque',
  'model',
  'reference',
  'scale',
  'archived',
  'collectionStatus',
  'usage',
  'tags',
  'updated',
  'favourite'
];
function cars(r) {
  const photos = new Set(
    r.db
      .prepare(
        `SELECT r.key FROM records r WHERE r.bucket='["cars"]' AND (EXISTS(SELECT 1 FROM json_each(r.json,'$.refs') ref WHERE json_extract(ref.value,'$.path')='["picture"]') OR EXISTS(SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path='["picture"]' AND f.json<>'""' AND f.json<>'null'))`
      )
      .all()
      .map(x => x.key)
  );
  return descriptors(r, 'cars', carFields).map(c => ({
    ...c,
    hasPhoto: photos.has(JSON.stringify(['cars', 'id:' + c.id]))
  }));
}
function availability(r, parts) {
  if (!parts.length) return {};
  const ids = JSON.stringify(parts.map(p => p.id)),
    used = new Map();
  for (const row of r.db
    .prepare(
      `SELECT json_extract(aux,'$.partId') id,sum(json_extract(aux,'$.quantity')) n FROM query_records WHERE bucket='["installations"]' AND json_extract(aux,'$.removed')=0 AND json_extract(aux,'$.partId') IN (SELECT value FROM json_each(?)) GROUP BY id`
    )
    .all(ids))
    used.set(row.id, row.n);
  for (const row of r.db
    .prepare(
      `SELECT json_extract(c.value,'$.partId') id,sum(json_extract(c.value,'$.quantity')) n FROM query_records q,json_each(q.aux,'$.components') c WHERE q.bucket='["assemblies"]' AND json_extract(c.value,'$.partId') IN (SELECT value FROM json_each(?)) GROUP BY id`
    )
    .all(ids))
    used.set(row.id, (used.get(row.id) || 0) + row.n);
  return Object.fromEntries(parts.map(p => [p.id, p.quantity - (used.get(p.id) || 0)]));
}
function assemblies(r, partIds = [], ids = [], carId = '') {
  // Fitted assembly components are not in the reservation index. Read their
  // component field explicitly so they still block loose-part assignment.
  const keys = r.db
    .prepare(
      `SELECT q.key FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='["components"]'
 WHERE q.bucket='["assemblies"]' AND json_extract(q.aux,'$.dismantled')=0 AND
 (q.key IN (SELECT value FROM json_each(?)) OR (?<>'' AND q.car_id=?) OR EXISTS(SELECT 1 FROM json_each(f.json) c WHERE json_extract(c.value,'$.partId') IN (SELECT value FROM json_each(?))))`
    )
    .all(
      JSON.stringify(ids.map(id => JSON.stringify(['assemblies', 'id:' + id]))),
      carId,
      carId,
      JSON.stringify(partIds)
    );
  return keys.map(k => r.record(k.key));
}
function finder(r, f) {
  const bucket = f.kind === 'supply' ? 'supplies' : 'parts',
    q = (f.query || '').trim().toLowerCase();
  const options = {
    archived: false,
    maker: f.maker || undefined,
    category: f.category || undefined,
    partType: f.partType || undefined,
    searchFields: ['name', 'maker', 'reference', 'partType'],
    searchTerms: q.split(/\s+/).filter(Boolean),
    excludeAssembled: bucket === 'parts',
    rankReference: q,
    sort: 'name',
    limit: 20
  };
  const result = r.list(bucket, options);
  const makers = r.db
    .prepare(
      `SELECT min(json_extract(f.json,'$')) name FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='["maker"]' WHERE q.bucket=? AND q.archived=0 AND q.maker<>'' ${bucket === 'parts' ? `AND substr(json_extract(q.key,'$[1]'),4) NOT IN(SELECT json_extract(part.value,'$.partId') FROM query_records a JOIN record_fields c ON c.record=a.key AND c.path='["components"]',json_each(c.json) part WHERE a.bucket='["assemblies"]' AND json_extract(a.aux,'$.dismantled')=0 AND json_extract(part.value,'$.partId') IS NOT NULL)` : ''} GROUP BY q.maker ORDER BY q.maker`
    )
    .all(JSON.stringify([bucket]));
  return { makers: makers.map(x => x.name), total: result.total, rows: result.rows };
}
function rebuild(r, carId) {
  const car = r.one('cars', carId),
    installed = r.db
      .prepare(
        `SELECT key FROM query_records WHERE bucket='["installations"]' AND car_id=? AND json_extract(aux,'$.removed')=0`
      )
      .all(carId)
      .map(x => r.record(x.key));
  const fitted = assemblies(r, [], [], carId),
    parts = descriptors(
      r,
      'parts',
      ['name'],
      installed.map(i => i.partId)
    );
  return require('./rebuild.cjs').context(
    { cars: car ? [car] : [], installations: installed, assemblies: fitted, parts },
    carId
  );
}
module.exports = { descriptors, relatedIds, cars, availability, assemblies, finder, rebuild };
