# Deferred startup review — 3 November 2026

## Behaviour

Current desktop collections and remembered Dealership copies can open without reconstructing every car, inventory record, history entry and measured lap session. Startup verifies the small record directory, committed identity and query-index generation, then validates the settings and definitions used by the screens. The Overview uses the existing bounded SQLite page queries. The normal path never reads the old collection JSON file.

Record sections load when requested. Individual page queries do not need to populate their complete sections. Loaded sections remain cached for the current session; there is no timer that loads everything after the first paint. Media retention consults asset references, and Review counts use SQL, so those housekeeping tasks do not accidentally trigger full loading.

This changes neither database format nor the Timing, Telemetry or Dealership contracts. Legacy JSON migration, outdated indexes/storage formats and rollback-journal recovery retain the fully validated opening path.

> Follow-up: the first-write full-model boundary described below has been replaced by [scoped writes](2026-11-03-scoped-first-writes.md). This document records the preceding startup phase.

## Transaction boundary

Writes still require complete domain validation because stock, configurations, reviews and results have shared invariants. Before the first asynchronous write, an integrity-check worker performs the SQLite scan; record bodies then decode in batches of 64 between event-loop turns. The normal validator runs before transaction preparation. Publication and notifications still follow successful atomic persistence.

Every deferred read is bound to the original database identity, revision and change epoch. A newer external revision causes an error rather than mixing old and new records. Read bodies verify their field digests and attachment references. A corrupt unopened body may be discovered when opened or before the first write rather than at launch; it is never silently ignored or replaced.

Synchronous compatibility operations and full snapshots/exports can still require the full model. Some screens use section-wide selectors. Settings calculates exact sizes from stored shapes and SQL byte lengths without populating the model. This is not a conversion of every domain operation into an independent, bounded SQL command, nor does it promise constant memory after all sections have been used.

## Review findings addressed

- Periodic media retention would have walked every deferred getter. It now checks only registered image hashes against committed asset references.
- The Review badge previously filtered all proposal bodies. A revision-bound SQL count now supplies the badge and connection status.
- The first save could have moved startup blocking into the first button click. Async materialization now yields between record batches, with the integrity scan in a worker. The remaining final domain validation is still synchronous.
- Read-only opening cannot recover a hot rollback journal. A simulated interrupted child writer confirmed that startup takes the established writable recovery path and restores the exact prior collection.
- The initial screen's settings and field definitions are validated without falsely marking the unloaded collection as globally validated.
- Query readers now verify agreement between a record's attachment references and `asset_refs`, as well as existing field and attachment-metadata checks.
- Exact storage totals formerly required complete materialization. Shape/byte-length accounting preserves both logical and working-metadata totals, including Unicode and repeated original images, without loading domain bodies into JavaScript.

## Regression coverage

Fifteen focused tests cover first-screen/body loading, car-page equivalence, first edits and stock fitting, untouched originals, undo state, corrupt deferred fields, stale revisions, scalar/array extension images, media retention, index upgrade fallback, malformed directories, event-loop yielding, queued first saves, lightweight review counts, Timing/Telemetry contract compatibility, failed first-write rollback, hot-journal recovery and exact deferred storage totals. The HTTP integration case exercises a real localhost host, Telemetry browsing and a Timing correction after deferred startup.

The complete Node suite passed **634 tests** and syntax checks passed. The final desktop suite passed **210 checks**, with no captured renderer errors or screenshot retries. The Windows ASAR package passed deferred Overview loading, unopened Timing history, the first-write integrity worker, batched saving, persisted edits, portable export/staging workers and exact restored-collection comparison. Runtime: Electron 45.1.0 / SQLite 3.53.4.

The 208 MiB original-photo qualification also passed with deferred opening enabled for the active collection and restart: first edits, stock fitting, maintenance, Timing duplicate/correction/withdrawal handling, reviewed changes, full localhost transfer, incremental catch-up, restart, exact-original hashing and portable export/validated restoration. It opened in 11.6 ms (28 cars); ordinary work read zero originals and catch-up transferred 4,373 bytes / five record bodies. Active-workload peak RSS was 320.5 MiB; this includes workers and replication/backup work and is not a startup-memory claim. Report: `.qa/deferred-active-26.json`.

Native macOS/Linux, physical multi-computer LAN and OS cold-cache startup are not covered by this run.

## Performance scope

The synthetic fixture has 5,000 cars, 10,000 parts and 10,250 measured laps. The real Electron qualification uses a disposable copy, a hidden window, warm OS caches, a rendered Overview and 120 page switches. Previous qualification measured 2403.3 ms to the usable Overview, including a 1956.7 ms Store open. The final deferred run measured **581.9 ms** and **60.3 ms** respectively, approximately **76% less time to the usable Overview**. The first repeat measured 569.7 ms. See `.qa/deferred-startup.log` for the final repeat and loaded-section diagnostics.

The final run's main-process working set was 123.6 MiB at the Overview. Navigating through additional sections raised it to approximately 178 MiB by the end. The renderer's post-GC JavaScript heap stayed around 1.9–2.0 MB and the Overview returned to 256 DOM elements. Process working sets include caches and do not equal live JavaScript heap. These are measured workloads, not guarantees for every machine or every database.

Startup diagnostics recorded eight common scalar/definition records loaded by the deferred model. The loaded section list excludes cars, parts, events, tests, documents and timing; the page reader separately retrieves the visible cars/events/jobs. This distinguishes loading a small page from loading complete domain collections. The lightweight record directory still scales with record count.

The app version remains 1.1.2. This work does not publish a release or modify the user's installed collection.
