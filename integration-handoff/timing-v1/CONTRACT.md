# Timing integration v1 contract

This document and `timing-v1.schema.json` define the implemented contract. HTTP paths are under the existing Paddock host. The sharing protocol stays `2`; the independent Timing integration version is **1**. Breaking changes require a new advertised integration version. Clients should ignore unknown response properties for future additive metadata; v1 request properties are strictly validated.

## Transport, authentication and discovery

- Local HTTP with UTF-8 JSON, no redirects or compression. This is a trusted-LAN service, not an Internet API. No browser CORS access is granted; **any Origin header is rejected**, including `null`. Use Electron main.
- Every request requires `Authorization: Bearer <connection-code>`; a code is 24 hex characters. Codes are shared secrets, never advertised by discovery or returned by `/v1/status`.
- Three independent codes: browse (`browse: true`, `submit: false`, `timingResults: false`); car submissions (`browse: true`, `submit` follows host toggle, `timingResults: false`); Timing (`browse: true`, `submit: false`, `timingResults` follows its own host toggle).
- Timing permission authorizes receipt lookup, session writes, corrections and withdrawals. It is not implicit in browsing or car-edit submissions. Permission and database identity are checked again after an upload completes. The code grants access to all Timing sources on this host; `source.id` is a namespace, **not a separate authentication identity**. Give the Timing code only to trusted race directors.
- Sharing restart generates new codes and disables Timing results. Existing session records and capture signatures survive. Revoking codes rotates all three. Capture signatures are not authentication tokens; they remain valid across network code changes.
- Discovery: UDP IPv4 multicast **239.255.47.77:47778**, TTL 1. Send `{"type":"slotforge-discover","version":1,"nonce":"<32 lowercase hex characters>"}`. Hosts reply to the sender's UDP port with `type: "slotforge-host"`, `version: 1`, the same nonce, database `id`, `name` and **actual HTTP port**. Combine that port with the UDP reply's source IPv4 address. Never interpret 47778 as the HTTP port. See discovery fixtures.
- Validate matching nonce/version, private source IPv4, port 1–65535, ID (1–100 ASCII letters/digits/underscore/hyphen), name (1–200 characters), and response size ≤2,048 bytes. Scan across suitable local interfaces; suggested discovery window 1.8 seconds. Firewall/VPN/client isolation may block discovery; manual connection remains supported.
- All `/v1/timing/*` calls also require `X-SlotForge-Database: <paired-database-id>`. Writes additionally require matching body `databaseId`. Never silently re-pair if an address now serves another database. Port/address/name changes do not change identity.

## Endpoints

| Method / path | Permission | Request / response |
| --- | --- | --- |
| GET `/v1/status` | Any valid code | Existing identity/name/revision/permissions plus `capabilities.timing`. Schema `$defs.status`; status fixture. |
| GET `/v1/collection` | Browse | Existing public catalogue. Send `X-SlotForge-Pages: 1`; follow `nextOffset` using `?offset=N&revision=R&database=ID`. Pages must have identical database ID and revision. Restart pagination on 409. Up to 25 cars / approximately 16 MiB per page; legacy unpaged response limited to 32 MiB. Archived cars are omitted. |
| GET `/v1/timing/cars/{carId}` | Browse | `$defs.profile`. Includes archived cars if requested directly; missing car returns 404. Current configuration only. |
| POST `/v1/timing/sessions` | Timing results | Root schema (`$defs.active` or `$defs.withdrawal`); success is HTTP 200, `$defs.receipt`. |
| GET `/v1/timing/sessions/{sourceId}/{sessionId}` | Timing results | Latest `$defs.receipt`, with `duplicate: false`; 404 if no identity is stored. No driver/lap payload is exposed by this endpoint. |

Timing should check `/v1/status` first, with or without the database header, to establish identity. A missing `capabilities.timing` means browsing only; do not probe car-submission endpoints for results support. Paddock's old `/v1/submissions` endpoint remains a reviewed **car package** endpoint.

Unknown Timing paths/methods return 404 `NOT_FOUND` after auth/identity/permission checks. Query parameters are not used by Timing endpoints. No saved-setup selector, delta feed, arbitrary car lookup by name or lap-result pagination is provided by v1.

## Public car profile and capture

Profile `car` exposes only `id`, `name`, `maker`, `marque`, `model`, `scale`, `raceClass`, `picture`, `availability` and `archived`. Optional catalogue values appear as empty strings. `picture` is the main PNG/JPEG/WebP data URL, or empty; it is not an external URL. No ownership, purchase details, private notes, documents or additional photos are exposed here.

`configuration` is an opaque, signed object:

- `databaseId`, `carId`, `kind: "current"`.
- `configurationId` and `revision`: the same 64-character SHA-256 content digest of database/car identity, kind, public technical values and installed-component snapshot. A rename alone does not change it. Reverting to identical configuration content can recover the same digest; it is **not a monotonic integer**.
- `carRevision`: the car record's integer revision at capture. This can change for non-technical edits.
- `capturedAt`: Paddock's UTC time when the profile was read.
- `technical`: explicitly allowed existing Paddock specification fields; all values are **strings**. `technicalNotes` is excluded. Do not parse or rewrite this object before resubmission.
- `components`: installed inventory `partId`, `name`, `quantity`, `field`, `position`, and nullable `assemblyId`. No private stock notes or storage locations.
- `signature`: server HMAC-SHA256 over all other configuration properties, with a private key persisted in this database. The first capture persists a key before returning; this may advance the database revision once. Subsequent profile reads do not change it.

Timing must keep the exact returned object with the raced participant. Host validation verifies the signature and identity, **not equality with the car's present configuration**. Old authentic captures remain acceptable after changes, rename, code rotation, restart or archival. Capture time has no expiry and is not compared with race timestamps because PCs can have different clocks. Timing is responsible for capturing before racing and displaying offline capture age. Signature verification proves the capture was issued by this database; it does not prove the physical car was assembled that way.

Saved setups are deliberately unsupported in v1. If a car is built from a saved setup, capture its actual current configuration once the work is complete. Do not substitute a setup ID for a configuration ID.

Existing conventional technical units remain: RPM for `ratedRpm`/`measuredRpm`; volts for voltage fields; teeth for `pinion`/`gear`; millimetres for dimensions, axle play and clearance; grams for weight/ballast where entered as a numerical weight; gf·cm for motor torque. These are user-entered descriptive specifications, not authoritative measured race values. Missing/unparseable specifications stay as strings and never become zero automatically. Snapshot fields are an opaque record, not inputs to result validation.

## Session envelope and identities

`integrationVersion: 1`, intended `databaseId`, `source: {id, name, application: "SlotForge Timing"}`, `sessionId`, integer `revision` 1–1,000,000, and `state` are mandatory.

- Generate and persist `source.id` once per Timing installation. Renaming the PC changes `source.name`, not its identity. Moving an installation with its durable queue must preserve its source ID.
- Generate and persist one `sessionId` before initial delivery; preserve it for corrections/withdrawal.
- Session identity is `(source.id, sessionId)` within the targeted database. Track identity is `(source.id, track.id)`. Driver IDs are scoped to their participant; heat IDs to the session; stint IDs to their participant; lap IDs are unique across the entire session.
- Linked car identity is `(databaseId, carId)`. Names are for display only. A missing car rejects the **entire** write with `CAR_NOT_FOUND`. No automatic relinking by name. An archived car accepts historical results with `CAR_ARCHIVED` in the receipt warnings; reading its profile exposes `archived: true`.
- `state: "active"` is a full replacement result document. `state: "withdrawn"` contains only the envelope and nonempty `reason`. It is not an HTTP DELETE.

## Active session data

Exact required/optional fields and bounds are in the JSON Schema. There is no implicit type coercion: numbers must be JSON numbers, booleans must be booleans. Unknown properties are rejected. Duration offsets and lap durations are **integer milliseconds**; distances are **metres**. Lane numbers are **one-based**, 1–64.

Dates must be ISO 8601 **UTC with exactly millisecond precision**, e.g. `2026-10-31T10:01:00.000Z`. Normalize offsets to UTC before sending. Invalid calendar dates are rejected. A session can last at most seven days.

| Section | Meaning |
| --- | --- |
| `name`, `type` | Display name; `practice`, `qualifying`, `race` or `endurance`. |
| `startedAt`, `endedAt` | Wall-clock session bounds. Offsets below are elapsed from `startedAt`, including pauses. |
| `track` | Source-scoped ID/name and one or more unique lane numbers with `lengthM` (number or null when unknown). Never guess unknown lengths. |
| `heats` | ID/name, `startedAtMs` and `endedAtMs` offsets inside the session. Parallel heats are allowed; one participant cannot drive overlapping stints. |
| `participants` | Stable entry ID, `physical` or `virtual`, nullable linked `carId` and `configuration`, display name, drivers, stints and laps. Car/configuration must both be present or both null. One linked physical car uses one participant across all heats/driver changes. Unlinked physical entries can be included for complete standings but contribute nothing to a Paddock car. |
| `drivers` | IDs and names, maximum 100 per participant. No user accounts or email addresses required. |
| `stints` | Reference heat, driver and lane, with non-overlapping start/end offsets within the heat. A driver or lane change creates a new stint. |
| `laps` | Unique ID, stint ID, positive lap number within participant/heat, measured `durationMs`, completion offset `endedAtMs`, validity/pit/record/distance flags, nullable measured `distanceM`, and reason. Empty reason is allowed. |
| `standings` | Final reviewed **session-wide** classification: participant, nullable position, status (`finished`, `dnf`, `dns`, `disqualified`), `classifiedLaps` (can be fractional), `classifiedElapsedMs`, and points. May be empty for practice. Only a finished participant may have position 1. Tied positions are allowed. |
| `adjustments` | Participant, kind (`time`, `laps`, `points`, `other`), signed amount and reason. `time` amounts are milliseconds, `laps` are laps, `points` are points; `other` is descriptive and its reason must explain the amount. These adjustments are **already included** in standings. Paddock does not apply them again. |
| `notes` | Reviewed session notes (maximum 4,000 characters). Not a technical modification or maintenance instruction. |
| participant `summary` | Optional cross-check using `$defs.summary`. Paddock recomputes it; discrepancies >0.000001 for numbers or any other mismatch return `SUMMARY_MISMATCH`. See `normal-with-summary.json`. Omit if Timing cannot supply exactly these meanings. |

Lap numbers must be unique and increasing within participant/heat when sorted by completion time. Measured lap intervals cannot overlap within participant/heat. A lap must finish within its referenced stint and its measured start must be inside that heat. A lap crossing a driver-change boundary is attributed to the stint/driver at completion; its measured interval is not split. Incomplete laps without a measured completion are omitted from `laps`; fractional classification belongs in standings. This version does not add fractional laps to physical mileage.

Invalid and pit laps require `recordEligible: false`. Valid non-pit laps may also be ineligible (for example, practice conditions unsuitable for official records). Paddock never promotes an ineligible lap. A Virtual Rival must use `kind: "virtual"`, `carId: null`, `configuration: null`. Virtual and unlinked entries are stored for context/classification but never contribute to physical-car statistics.

## Derived statistics: measured versus classified

The receipt contains per-participant `summaries` and an `included` flag. Paddock recomputes these from the accepted latest active document; it never adds client-provided totals to existing counters. For virtual/unlinked/withdrawn entries the physical contribution is zero; withdrawn receipts have no summaries.

| Statistic | Exact meaning |
| --- | --- |
| `validLaps` | Count of `valid && !pit` measured laps. |
| `recordEligibleLaps` | Count of `valid && !pit && recordEligible` laps. |
| `bestLapMs` | Minimum duration among eligible laps; null if none. |
| `averageLapMs` | Arithmetic mean duration over valid non-pit laps, including valid laps not eligible for records; null if none. |
| `measuredTimeMs` | Sum of valid non-pit lap durations. Excludes pauses, pit laps and race adjustments; **not session elapsed time**. |
| `distanceM` | Sum of known distances for physical linked laps with `countsForDistance: true`. Invalid/pit laps may still represent actual travelled distance and can count if Timing explicitly says so. No inferred distance from elapsed time, classification or simulated fuel. |
| `distanceComplete` | False if a distance-counting lap has `distanceM: null`; then the sum is a lower-bound known distance. No distance-counting laps yields true. |
| `wins` | 1 for a physical linked participant classified first with `status: finished` in race/endurance; otherwise 0. A tie can give multiple wins. Practice/qualifying never add wins. No per-heat wins are inferred. |

Keep records scoped to source-scoped track and, where relevant, lane/conditions and captured configuration. A raw fastest lap across different tracks is not a meaningful track record. The car UI shows session-level best laps and overall session/lap/distance/win totals; it does not publish a cross-track record leaderboard.

## Idempotency, corrections and withdrawal

The server canonicalizes parsed JSON recursively: object keys sorted, array order preserved, JSON primitive values unchanged. SHA-256 of that representation is `contentHash`. Whitespace and object-key order do not matter; array order does. JSON numeric equivalents such as `1` and `1.0` represent the same content. Preserve logical content across retries.

| Delivery | Outcome |
| --- | --- |
| First identity | Persist then 200; `duplicate: false`. |
| Same revision, same content | 200 with original hash/time, `duplicate: true`; no write/revision increment or repeated notification. |
| Same revision, different content | 409 `REVISION_CONFLICT`; nothing changed. |
| Older revision | 409 `STALE_REVISION`; nothing changed. |
| Newer revision | Atomic full replacement plus minimal audit entry for the previous revision. Derived statistics reflect only the new active payload. |
| Withdrawal | Persist tombstone, stop all contribution, retain source/session/revision/hash/reason and prior car associations. Duplicate handling is identical. |
| Withdrawal arrives before result | Create a tombstone even if there is no earlier payload. Late older results remain stale. |
| Newer active revision after withdrawal | Explicit reinstatement; allowed only with a greater revision and valid full document. |

All cars in a multi-car session commit together or none commit. A correction removing a car removes its contribution and leaves a visible “Removed by correction” association. Withdrawn/corrected status and revision history remain visible on affected cars. Old full lap payloads are replaced, not retained indefinitely; the audit retains revision/state/hash/receipt time, not every earlier race data byte. Each session retains at most 1,000 accepted versions.

The database write uses the existing atomic temporary-file/flush/rename transaction. Failed writes leave in-memory state unchanged and return no success. A disconnected client may not know whether a write committed: retry the identical revision or query the receipt. These identities persist across host restarts, not just in RAM. A full backup includes sessions, tombstones and the capture key. Restoring a backup from **before** a delivery necessarily restores older receipt state; reconcile queues after such rollback. Do not treat two diverged copies of one database ID as concurrent hosts.

## Errors and retries

Every Timing error body is `{ "error": "Human-readable explanation", "code": "MACHINE_CODE" }`. Match `code`, not message text. Authentication/origin/identity errors can take precedence over payload validation. Malformed requests are never queued for review.

| HTTP | Code | Timing response |
| --- | --- | --- |
| 400 | `INVALID_JSON`, `INVALID_PAYLOAD`, `SUMMARY_MISMATCH` | Keep local result; fix serialization/data before retrying. |
| 400 | `DATABASE_REQUIRED` | Send paired database header. |
| 401 | `UNAUTHENTICATED` | Ask for current code; do not discard local results. |
| 403 | `BROWSER_ORIGIN_FORBIDDEN` | Use Electron main; do not weaken Paddock protection. |
| 403 | `TIMING_PERMISSION_REQUIRED` | Dedicated Timing code and host permission required. |
| 404 | `CAR_NOT_FOUND` | Resolve missing identity; never attach by name. |
| 404 | `SESSION_NOT_FOUND` | No receipt stored; queued original can be sent. |
| 404 | `NOT_FOUND` | Check negotiated API path/version. |
| 409 | `DATABASE_MISMATCH` | Stop this connection and verify the original host. |
| 409 | `CONFIGURATION_MISMATCH`, `CONFIGURATION_INVALID` | Preserve local evidence. Do not substitute today's configuration for an already-raced car. Resolve capture/original-host mismatch. |
| 409 | `REVISION_CONFLICT` | Fetch latest receipt; require deliberate reconciliation/new revision. Never silently overwrite at same revision. |
| 409 | `STALE_REVISION` | Fetch receipt and reconcile with newer local queue items; do not retry the stale item forever or mark its content accepted. |
| 413 | `PAYLOAD_TOO_LARGE` | Do not retry unchanged; inspect size/contract limits. No automatic session splitting, as that changes identity/wins. |
| 415 | `CONTENT_TYPE_REQUIRED`, `CONTENT_ENCODING_UNSUPPORTED` | Use uncompressed UTF-8 `application/json` (optional `charset=utf-8`). |
| 422 | `UNSUPPORTED_VERSION` | Negotiate supported integration version. |
| 500 | `STORAGE_FAILED` | Retain queue; retry later after host storage is fixed. |
| 507 | `CAPACITY_EXCEEDED` | Host needs attention; retain local result. |

Transient timeout/socket/5xx failures should retry with capped backoff. There is no guarantee of a JSON body if the socket breaks or HTTP parsing fails before the route runs. Particularly abusive uploads may be disconnected after a bounded drain rather than reading an unlimited body. An HTTP 200 receipt is successful only if its identities and revision match the queued item. `receivedAt` is the host's acceptance time, not race time.

## Limits

- Session body **8 MiB** maximum (8,388,608 bytes); maximum **50,000 laps across the whole session**, 256 participants, 1,000 heats, 64 lanes, 100 drivers and 2,000 stints per participant, 2,000 adjustments. No chunked-session assembly API; HTTP chunked transfer itself is supported within the byte limit.
- At most 10,000 imported session identities including withdrawal tombstones; overall existing database limit 200 MiB still applies. Tombstones are not automatically purged.
- Session/heat/stint offsets ≤604,800,000 ms (7 days); positive lap duration ≤86,400,000 ms (1 day); lap number ≤1,000,000; per-lap/lane distance ≤100,000 m. Durations are bounded safe integers. Unknown distance is null.
- IDs 1–100 ASCII letters/digits/underscore/hyphen. Names generally 1–200 characters. Full field-specific text/numeric/array limits are in the schema.
- Host maximum 30 connections; request timeout 15 seconds, header timeout 10 seconds. No internet transport, TLS termination, per-installation account system, automatic discovery trust, cross-host conflict resolution or source registration endpoint in v1.

## Schema use

The root schema validates session submissions. Response definitions are `$defs.profile`, `$defs.receipt`, `$defs.status`, `$defs.error`; snapshot is `$defs.configuration`. Use draft 2020-12 with date-time validation enabled. The `.invalid` `$id` is an identifier, not a fetchable endpoint. Register the local schema; do not download it.

Schema validation alone cannot enforce cross-references, chronological bounds, signature authenticity, revision state, duplicates or computed summaries. These semantic rules are enforced by Paddock and covered by local server/client tests. Fixtures and schema are generated from the runtime definition with `node scripts/export-timing-handoff.cjs`, and tests compare the published schema to the runtime version.
