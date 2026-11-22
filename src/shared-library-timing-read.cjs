'use strict';
// Direct-file UI projections. SQL aggregates indexed laps inside the worker;
// original-only evidence is deliberately absent from this index.
const Q = require('./sqlite-query.cjs');
const fail = message => {
  throw Object.assign(Error(message), { code: 'INVALID_QUERY' });
};
const owner = require('./car-merge-query.cjs').owner;
function physical(includeUnselected = false, restricted = false, narrow = '') {
  // Inclusion controls attribution to the main car, not the historical race.
  // Global Timing records retain all evidence under its original
  // identity. A car-filtered query and service counters use selected history.
  // (Timing 2.4.0, speed) The values of a race are read from its stored text once per race (sess), and those of a car in it once per car
  // (physical), not again for every lap: Home over 260,000 laps took 84 s. The same rows and values as before.
  const ownerOf = includeUnselected ? `json_extract(p.value,'$.carId')` : owner('s', 'p');
  return `WITH sess AS MATERIALIZED (
 SELECT s.key,s.source,s.session,s.json,
 coalesce(json_extract(s.json,'$.format')='history-v1',0) rich,
 json_extract(s.json,'$.bundle.provenance.kind')='historical' historical,
 json_extract(s.json,'$.payload.name') sessionName,json_extract(s.json,'$.payload.type') sessionType,
 json_extract(s.json,'$.payload.startedAt') startedAt,json_extract(s.json,'$.bundle.context.savedAt') savedAt,
 json_extract(s.json,'$.payload.track.id') trackId,json_extract(s.json,'$.payload.track.name') trackName
 FROM query_sessions s
 WHERE json_extract(s.json,'$.payload.state')='active' AND coalesce(json_extract(s.json,'$._query.requiresCorrection'),0)=0${
   restricted ? ' AND s.key IN (SELECT key FROM query_car_results WHERE car_id IN (SELECT value FROM json_each(?)))' : ''
 }${narrow}
), owned AS MATERIALIZED (
 SELECT s.key,s.source,s.session,s.rich,s.historical,s.sessionName,s.sessionType,s.startedAt,s.savedAt,s.trackId,s.trackName,
 p.value participant,p.key participantIndex,${ownerOf} carId FROM sess s JOIN json_each(s.json,'$.payload.participants') p
 WHERE json_extract(p.value,'$.kind')='physical'
), physical AS MATERIALIZED (
 SELECT o.key sessionKey,o.source sourceId,o.session sessionId,o.participant,o.participantIndex,o.rich,o.historical,o.sessionName,o.sessionType,
 o.startedAt,o.savedAt,coalesce(o.startedAt,o.savedAt) effectiveDate,
 CASE WHEN o.startedAt IS NOT NULL THEN 'started' WHEN o.savedAt IS NOT NULL THEN 'saved' ELSE 'unknown' END dateBasis,
 o.trackId,o.trackName,o.carId,json_extract(o.participant,'$.id') participantId,
 coalesce((SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=json_array('cars','id:'||o.carId) AND f.path='["name"]'),json_extract(o.participant,'$.displayName')) carName
 FROM owned o WHERE o.carId IS NOT NULL
)`;
}
// (Timing 2.4.0, speed) The values of a lap come from query_lap_values, read out of its stored text when it was saved, and the stints of a
// car in a race are read once (stints), not again for every lap.
const lapColumns = (x = '') => `${x}v.lap_id lapId,${x}v.origin_lap_id originLapId,${x}v.number lapNumber,${x}v.duration durationMs,
 ${x}v.ended_at endedAtMs,${x}v.valid valid,${x}v.pit pit,${x}v.counts_distance countsDistance,${x}v.distance distanceM,
 CASE WHEN rich THEN ${x}v.personal_eligible ELSE ${x}v.record_eligible END personalEligible,
 CASE WHEN rich THEN ${x}v.track_eligible ELSE ${x}v.record_eligible END trackEligible,
 CASE WHEN rich THEN ${x}v.lane ELSE ${x}st.lane END lane,
 CASE WHEN rich THEN ${x}v.driver_id ELSE ${x}st.driverId END driverId`;
const laps = (from, id) => `stints AS MATERIALIZED (
 SELECT ${id} pid,json_extract(st.value,'$.id') id,json_extract(st.value,'$.lane') lane,json_extract(st.value,'$.driverId') driverId
 FROM ${from} p JOIN json_each(p.participant,'$.stints') st WHERE NOT p.rich
)`;
const JOIN_LAPS = id => `JOIN query_lap_values v ON v.key=p.sessionKey AND v.participant=p.participantId
 LEFT JOIN stints st ON NOT p.rich AND st.pid=${id} AND st.id=v.stint_id`;
function base(includeUnselected = false) {
  return (
    physical(includeUnselected) +
    ', ' +
    laps('physical', 'json_array(p.sessionKey,p.participantIndex)') +
    `, samples AS (SELECT p.*,${lapColumns()} FROM physical p ${JOIN_LAPS('json_array(p.sessionKey,p.participantIndex)')})`
  );
}
// (Timing 2.4.0, speed) One statistics request (Home asks six questions) builds its cars in races and their laps once, into temporary
// tables of its own read-only connection, which go away with it: each question built them again (about 1 s each over 260,000 laps). A car's
// statistics look only at the races one of its own cars took part in (the rule serviceCount uses).
// The small values come first in a row: reading one after the car's stored text walks through all of that text. The race's stored text is
// not copied for every car in it (60 MB a request): the two questions that read it look it up.
const SMALL = `sessionKey,sourceId,sessionId,participantIndex,rich,historical,sessionName,sessionType,startedAt,savedAt,effectiveDate,dateBasis,
 trackId,trackName,carId,participantId,carName`;
function prepare(r, input) {
  const own = input.carId && r.merges?.originalIds ? r.merges.originalIds(input.carId) : [];
  r.db.exec('DROP TABLE IF EXISTS temp.timing_physical; DROP TABLE IF EXISTS temp.timing_laps;');
  // (Timing 2.4.0, speed) A request about one source, track or period only builds the races it can match; the request's own filter still
  // decides (filtered), on the same values: Home asks about the track and each driver of the grid, which built the whole library each time.
  let narrow = '';
  const args = own.length ? [JSON.stringify(own)] : [];
  if (input.sourceId !== undefined) (narrow += ' AND s.source=?'), args.push(input.sourceId);
  if (input.trackId !== undefined) (narrow += " AND json_extract(s.json,'$.payload.track.id')=?"), args.push(input.trackId);
  const dated = "julianday(coalesce(json_extract(s.json,'$.payload.startedAt'),json_extract(s.json,'$.bundle.context.savedAt')))";
  if (input.from !== undefined) (narrow += ` AND ${dated}>=julianday(?)`), args.push(input.from);
  if (input.to !== undefined) (narrow += ` AND ${dated}<julianday(?)`), args.push(input.to);
  r.db
    .prepare(
      'CREATE TEMP TABLE timing_physical AS ' +
        physical(!input.carId, own.length > 0, narrow) +
        ' SELECT ' +
        SMALL +
        ',participant FROM physical'
    )
    .run(...args);
  // (records ask one question: their laps are joined as they are read, not copied first, see DIRECT)
  if (input.kind === 'records') return;
  // The unary + keeps each value exactly as stored: a column of a table made this way would otherwise turn text such as "12" into a number.
  r.db.exec(
    'CREATE TEMP TABLE timing_laps AS WITH ' +
      laps('temp.timing_physical', 'p.rowid') +
      ' SELECT p.rowid pid,' +
      lapColumns('+') +
      ' FROM temp.timing_physical p ' +
      JOIN_LAPS('p.rowid')
  );
}
// (Timing 2.4.0, speed) A lap of a records question is known by its car in the race (pid) and its place in the race (lpos).
const DIRECT = `WITH physical AS (SELECT * FROM temp.timing_physical), ${laps('temp.timing_physical', 'p.rowid')},
 samples AS (SELECT p.*,${lapColumns()},p.rowid pid,v.position lpos FROM temp.timing_physical p ${JOIN_LAPS('p.rowid')})`;
const PREPARED = `WITH physical AS (SELECT * FROM temp.timing_physical),
 samples AS (SELECT p.*,l.lapId,l.originLapId,l.lapNumber,l.durationMs,l.endedAtMs,l.valid,l.pit,l.countsDistance,l.distanceM,
 l.personalEligible,l.trackEligible,l.lane,l.driverId,l.pid,l.rowid lid FROM temp.timing_laps l JOIN temp.timing_physical p ON p.rowid=l.pid)`;

// (Timing 2.4.0, speed, serviceCount) A car's laps can only be in races one of its own cars (itself or a car merged into it) took part in,
// and every race lists its cars in query_car_results. Counting the laps of one car went through every race and lap of the library: 15 s a
// car with 2,500 races, so a first start spent hours on 800 cars, and the car list did it for every car it showed.
const BASE = base();
const VALID = 'durationMs IS NOT NULL AND valid=1 AND pit=0';
const SUMMARY = `count(*) recordedLaps,count(DISTINCT sessionKey) acceptedSessions,
 count(DISTINCT CASE WHEN historical THEN sessionKey END) historicalSessions,
 coalesce(sum(durationMs IS NOT NULL),0) measuredLaps,coalesce(sum(${VALID}),0) validLaps,
 coalesce(sum(CASE WHEN ${VALID} THEN durationMs ELSE 0 END),0) measuredTimeMs,
 avg(CASE WHEN ${VALID} THEN durationMs END) averageLapMs,
 min(CASE WHEN ${VALID} AND personalEligible=1 THEN durationMs END) bestPersonalLapMs,
 min(CASE WHEN ${VALID} AND trackEligible=1 THEN durationMs END) bestTrackLapMs,
 coalesce(sum(${VALID} AND personalEligible=1),0) personalRecordLaps,coalesce(sum(${VALID} AND trackEligible=1),0) trackRecordLaps,
 coalesce(sum(CASE WHEN countsDistance=1 THEN coalesce(distanceM,0) ELSE 0 END),0) distanceM,
 coalesce(sum(countsDistance=1),0) distanceLaps,coalesce(sum(countsDistance=1 AND distanceM IS NULL),0) unknownDistanceLaps,max(effectiveDate) lastDrivenAt,CASE WHEN max(effectiveDate) IS NULL THEN 'unknown' WHEN max(effectiveDate)=max(startedAt) THEN 'started' ELSE 'saved' END lastDrivenDateBasis`;
// (Timing 2.4.0, speed) A record is ranked on the values its order needs, and its other values and the car's stored text (participant) are
// read once it has won: sorting every lap with them took 45 s.
const NARROW = `sourceId,sessionId,sessionName,startedAt,savedAt,effectiveDate,dateBasis,trackId,trackName,carId,carName,participantId,lapId,originLapId,lapNumber,lane,driverId,durationMs,endedAtMs`;
const RECORD = `${NARROW},
 (SELECT json_extract(d.value,'$.name') FROM temp.timing_physical x JOIN json_each(x.participant,'$.drivers') d WHERE x.rowid=pid AND json_extract(d.value,'$.id')=driverId LIMIT 1) driverName`;
function query(input) {
  if (
    !input ||
    !['home', 'records', 'carStatistics', 'classes', 'resultSessions', 'sessionState', 'sessionIds'].includes(input.kind)
  )
    fail('Choose a Timing projection.');
  const allowed = [
    'kind',
    'sourceId',
    'sessionId',
    'trackId',
    'driverId',
    'carId',
    'lane',
    'from',
    'to',
    'offset',
    'limit',
    'token',
    'scope',
    'weekStart',
    'sort',
    'grouping',
    'excludeSourceId',
    'keepSessionIds'
  ];
  if (Object.keys(input).some(k => !allowed.includes(k))) fail('Unknown Timing projection option.');
  if (input.kind === 'classes' && Object.keys(input).some(k => !['kind', 'offset', 'limit', 'token'].includes(k)))
    fail('Class labels support pagination only.');
  const terms = [],
    args = [];
  for (const k of ['sourceId', 'trackId', 'driverId', 'carId'])
    if (input[k] !== undefined) {
      if (typeof input[k] !== 'string' || !/^[\w-]{1,100}$/.test(input[k])) fail('Invalid ' + k);
      terms.push(k + '=?');
      args.push(input[k]);
    }
  if ((input.trackId || input.driverId) && !input.sourceId) fail('Track and driver identities require sourceId.');
  if (input.lane !== undefined) {
    if (!Number.isInteger(input.lane) || input.lane < 1 || input.lane > 64) fail('Invalid lane.');
    terms.push('lane=?');
    args.push(input.lane);
  }
  for (const k of ['from', 'to', 'weekStart'])
    if (
      input[k] !== undefined &&
      (typeof input[k] !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input[k]) ||
        !Number.isFinite(Date.parse(input[k])) ||
        new Date(input[k]).toISOString().replace('.000Z', 'Z') !== input[k].replace('.000Z', 'Z'))
    )
      fail('Use valid UTC ISO timestamps.');
  if (input.from && input.to && Date.parse(input.from) >= Date.parse(input.to)) fail('from must precede to.');
  if (input.from) {
    terms.push('julianday(effectiveDate)>=julianday(?)');
    args.push(input.from);
  }
  if (input.to) {
    terms.push('julianday(effectiveDate)<julianday(?)');
    args.push(input.to);
  }
  const offset = input.offset ?? 0,
    limit = input.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    fail('Invalid page bounds.');
  if (offset && !input.token) fail('Continue with the first page token.');
  if (input.kind === 'carStatistics' && !input.carId) fail('Choose a car.');
  if (input.scope !== undefined && !['personal', 'track'].includes(input.scope)) fail('Unknown record scope.');
  if (input.sort !== undefined && !['track', 'time'].includes(input.sort)) fail('Unknown record ordering.');
  if (input.grouping !== undefined && (input.kind !== 'records' || !['lane', 'timing'].includes(input.grouping)))
    fail('Unknown record grouping.');
  if (input.sessionId !== undefined && input.kind !== 'sessionState')
    fail('Session identity is only supported by sessionState.');
  if (['resultSessions', 'sessionState', 'sessionIds'].includes(input.kind)) {
    if (
      Object.keys(input).some(
        k =>
          !['kind', 'sourceId', 'sessionId', 'offset', 'limit', 'token']
            .concat(input.kind === 'resultSessions' ? ['excludeSourceId', 'keepSessionIds'] : [])
            .includes(k)
      )
    )
      fail('Invalid session projection option.');
    // (Timing 2.4.0, speed) Timing lists its own races itself and the library's other races beside them: the races of one source can be left
    // out (excludeSourceId), except the ones it names (keepSessionIds, those Timing does not hold). Skipping them one by one walked the
    // whole library for every page: 167 s with 2,500 races.
    if (input.excludeSourceId !== undefined && (typeof input.excludeSourceId !== 'string' || !/^[\w-]{1,100}$/.test(input.excludeSourceId)))
      fail('Invalid excludeSourceId');
    if (
      input.keepSessionIds !== undefined &&
      (input.excludeSourceId === undefined ||
        !Array.isArray(input.keepSessionIds) ||
        input.keepSessionIds.length > 100000 ||
        input.keepSessionIds.some(x => typeof x !== 'string' || !x || x.length > 200))
    )
      fail('Invalid keepSessionIds');
    if (input.kind === 'sessionIds' && (!input.sourceId || input.offset !== undefined || input.limit !== undefined))
      fail('Choose the source whose session identities to list.');
    if (
      input.kind === 'sessionState' &&
      (!input.sourceId || typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 200)
    )
      fail('Choose a source session.');
    if (input.kind === 'sessionState' && (input.offset !== undefined || input.limit !== undefined))
      fail('A single session state does not support pagination.');
  }
  return {
    sql:
      (input.kind === 'records' ? DIRECT : PREPARED) +
      ', filtered AS (SELECT * FROM samples WHERE ' +
      (terms.length ? terms.join(' AND ') : '1') +
      ')',
    args,
    offset,
    limit
  };
}
// (Timing 2.4.0, speed) The finishers in first place of each race, read from its stored text once per race, not once for every car in it.
const FIRSTS = from => `firsts AS MATERIALIZED (
 SELECT s.sessionKey,a.value award,json_extract(a.value,'$.participantId') participantId FROM (SELECT DISTINCT sessionKey,rich,sessionType FROM ${from}) s
 JOIN query_sessions j ON j.key=s.sessionKey JOIN json_each(j.json,CASE WHEN s.rich THEN '$.bundle.context.classification' ELSE '$.payload.standings' END) a
 WHERE s.sessionType NOT IN ('practice','qualifying') AND json_extract(a.value,'$.position')=1 AND json_extract(a.value,'$.status')='finished')`;
function summary(r, q, where = '1', args = []) {
  const row = r.db.prepare(q.sql + ` SELECT ${SUMMARY} FROM filtered WHERE ${where}`).get(...q.args, ...args);
  // Count classifications separately from laps; an award never adds distance.
  const wins = r.db
    .prepare(
      q.sql +
        `, participants AS (SELECT DISTINCT p.sessionKey,p.participantId,p.rich,p.sessionType FROM (SELECT DISTINCT pid FROM filtered WHERE ${where}) k JOIN temp.timing_physical p ON p.rowid=k.pid), ${FIRSTS('participants')}, awards AS (
 SELECT p.sessionKey,p.participantId,f.award,p.rich FROM participants p JOIN firsts f ON f.sessionKey=p.sessionKey AND f.participantId=p.participantId)
 SELECT count(DISTINCT CASE WHEN NOT rich OR json_extract(award,'$.scope')='overall' THEN sessionKey END) overallWins,
 count(DISTINCT CASE WHEN rich AND json_extract(award,'$.scope')='class' THEN json_array(sessionKey,json_extract(award,'$.classId')) END) classWins FROM awards`
    )
    .get(...q.args, ...args);
  return {
    ...row,
    ...wins,
    distanceComplete: row.unknownDistanceLaps === 0,
    originalOnlyIncluded: false,
    manualIncluded: false
  };
}
// (Timing 2.4.0, speed) The rows are found once, then counted and paged: finding them twice took 1.5 s each for the records.
function page(r, q, sql, args = []) {
  r.db.exec('DROP TABLE IF EXISTS temp.timing_page');
  r.db.prepare('CREATE TEMP TABLE timing_page AS ' + q.sql + sql).run(...q.args, ...args);
  const total = r.db.prepare('SELECT count(*) n FROM temp.timing_page').get().n,
    rows = r.db.prepare('SELECT * FROM temp.timing_page ORDER BY rowid LIMIT ? OFFSET ?').all(q.limit, q.offset);
  return { rows, total, offset: q.offset, nextOffset: q.offset + rows.length < total ? q.offset + rows.length : null };
}
function read(store, input) {
  const q = query(input);
  return Q.read(store, input.token, r => {
    const identity = { version: 1, databaseId: r.id, recoveryId: r.epoch, token: r.token };
    if (['resultSessions', 'sessionState', 'sessionIds'].includes(input.kind)) {
      // Timing's Results restoration relies on these small metadata reads. Keep
      // session/evidence identities independent of merge contribution selections.
      const field = name =>
        `(SELECT json_extract(f.json,'$') FROM record_fields f WHERE f.record=o.key AND f.path='["${name}"]')`;
      const sql = `SELECT source sourceId,session sessionId,json_extract(json,'$.payload.state') state,
   coalesce(json_extract(json,'$.bundle.context.savedAt'),json_extract(json,'$.payload.startedAt')) date,
   json_extract(json,'$.payload.name') setupName,json_extract(json,'$.payload.type') sessionType,
   json_extract(json,'$.payload.track.id') trackId,json_extract(json,'$.payload.track.name') trackName,0 originalOnly,
   json_extract(json,'$.contentHash') contentHash,json_extract(json,'$.provenanceKind') provenance
   FROM query_sessions UNION ALL SELECT ${field('sourceId')},${field('originalId')},coalesce(${field('state')},'active'),
   ${field('startedAt')},${field('name')},NULL,NULL,NULL,1,NULL,NULL FROM records o
   WHERE o.bucket='["libraryOrigins"]' AND ${field('projectionStatus')}='raw-only'`;
      if (input.kind === 'sessionState')
        return {
          ...identity,
          row:
            r.db
              .prepare('SELECT * FROM (' + sql + ') WHERE sourceId=? AND sessionId=?')
              .get(input.sourceId, input.sessionId) || null
        };
      if (input.kind === 'sessionIds')
        return {
          ...identity,
          ids: r.db
            .prepare("SELECT sessionId FROM (" + sql + ") WHERE state='active' AND sourceId=? ORDER BY sessionId")
            .all(input.sourceId)
            .map(x => x.sessionId)
        };
      let where = "state='active'" + (input.sourceId ? ' AND sourceId=?' : '');
      const args = input.sourceId ? [input.sourceId] : [];
      if (input.excludeSourceId !== undefined) {
        where += ' AND (sourceId IS NOT ? OR sessionId IN (SELECT value FROM json_each(?)))';
        args.push(input.excludeSourceId, JSON.stringify(input.keepSessionIds || []));
      }
      const rows = r.db
        .prepare(
          'SELECT * FROM (' +
            sql +
            ') WHERE ' +
            where +
            ' ORDER BY coalesce(julianday(date),-1) DESC,sourceId,sessionId LIMIT ? OFFSET ?'
        )
        .all(...args, q.limit + 1, q.offset);
      const more = rows.length > q.limit;
      if (more) rows.pop();
      return { ...identity, rows, nextOffset: more ? q.offset + rows.length : null };
    }
    if (input.kind === 'classes') {
      const sql = `SELECT DISTINCT json_extract(f.json,'$') label FROM records r JOIN record_fields f ON f.record=r.key AND f.path='["raceClass"]' WHERE r.bucket='["cars"]' AND NOT EXISTS(SELECT 1 FROM record_fields w WHERE w.record=r.key AND w.path='["collectionStatus"]' AND w.json='"wishlist"') AND json_type(f.json)='text' AND trim(json_extract(f.json,'$'))<>''`;
      const total = r.db.prepare('SELECT count(*) n FROM (' + sql + ')').get().n,
        rows = r.db.prepare(sql + ' ORDER BY label LIMIT ? OFFSET ?').all(q.limit, q.offset);
      return {
        ...identity,
        rows,
        total,
        offset: q.offset,
        nextOffset: q.offset + rows.length < total ? q.offset + rows.length : null
      };
    }
    prepare(r, input);
    if (input.kind === 'records') {
      const scope = input.scope || 'track',
        groups =
          input.grouping === 'timing'
            ? scope === 'personal'
              ? 'sourceId,trackId,driverId'
              : 'sourceId,trackId'
            : scope === 'personal'
              ? 'sourceId,trackId,carId,driverId,lane'
              : 'sourceId,trackId,lane';
      // (Timing 2.4.0, speed) the best time of each group first, then the order among the laps with that time only
      const counted = `${VALID} AND ${scope}Eligible=1 AND trackId IS NOT NULL`,
        countedTied = `f.durationMs IS NOT NULL AND f.valid=1 AND f.pit=0 AND f.${scope}Eligible=1 AND f.trackId IS NOT NULL`,
        same = groups
          .split(',')
          .map(g => `f.${g} IS m.${g}`)
          .join(' AND ');
      const sql = `, best AS MATERIALIZED (SELECT ${groups},min(durationMs) time FROM filtered WHERE ${counted} GROUP BY ${groups}),
 tied AS (SELECT f.* FROM filtered f CROSS JOIN best m ON ${same} AND f.durationMs=m.time WHERE ${countedTied})
 SELECT ${RECORD} FROM (SELECT p.*,${lapColumns()},p.rowid pid FROM (SELECT pid wpid,lpos wpos FROM (SELECT pid,lpos,row_number() OVER(PARTITION BY ${groups} ORDER BY durationMs,coalesce(effectiveDate,'9999'),coalesce(endedAtMs,1e20),sessionId,participantId,lapId) winner FROM tied) WHERE winner=1) w
 JOIN temp.timing_physical p ON p.rowid=w.wpid JOIN query_lap_values v ON v.key=p.sessionKey AND v.participant=p.participantId AND v.position=w.wpos
 LEFT JOIN stints st ON NOT p.rich AND st.pid=p.rowid AND st.id=v.stint_id) ORDER BY ${input.sort === 'time' ? 'durationMs,' : ''}trackName,sourceId,trackId,lane,carId,driverId`;
      return { ...identity, scope, ...page(r, q, sql) };
    }
    if (input.kind === 'carStatistics')
      return {
        ...identity,
        carId: input.carId,
        summary: summary(r, q),
        tracks: page(
          r,
          q,
          `SELECT sourceId,trackId,max(trackName) trackName,${SUMMARY} FROM filtered GROUP BY sourceId,trackId ORDER BY trackName,sourceId,trackId`
        )
      };
    let week = input.weekStart;
    if (!week) {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      now.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
      week = now.toISOString();
    }
    const topDistanceCars = r.db
      .prepare(
        q.sql +
          ` SELECT carId,max(carName) carName,${SUMMARY} FROM filtered GROUP BY carId ORDER BY distanceM DESC,carId LIMIT 20`
      )
      .all(...q.args);
    const recentSessions = r.db
      .prepare(
        q.sql +
          // (Timing 2.4.0, speed) the laps are counted per car in a race first, then per race
          ' SELECT p.sourceId,p.sessionId,max(p.sessionName) name,max(p.startedAt) startedAt,max(p.savedAt) savedAt,max(p.effectiveDate) effectiveDate,max(p.dateBasis) dateBasis,max(p.trackId) trackId,max(p.trackName) trackName,sum(k.n) recordedLaps FROM (SELECT pid,count(*) n FROM filtered GROUP BY pid) k JOIN temp.timing_physical p ON p.rowid=k.pid GROUP BY p.sourceId,p.sessionId ORDER BY effectiveDate DESC,p.sourceId,p.sessionId LIMIT 20'
      )
      .all(...q.args);
    const topWinners = r.db
      .prepare(
        q.sql +
          `, entries AS (SELECT DISTINCT p.sessionKey,p.sourceId,p.sessionId,p.effectiveDate,p.sessionType,p.participant,p.participantId,p.rich FROM (SELECT DISTINCT pid FROM filtered) k JOIN temp.timing_physical p ON p.rowid=k.pid), ${FIRSTS('entries')}, winners AS (
 SELECT e.* FROM entries e JOIN firsts f ON f.sessionKey=e.sessionKey AND f.participantId=e.participantId WHERE NOT e.rich OR json_extract(f.award,'$.scope')='overall'),
 recipients AS (SELECT w.sourceId,w.sessionKey,w.effectiveDate,json_extract(d.value,'$.id') driverId,json_extract(d.value,'$.name') driverName FROM winners w JOIN json_each(w.participant,'$.drivers') d)
 SELECT sourceId,driverId,max(driverName) driverName,count(DISTINCT sessionKey) wins,max(effectiveDate) lastWinAt FROM recipients${input.driverId ? ' WHERE driverId=?' : ''} GROUP BY sourceId,driverId ORDER BY wins DESC,lastWinAt DESC,sourceId,driverId LIMIT 20`
      )
      .all(...q.args, ...(input.driverId ? [input.driverId] : []));
    const fastestThisWeek =
      r.db
        .prepare(
          q.sql +
            ` SELECT ${RECORD} FROM filtered WHERE ${VALID} AND trackEligible=1 AND julianday(effectiveDate)>=julianday(?) ORDER BY durationMs,effectiveDate,sourceId,sessionId,participantId,lapId LIMIT 1`
        )
        .get(...q.args, week) || null;
    return {
      ...identity,
      summary: summary(r, q),
      weekStart: week,
      topDistanceCars,
      topWinners,
      recentSessions,
      fastestThisWeek
    };
  }).value;
}
// The same laps as "SELECT count(*) FROM samples WHERE carId=?", read without the columns a count does not need: those read a dozen values
// out of the stored text of the race for every car in it (about 100 ms a car with a large history).
const SERVICE_COUNT = from => `WITH ss AS MATERIALIZED (
 SELECT key,source,session,json,coalesce(json_extract(json,'$.format')='history-v1',0) rich FROM query_sessions
 WHERE key IN (SELECT key FROM query_car_results WHERE car_id IN (SELECT value FROM json_each(?)))
 AND json_extract(json,'$.payload.state')='active' AND coalesce(json_extract(json,'$._query.requiresCorrection'),0)=0${
   from ? " AND (json_extract(json,'$.payload.startedAt') IS NULL OR julianday(json_extract(json,'$.payload.startedAt'))>=julianday(?))" : ''
 }
), pp AS MATERIALIZED (
 SELECT s.key,s.rich,p.value pv,json_extract(p.value,'$.id') pid FROM ss s JOIN json_each(s.json,'$.payload.participants') p
 WHERE json_extract(p.value,'$.kind')='physical' AND ${owner()}=?
)
SELECT count(*) n FROM pp JOIN query_lap_values v ON v.key=pp.key AND v.participant=pp.pid
 LEFT JOIN json_each(pp.pv,'$.stints') st ON NOT pp.rich AND json_extract(st.value,'$.id')=v.stint_id`;
function serviceCount(r, carId, from = null) {
  const own = r.merges?.originalIds ? r.merges.originalIds(carId) : [];
  const indexed = own.length
    ? r.db.prepare(SERVICE_COUNT(!!from)).get(JSON.stringify(own), ...(from ? [from] : []), carId).n
    : r.db
        .prepare(
          BASE +
            ' SELECT count(*) n FROM samples WHERE carId=?' +
            (from ? ' AND (startedAt IS NULL OR julianday(startedAt)>=julianday(?))' : '')
        )
        .get(...(from ? [carId, from] : [carId])).n;
  return indexed + require('./shared-library-lap-counts.cjs').originals(r, carId, from);
}
// Paddock lap reminders: laps per reminder in one pass over the lap index.
// wanted: [{key,carId,from}]. Only sessions with a known date count (a start time, or when
// Timing saved them): undated imported history must not make every new reminder due.
function datedLapCounts(r, wanted) {
  const counts = new Map(wanted.map(w => [w.key, 0]));
  if (!wanted.length) return counts;
  const rows = r.db
    .prepare(
      BASE +
        `, wanted AS (SELECT json_extract(value,'$.key') k,json_extract(value,'$.carId') carId,json_extract(value,'$.from') since FROM json_each(?)) SELECT w.k key,count(s.sessionKey) n FROM wanted w LEFT JOIN samples s ON s.carId=w.carId AND s.effectiveDate IS NOT NULL AND julianday(s.effectiveDate)>=julianday(w.since) GROUP BY w.k`
    )
    .all(JSON.stringify(wanted));
  for (const row of rows) counts.set(row.key, row.n);
  const originals = require('./shared-library-lap-counts.cjs').originals;
  for (const w of wanted) counts.set(w.key, counts.get(w.key) + originals(r, w.carId, w.from, { dated: true }));
  return counts;
}
module.exports = { read, serviceCount, datedLapCounts };
