'use strict';
// Search everything (Ctrl+K): cars, parts, workshop jobs and manuals in the open collection.
//
// Collections stored in SQLite are searched through the database index: only the handful
// of records that are shown get read, so the collection never has to be loaded into memory
// (that would freeze Paddock for a moment on large collections). Older collections that
// are not in SQLite yet are searched in memory with the same rules.
//
// It only reads. Results carry ids and short labels, never photos, notes or private
// documents. Every word typed must appear somewhere in a record (any order, accents ignored).

const LIMIT = 6;
const MAX_QUERY = 200;
const CANDIDATES = 400;

// Car fields that are searched, besides the general search text of the index.
const CAR_FIELDS = [
  'name',
  'number',
  'raceNumber',
  'maker',
  'marque',
  'model',
  'reference',
  'scale',
  'raceClass',
  'livery',
  'team',
  'drivers',
  'category',
  'edition',
  'location'
];
const PART_FIELDS = ['name', 'maker', 'reference', 'partType', 'category', 'location', 'compatibility'];
const SPECIAL = {
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ß: 'ss',
  đ: 'd',
  Đ: 'd',
  þ: 'th',
  Þ: 'th'
};

/** Lower case without accents: "Citroën" matches "citroen", "Ørsted" matches "orsted". */
function fold(value) {
  return String(value ?? '')
    .replace(/[øØłŁæÆœŒßđĐþÞ]/g, ch => SPECIAL[ch])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function words(query) {
  return fold(query).split(/\s+/).filter(Boolean).slice(0, 12);
}

const text = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
const list = value => (Array.isArray(value) ? value.map(text) : [text(value)]);

/**
 * Ranks a record: lower is better, null when a word is missing.
 * An exact reference or name counts most; other fields only need to contain the words.
 */
function rank(title, fields, terms, phrase, reference = '') {
  const name = fold(title);
  const all = [name, ...fields.map(fold)].join(' ');
  if (!terms.every(t => all.includes(t))) return null;
  return nameRank(name, terms, phrase, reference);
}

function nameRank(name, terms, phrase, reference) {
  if (reference && fold(reference) === phrase) return 0;
  if (name === phrase) return 0;
  if (name.startsWith(phrase)) return 1;
  if (terms.every(t => name.includes(t))) return name.split(/[\s\-/]+/).some(w => w.startsWith(terms[0])) ? 2 : 3;
  return 4;
}

function sorted(found) {
  return found.sort((a, b) => a.rank - b.rank || a.order - b.order || a.label.localeCompare(b.label));
}

// What a result shows. Builders only read the fields named here.
function carItem(c) {
  const wishlist = c.collectionStatus === 'wishlist';
  return {
    id: c.id,
    label: text(c.name) || 'Unnamed car',
    detail: [c.maker, c.reference, c.scale, wishlist ? 'Wishlist' : '', c.archived ? 'Archived' : '']
      .map(text)
      .filter(Boolean)
      .join(' · '),
    wishlist,
    archived: !!c.archived
  };
}
function partItem(p) {
  const owned = Number(p.quantity) > 0;
  return {
    id: p.id,
    label: text(p.name) || 'Unnamed part',
    detail: [p.maker, p.reference, p.partType, owned ? `${p.quantity} owned` : 'Catalogue']
      .map(text)
      .filter(Boolean)
      .join(' · '),
    category: text(p.category),
    owned
  };
}
const JOB_STATUS = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };
function jobItem(j, car) {
  return {
    id: j.id,
    label: text(j.name) || 'Workshop job',
    detail: [car, JOB_STATUS[j.status] || ''].filter(Boolean).join(' · ')
  };
}
function guideItem(d, car) {
  return {
    id: d.id,
    label: text(d.title) || text(d.name) || 'Manual',
    detail: [car || 'General reference', text(d.name)].filter(Boolean).join(' · ')
  };
}

function check(query) {
  if (typeof query !== 'string' || query.length > MAX_QUERY) {
    throw Object.assign(Error(`Search for up to ${MAX_QUERY} characters.`), { code: 'INVALID_QUERY' });
  }
}
const empty = () => ({ total: 0, items: [] });

/** In-memory search over a plain collection object (older JSON collections, and tests). */
function search(db, query, { limit = LIMIT } = {}) {
  check(query);
  const terms = words(query),
    phrase = terms.join(' ');
  if (!terms.length) return { query, cars: empty(), parts: empty(), jobs: empty(), guides: empty() };
  const carNames = new Map((db.cars || []).map(c => [c.id, text(c.name)]));
  const pick = found => {
    const hits = sorted(found.filter(x => x.rank !== null));
    return { total: hits.length, items: hits.slice(0, limit).map(x => x.item) };
  };
  const cars = pick(
    (db.cars || [])
      .filter(c => !c.merge)
      .map(c => {
        const item = carItem(c);
        return {
          item,
          label: item.label,
          order: (c.archived ? 2 : 0) + (item.wishlist ? 1 : 0),
          rank: rank(
            c.name,
            [...CAR_FIELDS.flatMap(k => list(c[k])), ...list(c.tags)],
            terms,
            phrase,
            text(c.reference)
          )
        };
      })
  );
  const parts = pick(
    (db.parts || [])
      .filter(p => !p.archived)
      .map(p => {
        const item = partItem(p);
        return {
          item,
          label: item.label,
          order: item.owned ? 0 : 1,
          rank: rank(
            p.name,
            PART_FIELDS.map(k => text(p[k])),
            terms,
            phrase,
            text(p.reference)
          )
        };
      })
  );
  const jobs = pick(
    (db.jobs || []).map(j => {
      const car = carNames.get(j.carId) || '';
      const item = jobItem(j, car);
      return {
        item,
        label: item.label,
        order: j.status === 'active' ? 0 : 1,
        rank: rank(j.name, [car, j.notes].map(text), terms, phrase)
      };
    })
  );
  const guides = pick(
    (db.documents || [])
      .filter(d => d.guide === true)
      .map(d => {
        const car = d.carId ? carNames.get(d.carId) || '' : '';
        const item = guideItem(d, car);
        return { item, label: item.label, order: 0, rank: rank(d.title, [d.name, car].map(text), terms, phrase) };
      })
  );
  return { query, cars, parts, jobs, guides };
}

// ---- SQLite collections: search the index, read only what is shown ----

const field = name =>
  `COALESCE((SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=r.key AND f.path='${JSON.stringify([name])}'),'')`;
// All searched fields of a record in one lookup (much faster than one lookup per field).
const fields = names =>
  `COALESCE((SELECT group_concat(json_extract(f.json,'$'),' ') FROM record_fields f WHERE f.record=r.key AND f.path IN (${names.map(n => `'${JSON.stringify([n])}'`).join(',')})),'')`;
const flag = (name, json) =>
  `EXISTS(SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path='${JSON.stringify([name])}' AND f.json='${json}')`;
const carName = `COALESCE((SELECT c.name FROM query_records c WHERE c.bucket='["cars"]' AND c.key=json_array('cars','id:'||q.car_id)),'')`;

// For each kind: which records, the searchable text, and the fields needed to rank and order.
const KINDS = {
  cars: {
    bucket: 'cars',
    where: `NOT EXISTS(SELECT 1 FROM record_fields f WHERE f.record=r.key AND f.path='["merge"]' AND f.json<>'null')`,
    text: `q.search||' '||${fields(CAR_FIELDS)}`,
    reference: field('reference'),
    order: `q.archived*2+${flag('collectionStatus', '"wishlist"')}`
  },
  parts: {
    bucket: 'parts',
    where: 'q.archived=0',
    text: `q.search||' '||${fields(PART_FIELDS)}`,
    reference: field('reference'),
    order: `CASE WHEN COALESCE(json_extract(q.aux,'$.quantity'),0)>0 THEN 0 ELSE 1 END`
  },
  jobs: {
    bucket: 'jobs',
    where: '1',
    text: `${fields(['name', 'notes'])}||' '||${carName}`,
    reference: `''`,
    order: `CASE WHEN q.status='active' THEN 0 ELSE 1 END`
  },
  guides: {
    bucket: 'documents',
    where: flag('guide', 'true'),
    text: `${fields(['title', 'name'])}||' '||${carName}`,
    reference: `''`,
    order: '0'
  }
};

const candidateSql = kind =>
  `SELECT r.key key,${kind === 'guides' ? `COALESCE(NULLIF(${field('title')},''),${field('name')})` : field('name')} label,${KINDS[kind].reference} reference,${KINDS[kind].order} ord,${KINDS[kind].text} text
    FROM records r JOIN query_records q ON q.key=r.key WHERE q.bucket=? AND ${KINDS[kind].where}`;

// Above this many records of one kind, each search asks the database instead of keeping
// every record's searchable text in memory.
const REMEMBER_UP_TO = 20000;

/**
 * Every record of a kind with its searchable text already folded, in the database's own
 * order. Preparing this reads a few fields of every record, which is nearly all the work of
 * a search; it is remembered for the revision, so the next keystroke only compares text.
 * Null when there are too many records to keep.
 */
function prepared(reader, kind, upTo) {
  return require('./revision-memory.cjs').remember(reader, 'search:' + kind, () => {
    const bucket = JSON.stringify([KINDS[kind].bucket]);
    if (reader.db.prepare('SELECT count(*) n FROM query_records WHERE bucket=?').get(bucket).n > upTo) return null;
    return reader.db
      .prepare(candidateSql(kind))
      .all(bucket)
      .map(row => ({ key: row.key, label: row.label, reference: row.reference, ord: row.ord, text: fold(row.text) }));
  });
}

/** The first candidates that contain every word, and how many records match in all. */
function candidates(reader, kind, terms, rememberUpTo = REMEMBER_UP_TO) {
  const all = prepared(reader, kind, rememberUpTo);
  if (all) {
    const matches = all.filter(row => terms.every(t => row.text.includes(t)));
    return { rows: matches.slice(0, CANDIDATES + 1), total: matches.length };
  }
  const bucket = JSON.stringify([KINDS[kind].bucket]);
  const conditions = terms.map(() => 'instr(sf_fold(text),?)>0').join(' AND ');
  const sql = `SELECT key,label,reference,ord FROM (${candidateSql(kind)}) WHERE ${conditions}`;
  const rows = reader.db.prepare(`${sql} LIMIT ${CANDIDATES + 1}`).all(bucket, ...terms);
  return {
    rows,
    total:
      rows.length > CANDIDATES
        ? reader.db.prepare(`SELECT count(*) n FROM (${sql})`).get(bucket, ...terms).n
        : rows.length
  };
}

function searchIndex(reader, kind, terms, phrase, limit) {
  const { rows, total } = candidates(reader, kind, terms);
  const ranked = sorted(
    rows.map(row => ({
      key: row.key,
      label: String(row.label || ''),
      order: Number(row.ord) || 0,
      rank: nameRank(fold(row.label), terms, phrase, String(row.reference || ''))
    }))
  );
  const items = [];
  for (const hit of ranked.slice(0, limit)) {
    const record = reader.record(hit.key, { assetHandle: true });
    if (!record) continue;
    const car =
      (kind === 'jobs' || kind === 'guides') && record.carId ? text(reader.one('cars', record.carId)?.name) : '';
    items.push(
      kind === 'cars'
        ? carItem(record)
        : kind === 'parts'
          ? partItem(record)
          : kind === 'jobs'
            ? jobItem(record, car)
            : guideItem(record, car)
    );
  }
  return { total, items };
}

/**
 * Searches the open collection. Uses the database index when the collection is stored
 * in SQLite, so nothing is loaded into memory; otherwise searches the in-memory data.
 */
function searchStore(store, query, { limit = LIMIT } = {}) {
  check(query);
  if (!store.file || store.expectedIdentity === null || !store.deferredState)
    return search(store.data, query, { limit });
  const terms = words(query),
    phrase = terms.join(' ');
  if (!terms.length) return { query, cars: empty(), parts: empty(), jobs: empty(), guides: empty() };
  return require('./sqlite-query.cjs').read(store, null, reader => {
    reader.db.function('sf_fold', { deterministic: true }, value => fold(value));
    const out = { query };
    for (const kind of Object.keys(KINDS)) out[kind] = searchIndex(reader, kind, terms, phrase, limit);
    return out;
  }).value;
}

module.exports = { search, searchStore, candidates, fold, words, rank, LIMIT, MAX_QUERY };
