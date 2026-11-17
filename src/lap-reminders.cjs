'use strict';
// Lap-based service reminders: "replace the braids every 500 laps".
//
// A maintenance record can carry nextDueLaps (and/or a nextDue date). The reminder is due
// when the car has driven that many laps since the day the work was done. Laps come from:
// - race sessions from SlotForge Timing stored in this collection, read from the same lap
//   index as Timing's own counters (withdrawn and uncorrected sessions excluded, merged cars
//   included). Sessions without a known date are left out. This is Paddock's own count per
//   task; it is separate from Timing's single "laps since service" counter, and
// - the lap count of manual track tests (see manualSince for which ones count).
const domain = require('../renderer/domain.js');

const MAX_LAPS = 1000000;

/** Validates the interval entered in "Record work". Empty means no lap reminder. */
function interval(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LAPS) {
    throw Object.assign(Error(`Enter the laps as a whole number from 1 to ${MAX_LAPS.toLocaleString('en')}.`), {
      code: 'INVALID_FIELD'
    });
  }
  return n;
}

/**
 * Counting starts at the beginning of the day the work was done (local time). So a race
 * that evening counts, even when the work is entered afterwards; a race earlier that same
 * day counts too, which errs on the side of servicing a little early.
 */
function since(event) {
  const recorded = Date.parse(event.date);
  const day = event.performedDate || (Number.isFinite(recorded) ? domain.today(new Date(recorded)) : '');
  const start = new Date(`${day}T00:00:00`);
  return Number.isFinite(start.getTime()) ? start.toISOString() : null;
}

/**
 * Manual tests are logged in Paddock itself, so their order against the work record is known
 * when the work was logged on the day it was done: only tests recorded after it count. So
 * "tested, serviced, logged it" starts at 0 instead of being due again at once. Work logged
 * later for an earlier day keeps the whole-day rule, as the order can't be known then.
 */
function manualSince(event) {
  const recorded = Date.parse(event.date);
  if (!Number.isFinite(recorded)) return since(event);
  const loggedOn = domain.today(new Date(recorded));
  if (event.performedDate && event.performedDate !== loggedOn) return since(event);
  return new Date(recorded).toISOString();
}

/** A manual test's lap count, read exactly as "Record test" validated it (text such as "25"). */
function testLaps(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Laps of manual track tests per reminder, for tests recorded at or after its start. */
function manualLaps(reader, wanted) {
  const counts = new Map(wanted.map(w => [w.key, 0]));
  const cars = [...new Set(wanted.map(w => w.carId))];
  if (!cars.length) return counts;
  const rows = reader.db
    .prepare(
      `SELECT q.car_id carId,json_extract(l.json,'$') laps,json_extract(d.json,'$') date
    FROM query_records q
    JOIN record_fields l ON l.record=q.key AND l.path='["laps"]'
    JOIN record_fields d ON d.record=q.key AND d.path='["date"]'
    WHERE q.bucket='["tests"]' AND q.car_id IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(cars));
  for (const w of wanted) {
    const from = w.manualFrom || w.from;
    const start = from ? Date.parse(from) : -Infinity;
    for (const row of rows) {
      if (row.carId !== w.carId) continue;
      const at = Date.parse(row.date);
      if (Number.isFinite(at) && at >= start) counts.set(w.key, counts.get(w.key) + testLaps(row.laps));
    }
  }
  return counts;
}

// Every page view reads the reminder summary, so the last count is kept until the collection
// changes. The reader's token (database, revision, change epoch) changes with every save,
// including new Timing results, so a stale count is never used.
let lastCount = null;

/** Laps driven since each reminder's work: {key → laps}. One pass for all reminders. */
function count(reader, wanted) {
  const key = reader.file && reader.token ? JSON.stringify([reader.file, reader.token, wanted]) : null;
  if (key && lastCount?.key === key) return new Map(lastCount.counts);
  const timing = require('./shared-library-timing-read.cjs').datedLapCounts(reader, wanted);
  const manual = manualLaps(reader, wanted);
  const counts = new Map(wanted.map(w => [w.key, (timing.get(w.key) || 0) + (manual.get(w.key) || 0)]));
  if (key) lastCount = { key, counts: new Map(counts) };
  return counts;
}

/**
 * Adds lap progress to reminder rows from Reader.reminders() and sorts them: anything due
 * (date passed or laps reached) first, then by date, then by laps left.
 */
function attach(reader, rows, day = domain.today(), { counter = count } = {}) {
  const wanted = [];
  for (const row of rows) {
    if (row.laps === null || row.laps === undefined) {
      row.laps = null;
      continue;
    }
    const event = reader.record(row.key, { assetHandle: true });
    if (event) wanted.push({ key: row.key, carId: event.carId, from: since(event), manualFrom: manualSince(event) });
  }
  const counts = wanted.length ? counter(reader, wanted) : new Map();
  for (const row of rows) {
    if (row.laps === null) continue;
    const every = Number(row.laps),
      laps = counts.get(row.key) || 0;
    row.laps = { driven: laps, interval: every, reached: laps >= every };
  }
  return rows.sort(
    (a, b) =>
      Number(due(b, day)) - Number(due(a, day)) ||
      (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31') ||
      left(a) - left(b) ||
      a.key.localeCompare(b.key)
  );
}
const left = row => (row.laps ? row.laps.interval - row.laps.driven : Number.MAX_SAFE_INTEGER);

/**
 * Adds the lap progress to a maintenance record read for the screen (a fresh copy from the
 * database, not the stored collection). lapStatus is for display only and never saved.
 */
function decorate(event, row) {
  if (event && row?.laps) event.lapStatus = { ...row.laps };
  return event;
}

/** Whether a reminder row is due now (date reached or laps reached). */
function due(row, day = domain.today()) {
  return !!(row.laps?.reached || (row.due && row.due <= day));
}

module.exports = { interval, since, manualSince, testLaps, manualLaps, count, attach, decorate, due, MAX_LAPS };
