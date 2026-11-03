# Optional scalable reads — Timing and Telemetry handoff

Paddock owns this host implementation. Timing owns its car cache, pre-race configuration capture and result delivery queue. Telemetry owns its analysis cache and calculations. Neither client opens Paddock's SQLite file or uses the private Dealership replica protocol.

This is an **opt-in version 1 extension**. Existing Timing/Telemetry routes, submissions, signatures, result revisions, permissions and payload limits remain supported. Client implementations have not been changed or tested in their own repositories. The examples use artificial data only.

## Discover and connect

Continue using LAN discovery and its actual advertised port, or the user's address. Pair with the database ID from `/v1/status`, using the existing bearer credential. Dealership Mode uses its one remembered user password. Legacy browse credentials can read cars; result reads need the existing `timingResults` permission. Do not add new credentials or settings.

Send `X-SlotForge-Extensions: scalable-v1` on `GET /v1/status` to receive `capabilities.scalable`. Without this header, the existing strict status shape is unchanged. Alternatively probe `GET /v1/scalable` with the database header. A pre-extension host returns 404; fall back to the existing supported interface. Never infer support from the app version string.

All routes below require:

```http
Authorization: Bearer <existing password or connection code>
X-SlotForge-Database: <paired database ID>
```

All operations are GET, read-only, JSON except the SSE event stream. Existing browser Origin protection remains unchanged: connect from the desktop main process. Catalogue access never authorizes private ownership notes, documents, stock records, credentials or result reads. Main-picture access is restricted to the current public picture of a named car, not arbitrary asset hashes.

## Route reference

All paths below follow `/v1/scalable`. Examples and exact response definitions are in [schema.json](schema.json) and [fixtures/manifest.json](fixtures/manifest.json).

| Route | Query | Response definition | Purpose |
| --- | --- | --- | --- |
| `/` | none | `scalableDiscovery` | Supported links and limits |
| `/status` | none | `scalableStatus` | Lightweight durable cursor |
| `/events` | none | SSE `scalableStatus` | Change hints and heartbeat |
| `/cars` | `offset`, `snapshot` | `scalableCars` | Up to 50 car metadata entries |
| `/cars/{carId}/profile` | none | `scalableProfile` | Existing signed current configuration plus separate media reference |
| `/cars/{carId}/media/{hash}` | `offset` | `scalableMedia` | Up to 256 KiB of stored image-string bytes |
| `/changes` | required `kind=cars` or `kind=results`, required `cursor` | `scalableChanges` | Changed/removed IDs since a committed cursor |
| `/results` | `offset`, `snapshot`, optional `carId` | `scalableResults` | Up to 50 delivered-session identities/tokens |
| `/results/{sourceId}/{sessionId}` | optional `token` | `scalableSession` | Session metadata, captured configurations, standings and summaries, without lap arrays |
| `/results/{sourceId}/{sessionId}/laps/{participantId}` | required `token`, optional `offset` | `scalableLaps` | Up to 250 original measured lap records |

Unknown/repeated parameters and negative/noninteger offsets are rejected. Identity fields follow the existing 1–100 character `[a-zA-Z0-9_-]` convention. No IDs are derived from display names.

## Timing: populate and refresh the racing catalogue

1. Read `/cars`. Keep the first page's `snapshot` and `cursor`. Continue with `offset=nextOffset&snapshot=...` until `nextOffset` is null. Keep the same filters throughout a listing. A 409 `SNAPSHOT_CHANGED` means discard the partial listing and restart.
2. Entries include archived/availability status. Timing controls which usable cars appear in race selectors. Keep stable identities as **database ID + car ID**. Missing and removed cars must not be matched to another car by name.
3. Fetch `/cars/{id}/profile` for chosen/invalidated cars. Its `profile` is the unchanged v1 signed profile shape with `car.picture` intentionally empty. The sibling `media` reference replaces inline photo transfer. The captured configuration is still accepted by the existing session submission API; don't rewrite it.
4. Capture the current signed configuration before racing, retaining it with the race. A car changed after the race must not replace that historical snapshot. Saved setup selection is not added by this extension.
5. Listen to `/events`, or check `/status` at a modest interval with backoff. If the advertised cursor differs, fetch `/changes?kind=cars&cursor=<last applied cursor>`, repeating with its returned cursor while `more` is true.
6. `invalidate` means refresh that ID, even if its name/revision appears unchanged. `remove` means remove the linked catalogue item from future selection, preserving race history. Advance the local cursor only after applying all returned invalidations/removals to the local cache. Duplicate fetches are harmless upserts/deletes.

Keep racing from the local cache through network interruptions. Send reviewed/finalized sessions using the existing `POST /v1/timing/sessions`, persistent source/session IDs, increasing revisions and retry queue. **No new write protocol** is introduced. Corrections and withdrawals remain complete, atomic session contributions, not editable individual laps. Simulation settings do not alter Paddock inventory or maintenance.

### Download photos

`media` is null when absent. Otherwise it has hash, MIME type, size, encoding and URL. The hash is SHA-256 of the exact UTF-8 stored data-URI string. Each chunk response's `data` is base64 of those string bytes, not base64 of the decoded image file. Assemble chunks using their offsets; verify total size and SHA-256, decode UTF-8, then use the resulting data URI. Cache by hash. This preserves existing original bytes and data-URI spelling.

Do not request unrelated/private assets. If the image changes or the car disappears mid-transfer, `MEDIA_CHANGED`/`CAR_NOT_FOUND` means discard the incomplete transfer and refresh the car. Requests do not pin obsolete public images indefinitely. There are no new image size allowances.

## Telemetry: delivered sessions and paged laps

1. Read `/results` (optionally `carId=...`) using the same listing snapshot rules. This lists **delivered sessions**, not all sessions that might exist on a Timing computer. Ordering is source ID then session ID. Withdrawn sessions retain their affected car IDs and remain visible to filtered listings.
2. Fetch the session head. Preserve `resultToken`, `payload`, `summaries`, `warnings` and `requiresCorrection`. Participants in `payload` have no `laps` property; `lapCounts` lists participants with stored laps. Missing count means zero. The head retains captured configurations, drivers, stints, heats, lane lengths, classification, adjustments and reviewed race notes.
3. For each active participant, request lap pages using the head's `resultToken`. Concatenate in returned order; order is the **original stored payload order**, not a new sort by lap duration or completion time. A 409 `RESULT_CHANGED` means discard all partial pages for that session and fetch its current head. A result token remains valid through unrelated car/collection edits and changes after correction, withdrawal or database epoch replacement.
4. Only publish a downloaded session to analysis after every participant's pages are complete. Reconstruct the original payload by adding each participant's `laps` array. The fixtures/tests prove exact reconstruction for normal, multi-heat and endurance sessions.
5. Use `/changes?kind=results&cursor=...` to identify sessions to refresh. The feed is unfiltered so corrections that change car membership and withdrawals cannot disappear behind a filter. A withdrawn head removes the previous contribution to records, distance, wins and comparisons. `remove` means remove the cached contribution entirely. Retain identity/tombstone state to prevent an old retry restoring it.

Keep measurements separate from adjusted classification. Preserve `valid`, `pit`, `recordEligible`, `countsForDistance`, distance, stint/driver and lane information. Virtual participants never contribute to a physical car's records or mileage. `requiresCorrection` quarantines legacy-invalid sessions according to the existing result model. Summary definitions and units remain those of [Timing v1](../timing-v1/CONTRACT.md): milliseconds, metres, UTC ISO 8601 timestamps, one-based lanes. Race notes and driver names supplied by Timing remain public result data; unrelated private Paddock notes remain excluded.

## Cursors, resets, notifications and recovery

Cursors are opaque and scoped to database identity and storage epoch. They persist across a normal host restart. They contain no credentials. `/status` and SSE hints use the latest committed point; an unrelated save can change the cursor while a car/results batch is empty. Persist separate applied cursors for each feed/cache. Don't replace your applied cursor merely because a newer hint arrived.

The host scans at most 32 retained transactions per change batch, returning at most 512 coalesced public IDs. No SQL envelopes, changed values, signing keys or private fields are exported. Duplicate IDs in a batch collapse to their last operation. The durable log retains 256 transactions/32 MiB. A gap or changed epoch returns `resetRequired:true`; `entries` is empty, with a reason:

- `epoch`: collection restore/replacement changed the generation.
- `expired`: the needed history is unavailable.
- `batch-size`: too many changed identifiers for a bounded batch.
- `configuration-dependency`: a part/installation changed; refresh linked profiles because component names/assignments may have changed without a car revision change.

On reset, stage a complete new listing and reconcile the appropriate cached records before adopting the new cursor. Refresh all affected cached profiles/session heads even if their apparent revisions match. Do not silently clear offline race history or unsent results. A reset is a read-cache reconciliation, not permission to overwrite the Paddock database.

SSE sends `data: <scalableStatus JSON>` initially, after coalesced changes (50 ms) and as a 15-second heartbeat. It sends only hints, never collections or laps. At most 10 extension streams are accepted. Slow readers above 16 KiB/backpressure are disconnected, and revoked credentials close their streams. Reconnect with bounded exponential backoff (suggested 2–30 seconds), then check changes from the last applied cursor. No `Last-Event-ID` replay is promised; the durable changes endpoint supplies replay. Browser Origin restrictions still apply.

## Errors and limits

Errors use `{error,code}`. Common status/code pairs:

| HTTP | Codes | Client action |
| --- | --- | --- |
| 400 | `DATABASE_REQUIRED`, `INVALID_QUERY`, `INVALID_CURSOR`, `INVALID_PAGE`, `SNAPSHOT_REQUIRED`, `TOKEN_REQUIRED` | Correct the request; don't retry unchanged |
| 401/403 | Existing authentication errors, `PERMISSION_REQUIRED` | Reconnect with the authorized credential |
| 404 | `NOT_FOUND`, `CAR_NOT_FOUND`, `SESSION_NOT_FOUND`, `PARTICIPANT_NOT_FOUND` | Fall back for an old host, or reconcile a removed item |
| 409 | `DATABASE_MISMATCH`, `SNAPSHOT_CHANGED`, `RESULT_CHANGED`, `MEDIA_CHANGED`, `SESSION_WITHDRAWN`, `STORAGE_REQUIRED` | Follow the relevant reconciliation rule; never combine mismatched pages |
| 413 | `RESPONSE_TOO_LARGE`, existing `PAYLOAD_TOO_LARGE` | Explicit unsupported size; never accept truncation |
| 429 | `STREAM_LIMIT`, existing authentication rate limit | Back off |
| 503 | `HOST_STOPPED` | Retry later |

The extension caps JSON responses at 8 MiB and keeps the existing 8 MiB/50,000-lap result submission limit. Most responses are much smaller; a session head may contain up to the existing bounded configuration/stint metadata. No enlarged session submissions are introduced. Older v1 consumers remain within their current supported limits, and oversized submissions still fail explicitly. The 200 MiB collection limit remains. Full streamed backup and larger storage are later phases.

## Compatibility and validation

| Host / client | Behavior |
| --- | --- |
| Existing host + existing client | Existing v1 behavior |
| New host + existing client | Same default status, inline profile/collection photos, complete v1 Telemetry sessions and result-write semantics |
| Existing host + new client | No advertised extension / 404 probe; use existing v1 routes |
| New host + new client | Opt-in discovery, incremental IDs, separate main-picture chunks, session heads and paged laps |
| New Paddock copy using Dealership v2 | Separate private protocol; this extension does not replace it |

Automated local tests cover old strict schemas, authentication, Origin/database checks, persistent cursors, archive/delete, reset/recovery, response page bounds, corrections, withdrawal, virtual/pit/invalid laps, immutable raced configurations, exact session reconstruction, separate image bytes, stream revocation and fixture validation. Windows packaged-runtime tests are recorded in the phase review. Native Linux/macOS runs, actual Timing/Telemetry client adoption and a physical multi-computer run remain separate acceptance work.

Regenerate fixtures using `node scripts/export-scalable-handoff.cjs`; validate them with `node --test tests/scalable-api.test.cjs`. Generation uses a temporary artificial database and changes no user collection. `schema.json` includes existing Timing definitions to make the new response definitions self-contained. New clients should tolerate future additive capability fields while honoring the negotiated version.
