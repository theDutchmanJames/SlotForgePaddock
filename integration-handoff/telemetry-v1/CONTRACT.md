# Telemetry read API v1

## Transport and authentication

Local HTTP, UTF-8 JSON, no redirects. Use the displayed dynamic port; never assume a fixed port. Discovery is unchanged: UDP multicast `239.255.47.77:47778`, request `{ "type":"slotforge-discover", "version":1, "nonce":"<32 lowercase hex digits>" }`. The reply echoes the nonce and supplies `id`, `name`, and `port`. Use its sender's LAN IPv4 address and advertised port, then authenticate and verify the database ID. The reply type is `slotforge-host`, with `version:1`, the echoed nonce, database `id` and `name`, and the actual `port`.

Every request requires `Authorization: Bearer <password>`. All `/v1/telemetry/*` requests additionally require `X-SlotForge-Database: <paired database ID>`. Dealership's remembered password grants the existing `timingResults` permission; legacy sharing's Timing credential also works. Legacy browse/submission credentials do not. Browser `Origin` headers, including `Origin: null`, remain forbidden. No CORS exception was added. Never put passwords in URLs or logs.

`GET /v1/status` advertises:

```json
{
  "version": 1,
  "index": "/v1/telemetry/results",
  "permission": "timingResults",
  "changes": "/v1/telemetry/changes",
  "filters": ["carId", "sourceId", "trackId", "from", "to"],
  "events": "/v1/telemetry/events",
  "status": "/v1/telemetry/status",
  "snapshot": true,
  "pageSize": 100
}
```

This object is at `capabilities.telemetry`. `permissions.timingResults` is the actual access flag. An older host without this capability can still provide catalogue browsing but cannot provide these downloads. Changes, filters, events, status, snapshot and pageSize are additive capabilities relative to the original minimal Telemetry patch. The changes endpoint, changeToken and summary metadata implement Telemetry's completed handoff; SSE and snapshot pinning are optional Paddock extensions.

## Index and browsing

`GET /v1/telemetry/results?offset=0`

Returns `version:1`, `databaseId`, current `databaseRevision`, `snapshot`, its alias `changeToken`, database `name`, `entries`, and `nextOffset` (integer or null). Up to 100 entries per page; pages may end sooner to keep metadata around 1 MiB. A single large withdrawal entry can exceed that target, but pages remain below 2 MiB. Follow `nextOffset` exactly, not a fixed increment. Store order is stable within a snapshot; it is not chronological order. Sort by the supplied timestamp in the client.

Each entry has:

| Field | Meaning |
| --- | --- |
| `sourceId`, `sessionId` | Stable Timing installation and session identities; combine with database ID |
| `revision`, `state` | Accepted Timing revision (1–1,000,000); `active` or `withdrawn` |
| `contentHash` | SHA-256 of the canonical Timing payload, as in its receipt |
| `resultHash` | Opaque SHA-256 change marker for payload plus received timestamp and stored receipt warnings |
| `receivedAt` | Host acceptance time, ISO UTC with milliseconds |
| `name` | Session name; last known name for a withdrawal |
| `type` | `practice`, `qualifying`, `race`, `endurance`, or null for withdrawal |
| `startedAt`, `endedAt` | ISO UTC session dates, or null for withdrawal |
| `track` | `{sourceId,id,name}`; track ID is local to its Timing source; null for withdrawal |
| `carIds` | Current linked physical cars for an active result; known historical links for withdrawal |
| `summary` | Browsing metadata `{name,type,startedAt,trackId,trackName,carIds}` for active results; null for withdrawal. Contains no lap statistics |

No current car records, photos, private ownership details, private notes, inventory or unrelated documents are in this projection. Unlinked physical and virtual participants can exist in a result and do not add IDs here. Car renames, archiving or removal do not remap historical identities.

Optional browsing filters: `carId`, `sourceId`, `trackId`, `from`, `to`. IDs use `[a-zA-Z0-9_-]{1,100}`. Use `sourceId` with `trackId` to select one source-scoped track. Without sourceId, matching track IDs from every source are returned; this does not mean they represent the same track. Dates must be exact ISO UTC timestamps with milliseconds, for example `2026-10-31T10:01:00.000Z`; comparisons use an inclusive `from` and exclusive `to` on session `startedAt`. `from` must not exceed `to`. Combine filters with AND. **All withdrawal entries are returned regardless of filters**, because their old track/date may no longer exist. Clients may put these in a separate notices area.

Use filtered indexes for browsing only. An entry missing from a filtered index does not prove deletion: only a complete unfiltered index may reconcile deletions from the local cache. Repeat identical filters and the snapshot token on subsequent pages. Unknown/repeated parameters are rejected.

## Snapshot consistency and incremental downloads

The opaque 64-character lowercase hex `snapshot` fingerprints the result manifest and database name/identity. It is not a monotonically increasing counter, timestamp, credential or signature. It stays unchanged for unrelated car/workshop/private edits. It changes with accepted session content, receipt metadata, withdrawals or index removals, including backup restores at an equal or lower database revision. It is stable across process restarts for identical data.

For continuation pages and detail downloads prefer `?snapshot=S`. A nonmatching token returns `409 SNAPSHOT_CHANGED`. On success, `snapshot` matches the pinned manifest, but `databaseRevision` may have advanced for unrelated work. The manifest is global even when a browsing filter is used.

For compatibility, `?revision=R` is also supported and requires the current database revision to equal R. If both are supplied, snapshot is authoritative; revision must still be a valid nonnegative safe integer. Any positive offset requires one of these consistency parameters. An offset of zero can start a new read.

Incremental means **read the paginated metadata index, then fetch only changed sessions**; there is no separate persistent delta journal. Compare resultHash, not just revision or contentHash, for complete payload-and-receipt cache updates. Validate canonical contentHash against the payload. The canonical algorithm recursively sorts object keys, preserves array order and uses JSON scalar encoding, then SHA-256 over UTF-8. A snapshot/resultHash is opaque; clients need not reproduce it.

`GET /v1/telemetry/status` returns `{version:1,databaseId,databaseRevision,snapshot}` without lap data. It accepts no query parameters. Use it for final transfer validation or a bounded change check if SSE is unavailable. Do not poll complete databases or result bodies.

## Complete session

`GET /v1/telemetry/results/{sourceId}/{sessionId}?snapshot=S`

Returns `version`, `databaseId`, `databaseRevision`, `snapshot`, the original Timing v1 `payload`, and its current `receipt`. Revision-only requests remain valid. Missing both consistency parameters gives `REVISION_REQUIRED`. Missing sessions give `404 SESSION_NOT_FOUND`.

Payloads include original measured laps, participant names, drivers and stints, heats, lanes, flags, final standings, adjustments, session notes and the technical configuration captured before racing. Configuration signatures are retained as part of the original payload; the private signing key is never exported. A withdrawal returns its withdrawal envelope and receipt with empty summaries, not the removed lap history. Session history audit records and previous full revisions are not exposed.

Limits inherited from Timing: 8 MiB per payload, 50,000 total laps, 256 participants, 1,000 heats, 2,000 stints per participant, 100 drivers per participant, 64 lanes, and sessions up to seven days. Detail responses including receipts fit below 9 MiB. At most 10,000 stored session identities. Durations and elapsed offsets are integer **milliseconds**; distance is **metres**; lanes are **one-based**. Absolute dates use ISO UTC timestamps with milliseconds. Lap `endedAtMs` and stint/heat bounds are relative to session start.

### Analysis semantics

- Keep measured lap duration separate from final classification time, classified laps, points and adjustments. Never turn a race penalty into a measured lap.
- Valid non-pit laps (`valid && !pit`) contribute to pace. Record candidates must additionally have `recordEligible` true. A slow lap is not automatically invalid.
- Physical-car history excludes virtual and unlinked participants. If the receipt has `SESSION_REQUIRES_CORRECTION`, do not use that session for aggregate records or physical-car statistics; retain it with a visible warning. `CAR_ARCHIVED` is informational.
- Mileage follows `countsForDistance`, not record eligibility. `distanceM:null` means unknown, not zero-length track. See the receipt's `distanceComplete` flag.
- Use each participant's captured configuration, never substitute today's car specifications. Compare tracks by source + track ID; names are labels, not identity. Driver IDs are scoped to a participant, not a cross-session person identity. Do not merge drivers across participants or sessions merely because IDs or names match, even within one Timing source.
- To compare a continuous run, retain lap order, heat/stint/lane/driver boundaries and invalid/pit gaps. Do not manufacture continuity by dropping intervening laps.
- Only delivered, accepted Timing sessions are exported. Manual Paddock performance entries, all of Timing's historic database, sector traces and class-specific record tables are outside this API.

## Quiet notifications

### Long-poll changes (Telemetry client contract)

`GET /v1/telemetry/changes?since=<URL-encoded changeToken>&wait=25` uses the same authentication and database identity headers. `since` is required, nonempty and at most 256 characters. `wait` defaults to 25 and must be an integer from 0 to 25. Unknown or repeated parameters are rejected.

The response is `{version:1,databaseId,changeToken,changed}`. `changed` is exactly whether the returned token differs from `since`. The index changeToken and snapshot fields are aliases for the same opaque token. If it already differs, the host responds immediately. Otherwise it waits up to the requested time for results to change; a timeout returns changed:false. `wait=0` performs an immediate check. No lap data is included.

Keep at most one outstanding wait per client. Re-arm it from the token of the **completed import**, not a newer notification, so changes arriving during import are caught. On disconnect, cancel the request; on reconnect, reconcile the full index before waiting. Back off after failures and honor Retry-After. Private-only changes do not end a wait. Password revocation returns 403 and a changed database ID returns 409. Host shutdown can interrupt a wait; keep the cache and reconnect.

### Optional SSE stream

`GET /v1/telemetry/events` uses the same headers, authentication and identity check. Fetch from Electron main and parse SSE incrementally; do not put a password in EventSource's URL.

Response type `text/event-stream`. The initial message and subsequent change messages are:

```text
data: {"version":1,"databaseId":"paddock-demo","snapshot":"<64 lowercase hex digits>"}

```

There is a comment heartbeat `: heartbeat` every 15 seconds. Result changes are coalesced within an event-loop turn; private changes do not send an event. There is no lap data in events, no event ID/replay, and no Last-Event-ID guarantee. Open the stream before syncing, then compare its latest token and the status token at completion. Coalesce work when events arrive during a sync. On disconnect, retain the cache and reconnect with bounded exponential backoff (for example 2–60 seconds); perform a full index reconciliation on reconnect.

Maximum 10 concurrent held Telemetry notification requests per host (SSE streams and long-poll waits combined), in addition to existing host connection limits. Slow consumers are disconnected instead of buffering indefinitely. Password rotation, database identity replacement and stopping the host close streams. A client should also detect a missed heartbeat (for example after 45 seconds). Authentication remains required on reconnection.

## Errors

JSON errors are `{ "error": "Human-readable explanation", "code": "STABLE_CODE" }`. Success is HTTP 200. Every analysis endpoint rejects methods other than GET without changing data.

| HTTP | Code | Action |
| --- | --- | --- |
| 400 | DATABASE_REQUIRED | Send the paired database ID |
| 400 | INVALID_QUERY / INVALID_PAGE | Correct filters, pagination or token syntax |
| 400 | REVISION_REQUIRED | Read the index first and supply snapshot or revision |
| 401 | UNAUTHENTICATED | Re-enter the current host password |
| 403 | TIMING_PERMISSION_REQUIRED | Use Dealership password or legacy Timing credential |
| 403 | BROWSER_ORIGIN_FORBIDDEN | Move requests to Electron main; do not weaken origin checks |
| 404 | SESSION_NOT_FOUND | Refresh the complete index; it may have been restored/removed |
| 404 | NOT_FOUND | Unsupported route or method |
| 409 | DATABASE_MISMATCH | Stop; explicitly select the intended database |
| 409 | SNAPSHOT_CHANGED | Discard staged partial refresh and retry from the index |
| 429 | AUTH_RATE_LIMITED | Respect Retry-After; fix credentials before retrying |
| 429 | STREAM_LIMIT | Close surplus streams/waits and reconnect with backoff |

Keep good offline results on all errors. Never interpret an error or partial page as an empty authoritative database. An empty **successful, complete, consistency-checked** unfiltered index does mean the host currently has no delivered sessions.
