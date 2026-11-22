'use strict';
// SQL over one participant's indexed laps; null timing/eligibility stays unknown.
function participant(db, key, id, { lane, driverId } = {}) {
  const valid = 'duration IS NOT NULL AND valid=1 AND pit=0';
  const eligible = kind => valid + ' AND ' + kind + '_eligible=1';
  const where = ['key=?', 'participant=?'],
    args = [key, id];
  if (lane !== undefined) {
    where.push('lane=?');
    args.push(lane);
  }
  if (driverId !== undefined) {
    where.push('driver_id=?');
    args.push(driverId);
  }
  const row = db
    .prepare(
      `SELECT count(*) n,
 coalesce(sum(duration IS NOT NULL),0) measuredLaps,
 coalesce(sum(${valid}),0) validLaps,
 coalesce(sum(CASE WHEN ${valid} THEN duration ELSE 0 END),0) measuredTimeMs,
 coalesce(sum(${eligible('personal')}),0) personalRecordLaps,
 coalesce(sum(${eligible('track')}),0) trackRecordLaps,
 min(CASE WHEN ${eligible('personal')} THEN duration END) bestPersonalLapMs,
 min(CASE WHEN ${eligible('track')} THEN duration END) bestTrackLapMs,
 coalesce(sum(CASE WHEN counts_distance=1 THEN coalesce(distance,0) ELSE 0 END),0) distanceM,
 coalesce(sum(counts_distance=1 AND distance IS NULL),0) unknownDistanceLaps
 FROM query_lap_values WHERE ${where.join(' AND ')}`
    )
    .get(...args);
  return row;
}
module.exports = { participant };
