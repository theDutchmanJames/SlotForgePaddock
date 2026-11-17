'use strict';
// Receipts only increase one stock record. Read its dependency neighbourhood;
// never hydrate the collection or validate unrelated cars and race histories.
const planning = require('./planning.cjs');
const merge = (left, right) => [...new Map([...left, ...right].map(r => [r.id, r])).values()];
function dependencies(store, before, base, item) {
  return store.deferredState.read(reader => {
    const read = rows => rows.map(r => reader.record(r.key, { assetHandle: true }));
    const keys = (bucket, ids) =>
      read(
        reader.db
          .prepare('SELECT key FROM records WHERE bucket=? AND identity IN (SELECT value FROM json_each(?))')
          .all(JSON.stringify([bucket]), JSON.stringify([...ids].filter(Boolean).map(id => 'id:' + id)))
      );
    const arrays = (bucket, path, ids) =>
      read(
        reader.db
          .prepare(
            `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path=? AND EXISTS (SELECT 1 FROM json_each(f.json) a WHERE json_extract(a.value,'$.partId') IN (SELECT value FROM json_each(?)))`
          )
          .all(JSON.stringify([bucket]), JSON.stringify(path), JSON.stringify([...ids]))
      );
    const builds = [],
      jobs = [],
      parts = new Set(item.kind === 'part' ? [item.id] : []);
    if (item.kind === 'part') {
      const linked = before.planning.shopping.filter(l => l.partId === item.id);
      builds.push(
        ...merge(
          arrays('buildDrafts', ['data', 'parts'], parts),
          keys('buildDrafts', new Set(linked.map(l => l.buildId)))
        )
      );
      jobs.push(
        ...merge(
          arrays('jobs', ['target', 'installations'], parts),
          keys(
            'jobs',
            new Set(
              linked.flatMap(l => [l.jobId, l.purchase?.requirement?.kind === 'job' ? l.purchase.requirement.id : null])
            )
          )
        ).filter(j => j.shoppingRequirements && j.status === 'active')
      );
    }
    const sourceJobs = new Set(builds.map(d => d.data.rebuild?.jobId).filter(Boolean));
    const allJobs = merge(merge(base.jobs, jobs), keys('jobs', sourceJobs));
    for (const d of builds) for (const p of d.data.parts) parts.add(p.partId);
    for (const j of jobs) for (const i of j.target?.installations || []) parts.add(i.partId);
    // Legacy first-generation lists can include the other parts of the same plan.
    // Existing user-edited checklists remain unchanged by requirement refreshes.
    for (const l of before.planning.shopping)
      if (builds.some(d => d.id === l.buildId) || jobs.some(j => j.id === l.jobId)) if (l.partId) parts.add(l.partId);
    const cars = new Set(jobs.map(j => j.carId));
    const installations = read(
      reader.db
        .prepare(
          `SELECT key FROM query_records WHERE bucket=? AND coalesce(json_extract(aux,'$.removed'),0)=0 AND (json_extract(aux,'$.partId') IN (SELECT value FROM json_each(?)) OR car_id IN (SELECT value FROM json_each(?)))`
        )
        .all('["installations"]', JSON.stringify([...parts]), JSON.stringify([...cars]))
    );
    for (const i of installations) parts.add(i.partId);
    const assemblies = merge(
      arrays('assemblies', ['components'], parts),
      read(
        reader.db
          .prepare('SELECT key FROM query_records WHERE bucket=? AND car_id IN (SELECT value FROM json_each(?))')
          .all('["assemblies"]', JSON.stringify([...cars]))
      )
    ).filter(a => !a.dismantled);
    return {
      ...base,
      parts: merge(base.parts, keys('parts', parts)),
      jobs: allJobs,
      cars: merge(base.cars, keys('cars', new Set(allJobs.map(j => j.carId).filter(Boolean)))),
      installations,
      assemblies,
      buildDrafts: builds
    };
  });
}
function prepare(store, action, p) {
  const context = require('./shopping-write.cjs').context(store, action, p),
    { before, receiptItem: item } = context;
  const deps = dependencies(store, before, context.dependencies, item);
  before.parts = deps.parts.filter(r => item.kind === 'part' && r.id === item.id);
  before.supplies = deps.supplies.filter(r => item.kind === 'supply' && r.id === item.id);
  if (store.data.planning.shoppingChecklistSources !== undefined)
    before.planning.shoppingChecklistSources = store.data.planning.shoppingChecklistSources;
  const workspace = draft => ({
    ...deps,
    revision: draft.revision,
    planning: draft.planning,
    parts: merge(deps.parts, draft.parts),
    supplies: merge(deps.supplies, draft.supplies)
  });
  const validate = data => {
    require('./store.cjs').validateStock(data);
    const db = workspace(data);
    planning.validate({ ...db, planning: { ...data.planning, jobs: [], shelves: [], focus: [] } });
    for (const part of data.parts)
      if (require('./workshop.cjs').available(db, part) < 0)
        throw Error('Installed or reserved stock exceeds owned quantity.');
  };
  validate(before);
  const updated = require('./record-draft.cjs').produce(before, draft => planning.mutate(workspace(draft), action, p));
  validate(updated.data);
  return require('./scoped-write.cjs').prepare(
    store,
    before,
    { ...updated.data, revision: before.revision + 1 },
    updated.result
  );
}
module.exports = { prepare };
