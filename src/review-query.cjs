'use strict';
// Read-only projections and write workspaces share one revision-bound reader.
// Never trust a previous preview when applying: rebuild it against that reader.
const collection = require('./collection.cjs'),
  catalogue = require('./catalogue-import.cjs');
const common = [
  'schema',
  'id',
  'revision',
  'catalogueRevision',
  'settings',
  'choices',
  'choiceAliases',
  'views',
  'customFields'
];
const meta = () => ({ textFields: require('./store.cjs').TEXT_FIELDS, techFields: require('./store.cjs').TECH_FIELDS });
const commands = new Set([
  'supply.delete',
  'car.bulk',
  'choice.rename',
  'catalogue.apply',
  'part.delete',
  'part.deleteMany'
]);
const plans = new Set([
  'setup.options',
  'bulk.preview',
  'choice.preview',
  'catalogue.preview',
  'catalogue.selection',
  'part.delete',
  'part.deleteMany',
  'setup.preview',
  'build.preview',
  'car.delete',
  'choices.catalogue'
]);
function workspace(store) {
  const s = new (require('./store.cjs').Store)();
  for (const k of common) s.data[k] = store.data[k];
  return s;
}
function keys(store, bucket) {
  let n = JSON.parse(store.deferredState.manifest);
  for (const k of bucket.split('.')) n = new Map(n.object).get(k);
  return (n?.array || []).map(x => x.record);
}
// Only requested scalar/array fields are projected; photographs and unrelated
// specifications are never decoded merely to find candidate records.
function projection(store, r, bucket, paths) {
  const rows = r.db
    .prepare(
      'SELECT f.record,f.path,f.json FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket=? AND f.path IN(SELECT value FROM json_each(?))'
    )
    .all(JSON.stringify(bucket.split('.')), JSON.stringify(paths.map(p => JSON.stringify(p))));
  const byKey = new Map();
  for (const row of rows) {
    let obj = byKey.get(row.record);
    if (!obj) byKey.set(row.record, (obj = {}));
    const path = JSON.parse(row.path);
    for (const k of path.slice(0, -1)) obj = obj[k] ??= {};
    obj[path.at(-1)] = JSON.parse(row.json);
  }
  return keys(store, bucket).map(key => ({ key, value: byKey.get(key) || {} }));
}
function add(s, r, bucket, id) {
  const list = s.data[bucket];
  let item = list.find(x => x.id === id);
  if (!item) {
    item = r.record(JSON.stringify([bucket, 'id:' + id]), { assetHandle: true });
    if (item) list.push(item);
  }
  return item;
}
function choiceProjection(store, r, db, field) {
  const fields = field ? [field] : collection.metadata(db, meta()).choices.map(f => f.key);
  const path = k =>
    k.startsWith('tech_') ? ['technical', k.slice(5)] : k.startsWith('custom_') ? ['custom', k.slice(7)] : [k];
  const paths = [
    ['id'],
    ...fields.map(path),
    ...fields.filter(k => k.startsWith('tech_')).map(k => ['factory', k.slice(5)])
  ];
  const cars = projection(store, r, 'cars', paths).map(x => ({ technical: {}, custom: {}, factory: {}, ...x.value }));
  const setups = fields.includes('track') ? projection(store, r, 'setups', [['track']]).map(x => x.value) : [];
  const tests = fields.some(k => ['track', 'driver'].includes(k))
    ? projection(store, r, 'tests', [['track'], ['driver']]).map(x => x.value)
    : [];
  return { ...db, cars, setups, tests };
}
function choiceWorkspace(store, r, p) {
  const s = workspace(store);
  if (!collection.metadata(s.data, meta()).choices.some(f => f.key === p.field)) throw Error('Unknown choice field.');
  const projected = choiceProjection(store, r, s.data, p.field),
    values = collection.valuesFor(projected, p.field);
  if (p.updateCars === true) {
    const sources = new Set([
      p.from,
      ...s.data.choiceAliases.filter(a => a.field === p.field && a.to === p.from).map(a => a.from)
    ]);
    const at = c =>
      p.field.startsWith('tech_')
        ? c.technical[p.field.slice(5)]
        : p.field.startsWith('custom_')
          ? c.custom[p.field.slice(7)]
          : c[p.field];
    for (const c of projected.cars)
      if ((Array.isArray(at(c)) ? at(c) : [at(c)]).some(v => sources.has(v))) add(s, r, 'cars', c.id);
    if (p.field.startsWith('tech_'))
      return {
        s: require('./car-detail-write.cjs').context(store, '@choice', {
          ids: s.data.cars.map(c => c.id),
          field: p.field.slice(5)
        }).store,
        values
      };
  }
  return { s, values };
}
function cataloguePreview(store, r, s, input) {
  const paths = ['id', 'name', 'maker', 'reference', 'quantity', 'location', 'archived']
    .map(k => [k])
    .concat(['name', 'manufacturer', 'reference'].map(k => ['catalogue', 'product', k]));
  const records = ['parts', 'supplies'].flatMap(b =>
    projection(store, r, b, paths).map(x => ({ kind: b === 'parts' ? 'part' : 'supply', value: x.value }))
  );
  return catalogue.preview(s.data, input, {
    records,
    isUnchanged: (record, product) => {
      const full = add(s, r, record.kind === 'part' ? 'parts' : 'supplies', record.value.id);
      return require('node:util').isDeepStrictEqual(full?.catalogue?.product, product);
    }
  });
}
const referenceLabels = [
  ['planning.shopping', 'shopping list or purchase history'],
  ['installations', 'car installation history'],
  ['assemblies', 'assemblies or assembly history'],
  ['setups', 'saved setups'],
  ['tests', 'performance records'],
  ['jobs', 'workshop jobs'],
  ['events', 'car history'],
  ['buildDrafts', 'saved build drafts'],
  ['parts', 'stock returned from this part']
];
function deletion(store, r, p, many) {
  const ids = many ? p.ids : [p.id];
  if (
    many &&
    (!Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      ids.some(id => typeof id !== 'string') ||
      new Set(ids).size !== ids.length)
  )
    throw Error('Select between 1 and 200 unique parts.');
  const s = workspace(store),
    reasons = new Map(ids.map(id => [id, new Set()]));
  // Find both top-level fields and references nested in historical snapshots.
  // This scans relevant metadata in SQL, not complete records/media in JS.
  for (const [bucket, label] of many
    ? [...referenceLabels.slice(1, -1), referenceLabels[0], referenceLabels.at(-1)]
    : referenceLabels) {
    const rows = r.db
      .prepare(
        `SELECT DISTINCT r.identity, t.atom id FROM records r JOIN record_fields f ON f.record=r.key JOIN json_tree(f.json) t WHERE r.bucket=? AND t.type='text' AND t.atom IN(SELECT value FROM json_each(?)) AND (t.key IN('partId','sourcePartId') OR t.parent IS NULL AND json_extract(f.path,'$[#-1]') IN('partId','sourcePartId'))`
      )
      .all(JSON.stringify(bucket.split('.')), JSON.stringify(ids));
    for (const row of rows) if (bucket !== 'parts' || row.identity !== 'id:' + row.id) reasons.get(row.id).add(label);
  }
  const rows = ids.map(id => {
    const part = add(s, r, 'parts', id);
    if (!part) throw Error('Part not found.');
    return {
      id,
      name: part.name,
      quantity: part.quantity,
      reasons: [...(many && part.quantity > 0 ? ['owned stock'] : []), ...reasons.get(id)]
    };
  });
  const model = many
    ? {
        revision: s.data.revision,
        eligible: rows.filter(x => !x.reasons.length),
        blocked: rows.filter(x => x.reasons.length)
      }
    : { ...rows[0], revision: s.data.revision };
  return { s, model };
}
function plan(store, action, p) {
  if (['setup.preview', 'build.preview', 'car.delete'].includes(action)) {
    const mapped = { 'setup.preview': 'setup.apply', 'build.preview': 'build.create', 'car.delete': 'car.delete' }[
      action
    ];
    return require('./physical-write.cjs').context(store, mapped, p).store.plan(action, p);
  }
  return store.deferredState.read(r => {
    if (action === 'setup.options') {
      const s = workspace(store);
      add(s, r, 'setups', p.id);
      for (const [bucket, fields] of [
        ['cars', ['id', 'name']],
        ['parts', ['id', 'name', 'quantity', 'tracking', 'reference', 'condition', 'location']],
        ['installations', ['id', 'carId', 'partId', 'quantity', 'field', 'position', 'removed', 'assemblyId']],
        ['assemblies', ['id', 'name', 'location', 'carId', 'dismantled', 'components']]
      ])
        s.data[bucket] = projection(
          store,
          r,
          bucket,
          fields.map(k => [k])
        ).map(x => x.value);
      return require('./workshop.cjs').setupOptions(s.data, p.id);
    }
    if (action.startsWith('part.delete')) return deletion(store, r, p, action === 'part.deleteMany').model;
    if (action === 'choices.catalogue') {
      const s = workspace(store);
      return collection.catalogue(choiceProjection(store, r, s.data), meta());
    }
    if (action === 'choice.preview') {
      const { s, values } = choiceWorkspace(store, r, p),
        draft = require('./json-data.cjs').cloneJSON(s.data),
        result = collection.renameChoice(draft, p, meta(), true, values);
      require('./store.cjs').validateDatabase(draft);
      return result;
    }
    const s = workspace(store);
    if (action === 'bulk.preview') {
      for (const id of p.ids || []) add(s, r, 'cars', id);
      return s.plan(action, p);
    }
    const model = cataloguePreview(store, r, s, p.input);
    return action === 'catalogue.selection' ? catalogue.selected(s.data, p, model) : model;
  });
}
function prepare(store, action, p) {
  return store.deferredState.read(r => {
    let s, model, values;
    if (action === 'supply.delete') {
      s = workspace(store);
      add(s, r, 'supplies', p.id);
      const linked = r.db
        .prepare(
          `SELECT 1 FROM records r JOIN record_fields f ON f.record=r.key WHERE r.bucket='["planning","shopping"]' AND f.path='["purchase","item","id"]' AND f.json=? AND length(f.json)<=512 AND EXISTS(SELECT 1 FROM record_fields k WHERE k.record=r.key AND k.path='["purchase","item","kind"]' AND k.json='"supply"') LIMIT 1`
        )
        .get(JSON.stringify(p.id));
      if (linked) throw Error('This supply is linked to purchasing history. Archive it instead.');
    } else if (action.startsWith('part.delete')) {
      ({ s, model } = deletion(store, r, p, action === 'part.deleteMany'));
      if (action === 'part.deleteMany' && model.blocked.length)
        throw Error('Some parts have stock or linked records. Review the selection again.');
      if (action === 'part.delete' && model.reasons.length)
        throw Error(
          'This part is linked to ' + model.reasons.join(', ') + '. Keep the record to preserve those references.'
        );
    } else if (action === 'choice.rename') ({ s, values } = choiceWorkspace(store, r, p));
    else {
      s = workspace(store);
      if (action === 'car.bulk') for (const id of p.ids || []) add(s, r, 'cars', id);
      else {
        model = cataloguePreview(store, r, s, p.input);
        for (const pick of p.selections || []) {
          const row = model.rows[pick.index];
          if (pick.targetId && row?.product)
            add(s, r, row.product.kind === 'part' ? 'parts' : 'supplies', pick.targetId);
        }
      }
    }
    const before = s.data;
    let result;
    if (action === 'choice.rename')
      s.transact(db => {
        result = collection.renameChoice(db, p, meta(), false, values);
        for (const row of result.rows)
          collection.rememberChoices(
            db,
            db.cars.find(c => c.id === row.id),
            meta()
          );
      });
    else if (action === 'catalogue.apply')
      s.transact(db => {
        result = catalogue.apply(db, p, model);
      });
    else result = s.mutate(action, p, { snapshot: false }).result;
    return require('./scoped-write.cjs').prepare(store, before, s.data, result);
  });
}
module.exports = { supports: a => commands.has(a), supportsPlan: a => plans.has(a), plan, prepare };
