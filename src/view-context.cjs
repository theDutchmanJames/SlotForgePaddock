'use strict';
// UI projections only. Mutations still run the authoritative domain checks.
const { cloneJSON } = require('./json-data.cjs');
const { fault } = require('./sqlite-query.cjs');
const pageQuery = require('./page-query.cjs');
const pick = (value, keys) =>
  Object.fromEntries(keys.filter(k => Object.hasOwn(value, k)).map(k => [k, cloneJSON(value[k])]));
const carChoice = c =>
  pick(c, [
    'id',
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
  ]);
const partChoice = p =>
  pick(p, [
    'id',
    'name',
    'maker',
    'reference',
    'category',
    'partType',
    'location',
    'condition',
    'tracking',
    'quantity',
    'iconId',
    'iconColour',
    'scale',
    'sourcePartId'
  ]);
function helpers(db, data, r) {
  const add = (bucket, id) => {
    if (!id) return null;
    const value = r.one(bucket, id);
    if (value) {
      const i = data[bucket].findIndex(v => v.id === id);
      if (i < 0) data[bucket].push(value);
      else data[bucket][i] = value;
    }
    return value;
  };
  const chooseCars = (includeWishlist = false) => {
    const full = new Map(data.cars.map(c => [c.id, c]));
    data.cars = pageQuery
      .cars(r)
      .filter(c => includeWishlist || !require('./car-membership.cjs').isWishlist(c))
      .map(c => full.get(c.id) || carChoice(c));
  };
  const stock = () => {
    const full = new Map(data.parts.map(p => [p.id, p]));
    data.parts = db.parts.map(p => full.get(p.id) || partChoice(p));
    data.assemblies = db.assemblies
      .filter(a => !a.dismantled)
      .map(a => pick(a, ['id', 'name', 'carId', 'location', 'dismantled', 'components']));
    const used = new Map();
    for (const i of db.installations) if (!i.removed) used.set(i.partId, (used.get(i.partId) || 0) + i.quantity);
    for (const a of data.assemblies)
      if (!a.carId) for (const c of a.components) used.set(c.partId, (used.get(c.partId) || 0) + c.quantity);
    data._view.available = Object.fromEntries(db.parts.map(p => [p.id, p.quantity - (used.get(p.id) || 0)]));
  };
  const related = (bucket, carId) => {
    data[bucket] = pageQuery.relatedIds(r, bucket, carId).map(id => r.one(bucket, id));
  };
  const installations = carId => {
    data.installations = pageQuery
      .relatedIds(r, 'installations', carId, { active: true })
      .map(id => r.one('installations', id));
    for (const i of data.installations) {
      add('parts', i.partId);
      if (i.assemblyId) add('assemblies', i.assemblyId);
    }
  };
  const shopping = items => {
    data.planning.shopping = cloneJSON(items);
    for (const line of data.planning.shopping)
      if (line.buildId)
        line.buildAvailable = !!r.db
          .prepare('SELECT 1 FROM records WHERE key=?')
          .get(JSON.stringify(['buildDrafts', 'id:' + line.buildId]));
    for (const s of items) {
      add('parts', s.partId);
      if (s.purchase?.item.kind === 'supply') add('supplies', s.purchase.item.id);
      if (s.buildCarId) add('cars', s.buildCarId);
      if (s.jobId) {
        const j = add('jobs', s.jobId);
        if (j) add('cars', j.carId);
      }
    }
  };
  const slice = (items, limit = 24, key = 'list') => {
    const offset = data._view.request.offset || 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw fault('INVALID_QUERY', 'Invalid page.');
    data._view[key] = {
      offset,
      limit,
      total: items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null
    };
    return items.slice(offset, offset + limit);
  };
  return { add, chooseCars, stock, related, installations, shopping, slice };
}
function extraView(db, data, r, request) {
  const h = helpers(db, data, r),
    info = data._view;
  if (request.shoppingFinder) {
    const f = request.shoppingFinder;
    if (typeof f !== 'object' || Array.isArray(f)) throw fault('INVALID_QUERY', 'Invalid part search.');
    for (const k of ['query', 'maker', 'category', 'partType', 'kind'])
      if (f[k] !== undefined && (typeof f[k] !== 'string' || f[k].length > 500))
        throw fault('INVALID_QUERY', 'Invalid part search.');
    if (f.kind && !['part', 'supply'].includes(f.kind)) throw fault('INVALID_QUERY', 'Invalid item type.');
    const found = pageQuery.finder(r, f);
    info.shoppingFinder = {
      makers: found.makers,
      total: found.total,
      items: found.rows.map(full => {
        const v = partChoice(full);
        require('./lazy-assets.cjs').copyProperty(v, 'picture', full);
        return v;
      })
    };
    // Typeahead requests need matches only, not a second Shopping List projection.
    return true;
  }
  if (request.page === 'Library' && request.libraryTab === 'parts') {
    const f = request.catalogue || {};
    if (f.scope && !['all', 'unowned', 'owned'].includes(f.scope))
      throw fault('INVALID_QUERY', 'Invalid catalogue scope.');
    const result = r.list('parts', {
      query: f.query || '',
      category: f.category || undefined,
      maker: f.maker || undefined,
      owned: f.scope === 'owned',
      unowned: f.scope === 'unowned',
      sort: 'name',
      offset: request.offset || 0,
      limit: 40
    });
    data.parts = result.rows;
    info.list = { total: result.total, offset: request.offset || 0, limit: 40, nextOffset: result.nextOffset };
    info.catalogueMakers = r.db
      .prepare(
        "SELECT min(json_extract(f.json,'$')) name FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='[\"maker\"]' WHERE q.bucket='[\"parts\"]' AND q.maker<>'' GROUP BY q.maker ORDER BY q.maker"
      )
      .all()
      .map(x => x.name);
    return true;
  }
  if (['Settings', 'Library', 'Connections', 'Import & Export'].includes(request.page)) return true;
  if (request.page === 'Showroom') {
    const filters = request.showroom || {},
      model = require('../renderer/showroom-domain.js'),
      all = pageQuery.cars(r),
      choices = model.cars({ cars: all }, filters),
      shelf = db.planning.shelves.find(s => s.id === filters.shelf);
    const byId = new Map(choices.map(c => [c.id, c])),
      list = shelf ? shelf.carIds.map(id => byId.get(id)).filter(Boolean) : choices;
    info.showroomChoices = list.map(c => ({ id: c.id, name: c.name }));
    info.usage = [...new Set(all.filter(require('./car-membership.cjs').active).flatMap(c => c.usage || []))].sort();
    info.activeCars = all.filter(require('./car-membership.cjs').active).length;
    info.galleryIds = h.slice(list, 48).map(c => c.id);
    info.galleryIds.forEach(id => h.add('cars', id));
    info.allShowroomChoices = model.cars({ cars: all });
    const featured = model.cover(all, db.planning.shelves, filters.cover || { carId: db.settings.showroomFeaturedId }, {
      id: filters.coverId,
      avoid: filters.coverAvoidId,
      seed: filters.coverSeed
    });
    info.featuredId = featured?.id;
    h.add('cars', featured?.id);
    if (all.some(c => require('./car-membership.cjs').active(c) && c.id === filters.viewerId))
      h.add('cars', filters.viewerId);
    data.planning.shelves = cloneJSON(db.planning.shelves);
    return true;
  }
  if (request.page === 'Workshop') {
    if (request.toolboxTab === 'Manuals and Part Guides') {
      const f = request.guides || {},
        result = r.list('documents', {
          guides: true,
          guideQuery: f.query || '',
          generalGuide: f.carId === 'general',
          carId: f.carId && f.carId !== 'general' ? f.carId : undefined,
          offset: request.offset || 0,
          limit: 24
        });
      data.documents = result.rows.map(d => {
        const out = pick(d, ['id', 'guide', 'carId', 'name', 'mime', 'size', 'title', 'category', 'added', 'updated']);
        require('./lazy-assets.cjs').copyProperty(out, 'picture', d);
        return out;
      });
      info.list = { total: result.total, offset: request.offset || 0, limit: 24, nextOffset: result.nextOffset };
      h.chooseCars();
      return true;
    }
    if (request.jobId) {
      const j = h.add('jobs', request.jobId);
      if (j) {
        h.add('cars', j.carId);
        h.installations(j.carId);
        h.shopping(db.planning.shopping.filter(s => s.jobId === j.id));
      }
      return true;
    }
    if (request.toolboxTab === 'Workshop supplies') {
      const f = request.supply || {},
        result = r.list('supplies', {
          archived: !!f.archived,
          category: f.category || undefined,
          lowSupply: !!f.low,
          searchFields: ['name', 'partType', 'maker', 'reference', 'location'],
          searchTerms: [String(f.query || '').toLowerCase()],
          offset: request.offset || 0,
          limit: 24
        });
      data.supplies = result.rows;
      info.list = { total: result.total, offset: request.offset || 0, limit: 24, nextOffset: result.nextOffset };
      return true;
    }
    if (request.jobCategory && !require('../renderer/job-types.js').valid(request.jobCategory))
      throw fault('INVALID_QUERY', 'Invalid job category.');
    const jobFilter = { jobCategory: request.jobCategory };
    info.jobCounts = {
      active: r.count('jobs', { ...jobFilter, status: 'active' }),
      closed: r.count('jobs', { ...jobFilter, notStatus: 'active' })
    };
    const result = r.list('jobs', {
      ...jobFilter,
      ...(request.closedJobs ? { notStatus: 'active' } : { status: 'active' }),
      offset: request.offset || 0,
      limit: 24
    });
    data.jobs = result.rows;
    info.list = { total: result.total, offset: request.offset || 0, limit: 24, nextOffset: result.nextOffset };
    data.jobs.forEach(j => h.add('cars', j.carId));
    const events = r.list('events', {
      types: ['maintenance', 'modification', 'installation', 'removal'],
      limit: Math.min(200, Math.max(3, request.recentWorkLimit || 3))
    });
    info.recentTotal = events.total;
    data.events = events.rows;
    const reminders = r.reminders();
    info.reminderTotal = reminders.length;
    const offset = request.detailOffsets?.reminders || 0;
    info.reminders = {
      pager: 'reminders',
      offset,
      limit: 24,
      total: reminders.length,
      nextOffset: offset + 24 < reminders.length ? offset + 24 : null
    };
    info.maintenance = reminders
      .slice(offset, offset + 24)
      .map(e => require('./lap-reminders.cjs').decorate(r.record(e.key), e));
    info.maintenance.forEach(e => h.add('cars', e.carId));
    return true;
  }
  if (request.page === 'Parts' && request.partsTab === 'Assemblies') {
    const result = r.list('assemblies', { dismantled: false, offset: request.offset || 0, limit: 24 });
    info.assemblies = result.total;
    data.assemblies = result.rows;
    info.list = { total: result.total, offset: request.offset || 0, limit: 24, nextOffset: result.nextOffset };
    for (const a of data.assemblies) {
      h.add('cars', a.carId);
      for (const c of a.components) h.add('parts', c.partId);
    }
    info.available = pageQuery.availability(r, data.parts);
    return true;
  }
  if (
    request.page === 'Build from Scratch' ||
    (request.page === 'Parts' && request.partsTab === 'Build from Scratch')
  ) {
    // Only the selected category/page and assigned parts need specifications.
    if (request.build?.rebuildCarId) info.rebuild = pageQuery.rebuild(r, request.build.rebuildCarId);
    const f = request.build || {},
      types = f.types || [],
      ids = new Set(f.partIds || []);
    for (const i of info.rebuild?.installations || []) ids.add(i.partId);
    const result = r.list('parts', {
      partTypes: f.all ? [] : types,
      searchFields: ['name', 'reference', 'maker', 'location', 'partType'],
      searchTerms: [String(f.query || '').toLowerCase()],
      offset: request.offset || 0,
      limit: 40
    });
    info.buildIds = result.rows.map(p => p.id);
    info.list = { total: result.total, offset: request.offset || 0, limit: 40, nextOffset: result.nextOffset };
    data.parts = result.rows;
    info.buildIds.forEach(id => ids.add(id));
    data.assemblies = pageQuery.assemblies(r, [...ids], f.assemblyIds || [], f.rebuildCarId || '');
    for (const a of data.assemblies.filter(a => (f.assemblyIds || []).includes(a.id) || a.carId === f.rebuildCarId))
      for (const c of a.components) ids.add(c.partId);
    for (const id of ids) if (!data.parts.some(p => p.id === id)) h.add('parts', id);
    info.available = pageQuery.availability(r, data.parts);
    data.buildDrafts = pageQuery
      .descriptors(r, 'buildDrafts', [
        'updated',
        ['data', 'name'],
        ['data', 'parts'],
        ['data', 'assemblies'],
        ['data', 'rebuild', 'jobId']
      ])
      .map(d => ({
        id: d.id,
        updated: d.updated,
        ...(d.data.rebuild ? { rebuildJobId: d.data.rebuild.jobId } : {}),
        data: { name: d.data.name, parts: d.data.parts.map(() => null), assemblies: d.data.assemblies.map(() => null) }
      }));
    return true;
  }
  if (request.page === 'Shopping List' || (request.page === 'Parts' && request.stockScope === 'shopping')) {
    const f = request.shopping || {};
    if (typeof f !== 'object' || Array.isArray(f)) throw fault('INVALID_QUERY', 'Invalid shopping filters.');
    for (const key of ['query', 'listId', 'maker', 'supplier', 'source', 'status'])
      if (f[key] !== undefined && (typeof f[key] !== 'string' || f[key].length > 500))
        throw fault('INVALID_QUERY', 'Invalid shopping filter.');
    if (f.groupBySupplier !== undefined && typeof f.groupBySupplier !== 'boolean')
      throw fault('INVALID_QUERY', 'Invalid supplier grouping.');
    if (
      (f.status && !['all', 'done', 'open', 'outstanding', 'toBuy', 'ordered', 'received'].includes(f.status)) ||
      (f.source && !['general', 'build', 'job'].includes(f.source))
    )
      throw fault('INVALID_QUERY', 'Unknown shopping filter.');
    const result = require('./shopping-query.cjs').project(db, f, r);
    data.planning.shoppingLists = result.lists;
    data.planning.purchasingVersion = 1;
    info.shopping = {
      makers: result.makers,
      suppliers: result.suppliers,
      counts: result.counts,
      listCounts: result.listCounts,
      sources: require('./shopping-demand-query.cjs').sources(r),
      totals: result.totals,
      conflicts: require('./shopping-demand-query.cjs').conflicts(r)
    };
    h.shopping(h.slice(result.lines, 30));
    return true;
  }
  if (request.page === 'Cars' && request.carId && request.section === 'Technical & parts') {
    if (!h.add('cars', request.carId)) throw fault('CAR_NOT_FOUND', 'This car no longer exists.');
    h.installations(request.carId);
    return true;
  }
  return false;
}
function editor(db, data, r, request) {
  const e = request.editor;
  if (!e) return;
  const { action, id } = e;
  if (typeof action !== 'string' || action.length > 100 || (id !== undefined && typeof id !== 'string'))
    throw fault('INVALID_QUERY', 'Invalid editor context.');
  const h = helpers(db, data, r),
    a = action;
  data._view.editor = true;
  if (a === 'shop-requirements') {
    const split = id.indexOf(':');
    data._view.shoppingRequirements = require('./shopping-requirements.cjs').preview(
      db,
      id.slice(0, split),
      id.slice(split + 1)
    );
    return;
  }
  if (a === 'job-shopping' || a === 'shop-reconcile') return;
  if (['shop-new-list', 'shop-rename-list'].includes(a)) {
    data.planning.shoppingLists = require('./shopping-query.cjs').project(db, {}, r).lists;
    return;
  }
  if (a.startsWith('shop-')) {
    const projected = require('./shopping-query.cjs').project(db, {}, r);
    data.planning.shoppingLists = projected.lists;
    if (['shop-add', 'shop-link', 'shop-receive'].includes(a)) {
      h.chooseCars();
      data.jobs = db.jobs.filter(j => j.status === 'active').map(j => pick(j, ['id', 'carId', 'name', 'status']));
    }
    if (
      [
        'shop-done',
        'shop-reopen',
        'shop-delete',
        'shop-undo',
        'shop-quantity',
        'shop-move',
        'shop-plus',
        'shop-minus'
      ].includes(a)
    ) {
      const line = projected.allLines.find(s => s.id === id);
      if (line) h.shopping([line]);
    }
    if (['shop-bulk-order', 'shop-bulk-cancel', 'shop-bulk-receive'].includes(a)) {
      if (!Array.isArray(e.selected) || e.selected.length > 200)
        throw fault('INVALID_QUERY', 'Select at most 200 purchases.');
      h.shopping(projected.allLines.filter(s => e.selected.includes(s.id)));
    }
    if (
      [
        'shop-order',
        'shop-cancel-order',
        'shop-history',
        'shop-correct',
        'shop-edit',
        'shop-link',
        'shop-receive',
        'shop-remove'
      ].includes(a)
    ) {
      const line = projected.allLines.find(s => s.id === id);
      if (line) h.shopping([line]);
    }
    return;
  }
  let carId = request.carId;
  if (a === 'reports' && !id && e.selected?.length === 1) carId = e.selected[0];
  // Resolve stable identities, never names or the currently displayed page.
  const typed = require('./editor-query.cjs').bucket(a),
    targetId = id || (typed === 'jobs' ? request.jobId : null);
  if (targetId)
    for (const bucket of typed
      ? [typed]
      : ['cars', 'parts', 'supplies', 'jobs', 'setups', 'tests', 'documents', 'assemblies']) {
      const value = h.add(bucket, targetId);
      if (value) {
        if (bucket === 'cars') carId = targetId;
        else if (value.carId) carId = value.carId;
      }
    }
  // Editors only need document metadata; never send full PDF/image bytes to rename or remove a guide.
  data.documents = data.documents.map(d => {
    const out = pick(d, ['id', 'guide', 'carId', 'name', 'mime', 'size', 'title', 'category', 'added', 'updated']);
    require('./lazy-assets.cjs').copyProperty(out, 'picture', d);
    return out;
  });
  if (carId) h.add('cars', carId);
  if (carId && ['factory-specs', 'slotcar-research', 'slotcar-kit', 'slotcar-pick'].includes(a)) h.installations(carId);
  if (['guide-add', 'guide-edit', 'car-compare', 'reports', 'export-selected'].includes(a)) h.chooseCars(true);
  if (
    [
      'install-part',
      'install-stock',
      'install-assembly',
      'new-job',
      'maintenance-job',
      'shelf-new',
      'shelf-edit',
      'send-selected',
      'select-filtered'
    ].includes(a)
  )
    h.chooseCars();
  if (
    ['add-assembly', 'replace-assembly', 'install-part', 'install-stock', 'receive-stock', 'shop-receive'].includes(a)
  ) {
    h.stock();
    h.chooseCars();
  }
  if (['shop-add', 'new-job', 'maintenance-job'].includes(a)) {
    data.jobs = db.jobs.filter(j => j.status === 'active').map(j => pick(j, ['id', 'carId', 'name', 'status']));
    h.chooseCars();
  }
  if (a === 'select-filtered' || (a === 'reports' && !id && !e.selected?.length)) {
    const result = r.list('cars', {
      collectionStatus: request.collectionStatus ?? 'collection',
      query: request.query || '',
      usage: request.usage || [],
      matchAll: !!request.matchAll,
      archived: !!request.archived,
      sort: request.sort || 'name',
      direction: request.sortDirection,
      limit: 200,
      idsOnly: true
    });
    if (result.total > 1000) throw fault('QUERY_LIMIT', 'Narrow the filters to 1,000 cars or fewer.');
    const ids = [...result.rows];
    for (let offset = 200; offset < result.total; offset += 200)
      ids.push(
        ...r.list('cars', {
          collectionStatus: request.collectionStatus ?? 'collection',
          query: request.query || '',
          usage: request.usage || [],
          matchAll: !!request.matchAll,
          archived: !!request.archived,
          sort: request.sort || 'name',
          direction: request.sortDirection,
          offset,
          limit: 200,
          idsOnly: true
        }).rows
      );
    const map = new Map(pageQuery.cars(r).map(c => [c.id, c]));
    data.cars = ids.map(id => carChoice(map.get(id)));
    data._view.list = { total: ids.length, limit: 1000, offset: 0, nextOffset: null };
  }
  if (['add-part', 'edit-part'].includes(a))
    data._view.partSuggestions = require('./editor-query.cjs').suggestions(r, 'parts');
  if (['add-supply', 'edit-supply'].includes(a))
    data._view.supplySuggestions = require('./editor-query.cjs').suggestions(r, 'supplies');
  if (['add-car', 'edit-car'].includes(a))
    data._view.carCustomChoices = require('./editor-query.cjs').customChoices(r, data.customFields);
  if (['new-job', 'maintenance-job'].includes(a))
    data.setups = db.setups.map(s => pick(s, ['id', 'carId', 'name', 'date']));
  if (a === 'compare-setup' && carId) h.related('setups', carId);
  if (['add-test', 'reports'].includes(a) && carId)
    data.setups = pageQuery.descriptors(
      r,
      'setups',
      ['carId', 'name', 'date', 'track'],
      pageQuery.relatedIds(r, 'setups', carId)
    );
  if (a === 'compare-setup' && carId) {
    h.installations(carId);
    h.related('tests', carId);
    h.related('jobs', carId);
  }
  if (a === 'add-work' && carId)
    data.events = db.events.filter(v => v.carId === carId && v.task).map(v => pick(v, ['id', 'carId', 'task']));

  if (a === 'receive-stock') data.planning.shopping = cloneJSON(db.planning.shopping.filter(s => s.partId === id));

  if (a.startsWith('shelf-')) data.planning.shelves = cloneJSON(db.planning.shelves);
  if (a === 'rebuild-start') {
    h.chooseCars();
    data.jobs = db.jobs.map(j => pick(j, ['id', 'carId', 'status', 'category', 'kind']));
  }
  if (a === 'build-load-draft') {
    const d = db.buildDrafts.find(d => d.id === id);
    if (d) data.buildDrafts = [cloneJSON(d)];
  }
  if (a === 'build-assemblies' || a === 'build-use-assembly') {
    data.assemblies = pageQuery
      .descriptors(r, 'assemblies', ['name', 'carId', 'location', 'dismantled', 'components'])
      .filter(a => !a.dismantled);
    const full = new Map(data.parts.map(p => [p.id, p]));
    for (const p of pageQuery.descriptors(
      r,
      'parts',
      ['name', 'quantity', 'tracking'],
      data.assemblies.flatMap(a => a.components.map(c => c.partId))
    ))
      if (!full.has(p.id)) full.set(p.id, p);
    data.parts = [...full.values()];
    data._view.available = pageQuery.availability(r, data.parts);
  }
  if (a === 'compare-pace') {
    data._view.paceRuns = [
      ...r.db
        .prepare("SELECT json_extract(json,'$._query.runs') runs FROM query_sessions")
        .all()
        .flatMap(row => JSON.parse(row.runs || '[]')),
      ...require('../renderer/pace-model.js').runs({ ...db, timing: { sessions: [] } })
    ];
    h.chooseCars();
    const ids = new Set(data._view.paceRuns.map(run => run.carId)),
      originals = new Map(db.cars.map(c => [c.id, c]));
    for (const c of data.cars)
      if (ids.has(c.id)) require('./lazy-assets.cjs').copyProperty(c, 'picture', originals.get(c.id));
  }
  // Catalogue matches are requested explicitly by the selected incoming row.
  if (a === 'catalogue-product')
    for (const bucket of ['parts', 'supplies']) for (const key of e.matchIds || []) h.add(bucket, key);
  // Job plans and photo framing are projected once by view-query.
}
module.exports = { extraView, editor, helpers, carChoice, partChoice };
