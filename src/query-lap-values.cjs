'use strict';
// (Timing 2.4.0, speed) The values of each indexed lap, read out of its stored text once, when the lap is saved, instead of again for every
// statistics request: Home took 28 s over 260,000 laps reading about a dozen values out of every lap. Rebuildable from query_laps and kept
// in step with it by SQLite triggers, in the same transaction, including foreign-key cascades and writes by an older engine that does not
// know this table. Never an authority: the values are exactly what json_extract returns from query_laps.json.
const values = {
  lap_id: '$.id',
  origin_lap_id: '$.originLapId',
  number: '$.number',
  duration: '$.durationMs',
  ended_at: '$.endedAtMs',
  valid: '$.valid',
  pit: '$.pit',
  counts_distance: '$.countsForDistance',
  distance: '$.distanceM',
  record_eligible: '$.recordEligible',
  personal_eligible: '$.personalRecordEligible',
  track_eligible: '$.trackRecordEligible',
  lane: '$.lane',
  driver_id: '$.driverId',
  stint_id: '$.stintId'
};
const columns = Object.keys(values);
const TRIGGERS = ['query_lap_values_insert', 'query_lap_values_update', 'query_lap_values_delete'];
const extracted = row => columns.map(c => `json_extract(${row}.json,'${values[c]}')`).join(',');
const insert = row =>
  `INSERT INTO query_lap_values(key,participant,position,${columns.join(',')}) VALUES(${row}.key,${row}.participant,${row}.position,${extracted(row)});`;
const remove = row =>
  `DELETE FROM query_lap_values WHERE key=${row}.key AND participant=${row}.participant AND position=${row}.position;`;
function schema(db) {
  db.exec(`${TRIGGERS.map(t => `DROP TRIGGER IF EXISTS ${t};`).join(' ')} DROP TABLE IF EXISTS query_lap_values;
 CREATE TABLE query_lap_values(key TEXT NOT NULL,participant TEXT NOT NULL,position INTEGER NOT NULL,${columns.map(c => c + ' ANY').join(',')},PRIMARY KEY(key,participant,position)) STRICT,WITHOUT ROWID;
 CREATE TRIGGER query_lap_values_insert AFTER INSERT ON query_laps BEGIN ${insert('NEW')} END;
 CREATE TRIGGER query_lap_values_update AFTER UPDATE ON query_laps BEGIN ${remove('OLD')} ${insert('NEW')} END;
 CREATE TRIGGER query_lap_values_delete AFTER DELETE ON query_laps BEGIN ${remove('OLD')} END;`);
}
function rebuild(db) {
  schema(db);
  db.exec(
    `INSERT INTO query_lap_values(key,participant,position,${columns.join(',')}) SELECT key,participant,position,${extracted('query_laps')} FROM query_laps ORDER BY key,participant,position`
  );
}
module.exports = { schema, rebuild, columns, values, TRIGGERS };
