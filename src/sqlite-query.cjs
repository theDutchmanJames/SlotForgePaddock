'use strict';
// Read-only, revision-bound application queries. SQL identifiers and ordering
// expressions are allowlisted; values never become SQL text.
const { DatabaseSync } = require('node:sqlite');
const records = require('./sqlite-records.cjs'),
  lazy = require('./lazy-assets.cjs');
const buckets = new Set([
  'cars',
  'parts',
  'events',
  'setups',
  'tests',
  'jobs',
  'installations',
  'assemblies',
  'documents',
  'submissions',
  'supplies',
  'views'
]);
const fault = (code, message) => Object.assign(new Error(message), { code });
class Reader {
  constructor(file, expected) {
    this.file = file;
    this.db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
    this.reads = 0;
    this.db.function('sf_sort_text', { deterministic: true }, value => String(value || '').toLowerCase());
    try {
      this.db.exec('BEGIN');
      const value = this.db.prepare("SELECT value FROM state WHERE key='identity'").get();
      if (!value) throw fault('QUERY_UNAVAILABLE', 'This collection has not been saved.');
      [this.id, this.revision] = JSON.parse(value.value);
      this.epoch = this.db.prepare("SELECT value FROM state WHERE key='change_epoch'").get()?.value;
      if (expected && (expected.id !== this.id || expected.revision !== this.revision || expected.epoch !== this.epoch))
        throw fault('QUERY_CHANGED', 'The collection changed. Refresh this page.');
      this.token = { id: this.id, revision: this.revision, epoch: this.epoch };
      require('./car-merge-query.cjs').install(this);
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  record(key, { assetHandle = false } = {}) {
    const row = this.db.prepare('SELECT json FROM records WHERE key=?').get(key);
    if (!row) return null;
    this.reads++;
    const envelope = records.decode(
      row.json,
      this.db
        .prepare('SELECT path,json FROM record_fields WHERE record=?')
        .all(key)
        .map(r => [r.path, r.json])
    );
    const expected = new Set(envelope.refs.map(ref => ref.hash)),
      actual = new Set(
        this.db
          .prepare('SELECT hash FROM asset_refs WHERE record=?')
          .all(key)
          .map(r => r.hash)
      );
    if (expected.size !== actual.size || [...expected].some(hash => !actual.has(hash)))
      throw Error('Attachment reference integrity check failed.');
    for (const ref of envelope.refs) {
      // A description verified earlier is reused (see lazy-assets.cjs): reading it again
      // would pull the whole attachment off disk. Existence is still checked, from the index.
      let meta = lazy.remembered(this.file, this.epoch, ref.hash);
      if (meta) {
        this.assetExists ??= this.db.prepare('SELECT 1 FROM assets WHERE hash=?');
        if (!this.assetExists.get(ref.hash)) throw Error('Missing attachment.');
      } else {
        this.assetInfo ??= this.db.prepare('SELECT meta,meta_digest,length(value) size FROM assets WHERE hash=?');
        const row = this.assetInfo.get(ref.hash);
        if (!row) throw Error('Missing attachment.');
        meta = JSON.parse(row.meta);
        if (lazy.digest(row.meta) !== row.meta_digest || !lazy.valid(meta, ref.hash, row.size))
          throw Error('Attachment metadata integrity check failed.');
        lazy.remember(this.file, this.epoch, ref.hash, meta);
      }
      const asset = lazy.asset(this.file, meta);
      if (!ref.path.length) {
        envelope.value = assetHandle ? asset : asset.read();
        continue;
      }
      let owner = envelope.value;
      for (const k of ref.path.slice(0, -1)) {
        if (!owner || !Object.hasOwn(owner, k)) throw Error('Invalid attachment reference.');
        owner = owner[k];
      }
      if (!owner || !Object.hasOwn(owner, ref.path.at(-1))) throw Error('Invalid attachment reference.');
      lazy.attach(owner, ref.path.at(-1), asset);
    }
    return envelope.value;
  }
  one(bucket, id) {
    if (!buckets.has(bucket)) throw fault('INVALID_QUERY', 'Unknown record type.');
    return this.record(JSON.stringify([bucket, 'id:' + id]));
  }
  scalar(...path) {
    return this.record(JSON.stringify(path));
  }
  list(bucket, options = {}) {
    // Which records match is remembered for this revision (see revision-memory.cjs): going
    // back to a list, or opening a part from it, asks the same question again. The records
    // themselves are always read afresh.
    const found = options.ids
      ? this.matching(bucket, options)
      : require('./revision-memory.cjs').remember(this, 'list:' + JSON.stringify([bucket, options]), () =>
          this.matching(bucket, options)
        );
    const offset = options.offset ?? 0;
    return {
      rows: found.keys.map(key => (options.idsOnly ? JSON.parse(key)[1].slice(3) : this.record(key))),
      total: found.total,
      nextOffset: offset + found.keys.length < found.total ? offset + found.keys.length : null,
      token: this.token
    };
  }
  /** The keys of one page of matching records, and how many match in all. */
  matching(bucket, options = {}) {
    if (!buckets.has(bucket)) throw fault('INVALID_QUERY', 'Unknown record type.');
    const {
      offset = 0,
      limit = 50,
      sort = 'order',
      query = '',
      carId,
      archived,
      status,
      ids,
      usage = [],
      matchAll = false
    } = options;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      typeof query !== 'string' ||
      query.length > 500 ||
      !['order', 'name', 'maker', 'updated', 'date', 'marque', 'model', 'scale', 'reference', 'created'].includes(
        sort
      ) ||
      (options.direction !== undefined && !['asc', 'desc'].includes(options.direction)) ||
      !Array.isArray(usage) ||
      usage.length > 100 ||
      usage.some(v => typeof v !== 'string') ||
      (ids && (!Array.isArray(ids) || ids.length > 10000 || ids.some(v => typeof v !== 'string')))
    )
      throw fault('INVALID_QUERY', 'Invalid record query.');
    const where = ['r.bucket=?'],
      params = [JSON.stringify([bucket])];
    for (const [field, value] of Object.entries({
      category: options.category,
      partType: options.partType,
      partId: options.partId,
      removed: options.removed
    })) {
      if (value !== undefined) {
        where.push(`json_extract(q.aux,'$.${field}')=?`);
        params.push(typeof value === 'boolean' ? Number(value) : value);
      }
    }
    if (options.hasField) where.push("json_extract(q.aux,'$.field')<>''");
    if (options.owned) {
      where.push("json_extract(q.aux,'$.quantity')>0");
    }
    if (options.types) {
      if (!Array.isArray(options.types) || options.types.length > 20)
        throw fault('INVALID_QUERY', 'Invalid event types.');
      where.push('q.type IN (' + options.types.map(() => '?').join(',') + ')');
      params.push(...options.types);
    }
    if (carId !== undefined) {
      where.push('q.car_id=?');
      params.push(carId);
    }
    if (options.guides) {
      where.push(
        "EXISTS (SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path='[\"guide\"]' AND f.json='true')"
      );
    }
    if (options.generalGuide) where.push('q.car_id IS NULL');
    if (options.guideQuery) {
      if (typeof options.guideQuery !== 'string' || options.guideQuery.length > 500)
        throw fault('INVALID_QUERY', 'Invalid guide search.');
      where.push(
        "EXISTS (SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path IN ('[\"title\"]','[\"name\"]') AND instr(sf_sort_text(json_extract(f.json,'$')),?)>0)"
      );
      params.push(options.guideQuery.toLowerCase());
    }
    if (options.maker !== undefined) {
      if (typeof options.maker !== 'string') throw fault('INVALID_QUERY', 'Invalid manufacturer.');
      where.push('q.maker=?');
      params.push(options.maker.toLowerCase());
    }
    if (options.unowned) where.push("json_extract(q.aux,'$.quantity')=0");
    if (options.collectionStatus !== undefined) {
      if (bucket !== 'cars' || !['collection', 'wishlist'].includes(options.collectionStatus))
        throw fault('INVALID_QUERY', 'Invalid collection status filter.');
      const wish =
        'EXISTS (SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path=\'["collectionStatus"]\' AND f.json=\'"wishlist"\')';
      where.push(options.collectionStatus === 'wishlist' ? wish : 'NOT ' + wish);
    }
    if (archived !== undefined) {
      where.push('q.archived=?');
      params.push(archived ? 1 : 0);
    }
    if (status !== undefined) {
      where.push('q.status=?');
      params.push(status);
    }
    if (options.notStatus !== undefined) {
      where.push('q.status<>?');
      params.push(options.notStatus);
    }
    if (options.dismantled !== undefined) {
      where.push("json_extract(q.aux,'$.dismantled')=?");
      params.push(Number(options.dismantled));
    }
    if (options.jobCategory) {
      where.push("COALESCE(NULLIF(json_extract(q.aux,'$.category'),''),'general')=?");
      params.push(options.jobCategory);
    }
    if (options.partTypes?.length) {
      where.push("json_extract(q.aux,'$.partType') IN (SELECT value FROM json_each(?))");
      params.push(JSON.stringify(options.partTypes));
    }
    if (options.lowSupply)
      where.push(
        `EXISTS(SELECT 1 FROM record_fields k JOIN record_fields a ON a.record=k.record AND a.path='["remaining"]' JOIN record_fields b ON b.record=k.record AND b.path='["minimum"]' WHERE k.record=r.key AND k.path='["kind"]' AND k.json='"Consumable"' AND json_extract(a.json,'$')<=json_extract(b.json,'$'))`
      );
    if (options.excludeAssembled)
      where.push(
        `substr(r.identity,4) NOT IN(SELECT json_extract(c.value,'$.partId') FROM query_records a JOIN record_fields f ON f.record=a.key AND f.path='["components"]',json_each(f.json) c WHERE a.bucket='["assemblies"]' AND json_extract(a.aux,'$.dismantled')=0 AND json_extract(c.value,'$.partId') IS NOT NULL)`
      );
    if (options.searchFields) {
      const allowed = new Set(['name', 'maker', 'reference', 'partType', 'location']);
      if (
        !Array.isArray(options.searchFields) ||
        options.searchFields.some(k => !allowed.has(k)) ||
        !Array.isArray(options.searchTerms) ||
        options.searchTerms.some(t => typeof t !== 'string' || t.length > 500)
      )
        throw fault('INVALID_QUERY', 'Invalid field search.');
      // The fixed field order preserves substring matching across field boundaries.
      const text = options.searchFields
        .map(
          k =>
            `COALESCE((SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=r.key AND f.path='["${k}"]'),'')`
        )
        .join("||' '||");
      for (const term of options.searchTerms.filter(Boolean)) {
        where.push(`instr(sf_sort_text(${text}),?)>0`);
        params.push(term.toLowerCase());
      }
    }
    if (ids) {
      if (!ids.length) return { keys: [], total: 0 };
      where.push(`r.identity IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids.map(id => 'id:' + id));
    }
    if (query) {
      where.push('instr(q.search,?)>0');
      params.push(query.toLowerCase());
    }
    if (usage.length) {
      const checks = usage.map(() => 'EXISTS (SELECT 1 FROM json_each(q.usage) u WHERE u.value=?)');
      where.push('(' + checks.join(matchAll ? ' AND ' : ' OR ') + ')');
      params.push(...usage);
    }
    // The manifest is the authoritative order for compatibility with existing
    // collection exports. JSON_each visits only record references, never bodies.
    const from = ` FROM records r JOIN query_records q ON q.key=r.key WHERE ${where.join(' AND ')}`;
    // A field search looks up several fields for every record, so matching is the expensive
    // part. Counting and fetching separately would do it twice; instead fetch every matching
    // key in order once, then count and cut the page here. The result is the same.
    const onePass = !options.countOnly && !!options.searchFields && options.searchTerms.some(Boolean);
    let total = onePass ? 0 : this.db.prepare('SELECT count(*) n' + from).get(...params).n;
    const page = onePass ? '' : ' LIMIT ? OFFSET ?',
      window = onePass ? [] : [limit, offset];
    let keys = [];
    if (!options.countOnly) {
      if (sort === 'order') {
        // Fix the loop order: otherwise SQLite can scan all manifest ordinals for
        // every matching record (quadratic at thousands of cars/history entries).
        // CROSS JOIN still uses the equality predicates and primary-key lookups.
        const sql = `WITH ordinals AS MATERIALIZED (SELECT json_extract(a.value,'$.record') key,CAST(a.key AS INTEGER) position
     FROM json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')=?),'$[1].array') a)
     SELECT r.key FROM ordinals o CROSS JOIN records r ON r.key=o.key CROSS JOIN query_records q ON q.key=r.key WHERE ${where.join(' AND ')} ORDER BY o.position${page}`;
        keys = this.db.prepare(sql).all(bucket, ...params, ...window);
      } else {
        const scalar = ['marque', 'model', 'scale', 'reference', 'created'].includes(sort);
        const expression = scalar
          ? `COALESCE((SELECT sf_sort_text(json_extract(f.json,'$')) FROM record_fields f WHERE f.record=r.key AND f.path='["${sort}"]'),'')`
          : `q.${sort}`;
        const direction =
          options.direction?.toUpperCase() || (['date', 'updated', 'created'].includes(sort) ? 'DESC' : 'ASC');
        const ranking = options.rankReference
          ? `(COALESCE((SELECT sf_sort_text(json_extract(f.json,'$')) FROM record_fields f WHERE f.record=r.key AND f.path='["reference"]'),'')=?) DESC,`
          : '';
        keys = this.db
          .prepare(
            'SELECT r.key' +
              from +
              ` ORDER BY ${ranking}(${expression}='') ASC,${expression} ${direction},r.identity ASC${page}`
          )
          .all(...params, ...(ranking ? [options.rankReference] : []), ...window);
      }
      if (onePass) {
        total = keys.length;
        keys = keys.slice(offset, offset + limit);
      }
    }
    return { keys: keys.map(r => r.key), total };
  }
  count(bucket, options = {}) {
    return this.list(bucket, { ...options, countOnly: true }).total;
  }
  // The newest maintenance record per car and task, when it sets a next due date and/or a
  // lap interval. Rows: {key,due,carId,laps:{driven,interval,reached}|null}; due ones first.
  reminders() {
    if (this.cachedReminders) return this.cachedReminders;
    const rows = this.db
      .prepare(
        `WITH ordinals AS MATERIALIZED (SELECT json_extract(a.value,'$.record') key,CAST(a.key AS INTEGER) ordinal FROM json_each((SELECT m.value FROM json_each((SELECT value FROM state WHERE key='manifest'),'$.object') m WHERE json_extract(m.value,'$[0]')='events'),'$[1].array') a), ranked AS (SELECT q.key,q.car_id,q.due,(SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=q.key AND f.path='["nextDueLaps"]') laps,row_number() OVER(PARTITION BY q.car_id,q.task ORDER BY q.rank DESC,o.ordinal) n FROM query_records q JOIN ordinals o ON o.key=q.key WHERE q.bucket='["events"]' AND q.type='maintenance') SELECT ranked.key,ranked.due,ranked.car_id carId,ranked.laps FROM ranked JOIN query_records c ON c.key=json_array('cars','id:'||ranked.car_id) WHERE n=1 AND (ranked.due<>'' OR ranked.laps IS NOT NULL) AND c.archived=0 AND NOT EXISTS(SELECT 1 FROM record_fields f WHERE f.record=c.key AND f.path='["collectionStatus"]' AND f.json='"wishlist"') ORDER BY ranked.due,ranked.key`
      )
      .all();
    return (this.cachedReminders = require('./lap-reminders.cjs').attach(this, rows));
  }
  summary() {
    const rows = this.db.prepare('SELECT * FROM query_totals').all();
    const sum = (bucket, field, filter = () => true) =>
        rows.filter(r => r.bucket === JSON.stringify([bucket]) && filter(r)).reduce((n, r) => n + (r[field] || 0), 0),
      reminders = this.reminders(),
      fitted = sum('installations', 'fitted');
    return {
      cars:
        sum('cars', 'n', r => !r.archived) -
        this.db
          .prepare(
            'SELECT count(*) n FROM record_fields f JOIN query_records q ON q.key=f.record WHERE f.path=\'["collectionStatus"]\' AND f.json=\'"wishlist"\' AND length(f.json)<=512 AND q.bucket=\'["cars"]\' AND q.archived=0'
          )
          .get().n,
      parts: sum('parts', 'owned'),
      catalogue: sum('parts', 'n'),
      available: sum('parts', 'quantity') - fitted - sum('assemblies', 'reserved'),
      jobs: sum('jobs', 'n', r => r.status === 'active'),
      incoming: sum('submissions', 'incoming'),
      maintenance: reminders.length,
      due: reminders.filter(r => require('./lap-reminders.cjs').due(r)).length
    };
  }
}
function read(store, expected, fn) {
  if (!store.file || store.expectedIdentity === null)
    throw fault('QUERY_UNAVAILABLE', 'Save this collection before querying it.');
  const reader = new Reader(store.file, expected);
  try {
    if (reader.id !== store.data.id || reader.revision !== store.data.revision)
      throw fault('QUERY_CHANGED', 'The collection is being saved. Refresh this page.');
    const value = fn(reader);
    return { value, token: reader.token, recordReads: reader.reads };
  } finally {
    reader.close();
  }
}
module.exports = { Reader, read, fault };
