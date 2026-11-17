'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { DatabaseSync } = require('node:sqlite');
const F = require('./spreadsheet-fields.cjs'),
  P = require('./catalogue-picture-requests.cjs'),
  W = require('./spreadsheet-worker.cjs'),
  C = require('./catalogue-pictures-contract.cjs');
const hash = C.digest;
const selected = (data, keys) => {
  const out = {};
  for (const id of keys) {
    const [a, b] = id.split('.');
    if (b) {
      if (Object.hasOwn(data[a] || {}, b)) (out[a] ??= {})[b] = data[a][b];
    } else if (Object.hasOwn(data, a)) out[a] = data[a];
  }
  return out;
};
class SpreadsheetImports {
  constructor({ profile, getStore, club, onChange = () => {} }) {
    this.file = path.join(profile, 'spreadsheet-imports.sqlite');
    fs.mkdirSync(profile, { recursive: true });
    this.getStore = getStore;
    this.club = club;
    this.onChange = onChange;
    this.busy = false;
    this.work = null;
    this.generation = 0;
    this.closed = false;
  }
  use(fn) {
    const db = new DatabaseSync(this.file, { timeout: 5000 });
    try {
      db.exec(
        'PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,database_id TEXT NOT NULL,source_hash TEXT NOT NULL,state TEXT NOT NULL,json TEXT NOT NULL,UNIQUE(database_id,source_hash)) STRICT; CREATE TABLE IF NOT EXISTS progress(import_id TEXT NOT NULL,row_number INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(import_id,row_number)) STRICT'
      );
      return fn(db);
    } finally {
      db.close();
    }
  }
  active() {
    return P.withReader(this.getStore(), (_r, a) => a);
  }
  get(id) {
    if (typeof id !== 'string') throw Error('Choose a spreadsheet import');
    const job = this.use(db => db.prepare('SELECT json FROM imports WHERE id=?').get(id));
    if (!job) throw Error('Spreadsheet import not found');
    const j = JSON.parse(job.json),
      indices = new Map(j.rows.map((r, i) => [r.row, i]));
    for (const r of this.use(db => db.prepare('SELECT row_number,json FROM progress WHERE import_id=?').all(id))) {
      const index = indices.get(r.row_number);
      if (index !== undefined) j.rows[index] = JSON.parse(r.json);
    }
    return j;
  }
  save(job) {
    const text = JSON.stringify(job);
    if (Buffer.byteLength(text) > 32 * 1024 * 1024)
      throw Error('The import exceeds the 32 MiB review limit; split the spreadsheet');
    this.use(db => {
      const total = db
        .prepare('SELECT coalesce(sum(length(CAST(json AS BLOB))),0) n FROM imports WHERE id<>?')
        .get(job.id).n;
      if (total + Buffer.byteLength(text) > 128 * 1024 * 1024)
        throw Error('Saved spreadsheet imports are full. Remove completed imports first.');
      db.exec('BEGIN IMMEDIATE');
      db.prepare(
        'INSERT INTO imports VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,json=excluded.json'
      ).run(job.id, job.databaseId, job.sourceHash, job.state, text);
      db.prepare('DELETE FROM progress WHERE import_id=?').run(job.id);
      db.exec('COMMIT');
    });
    this.onChange();
  }
  rowSave(id, row) {
    this.use(db =>
      db
        .prepare(
          'INSERT INTO progress VALUES(?,?,?) ON CONFLICT(import_id,row_number) DO UPDATE SET json=excluded.json'
        )
        .run(id, row.row, JSON.stringify(row))
    );
  }
  stateSave(id, state, error = '') {
    this.use(db =>
      db
        .prepare("UPDATE imports SET state=?,json=json_set(json,'$.state',?,'$.error',?) WHERE id=?")
        .run(state, state, error, id)
    );
    this.onChange();
  }
  guard(job) {
    const a = this.active();
    if (a.databaseId !== job.databaseId || a.recoveryId !== job.recoveryId)
      throw Error('The collection was changed or restored. This saved import cannot be replayed into it.');
    if (this.closed) throw Error('Spreadsheet imports are closing');
  }
  idle() {
    if (this.busy || this.work) throw Error('Wait for the current spreadsheet operation to finish');
  }
  async edit(fn) {
    this.idle();
    this.busy = true;
    const generation = this.generation;
    try {
      return await fn(() => {
        if (this.closed || generation !== this.generation) throw Error('Spreadsheet operation cancelled');
      });
    } finally {
      this.busy = false;
    }
  }
  list() {
    const active = this.active();
    return this.use(db =>
      db
        .prepare('SELECT id,state,json FROM imports WHERE database_id=? ORDER BY rowid DESC')
        .all(active.databaseId)
        .map(r => {
          const j = this.get(r.id);
          return {
            id: r.id,
            name: j.name,
            state: j.state,
            total: j.rows?.length || 0,
            done: j.rows?.filter(r => r.result).length || 0,
            recoveryChanged: j.recoveryId !== active.recoveryId
          };
        })
    );
  }
  view(id, offset = 0, filter = 'all') {
    const j = this.get(id);
    if (!Number.isInteger(offset) || offset < 0) throw Error('Invalid review page');
    if (!['all', 'new', 'matches', 'attention'].includes(filter)) throw Error('Invalid review filter');
    const active = this.active();
    if (j.databaseId !== active.databaseId) throw Error('Open the original collection');
    const available = F.fields(this.getStore().data.customFields);
    const sheet = j.workbook.sheets[j.config.sheet] || j.workbook.sheets[0],
      width = Math.max(...sheet.rows.map(r => r.length), 0),
      headers = Array.from(
        { length: width },
        (_, i) => sheet.rows[j.config.header - 1]?.[i]?.text || 'Column ' + (i + 1)
      );
    const rows = j.rows || [],
      matches = r => r.candidates.length > 0 || r.duplicate,
      attention = r => r.errors.length > 0 || !!r.error;
    const filtered = rows.filter(
      r =>
        filter === 'all' ||
        (filter === 'matches' && matches(r)) ||
        (filter === 'new' && !matches(r)) ||
        (filter === 'attention' && attention(r))
    );
    offset = Math.min(Math.floor(offset / 40) * 40, Math.max(0, Math.floor((filtered.length - 1) / 40) * 40));
    const counts = {
      all: rows.length,
      new: rows.filter(r => !matches(r)).length,
      matches: rows.filter(matches).length,
      attention: rows.filter(attention).length,
      create: rows.filter(r => !r.result && r.choice === 'new' && !r.errors.length).length,
      update: rows.filter(r => !r.result && !['skip', 'new'].includes(r.choice) && !r.errors.length).length,
      skipped: rows.filter(r => r.choice === 'skip' && !r.result).length,
      imported: rows.filter(r => r.result?.status === 'imported').length,
      submitted: rows.filter(r => r.result?.status === 'submitted').length
    };
    return {
      id: j.id,
      name: j.name,
      state: j.state,
      config: j.config,
      fields: available,
      sheets: j.workbook.sheets.map((s, index) => ({ index, name: s.name, rows: s.rows.length })),
      headers,
      sample: sheet.rows.slice(Math.max(0, j.config.header - 1), j.config.header + 4).map(r => r.map(c => c.text)),
      samples: Array.from({ length: width }, (_, i) =>
        sheet.rows.slice(j.config.header, j.config.header + 3).map(r => r[i]?.text || '')
      ),
      previewTotal: sheet.rows.length - j.config.header,
      previewToken: hash([j.sourceHash, j.config.sheet, j.config.header, j.workbook.delimiter || '']),
      previewRows: sheet.rows
        .slice(j.config.header, j.config.header + 80)
        .map((r, i) => ({
          row: j.config.header + i + 1,
          cells: Array.from({ length: width }, (_, c) => r[c]?.text || '')
        })),
      sourceRows: sheet.rows.slice(j.config.header).filter(r => r.some(c => String(c.text ?? '').trim() || c.issue))
        .length,
      rows: filtered.slice(offset, offset + 40),
      total: rows.length,
      filteredTotal: filtered.length,
      filter,
      counts,
      offset,
      ready: counts.create + counts.update,
      done: counts.imported + counts.submitted,
      failed: rows.filter(r => r.error).length,
      work: this.work?.id === id,
      recoveryChanged: j.recoveryId !== active.recoveryId,
      locked: !!rows.some(r => r.attempt),
      error: j.error || '',
      delimiter: j.workbook.delimiter
    };
  }
  previewRows(id, offset, token) {
    const j = this.get(id);
    if (j.databaseId !== this.active().databaseId) throw Error('Open the original collection');
    const expected = hash([j.sourceHash, j.config.sheet, j.config.header, j.workbook.delimiter || '']);
    if (token !== expected) throw Error('The spreadsheet layout changed. Reopen its preview.');
    const sheet = j.workbook.sheets[j.config.sheet],
      total = sheet.rows.length - j.config.header,
      width = Math.max(...sheet.rows.map(r => r.length), 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > total) throw Error('Invalid spreadsheet preview row');
    return {
      offset,
      total,
      token: expected,
      rows: sheet.rows
        .slice(j.config.header + offset, j.config.header + offset + 80)
        .map((r, i) => ({
          row: j.config.header + offset + i + 1,
          cells: Array.from({ length: width }, (_, c) => r[c]?.text || '')
        }))
    };
  }
  async pick(file) {
    return this.edit(async check => {
      const active = this.active(),
        extension = path.extname(file).toLowerCase(),
        handle = await fs.promises.open(file, 'r');
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > require('./spreadsheet-parser.cjs').MAX_FILE)
          throw Error('Choose a file of at most 16 MiB');
        const buffer = Buffer.alloc(require('./spreadsheet-parser.cjs').MAX_FILE + 1);
        let size = 0;
        while (size < buffer.length) {
          const read = await handle.read(buffer, size, buffer.length - size, null);
          if (!read.bytesRead) break;
          size += read.bytesRead;
        }
        if (size > require('./spreadsheet-parser.cjs').MAX_FILE) throw Error('Choose a file of at most 16 MiB');
        bytes = buffer.subarray(0, size);
      } finally {
        await handle.close();
      }
      const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex'),
        old = this.use(db =>
          db.prepare('SELECT id FROM imports WHERE database_id=? AND source_hash=?').get(active.databaseId, sourceHash)
        );
      if (old) return this.view(old.id);
      const workbook = await W.run('parse', { bytes, extension });
      check();
      P.identity(this.active(), active);
      if (!workbook.sheets.some(s => s.rows.length)) throw Error('The spreadsheet is empty');
      const sheet = workbook.sheets.findIndex(s => s.rows.length),
        first = workbook.sheets[sheet],
        width = Math.max(...first.rows.map(r => r.length), 0),
        header = 1,
        available = F.fields(this.getStore().data.customFields),
        mapping = F.suggest(
          Array.from({ length: width }, (_, i) => first.rows[0]?.[i]?.text || ''),
          available
        );
      const job = {
        id: crypto.randomUUID(),
        ...active,
        name: path.basename(file),
        sourceHash,
        state: 'mapping',
        workbook,
        extension,
        source: extension === '.csv' ? bytes.toString('base64') : null,
        config: { sheet, header, mapping, dateOrder: '', decimal: '.', labelSeparator: ',' },
        rows: []
      };
      this.save(job);
      return this.view(job.id);
    });
  }
  async configure(id, p) {
    return this.edit(async check => {
      const j = this.get(id);
      this.guard(j);
      if (j.rows.some(r => r.attempt))
        throw Error('Some cars have already been submitted. Finish this import before changing its mapping');
      const delimiterChanged = !!p.delimiter && p.delimiter !== j.workbook.delimiter;
      if (p.delimiter && j.extension === '.csv' && p.delimiter !== j.workbook.delimiter)
        j.workbook = await W.run('parse', {
          bytes: Buffer.from(j.source, 'base64'),
          extension: '.csv',
          options: { delimiter: p.delimiter }
        });
      check();
      this.guard(j);
      if (
        !Number.isInteger(p.sheet) ||
        !j.workbook.sheets[p.sheet] ||
        !Number.isInteger(p.header) ||
        p.header < 1 ||
        p.header > j.workbook.sheets[p.sheet].rows.length
      )
        throw Error('Choose a worksheet and its header row');
      const sheet = j.workbook.sheets[p.sheet],
        width = Math.max(...sheet.rows.map(r => r.length), 0),
        reset = j.config.sheet !== p.sheet || j.config.header !== p.header || p.resuggest === true || delimiterChanged;
      j.config = {
        sheet: p.sheet,
        header: p.header,
        dateOrder: p.dateOrder || '',
        decimal: p.decimal || '.',
        labelSeparator: p.labelSeparator || ',',
        mapping: reset
          ? F.suggest(
              Array.from({ length: width }, (_, i) => sheet.rows[p.header - 1]?.[i]?.text || ''),
              F.fields(this.getStore().data.customFields)
            )
          : p.mapping
      };
      if (!Array.isArray(j.config.mapping) || j.config.mapping.length !== width) throw Error('Map each column');
      j.state = 'mapping';
      j.rows = [];
      this.save(j);
      return this.view(id);
    });
  }
  async preview(id) {
    return this.edit(async check => {
      const j = this.get(id);
      this.guard(j);
      if (j.rows.some(r => r.attempt)) throw Error('This import has already started');
      const customFields = this.getStore().data.customFields,
        result = await W.run('preview', {
          file: this.getStore().file,
          expected: j,
          workbook: j.workbook,
          config: j.config,
          customFields
        });
      check();
      this.guard(j);
      j.rows = result.rows;
      j.fieldHash = hash(F.fields(customFields));
      j.state = 'review';
      j.error = '';
      this.save(j);
      return this.view(id);
    });
  }
  choose(id, changes) {
    this.idle();
    const j = this.get(id);
    this.guard(j);
    if (!Array.isArray(changes) || changes.length > 5000) throw Error('Invalid row selection');
    for (const change of changes) {
      const row = j.rows.find(r => r.row === change.row);
      if (!row || row.attempt) throw Error('This row cannot be changed');
      if (row.errors.length && change.choice !== 'skip') throw Error('Fix this row before importing');
      if (!['new', 'skip', ...row.candidates.map(c => c.id)].includes(change.choice))
        throw Error('Choose a listed matching car');
      row.choice = change.choice;
      if (change.fields) {
        if (
          !Array.isArray(change.fields) ||
          new Set(change.fields).size !== change.fields.length ||
          change.fields.some(f => !F.fields(this.getStore().data.customFields).some(a => a.id === f))
        )
          throw Error('Invalid field selection');
        row.fields = change.fields;
      }
      delete row.error;
    }
    if (j.state === 'complete' && j.rows.some(r => r.choice !== 'skip' && !r.result)) j.state = 'review';
    this.save(j);
    return this.view(id);
  }
  bulk(id, select) {
    this.idle();
    const j = this.get(id);
    this.guard(j);
    return this.choose(
      id,
      j.rows
        .filter(r => !r.attempt && (!select || (!r.errors.length && !r.candidates.length && !r.duplicate)))
        .map(r => ({ row: r.row, choice: select ? 'new' : 'skip' }))
    );
  }
  detail(id, rowNumber, choice) {
    const j = this.get(id);
    this.guard(j);
    const row = j.rows.find(r => r.row === rowNumber);
    if (!row) throw Error('Unknown spreadsheet row');
    const selectedChoice = choice === undefined ? row.choice : choice;
    if (!['skip', 'new', ...row.candidates.map(c => c.id)].includes(selectedChoice))
      throw Error('Choose a listed matching car');
    const fields = F.fields(this.getStore().data.customFields);
    let car = null;
    if (!['skip', 'new'].includes(selectedChoice))
      car = P.withReader(this.getStore(), r => r.one('cars', selectedChoice));
    return {
      row,
      fields: fields
        .filter(f => {
          const [a, b] = f.id.split('.');
          return b ? Object.hasOwn(row.data[a] || {}, b) : Object.hasOwn(row.data, a);
        })
        .map(f => {
          const [a, b] = f.id.split('.');
          return {
            ...f,
            before: car ? (b ? car[a]?.[b] : car[a]) : undefined,
            after: b ? row.data[a][b] : row.data[a]
          };
        })
    };
  }
  async start(id) {
    this.idle();
    const j = this.get(id);
    this.guard(j);
    if (j.state !== 'review' && j.state !== 'importing') throw Error('Review the mapped cars first');
    if (j.fieldHash !== hash(F.fields(this.getStore().data.customFields)))
      throw Error('Custom fields changed. Review the mapping again');
    const chosen = j.rows.filter(r => r.choice !== 'skip' && !r.result);
    if (!chosen.length) throw Error('Select cars to import');
    const work = { id, stopped: false, promise: null };
    // Freeze every operation before the first write, so retries retain payloads,
    // revision checks and generated operation identities even after a lost reply.
    for (const row of chosen)
      if (!row.attempt) {
        if (row.errors.length) throw Error('A selected row has errors');
        const data = selected(row.data, row.fields);
        if (!Object.keys(data).length || (row.choice === 'new' && !data.name))
          throw Error('New cars need a selected display name');
        const candidate = row.candidates.find(c => c.id === row.choice);
        row.attempt = {
          id: 'sheet-' + crypto.randomUUID(),
          payload: row.choice === 'new' ? { data } : { id: row.choice, revision: candidate.revision, data },
          mode: this.getStore().data.club ? 'dealership' : 'local'
        };
      }
    j.state = 'importing';
    j.error = '';
    this.work = work;
    try {
      this.save(j);
    } catch (e) {
      this.work = null;
      throw e;
    }
    work.promise = (async () => {
      let lastError = '';
      for (const row of chosen) {
        if (work.stopped) break;
        try {
          this.guard(j);
          const store = this.getStore();
          if (row.attempt.mode !== (store.data.club ? 'dealership' : 'local'))
            throw Error('The connection mode changed. Return to the original collection');
          if (j.fieldHash !== hash(F.fields(store.data.customFields)))
            throw Error('Custom fields changed; this import needs attention');
          const options = { snapshot: false, commandId: row.attempt.id, databaseId: j.databaseId, epoch: j.recoveryId };
          let result;
          if (row.attempt.mode === 'dealership') {
            if (!row.attempt.proposal) {
              row.attempt.proposal = this.proposal(row.attempt, j);
              this.rowSave(id, row);
            }
            const receipt = this.club.active
              ? await this.club.request('/v1/club/proposals', row.attempt.proposal)
              : await this.club.receiveAsync(row.attempt.proposal);
            if (receipt.id !== row.attempt.id || !['pending', 'accepted', 'rejected'].includes(receipt.status))
              throw Error('The dealership acknowledgement is invalid. Retry this import.');
            result = { queued: true, result: null };
          } else result = await store.mutateAsync('car.save', row.attempt.payload, options);
          row.result = { status: result.queued ? 'submitted' : 'imported', carId: result.result || null };
          delete row.error;
          this.rowSave(id, row);
        } catch (e) {
          row.error = e.message;
          lastError = 'Some rows need attention. Imported cars are retained; Retry uses the original save identities.';
          this.rowSave(id, row);
          break;
        }
      }
      this.stateSave(id, j.rows.some(r => r.choice !== 'skip' && !r.result) ? 'review' : 'complete', lastError);
    })()
      .catch(e => {
        try {
          this.stateSave(id, 'review', e.message);
        } catch {}
      })
      .finally(() => {
        if (this.work === work) this.work = null;
        this.onChange();
      });
    return this.view(id);
  }
  proposal(attempt, job) {
    const M = require('./club-model.cjs'),
      review = require('./field-review.cjs'),
      store = this.getStore(),
      club = this.club;
    if (club.active && club.state !== 'connected') throw Error('Reconnect to the dealership before importing');
    const simulation = club.simulation('car.save', attempt.payload, false, store),
      compact = store.deferredState
        ? require('./scoped-write.cjs').compact(store, 'car.save', attempt.payload)
        : M.compactPayload(store.data, 'car.save', attempt.payload),
      conditions = review.captureStore(store, 'car.save', compact, job.recoveryId);
    const input = {
      id: attempt.id,
      databaseId: job.databaseId,
      clubId: store.data.club.id,
      sourceId: club.device.id,
      device: club.device.name,
      deliveryEpoch: job.recoveryId,
      action: 'car.save',
      payload: compact,
      base: conditions ? M.hash(conditions) : require('./review-baseline.cjs').digest(store),
      ...(conditions ? { conditions } : { baselineVersion: 1 }),
      original: simulation.changes
    };
    M.command(input);
    return input;
  }

  async recheck(id, rowNumber) {
    return this.edit(async check => {
      const store = this.getStore();
      return store.withIdle(() => {
        check();
        const j = this.get(id);
        this.guard(j);
        if (store !== this.getStore()) throw Error('The collection changed');
        const row = j.rows.find(r => r.row === rowNumber);
        if (!row?.attempt || row.result || row.attempt.mode !== 'local')
          throw Error('Only a failed local save can be reviewed again');
        const receipt = require('./command-receipts.cjs').lookupFile(store.file, {
          id: row.attempt.id,
          action: 'car.save',
          payload: row.attempt.payload,
          databaseId: j.databaseId,
          epoch: j.recoveryId
        });
        if (receipt) row.result = { status: 'imported', carId: receipt.result };
        else {
          delete row.attempt;
          if (!['new', 'skip'].includes(row.choice)) {
            const car = P.withReader(store, r => r.one('cars', row.choice));
            const candidate = row.candidates.find(c => c.id === row.choice);
            if (car) Object.assign(candidate, { revision: car.revision, name: car.name });
            else row.choice = 'skip';
          }
        }
        delete row.error;
        this.save(j);
        return this.view(id);
      });
    });
  }
  async stop() {
    this.generation++;
    if (this.work) {
      this.work.stopped = true;
      await this.work.promise;
    }
  }
  async close() {
    this.closed = true;
    await this.stop();
  }
  discard(id) {
    this.idle();
    const j = this.get(id);
    if (j.databaseId !== this.active().databaseId) throw Error('Open the original collection');
    if (j.rows.some(r => r.attempt && !r.result)) throw Error('Resolve uncertain saves before removing this import');
    this.use(db => {
      db.exec('BEGIN');
      db.prepare('DELETE FROM progress WHERE import_id=?').run(id);
      db.prepare('DELETE FROM imports WHERE id=?').run(id);
      db.exec('COMMIT');
    });
    this.onChange();
    return { removed: true };
  }
}
module.exports = { SpreadsheetImports, selected };
