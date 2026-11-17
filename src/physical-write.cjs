'use strict';
// Dependency workspaces for physical operations. SQLite remains authoritative:
// stock users are selected across ALL cars, not just the currently open car.
// Existing domain commands, validators and the revision-checked commit are reused.
const actions = new Set([
  'car.delete',
  'part.save',
  'part.install',
  'part.remove',
  'assembly.create',
  'assembly.replace',
  'assembly.install',
  'assembly.remove',
  'assembly.dismantle',
  'setup.save',
  'setup.apply',
  'build.draft.save',
  'build.draft.delete',
  'build.create',
  'rebuild.start',
  'job.start',
  'job.edit',
  'job.shopping',
  'job.fit',
  'job.remove',
  'job.setting',
  'job.complete',
  'job.cancel',
  'planning.delivery.receive',
  'planning.receipt.correct',
  'planning.order.place',
  'planning.order.cancel',
  'planning.shopping.applyRequirements'
]);
const supports = (action, p = {}) => actions.has(action) || (action === 'car.save' && p.stockOverrides !== undefined);
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
      queues = [],
      stock = new Set(),
      fullCars = new Set(),
      plans = new Set();
    let refreshed = false;
    const bucketPath = b => b.split('.'),
      array = b => bucketPath(b).reduce((o, k) => o[k], data);
    const addKey = (b, key) => {
      let map = maps.get(b);
      if (!map) maps.set(b, (map = new Map()));
      if (map.has(key)) return map.get(key);
      const value = r.record(key, { assetHandle: true });
      if (!value) return null;
      map.set(key, value);
      array(b).push(value);
      queues.push([b, value]);
      if (JSON.parse(key).at(-1).startsWith('index:'))
        recordKeys.set(JSON.stringify([...bucketPath(b), 'index:' + (array(b).length - 1)]), key);
      return value;
    };
    const add = (b, id) => (id ? addKey(b, JSON.stringify([...bucketPath(b), 'id:' + id])) : null);
    const rows = (b, sql, args = []) =>
      r.db
        .prepare(sql)
        .all(...args)
        .map(x => addKey(b, x.key));
    const related = (b, path, value, active = false) =>
      rows(
        b,
        `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path=? AND f.json=? AND length(f.json)<=512 ${active ? "AND EXISTS(SELECT 1 FROM record_fields x WHERE x.record=r.key AND x.path='[\"removed\"]' AND x.json IN ('null','\"\"'))" : ''}`,
        [JSON.stringify(bucketPath(b)), JSON.stringify(path), JSON.stringify(value)]
      );
    const contains = (b, path, id, property = 'partId') =>
      rows(
        b,
        `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path=? AND EXISTS(SELECT 1 FROM json_each(f.json) a WHERE json_extract(a.value,?)=?) ${b === 'jobs' ? `AND EXISTS(SELECT 1 FROM record_fields j WHERE j.record=r.key AND j.path='["shoppingRequirements"]' AND j.json='true') AND EXISTS(SELECT 1 FROM record_fields j WHERE j.record=r.key AND j.path='["status"]' AND j.json='"active"')` : ''}`,
        [JSON.stringify(bucketPath(b)), JSON.stringify(path), '$.' + property, id]
      );
    const part = id => {
      if (!id) return;
      add('parts', id);
      if (!stock.has(id)) {
        stock.add(id);
        queues.push(['@stock', id]);
      }
    };
    const car = id => {
      if (!id) return;
      add('cars', id);
      if (!fullCars.has(id)) {
        fullCars.add(id);
        related('installations', ['carId'], id, true);
      }
    };
    const job = id => {
      const j = add('jobs', id);
      if (j && !plans.has('job:' + id)) {
        plans.add('job:' + id);
        car(j.carId);
        related('buildDrafts', ['data', 'rebuild', 'jobId'], id);
        related('planning.jobs', ['jobId'], id);
        related('planning.shopping', ['jobId'], id);
        related('planning.shopping', ['purchase', 'requirement', 'id'], id);
        related('planning.shoppingLists', ['source', 'id'], id);
        related('planning.shoppingChecklistSources', ['id'], id);
      }
      return j;
    };
    const draft = id => {
      const d = add('buildDrafts', id);
      if (d && !plans.has('build:' + id)) {
        plans.add('build:' + id);
        related('planning.shopping', ['buildId'], id);
        related('planning.shoppingLists', ['source', 'id'], id);
        related('planning.shoppingChecklistSources', ['id'], id);
      }
      return d;
    };
    const inputBuild = d => {
      if (!d || typeof d !== 'object') return;
      for (const row of Array.isArray(d.parts) ? d.parts : []) part(row?.partId);
      for (const a of Array.isArray(d.assemblies) ? d.assemblies : []) add('assemblies', a?.id);
      if (d.rebuild) {
        car(d.rebuild.carId);
        job(d.rebuild.jobId);
      }
    };
    const selection = value => {
      if (typeof value !== 'string') return;
      const [type, id] = value.split(':');
      if (type === 'p') part(id);
      if (type === 'i') add('installations', id);
      if (type === 'a') add('assemblies', id);
    };
    const version = source.planning.purchasingVersion;
    if (version !== undefined) {
      data.planning.purchasingVersion = version;
      data.planning.shoppingLists = [];
      add('planning.shoppingLists', 'general');
    }
    // Sources have stable IDs but share IDs across the build/job namespaces.
    // Read by stored record key, retaining their manifest identity on commit.
    if (
      new Map(new Map(JSON.parse(store.deferredState.manifest).object).get('planning').object).has(
        'shoppingChecklistSources'
      )
    )
      data.planning.shoppingChecklistSources = [];
    const needsPurchasing = action !== 'setup.save' && action !== 'job.start' && action !== 'rebuild.start';
    if (needsPurchasing && version === undefined) {
      // One-time legacy upgrade needs every old line before setting its global
      // version. Modern collections do not take this path.
      rows('planning.shopping', 'SELECT key FROM records WHERE bucket=\'["planning","shopping"]\'');
    }
    if (action === 'car.delete') {
      car(p.id);
      for (const b of ['installations', 'assemblies', 'setups', 'tests', 'events', 'documents'])
        related(b, ['carId'], p.id);
      for (const j of related('jobs', ['carId'], p.id)) job(j.id);
      related('cars', ['rebuild', 'from', 'id'], p.id);
      related('cars', ['rebuild', 'to', 'id'], p.id);
      for (const d of related('buildDrafts', ['data', 'rebuild', 'carId'], p.id)) draft(d.id);
      related('planning.focus', ['carId'], p.id);
      rows(
        'planning.shelves',
        `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["planning","shelves"]' AND f.path='["carIds"]' AND EXISTS(SELECT 1 FROM json_each(f.json) c WHERE c.value=?)`,
        [p.id]
      );
    }
    if (action === 'part.save' && p.id) {
      const old = add('parts', p.id);
      if (old) {
        // Editing dedicated assembly stock was never permitted, including its name.
        contains('assemblies', ['components'], p.id);
        if (Number(p.data?.quantity) !== old.quantity || p.data?.name !== old.name || p.data?.tracking !== old.tracking)
          part(p.id);
        if (p.data?.name !== old.name || p.data?.tracking !== old.tracking) related('installations', ['partId'], p.id);
        if (p.data?.tracking !== old.tracking)
          rows(
            'assemblies',
            `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["assemblies"]' AND f.path='["history"]' AND EXISTS(SELECT 1 FROM json_tree(f.json) a WHERE a.key='partId' AND a.value=?)`,
            [p.id]
          );
      }
    }
    if (action === 'car.save') car(p.id);
    if (action === 'part.install') {
      car(p.carId);
      part(p.partId);
    }
    if (action === 'part.remove') add('installations', p.id);
    if (action.startsWith('assembly.')) {
      add('assemblies', p.id);
      part(p.partId);
      if (p.carId) car(p.carId);
      for (const c of Array.isArray(p.components) ? p.components : []) part(c?.partId);
    }
    if (action === 'setup.save') {
      if (p.suggestion !== undefined) {
        add('cars', p.carId);
        for (const row of Array.isArray(p.suggestion?.rows) ? p.suggestion.rows : []) add('parts', row?.partId);
      } else car(p.carId);
    }
    if (action === 'setup.apply') {
      const setup = add('setups', p.id);
      if (setup) car(setup.carId);
      for (const v of Object.values(p.selections || {})) selection(v);
    }
    if (action.startsWith('build.')) {
      draft(p.id || p.draftId);
      inputBuild(p.data);
    }
    if (action === 'rebuild.start' || action === 'job.start') {
      const setup = add('setups', p.setupId),
        id = p.carId || setup?.carId;
      car(id);
      if (id)
        for (const j of rows(
          'jobs',
          `SELECT r.key FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["jobs"]' AND f.path='["carId"]' AND f.json=? AND length(f.json)<=512 AND EXISTS(SELECT 1 FROM record_fields j WHERE j.record=r.key AND j.path='["status"]' AND j.json='"active"')`,
          [JSON.stringify(id)]
        ))
          job(j.id);
    }
    if (action.startsWith('job.') && action !== 'job.start') {
      job(p.id);
      selection(p.selection);
      add('installations', p.installationId);
    }
    if (action === 'planning.shopping.applyRequirements') {
      if (p.kind === 'build') draft(p.sourceId);
      else if (p.kind === 'job') job(p.sourceId);
    }
    if (
      action.startsWith('planning.delivery.') ||
      action.startsWith('planning.order.') ||
      action === 'planning.receipt.correct'
    ) {
      add('planning.shopping', p.id);
      for (const e of Array.isArray(p.entries) ? p.entries : []) add('planning.shopping', e?.id);
    }
    // Only parts that the operation can alter initiate requirement refreshes.
    // Dependencies needed merely to validate old snapshots remain leaf records.
    const refresh = () => {
      if (refreshed) return;
      refreshed = true;
      for (const id of [...stock]) {
        if (
          !require('./shopping-requirements.cjs').affects(action) &&
          !action.startsWith('planning.') &&
          action !== 'car.save'
        )
          continue;
        for (const d of contains('buildDrafts', ['data', 'parts'], id)) draft(d.id);
        for (const j of contains('jobs', ['target', 'installations'], id))
          if (j.shoppingRequirements && j.status === 'active') job(j.id);
        for (const line of related('planning.shopping', ['partId'], id)) {
          if (line.buildId) draft(line.buildId);
          if (line.jobId) job(line.jobId);
        }
      }
    };
    let cursor = 0;
    while (cursor < queues.length) {
      const [b, v] = queues[cursor++];
      if (b === '@stock') {
        related('installations', ['partId'], v, true);
        contains('assemblies', ['components'], v);
        // All outstanding purchases count for individually tracked identities.
        related('planning.shopping', ['partId'], v);
      } else if (b === 'installations') {
        add('cars', v.carId);
        part(v.partId);
        if (v.assemblyId) add('assemblies', v.assemblyId);
      } else if (b === 'assemblies') {
        if (v.carId) {
          add('cars', v.carId);
          if (!v.dismantled) car(v.carId);
        }
        for (const c of v.components) {
          if (!v.dismantled) part(c.partId);
          else add('parts', c.partId);
        }
        for (const h of v.history || []) for (const c of [...h.before, ...h.after]) add('parts', c.partId);
      } else if (b === 'planning.shelves') {
        for (const id of v.carIds) add('cars', id);
      } else if (b === 'tests' || b === 'events') {
        add('cars', v.carId);
        for (const i of v.installations || []) add('parts', i.partId);
      } else if (b === 'setups') {
        add('cars', v.carId);
        for (const i of v.installations) {
          part(i.partId);
          if (i.assemblyId) add('assemblies', i.assemblyId);
        }
      } else if (b === 'jobs') {
        add('cars', v.carId);
        if (v.setupId) add('setups', v.setupId);
        for (const snap of [v.baseline, v.target, v.actual, ...v.log.map(e => e.actual)].filter(Boolean))
          for (const i of snap.installations) add('parts', i.partId);
      } else if (b === 'buildDrafts') {
        draft(v.id);
        inputBuild(v.data);
      } else if (b === 'planning.shopping') {
        if (v.partId) part(v.partId);
        if (v.purchase?.item.kind === 'supply') add('supplies', v.purchase.item.id);
        if (v.jobId) job(v.jobId);
        if (v.purchase?.listId) add('planning.shoppingLists', v.purchase.listId);
      }
      if (cursor === queues.length) refresh();
    }
    // Preserve existing order: application choices and legacy duplicate lines can
    // use first-match semantics. SQL query ordering must not change those choices.
    const roots = new Map(JSON.parse(store.deferredState.manifest).object);
    for (const [b, map] of maps) {
      let node = { object: [...roots] };
      for (const k of bucketPath(b)) node = new Map(node.object).get(k);
      const order = new Map((node?.array || []).map((n, i) => [n.record, i]));
      const entries = [...map].sort((a, b) => order.get(a[0]) - order.get(b[0]));
      array(b).splice(0, array(b).length, ...entries.map(e => e[1]));
      for (const [i, [key]] of entries.entries())
        if (JSON.parse(key).at(-1).startsWith('index:'))
          recordKeys.set(JSON.stringify([...bucketPath(b), 'index:' + i]), key);
    }
  });
  s.data = validateDatabase(data);
  return { store: s, recordKeys };
}
function prepare(store, action, p) {
  const scoped = require('./scoped-write.cjs'),
    { store: s, recordKeys } = context(store, action, p),
    before = s.data,
    result = s.mutate(action, p, { snapshot: false }).result;
  // Deletion can shift index-keyed plans/focus. Map surviving entries by their
  // business identity rather than reusing the removed entry's array index.
  const afterKeys = action === 'car.delete' ? new Map(recordKeys) : recordKeys;
  if (action === 'car.delete')
    for (const [bucket, identity] of [
      ['jobs', v => v.jobId],
      ['focus', v => JSON.stringify([v.carId, v.photoKey])]
    ]) {
      for (const key of [...afterKeys.keys()]) if (JSON.parse(key)[1] === bucket) afterKeys.delete(key);
      for (const [index, row] of s.data.planning[bucket].entries()) {
        const old = before.planning[bucket].findIndex(v => identity(v) === identity(row));
        const original = recordKeys.get(JSON.stringify(['planning', bucket, 'index:' + old]));
        if (original) afterKeys.set(JSON.stringify(['planning', bucket, 'index:' + index]), original);
      }
    }
  return scoped.prepare(
    store,
    before,
    s.data,
    result,
    recordKeys.size ? recordKeys : null,
    afterKeys.size ? afterKeys : null
  );
}
module.exports = { supports, context, prepare };
