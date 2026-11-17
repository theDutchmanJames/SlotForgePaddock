'use strict';
// Planning-only writes never alter installed stock. Progress notes additionally
// capture the current configuration, using only this car's fitted components.
const planning = require('./planning.cjs'),
  jobs = require('./jobs.cjs');
const supports = action => ['planning.job.save', 'planning.job.check', 'job.note'].includes(action);
function prepare(store, action, p) {
  const scoped = require('./scoped-write.cjs'),
    source = store.data;
  const before = {
    schema: source.schema,
    id: source.id,
    revision: source.revision,
    catalogueRevision: source.catalogueRevision,
    jobs: []
  };
  const keys = new Map();
  const deps = store.deferredState.read(r => {
    const one = (bucket, id) => r.record(JSON.stringify([bucket, 'id:' + id]), { assetHandle: true });
    const job = one('jobs', action === 'job.note' ? p.id : p.jobId);
    if (!job) throw Error('Workshop job not found.');
    before.jobs = [job];
    if (action !== 'job.note') {
      // Plans predate stable IDs: select by jobId but retain their index identity.
      const rows = r.db
        .prepare(
          'SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path=? AND f.json=?'
        )
        .all('["planning","jobs"]', '["jobId"]', JSON.stringify(job.id));
      if (rows.length > 1) throw Error('Duplicate job plan.');
      // Sparse car deletion leaves gaps. A count can collide with a surviving
      // index; allocate beyond the highest stored identity instead.
      const target =
        rows[0]?.key ||
        JSON.stringify([
          'planning',
          'jobs',
          'index:' +
            r.db
              .prepare('SELECT coalesce(max(CAST(substr(identity,7) AS INTEGER)),-1)+1 n FROM records WHERE bucket=?')
              .get('["planning","jobs"]').n
        ]);
      keys.set(JSON.stringify(['planning', 'jobs', 'index:0']), target);
      before.planning = { jobs: rows.map(row => r.record(row.key, { assetHandle: true })) };
      return {};
    }
    const car = one('cars', job.carId);
    if (!car) throw Error('Car not found.');
    const installations = r.db
      .prepare(
        "SELECT key FROM query_records WHERE bucket='[\"installations\"]' AND car_id=? AND json_extract(aux,'$.removed')=0"
      )
      .all(job.carId)
      .map(row => r.record(row.key, { assetHandle: true }));
    const ids = new Set(
      [...installations, ...(job.baseline?.installations || []), ...job.log.flatMap(e => e.actual.installations)].map(
        i => i.partId
      )
    );
    const parts = [...ids].map(id => one('parts', id));
    if (parts.some(p => !p)) throw Error('A workshop component is missing.');
    before.events = [];
    if (source.planning.shoppingLists !== undefined) before.planning = { shoppingLists: source.planning.shoppingLists };
    return { cars: [car], parts, installations, assemblies: [], setups: [] };
  });
  // Legacy general jobs may carry a requirements flag. Their reconciliation
  // needs the physical dependency scope, not just the job's notes.
  if (action === 'job.note' && before.jobs[0].shoppingRequirements)
    return require('./physical-write.cjs').prepare(store, action, p);
  const workspace = d => ({
    ...deps,
    revision: d.revision,
    jobs: d.jobs,
    events: d.events || [],
    planning: { shopping: [], jobs: [], shelves: [], focus: [], ...d.planning }
  });
  const validate = d => {
    if (action === 'job.note') jobs.validate(workspace(d), require('./store.cjs').TECH_FIELDS);
    else planning.validate(workspace(d));
  };
  validate(before);
  const updated = require('./record-draft.cjs').produce(before, draft =>
    action === 'job.note'
      ? jobs.mutate(workspace(draft), action, p, require('./store.cjs').TECH_FIELDS)
      : planning.mutate(workspace(draft), action, p)
  );
  validate(updated.data);
  return scoped.prepare(
    store,
    before,
    { ...updated.data, revision: before.revision + 1 },
    updated.result,
    keys.size ? keys : null
  );
}
module.exports = { supports, prepare };
