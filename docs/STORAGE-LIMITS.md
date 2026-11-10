# Storage limits and qualification

This describes SQLite storage in v1.2.0. **The 200 MiB total logical collection cap has been removed.** Original photos and documents are stored separately and do not count toward the replacement **200 MiB working-metadata safeguard**. Full-model operations still hold and validate bounded non-media records; this is not unlimited storage. SQLite file size also includes indexes, recovery information and reusable pages, and deduplicates repeated originals.

Settings → Database shows the database file size, distinct currently referenced media, retained recovery/synchronization media, logical usage, working metadata and free space. Media sizes are their encoded storage sizes, not decoded pixels. These figures are not additive: media already occupies space inside the database file. Recovery archives and temporary work files are additional disk usage.

## Safeguards

- Saves preflight free space using submitted metadata and new/replaced original media, with a 16 MiB reserve. Unchanged deduplicated media is not charged again. External assets are measured without loading their bodies. SQLite still rolls back if space disappears after the check; the estimate cannot reserve space against other applications.
- Portable backup/restore checks the larger staging and recovery footprint separately. Progress and cancellation remain available for these background operations. Keep a verified portable backup on another drive.
- Legacy JSON exports and network packages measure lazy originals before serialization. Oversized operations fail clearly rather than first allocating the entire payload. Existing size limits and wire formats remain intact.
- Query-page saves omit a redundant full-model response snapshot. Legacy internal callers can still request that response. This does **not** mean every domain operation or startup now loads only selected records.
- Ordered history queries use manifest order with indexed record lookups, avoiding a repeated full ordinal scan for each matching row.
- Current-format desktop startup loads the directory, common definitions and first-screen records. Bodies are checked when read; old-format migration and full-model operations retain complete validation. Ordinary first saves use scoped dependencies. See [SQLite storage](SQLITE-STORAGE.md).
- Overview counts use transactionally maintained derived counters. Existing version-6 query indexes gain counters without rebuilding car/lap projections; a missing or stale index still rebuilds from authoritative records.
- Inactive Dealership copies stay unopened until selected. Connection status reads only an identity hint; activation uses the appropriate deferred or migration validation path. File protection, media sweeping and shutdown do not force the copy open.

## Limit audit

MiB means 1,048,576 bytes. Some older error messages use “MB” for the same binary byte limits.

| Scope | Current bound | Purpose / decision |
| --- | --- | --- |
| Total logical collection | No aggregate media cap | Limited by disk resources, record counts and per-operation limits |
| Working metadata | 200 MiB | Bounded core validation; each original-media reference contributes a conservative 256-byte allowance, not its body |
| Cars / inventory records | 10,000 / 50,000 | Domain bounds remain; these are not performance guarantees |
| One photograph | 12 MiB encoded data URI, approximately 9 MiB original bytes | Preserve exact originals within the limit; larger originals require an explicit smaller-copy choice. No automatic enlargement of decode limits |
| One private document | 20 MiB decoded | Bounds validation and document opening/export |
| Legacy JSON file import/export | 256 MiB | Matching reader/writer boundary; use `.sfpbackup` for full backups |
| Manufacturer catalogue input | 16 MiB | Checked during file reading, not only by the initial stat |
| Public car package | 1,000 cars; file/network byte bounds also apply | Select fewer cars when a package exceeds the transport bound |
| Legacy public sharing request / complete response | 32 MiB | Large catalogues need paged clients; individual network requests remain bounded |
| Legacy catalogue pages / total client cache | Approximately 16 MiB / 200 MiB | Existing compatibility client still assembles the full public collection |
| Legacy Dealership snapshot | 220 MiB | New clients use sync v2; oversized old-style snapshots receive HTTP 413 |
| Dealership proposal | 16 MiB | Independent of the collection limit |
| Review proposal history | 5,000 total / 200 pending | Retains delivery identities; fails closed instead of forgetting retries |
| Dealership replay retention | 256 transactions / 32 MiB, plus 32 MiB replay-only media | Older cursors require explicit verified replacement |
| Dealership sync v2 batch | 32 transactions / approximately 2 MiB | Oversized transactions require snapshot replacement |
| Dealership snapshot metadata / chunks | 220 MiB / 1 MiB | Host writes metadata incrementally; receiver assembles bounded metadata; attachments transfer separately |
| Snapshot idle timeout / concurrent offers | 2 minutes without a request / 2 | Successful metadata or asset requests renew the timeout |
| Timing result submission | 8 MiB / 50,000 laps / 256 participants | Atomic corrected/withdrawn session semantics retained |
| Scalable public API | 8 MiB responses; 50 index entries; 250 laps; 256 KiB media chunks | Negotiated separately; no silent truncation |
| Portable backup format 2 | 32 MiB per record/manifest; 28 MiB per encoded asset | No archive-wide cap; active restore validates the working-metadata safeguard |
| Original cache / thumbnail cache | 32 MiB / 16 MiB | Bounded runtime caches; active media handles are not original bodies |
| Temporary editor photographs | 200 MiB | Separate staging guard, not the active collection limit |

Text lengths, array counts, query offsets, pixel-decoding checks, request timeouts, authentication and pending-operation bounds also remain. The aggregate media cap was removed after active-collection, persistence, synchronization and backup qualification; individual resource bounds remain.

## Compatibility and acceptance

Use capability negotiation, not assumptions based on the app's name or network address:

- Current live storage format: **3**. Old JSON migration retains the original file. Older binaries must not open an unsupported SQLite format. Earlier format-3 builds may still enforce the old aggregate cap; do not assume they can open a large new collection. Keep a backup and use a supported bounded export when downgrading.
- Portable backups: **format 2**; older apps need a supported JSON export within its size bound.
- Dealership replication: **sync version 2** with the existing user-chosen password. Legacy sharing remains available within its bounds.
- Timing submissions: existing **integration version 1**. Telemetry's existing reads remain supported. Optional scalable reads require **`scalable-v1`** negotiation; the other apps own their client upgrades.

Included in v1.2.0. Host tests do not certify native Linux/macOS packages, actual Timing/Telemetry client upgrades, or physical LAN behaviour.

## Completion and remaining platform acceptance

General transactions use copy-on-write drafts and persist only changed record bodies. Validated unchanged records/subtrees reuse their local checks and size measurements; cross-record dependencies are still checked. Incremental replica application reconstructs only changed records and commits them with the cursor. Review comparisons preserve unchanged identities; negotiated general-review baselines hash record digests rather than loading originals. Host snapshot metadata streams to a temporary file from one consistent revision.

Startup inspects the record directory and initial view; explicit full domain validation still inspects bounded working metadata. Manifest/record lists and some selectors scale with collection size. These intentional costs are protected by the separate metadata guard; no claim of constant-time operations or unlimited metadata is made.

The active 2.1 GiB synthetic collection passed editing, stock installation, maintenance, Timing duplicate/correction/withdrawal, general reviewed changes, full localhost replication, incremental catch-up, restart, exact original hashes, portable export and validated restore staging. Native macOS/Linux execution, OS cold-start timing and physical multi-computer acceptance remain release checks. New Timing/Telemetry scalable-client adoption is separate from compatibility with existing APIs.

Run `npm run qualify:large` for the active 2.1 GiB qualification (272 unique 8 MiB encoded originals); `npm run qualify:large -- 26` exercises a smaller collection above the previous cap. Fixtures are disposable and require substantial free disk space. Reports are written beneath `.qa`.

Run `npm run qualify:storage` for disposable 100, 500, 1,000 and 5,000-car fixtures with twice as many parts, custom values, original-photo sharing/deduplication, 10,250 measured laps, history and review proposals. Results go to `.qa/phase8-qualification.json`. The benchmark uses separate measurement processes and a warm OS cache. It measures host-local proposals, not LAN round trips. See the review record (internal development reference) for measured evidence and remaining failures.

### Startup follow-up measurements (3 November 2026)

On the same Windows reference machine, backend startup plus overview now takes 255 / 392 / 638 / 1,880 ms at 100 / 500 / 1,000 / 5,000 cars. The 5,000-car local save/detail p95 is 130 ms, with 16.6 ms maximum synchronous preparation and 343 MiB peak process RSS over the complete benchmark (previously 210 ms and 504 MiB). Original photo reads remain zero on startup and ordinary edits.

A separate real Electron run with the synthetic 5,000-car fixture reached the rendered overview in 2,101 ms from the benchmark entry point. This excludes OS process launch, uses a warm OS cache and an already-upgraded derived index, and runs hidden. Across 120 page switches, renderer heap after collection stayed about 1.9–2.0 MB, DOM count returned to 256 each time, and working memory settled. Main-process working set was about 192–194 MiB after warm-up. These are measured observations, not a universal performance guarantee or proof that every workflow is bounded.

The repeatable desktop probe is `scripts/qualify-startup.cjs`: run it with Electron and a synthetic SQLite fixture beneath `.qa`. It copies the fixture into its own QA profile, never the installed profile. Its output records stage timings, process memory and 20-page checkpoints; renderer garbage collection at those checkpoints distinguishes retained objects from transient allocations. The source fixture is unchanged. See the review for final regression evidence.

The corresponding 1,000-car real desktop run reached its overview in **800 ms**, with a 444 ms Store open, under the two-second reference target. This uses the same warm-cache hidden-window methodology; it is not an OS cold-start claim.

### Phase 8 completion qualification (before deferred startup and scoped writes)

The final backend run includes the replacement metadata accounting and copy-on-write validation reuse. At 1,000 cars plus 2,000 parts and 10,250 laps, open/overview took 805.5 ms, targeted edit/detail p95 37.9 ms and maintenance save p95 53.8 ms. At 5,000 cars these were 2,543.4 ms, 187.4 ms and 235.3 ms, with 442 MiB peak RSS across the measurement process. Earlier startup-only measurements above are historical checkpoints, not the final totals. Ordinary car preparation stayed under 16 ms, but the 5,000-car maintenance operation still had 185.5 ms synchronous preparation from bounded global checks. No universal no-stall claim is made.

Final regression evidence: 615 Node tests, 210 desktop workflows, syntax checks and packaged Windows SQLite/worker backup/restore checks passed. A fresh hidden Electron run opened the 5,000-car overview in 2,403.3 ms and completed 120 page switches with stable DOM counts and settled process memory. Active 2.1 GiB media workflows peaked at approximately 299 MiB RSS; portable export and validated restore staging also passed. See the review for precise scope, hardware, timings and remaining platform acceptance.

### Deferred startup and scoped writes

The subsequent startup and first-write improvements supersede the earlier full-load measurements above. See deferred startup (internal development reference) and scoped first writes (internal development reference). The final pre-release suite passed 651 automated tests and 210 desktop checks. Full-model compatibility operations remain explicit exceptions.
