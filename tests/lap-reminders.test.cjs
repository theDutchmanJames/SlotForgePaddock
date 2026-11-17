'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
const Q = require('../src/sqlite-query.cjs');
const T = require('../src/timing-integration.cjs');
const L = require('../src/lap-reminders.cjs');
const domain = require('../renderer/domain.js');
const { fixtures } = require('./support/timing-fixtures.cjs');

const act = (s, action, p = {}) => s.mutate(action, { revision: s.data.revision, ...p }, { snapshot: false }).result;

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paddock-laps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(path.join(dir, 'db.sqlite'));
  const f = fixtures();
  s.replace(f.store.snapshot());
  return { s, f, reminders: () => Q.read(s, null, r => r.reminders()).value };
}

const record = (s, extra) => act(s, 'work.add', { carId: 'car-a', type: 'maintenance', title: 'New braids', task: 'Braids', ...extra });
const timingLaps = (s, from) => Q.read(s, null, r => require('../src/shared-library-timing-read.cjs').serviceCount(r, 'car-a', from)).value;

test('a lap interval is validated and saved with the maintenance record', t => {
  const { s } = setup(t);
  for (const bad of [0, -5, 1.5, '12a', 1000001]) assert.throws(() => record(s, { nextDueLaps: bad }), /whole number/);
  record(s, { nextDueLaps: '500' });
  const e = s.data.events.find(x => x.task === 'Braids');
  assert.equal(e.nextDueLaps, 500);
  assert.equal(e.type, 'maintenance');
  record(s, { title: 'Checked', task: 'Tyres' });
  assert.equal(s.data.events.find(x => x.task === 'Tyres').nextDueLaps, undefined, 'no interval, no field');
  // A lap interval alone makes Record work a maintenance record (with a reminder).
  act(s, 'work.add', { carId: 'car-a', type: 'modification', category: 'braids', title: 'Braids again', nextDueLaps: 300 });
  assert.equal(s.data.events.find(x => x.title === 'Braids again').type, 'maintenance');
  // A stored record with an invalid interval is rejected by the collection check.
  assert.throws(() => s.transact(d => { d.events[0].nextDueLaps = 0; }), /lap/i);
});

test('laps from Timing races since the work count towards the reminder', t => {
  const { s, f, reminders } = setup(t);
  record(s, { performedDate: '2026-10-30', nextDueLaps: 3 }); // The day before the club race.
  let row = reminders().find(r => r.carId === 'car-a');
  assert.deepEqual(row.laps, { driven: 0, interval: 3, reached: false });
  await_receive(s, f.normal);
  const raced = timingLaps(s, null);
  assert.ok(raced >= 3, 'the fixture race has laps for car-a');
  row = reminders().find(r => r.carId === 'car-a');
  assert.deepEqual(row.laps, { driven: raced, interval: 3, reached: true });
  assert.equal(L.due(row), true);
  assert.equal(Q.read(s, null, r => r.summary()).value.due, 1, 'counts as due in the overview');
});

test('work done after the race starts a fresh count; a withdrawn race does not count', t => {
  const { s, f, reminders } = setup(t);
  await_receive(s, f.normal);
  record(s, { performedDate: '2026-11-01', nextDueLaps: 3 }); // After the 31 October race.
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 0);
  record(s, { performedDate: '2026-10-30', nextDueLaps: 3 }); // Recorded later for an earlier day:
  // only the newest record per task counts, and it is ranked by the day the work was done.
  assert.equal(reminders().filter(r => r.carId === 'car-a').length, 1);
  T.receive(s, f.withdrawal);
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 0);
});

test('manual track tests add their laps when recorded after the work', t => {
  const { s, reminders } = setup(t);
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '25' }); // A day before the work: not counted.
  s.transact(d => { d.tests[d.tests.length - 1].date = '2026-01-01T12:00:00.000Z'; });
  record(s, { nextDueLaps: 100 });
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '30' });
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '12' });
  act(s, 'test.add', { carId: 'car-b', track: 'Home', laps: '99' }); // Another car.
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 42);
});

test('a date and a lap interval together: whichever comes first', t => {
  const { s, reminders } = setup(t);
  record(s, { nextDue: '2000-01-01', nextDueLaps: 1000 });
  const row = reminders().find(r => r.carId === 'car-a');
  assert.equal(row.laps.reached, false);
  assert.equal(L.due(row), true, 'the date has passed');
  const view = require('../src/view-query.cjs').view(s, { page: 'Review', reviewTab: 'Maintenance' });
  const e = view.events.find(x => x.carId === 'car-a');
  assert.deepEqual(e.lapStatus, row.laps, 'the screen gets the lap progress');
  assert.equal(domain.reminderText(e), `${domain.displayDate('2000-01-01')} or 0 of 1,000 laps`);
  assert.equal(s.data.events.find(x => x.task === 'Braids').lapStatus, undefined, 'never stored');
});

test('due reminders come first, then by date, then by laps left', () => {
  const day = '2026-11-17';
  const rows = [
    { key: 'a', due: '2026-12-01', laps: null },
    { key: 'b', due: '', laps: { driven: 10, interval: 100, reached: false } },
    { key: 'c', due: '', laps: { driven: 120, interval: 100, reached: true } },
    { key: 'd', due: '2026-11-01', laps: null },
    { key: 'e', due: '', laps: { driven: 90, interval: 100, reached: false } },
  ];
  // attach() counts laps through a counter; give it one that returns the progress above.
  const progress = new Map(rows.filter(r => r.laps).map(r => [r.key, r.laps.driven]));
  const reader = { record: key => ({ key, carId: 'c', date: '2026-11-01T00:00:00Z', performedDate: '2026-11-01' }) };
  let calls = 0;
  const sorted = L.attach(reader, rows.map(r => ({ ...r, laps: r.laps ? r.laps.interval : null })), day,
    { counter: (_r, wanted) => { calls++; return new Map(wanted.map(w => [w.key, progress.get(w.key)])); } });
  // Due first (by date, then laps-only), then upcoming by date, then by fewest laps left.
  assert.deepEqual(sorted.map(r => r.key), ['d', 'c', 'a', 'e', 'b']);
  assert.equal(calls, 1, 'all reminders are counted in one pass');
});

test('the screen helpers: due, text and ordering without counts', () => {
  const day = '2026-11-17';
  assert.equal(domain.reminderDue({ lapStatus: { reached: true } }, day), true);
  assert.equal(domain.reminderDue({ nextDue: '2026-11-17' }, day), true);
  assert.equal(domain.reminderDue({ nextDue: '2026-11-18', lapStatus: { reached: false } }, day), false);
  assert.equal(domain.reminderText({ nextDueLaps: 500 }), 'after 500 laps');
  assert.equal(domain.reminderText({ nextDueLaps: 500, lapStatus: { driven: 1234, interval: 500, reached: true } }), '1,234 of 500 laps');
  const events = [
    { id: 1, type: 'maintenance', carId: 'c', task: 'Braids', date: '2026-11-01T10:00:00Z', performedDate: '2026-11-01', nextDueLaps: 500 },
    { id: 2, type: 'maintenance', carId: 'c', task: 'Tyres', date: '2026-11-01T10:00:00Z', nextDue: '2026-12-01' },
    { id: 3, type: 'maintenance', carId: 'c', task: 'Motor', date: '2026-11-01T10:00:00Z', nextDue: '2026-11-02' },
    { id: 4, type: 'maintenance', carId: 'c', task: 'Oil', date: '2026-11-01T10:00:00Z' },
  ];
  assert.deepEqual(domain.reminders(events, day).map(e => e.id), [3, 2, 1]);
});

test('counting always starts at the beginning of the day the work was done', () => {
  const now = new Date();
  const today = domain.today(now);
  assert.equal(L.since({ date: now.toISOString(), performedDate: today }), new Date(`${today}T00:00:00`).toISOString());
  assert.equal(L.since({ date: now.toISOString(), performedDate: '2026-01-05' }), new Date('2026-01-05T00:00:00').toISOString());
  assert.equal(L.since({ date: now.toISOString() }), new Date(`${today}T00:00:00`).toISOString(), 'no work date: the day it was recorded');
  assert.equal(L.interval(''), undefined);
  assert.equal(L.interval(' 250 '), 250);
});

test('serviced, raced, logged it that evening: the race counts', t => {
  const { s, f, reminders } = setup(t);
  T.receive(s, f.normal); // Raced on 31 October.
  record(s, { performedDate: '2026-10-31', nextDueLaps: 3 }); // Work done that day, entered later.
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, timingLaps(s, null));
});

test('for dated races, the one-pass count matches the existing per-car counter', t => {
  const { s, f } = setup(t);
  T.receive(s, f.normal);
  T.receive(s, f.multi);
  const R = require('../src/shared-library-timing-read.cjs');
  const froms = [null, '2026-10-31T00:00:00.000Z', '2026-10-31T10:01:30.000Z', '2030-01-01T00:00:00.000Z'];
  Q.read(s, null, r => {
    for (const carId of ['car-a', 'car-b']) {
      const wanted = froms.map((from, i) => ({ key: carId + i, carId, from: from || '1970-01-01T00:00:00.000Z' }));
      const batch = R.datedLapCounts(r, wanted);
      froms.forEach((from, i) => assert.equal(batch.get(carId + i), R.serviceCount(r, carId, from), `${carId} from ${from}`));
    }
  });
  // Undated races (only possible in imported old history) are left out by the query's
  // "effectiveDate IS NOT NULL" condition; Paddock's own Timing results always carry a date.
});

test('the remembered lap count is refreshed after every save', t => {
  const { s, reminders } = setup(t);
  record(s, { nextDueLaps: 100 });
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 0);
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 0, 'same revision: remembered');
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '30' });
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 30, 'new revision: counted again');
});

test('manual test laps are read exactly as Record test accepted them', () => {
  assert.equal(L.testLaps('25'), 25);
  assert.equal(L.testLaps('1e3'), 1000);
  assert.equal(L.testLaps('0x20'), 32);
  assert.equal(L.testLaps(''), 0);
  assert.equal(L.testLaps('-4'), 0);
  assert.equal(L.testLaps('2.5'), 0);
});

test('tested, then serviced and logged the same day: the earlier test does not count', t => {
  const { s, reminders } = setup(t);
  const today = domain.today();
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '60' }); // Earlier today, before the work.
  s.transact(d => { d.tests[d.tests.length - 1].date = new Date(Date.now() - 3600e3).toISOString(); });
  record(s, { performedDate: today, nextDueLaps: 50 });
  assert.equal(reminders().find(r => r.carId === 'car-a').laps.driven, 0, 'a fresh start, not due again at once');
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '20' }); // After the work.
  assert.deepEqual(reminders().find(r => r.carId === 'car-a').laps, { driven: 20, interval: 50, reached: false });
});

test('work logged later for an earlier day keeps the whole-day rule for manual tests', () => {
  const at = new Date(2026, 10, 17, 18, 0, 0); // Logged on 17 November in the evening.
  const loggedToday = { date: at.toISOString(), performedDate: '2026-11-17' };
  assert.equal(L.manualSince(loggedToday), at.toISOString(), 'same day: from the moment it was logged');
  assert.equal(L.manualSince({ date: at.toISOString() }), at.toISOString(), 'no work date: same as logged today');
  const loggedLater = { date: at.toISOString(), performedDate: '2026-11-15' };
  assert.equal(L.manualSince(loggedLater), new Date('2026-11-15T00:00:00').toISOString(), 'earlier day: whole day');
  assert.equal(L.since(loggedToday), new Date('2026-11-17T00:00:00').toISOString(), 'Timing races keep the whole day');
});

test('Workshop and Review get the same lap progress from one count per read', t => {
  const { s } = setup(t);
  record(s, { nextDueLaps: 50 });
  act(s, 'test.add', { carId: 'car-a', track: 'Home', laps: '60' });
  const workshop = require('../src/view-query.cjs').view(s, { page: 'Workshop' });
  const e = workshop._view.maintenance.find(x => x.carId === 'car-a');
  assert.deepEqual(e.lapStatus, { driven: 60, interval: 50, reached: true });
  assert.equal(domain.reminderDue(e), true);
  const summary = Q.read(s, null, r => { const a = r.reminders(); return { same: a === r.reminders(), due: r.summary().due }; }).value;
  assert.equal(summary.same, true, 'computed once per read');
  assert.equal(summary.due, 1);
});

function await_receive(s, payload) {
  T.receive(s, payload);
}
