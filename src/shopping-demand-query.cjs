'use strict';
const pages = require('./page-query.cjs'),
  requirements = require('./shopping-requirements.cjs');
// Cache only derived demand, never authoritative inventory or mutation checks.
// Relevant record digests + database recovery epoch also invalidate external
// Timing/Dealership writes and restores. Checklist-only edits reuse demand.
const cache = new Map();
function demand(r) {
  const hash = require('node:crypto').createHash('sha256');
  hash.update(JSON.stringify([r.id, r.epoch]));
  for (const row of r.db
    .prepare(
      `SELECT key,json_extract(json,'$.digest') digest FROM records WHERE bucket IN ('["buildDrafts"]','["jobs"]','["installations"]','["assemblies"]') ORDER BY key`
    )
    .iterate())
    hash.update(JSON.stringify(row));
  const signature = hash.digest('hex'),
    prior = cache.get(r.file);
  if (prior?.signature === signature) return prior.demands;
  const demands = new Map(),
    collect = (name, totals) => {
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
  for (const d of pages.descriptors(r, 'buildDrafts', [
    ['data', 'name'],
    ['data', 'parts']
  ]))
    collect(d.data.name || 'Untitled build', requirements.buildDemand(d));
  const jobIds = r.db
    .prepare(
      `SELECT q.key FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='["shoppingRequirements"]' AND f.json='true' WHERE q.bucket='["jobs"]' AND q.status='active'`
    )
    .all()
    .map(x => JSON.parse(x.key)[1].slice(3));
  const jobs = pages.descriptors(r, 'jobs', ['name'], jobIds).map(j => r.one('jobs', j.id));
  if (jobs.length) {
    const carIds = [...new Set(jobs.map(j => j.carId))];
    const installed = r.db
      .prepare(
        `SELECT key FROM query_records WHERE bucket='["installations"]' AND json_extract(aux,'$.removed')=0 AND car_id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(carIds))
      .map(x => r.record(x.key));
    const fitted = r.db
      .prepare(
        `SELECT key FROM query_records WHERE bucket='["assemblies"]' AND json_extract(aux,'$.dismantled')=0 AND car_id IN (SELECT value FROM json_each(?))`
      )
      .all(JSON.stringify(carIds))
      .map(x => r.record(x.key));
    const db = {
      jobs,
      cars: carIds.map(id => ({ id })),
      installations: installed,
      assemblies: fitted,
      parts: pages.descriptors(
        r,
        'parts',
        ['name'],
        installed.map(i => i.partId)
      )
    };
    for (const job of jobs) collect(job.name, requirements.jobDemand(db, job));
  }
  cache.delete(r.file);
  cache.set(r.file, { signature, demands });
  while (cache.size > 4) cache.delete(cache.keys().next().value);
  return demands;
}
function conflicts(r) {
  const demands = demand(r),
    ids = [...demands].filter(([, d]) => d.plans.length >= 2).map(([id]) => id);
  const parts = pages.descriptors(r, 'parts', ['name', 'quantity'], ids),
    stock = pages.availability(r, parts);
  return parts.flatMap(p => {
    const d = demands.get(p.id);
    return d.quantity > stock[p.id]
      ? [{ partId: p.id, name: p.name, required: d.quantity, available: stock[p.id], plans: [...d.plans] }]
      : [];
  });
}
function sources(r) {
  return [
    ...pages
      .descriptors(r, 'buildDrafts', [
        ['data', 'name'],
        ['data', 'rebuild', 'jobId']
      ])
      .map(d => ({
        kind: 'build',
        id: d.id,
        listKind: d.data.rebuild ? 'job' : 'build',
        listSourceId: d.data.rebuild?.jobId || d.id
      })),
    ...pages
      .descriptors(r, 'jobs', ['kind', 'status'])
      .filter(j => j.status === 'active' && j.kind !== 'general')
      .map(j => ({ kind: 'job', id: j.id, listKind: 'job', listSourceId: j.id }))
  ];
}
module.exports = { conflicts, sources };
