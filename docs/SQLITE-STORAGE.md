# SQLite storage and migration

Paddock stores personal collections and Dealership replicas in local SQLite files. The application remains JavaScript/Electron. SQLite is included in the runtime; users do not install or configure a database server.

## Existing collections

On first opening a profile, Paddock checks for `database.sqlite`. If it does not exist, an existing `database.json` is validated and migrated to a temporary SQLite file. The temporary database is read back, validated and compared with the complete source data before it becomes the live database. Publication uses an exclusive filesystem hard link so it cannot overwrite a database created by another process during migration. The local filesystem must support hard links; publication failure leaves the original JSON unchanged. The original JSON file and its existing `.previous` copy are left unchanged. Dealership cache databases follow the same process.

The original JSON is a migration-time recovery copy, **not a continuously updated backup**. Once SQLite exists, subsequent changes are saved there. Do not delete SQLite to switch back to an older app: doing so would expose the stale JSON collection. Export a complete backup from the current app first, and use a compatible app's backup restore workflow.

A corrupt, empty, incomplete or unsupported SQLite database produces an error rather than silently starting an empty collection or reverting to the older JSON. Current-format desktop startup verifies the committed identity, record directory, index generation, settings and field definitions. Individual bodies and attachment references are checked when read. Normal writes validate their affected records and dependency groups; corruption in an unopened, unrelated section is reported when it is read or during full validation, rather than requiring every edit to open the whole collection. Attachment bodies are hash-verified when read; eager migration/backup verification also checks their bodies. Recovery from a rollback journal takes the established writable, fully validated opening path. Keep the files for recovery. Never edit an active database directly or place a single SQLite file on a shared network drive: use Dealership Mode to connect computers.

## Loading on demand

The desktop opens current format-3/schema-11 databases with current indexes using a deferred model. It reads the record directory and common screen definitions, then uses the existing SQLite page queries for the Overview. Cars, parts, history, documents and lap-session bodies are not all reconstructed before the first screen appears. Existing connections and the Review badge also avoid loading an inactive replica or every proposal.

Unloaded sections are revision-bound getters. Existing domain consumers load a section when they request it; page queries can read individual records without populating the whole section. Loaded sections are retained for the running session. Image cleanup consults attachment references instead of triggering section loading. There is no automatic background full load.

Normal commands now use scoped workspaces. Car text edits, favourites and maintenance entries read the named car and common definitions. Preferences, reusable definitions, supplies and incoming packages use their respective groups. Stock, assemblies, setups and jobs validate their complete connected stock group. History is appended without opening old entries, except when stock deletion must check historical references. Timing deliveries read the addressed session and participating cars; duplicate, conflict, correction and withdrawal semantics are unchanged. Dealership proposals and approvals use the same scopes and atomic commit boundary.

After a scoped commit, a fresh deferred view is bound to the new revision. Omitted records remain in the committed manifest; a sparse workspace is never treated as a replacement collection. Size limits use revision-bound SQL counters updated in the record transaction. Existing files without those counters get one SQL shape/byte-length scan on the first commit, in the writer worker for asynchronous commands; this does not construct the domain model. Changed bodies, metadata limits, indexes, undo, media references and the change log commit together.

Full snapshots/JSON exports, migration, restore, replica replacement and arbitrary internal compatibility transactions can still require full validation/materialization. Legacy Dealership peers requiring whole-snapshot checksums use the complete model path. Settings can calculate exact totals from shapes and SQL byte lengths without populating domain sections. This is not a claim that every operation is a single-record SQL command. Old storage versions, outdated indexes and legacy JSON migrations retain the complete validation path. See the scoped-write review (internal development reference).

See the deferred-startup review (internal development reference) for measurements and validation scope.

## Transactions and compatibility

The existing Store validation and transaction boundary remain authoritative. Car changes, stock returns, review decisions, history and revisions are committed together. Failed validation or disk writes leave the committed collection unchanged; change notifications occur only after persistence succeeds. Asynchronous saves use a worker thread. SQLite also checks the expected database identity and revision inside the transaction to reject an unexpected second writer.

Storage format 3 has per-record ordered shapes, separate field rows, ordered manifests and deduplicated media blobs with checked metadata. A scalar edit writes its field row rather than rewriting neighbouring scalar values. Arrays remain authoritative JSON values; derived SQL adapters support paged queries. `BEGIN IMMEDIATE`, foreign keys and full synchronous commits protect the write boundary. The preceding committed revision is retained using an undo journal inside the same SQLite transaction.

Opening format 1 or 2 first validates its collection and saves a consistent SQLite recovery copy named `database.sqlite.format<old-version>-<unique-id>.backup`. Migration adds attachment metadata, and splits format 1 records, inside one transaction. It reconstructs both current and previous revisions for exact comparison before committing. This one-time migration still reads originals. Failure rolls back the schema change. The recovery copy remains protected from accidental export overwrite, including after restart. Older binaries cannot open format 3 directly; use a compatible exported backup when downgrading.

Field revisions, deletion markers and an internal change journal commit with the data. The journal retains up to 256 transactions/32 MiB of JSON; media retained solely for replay has a separate 32 MiB budget. Expired or oversized cursors require a snapshot. Dealership sync v2 exposes bounded replay through its negotiated protocol; legacy peers retain their compatibility adapter.

Existing-car edits, proposal receipt/rejection and targeted car approval use bounded record submissions to the persistent writer. Ordinary commands use the scoped dependency groups described above; explicit full-model operations retain the compatibility path. The Dealership field review contract (internal development reference) allows negotiated text edits to compare relevant field versions; old proposals and complex operations keep their existing conflict checks.

Logical collection schema 11 and the public JSON contracts are unchanged. This preserves database/car identities, exact media strings, ordered replication digests, Timing signatures and captured configurations, result revisions/withdrawals, Telemetry snapshots, pending reviews and Dealership permissions. Device connection preferences remain in their existing separate file. Timing and Telemetry clients do not need a storage-format change.

## Photos

SQLite retains the exact photograph bytes already present in the collection. New PNG, JPEG and WebP imports retain their original format, dimensions and metadata when they fit the existing limit. An oversized import offers an explicit smaller-copy choice; it is never silently reduced. Photos imported by older versions may already have been resized, and migration cannot reconstruct their original detail.

Gallery previews use on-demand thumbnails with a maximum edge of 480 pixels, without upscaling. PNG transparency is retained. The large viewer, exports and backups use the stored original. Opaque local image references keep image data out of routine renderer snapshots; they are not exported or sent to integrations and cannot address arbitrary filesystem paths.

Per-file and count limits remain: 12 MiB per encoded photo (approximately 9 MiB of source bytes) and 40 additional car photos. Aggregate original media is no longer capped at 200 MiB; a separate 200 MiB working-metadata safeguard remains. SQLite file size also includes indexing, free pages and the preceding revision. See [storage limits](STORAGE-LIMITS.md).

## Backups and recovery

- **Import & Export → Back up this database** exports a complete portable `.sfpbackup`, including private information and original attachments. Legacy JSON remains an optional bounded export.
- **Settings → Database → Export previous revision** exports the preceding committed revision in the same backup format. This is one revision, not a long-term backup history.
- Restoring a backup first writes a separate complete recovery backup under `recovery-backups` beside the database. SQLite also retains the preceding revision. Restore rechecks the selected collection, Dealership state, revision and outstanding write after confirmation, before writing that copy or replacing data.
- Do not overwrite live database, journal, cache or retained legacy files with exports. The app protects these paths.

## Performance and current limits

The implementation stages and qualification gates are recorded in the [SQLite scalability plan](SQLITE-SCALABILITY-PLAN.md), including targeted field changes, atomic domain transactions, bounded media, incremental Dealership delivery and the gates for replacing the collection-wide limit.

The renderer receives lightweight media references and galleries load thumbnails on demand. Current-format startup opens the directory and first screen on demand. Ordinary writes validate scoped records and dependencies. Full-model compatibility operations and index rebuilds can still scale with complete metadata; record directories and selector lists also grow with collection size.

Format 3 opens media through lazy internal handles. Opening, validating, copying the renderer snapshot and saving an ordinary car text field do not materialize unrelated originals. Renderer photo reads run in a background SQLite reader; thumbnail decoding runs in a renderer Web Worker. Caches are bounded: 32 MiB for main-process original strings, 32 MiB for reader-worker encoded image bytes, and 16 MiB for thumbnail bytes. JSON string/photograph validation caches each have an 8 MiB budget. These are cache budgets, not a cap on total application memory or transient image-decoder memory.

Open editors/viewers hold media leases. Unsaved imports are staged in the reserved profile `media-staging` folder, with a 200 MiB quota. Unreferenced URLs and staged images are swept after a 60-second grace period, normally on the next 30-second sweep; closing a dialog releases its lease. Reload/exit clears staging, and startup retries cleanup of abandoned UUID-named staging files. Locked-file cleanup does not turn a successful save into an error.

Current records, the preceding revision, retained changes and live lazy handles protect SQLite assets from garbage collection. Snapshot/export references and dialog leases therefore survive subsequent saves. JavaScript garbage collection may delay reclaiming obsolete handles; a later write, including after restart, removes eligible assets. Original files remain byte-for-byte unchanged in existing exports, backups and integration responses.

Legacy Dealership journal checksums are calculated only when an entry is requested, rather than rereading all images while acknowledging a save. They remain the exact existing wire checksum; retained snapshot estimates and patch sizes count against the journal budget. Legacy network requests and JSON exports still serialize originals within their own size bounds. Portable backups and sync v2 transfer originals separately.

`npm run benchmark:sqlite` creates disposable synthetic collections, preserving real user profiles. One Windows run using Node 24.21.0 and distinct 128 KiB images produced:

| Measurement | 500 cars | 1,000 cars |
| --- | ---: | ---: |
| Logical collection size | 83.6 MiB | 167.2 MiB |
| One-time migration and verification | 1,052 ms | 2,270 ms |
| SQLite reopen and full validation | 456 ms | 816 ms |
| Initial renderer data | 273 KiB | 546 KiB |
| One-field asynchronous save | 155 ms | 225 ms |
| Record writes / photo writes for that save | 3 / 0 | 3 / 0 |

These are backend measurements, not complete desktop startup times or guarantees for another computer. In this run, JSON read and validation alone took 254/488 ms; SQLite is not claimed to make that step faster. The main benefits are transactional persistence, incremental writes, image deduplication and reduced renderer traffic. Profiling also identified long-string cache collisions for photos with common prefixes; caches now partition those values while retaining exact-key comparisons.

## Verification

Automated coverage includes exact migration round trips, migration interruption, SQLite transaction interruption, disk-write failures, stale writers, previous-revision recovery, corrupt assets and unrelated databases. Existing local server/client tests exercise Timing, Telemetry, Dealership replication, stock overrides, review approval and manual performance records. Additional migration coverage checks signed sessions, pending proposals, corrections and withdrawals together across restart.

Desktop checks exercise imports, exports, galleries, original image dimensions, thumbnails, backups and existing workflows. Local API tests do not substitute for testing on two physical computers. Native Linux/macOS packaged runtime testing remains a platform-specific check.

Verification on 3 November 2026: **441 Node tests passed**, syntax checks passed, and the complete Electron workflow suite reported **191 checks with no renderer errors**. The Windows package was built locally; its bundled Electron 45.1.0 / Node 24.22.1 / SQLite 3.53.4 runtime successfully migrated a temporary collection, ran the asynchronous writer from inside `app.asar`, reopened the result and retained the exact photo bytes. No personal collection was used for these checks.

## Follow-up review — 3 November 2026

This review covered the first SQLite implementation, its Store transaction boundary, migration, media transport, original-photo import, recovery/export paths, connection updates, build launchers and tests. It does not implement the subsequent scalability plan.

Confirmed issues corrected:

1. **Empty/incomplete SQLite files could mask the legacy collection.** Opening no longer initializes an existing empty file or accepts a database without a committed manifest. Failed migration and first-write cases fail explicitly while retaining the original files.
2. **Reading the previous revision could create an empty live file.** A new, unsaved collection now returns no previous revision without creating anything.
3. **Asset extraction could alter unusual user text.** Broad image-prefix/data-field matching could encode unpaired UTF-16 characters as replacement characters. Only supported base64 photo strings and base64 document payloads are extracted; arbitrary text remains JSON and round-trips exactly.
4. **Missing attachment-reference rows went unnoticed.** Reads now compare record envelopes against attachment references, check foreign keys and verify the committed collection identity. Damaged reference metadata fails before a later save can garbage-collect a live attachment.
5. **Renderer photo substitution could affect ordinary text.** Car names, notes, reusable choices, custom values and other text no longer become opaque URLs or trigger photo-reference errors. Actual pictures and photo payloads still work, including sparse snapshot patches.
6. **Background shared-collection refreshes bypassed media projection.** Network events now use the same lightweight photo references as normal IPC responses; public network payloads retain their existing data-URI contract.
7. **Migration publication had an overwrite race.** Exclusive publication now refuses an intervening destination instead of replacing it.
8. **Restore could continue after its collection context changed.** A final context/write-state check now precedes recovery-file creation and replacement.
9. **Native launcher instructions still recommended Node 22.** Linux and macOS launcher messages now match the builder's Node 24 requirement.

Review regression coverage additionally terminates a writer after uncommitted pages have spilled to disk, verifies hot-journal recovery, injects failures into records/assets/recovery/commit metadata, retries failed asynchronous saves, and compares exact current/previous JSON through 60 mixed add/edit/delete/reorder transactions. Integration migration coverage retains signed Timing configurations, duplicate-delivery handling, corrections, withdrawals, Telemetry output, pending Dealership reviews and the remembered password across restart.

Final automated suite: **453 tests passed, zero failures or skipped tests**, and all configured syntax checks passed. The complete Electron workflow suite passed **193 checks with zero renderer errors**, including background shared-photo loading and the restore-confirmation race. A rebuilt Windows package passed migration, worker-inside-ASAR, previous-revision and exact-photo checks with Electron 45.1.0 / Node 24.22.1 / SQLite 3.53.4. All tests used disposable data or the isolated QA profile, not the personal collection.

A repeat synthetic benchmark observed 149 ms / 278 ms asynchronous one-field saves for 500 / 1,000 cars, writing three records and zero photographs in both cases. Reopen plus full validation took 416 ms / 986 ms. These are backend timings on this computer, not UI-latency guarantees. Native Linux/macOS runtime tests and two-physical-computer tests remain outside this local review.

## SQL read views and derived result indexes

The phase 4 read layer opens a read-only SQLite transaction for each request. Overview uses metadata counts and recent records. Cars load 48 matching records; part folders load counts, and a group/search loads 50 parts. Selected car history, maintenance, setups, documents and manual performance records have separate pages. Review queues load 20 entries. The car performance screen receives ten Timing session summaries, and its detail dialog requests 100 measured laps at a time. Counts describe the complete matching collection, not just the displayed page; Select filtered still includes matches across pages.

Internal continuation tokens contain database identity, revision and change epoch. Changed tokens reject continuation instead of mixing pages. The renderer suppresses old page/search responses, resets stale pagination, keeps open editor values, and requests the current page after closing an editor. Unchanged background notifications do not transfer another page.

The authoritative records and scalar fields remain unchanged. Rebuildable query metadata, session summaries, lane candidates and individual lap read rows commit in the same transaction as the original record. They are not independently writable authorities. Session corrections replace their derived contribution; withdrawals remove their laps/statistical contribution while keeping the tombstone. Index version, missing tables and a committed identity/epoch/sequence watermark trigger rebuilding from authoritative records when necessary. Index creation/rebuilding does not materialize original pictures. A failed index update rolls back the authoritative write too. Logical JSON backups export authoritative data; restoring them rebuilds these derived tables.

Timing profile reads and paginated public catalogue reads select relevant SQL records. Telemetry index/status reads project public metadata without loading measured laps or configuration bodies into the index response; downloading a session reconstructs only that session in its original lap order. Existing public contracts, authentication, origin protection, privacy exclusions, signatures and correction/withdrawal rules are unchanged. The public version 1 Telemetry session download remains a complete bounded session; internal 100-lap UI pages do not change its wire format.

The remaining local screens use scoped view adapters too. Showroom has 48-car gallery pages with a separate complete ID/name sequence for spotlight selection and cross-page slideshows. Workshop jobs and supplies use 24-record pages; shopping uses 30; scratch-building displays 40 candidate parts while retaining assigned parts independently. Assembly pages use 24 records, part installation history uses 50, and workshop reminders have independent 24-record navigation. Settings, Library, Connections and Import & Export receive settings/choice metadata and counts rather than car/part histories.

Editor contexts include complete target records and the compact choices their workflow needs. Stock availability is calculated against all active installations and stored assemblies, including those outside the displayed page. Car/setup selectors stay complete. Closing an editor releases its working context and reloads the active page. Mutation and import responses use the same projection; explicit legacy full reads remain available for compatibility and tests. Empty, unsaved in-memory stores retain their compatibility adapter.

Pace-comparison runs are derived when a Timing session changes and stored in the rebuildable query index (version 6). Opening comparison does not scan measured lap bodies. Corrections, withdrawals and rebuilding are compared against the existing calculation model. The internal cache does not change any public result/session schema.

Current limits: explicit full-model operations still hold bounded non-media records and lap history; ordinary startup and saves use deferred/scoped paths. Compact native-selector metadata and reusable choices scale with the number of choices; selected-car setup comparisons retain that car's relevant snapshots. Legacy remote sharing still caches its public collection. Query filters and aggregates can scan metadata; this is not constant-time full-text search or unlimited storage. Local views keep a current page and editor context, not an accumulating page cache. A separate 200 MiB working-metadata guard and existing per-operation limits remain; aggregate original media is no longer capped at 200 MiB.

## Durable Dealership replication

New Paddock peers negotiate private sync version 2 through `/v1/club/status`; public Timing and Telemetry status/response schemas are unchanged. Committed SQL change entries drive batches of at most 32 transactions/about 2 MiB of log JSON. A copy stores its source epoch, sequence, revision and canonical source manifest in `state.replica_sync` in the same transaction as its reconstructed records, fields, assets and query indexes. A failed commit cannot advance the cursor. Normal replacement/restoration clears this cursor; only verified replica commits can supply it.

The host emits coalesced revision signals and heartbeat revisions. Clients retain one pending catch-up target, fetch missing batches and back off on transient failures. Replay survives process restarts. Legacy peers retain the old bounded journal/snapshot adapter; its whole-collection checksum work is avoided when only version 2 peers are present. No database file is shared across machines.

History retains 256 transactions/32 MiB, plus a separate 32 MiB ceiling for assets retained only for replay. An expired epoch/prefix or oversized transaction requires explicit replacement. The old copy is backed up, unsent proposals remain in the outbox, metadata is verified in 1 MiB chunks, and missing assets are downloaded separately by hash into a temporary SQLite store. Final data and cursor publication is atomic and checks the live baseline again to prevent overlapping transfers from rewinding it. Imported lazy asset handles are rebound to the committed destination before staging cleanup.

Snapshots freeze a revision, expire after two minutes of inactivity and have two concurrent slots; slow event readers are disconnected. Proposal receipts are retained with review history (5,000 total/200 pending); the host fails closed at capacity rather than forgetting an old operation. New proposals bind the committed source epoch. Independent car text fields can be approved selectively; dependent stock/build/setup operations stay atomic.

This bounds network batches, not all core processing. The host streams snapshot metadata record by record; the receiver assembles a bounded snapshot. Replica validation still checks the bounded non-media model, but ordinary catch-up only decodes and packs changed record bodies. Phase 7 replaces collection recovery backups with verified portable SQLite containers; device proposal-outbox recovery remains bounded JSON. See [portable backups](PORTABLE-BACKUPS.md). See the wire contract and executable fixtures (internal development reference). Physical multi-computer LAN and native Linux/macOS runs have not been performed for this phase.

## Optional scalable public reads

Phase 6 exposes `/v1/scalable` as a separately negotiated public read projection. Default `/v1/status` and all existing Timing/Telemetry responses remain unchanged. Clients opt in with `X-SlotForge-Extensions: scalable-v1`, or probe the extension root after pairing. The existing credential, permissions, database identity and browser-Origin guards apply. Dealership's single password continues granting its existing access.

Catalogue/result invalidation feeds read at most 32 durable transactions and return at most 512 coalesced public IDs; they never export internal SQL envelopes or changed private values. Epoch reset, pruned history and wide changes require explicit cache reconciliation. Part/installation changes conservatively invalidate the catalogue cache because captured component names may change without a car revision change. Status/SSE send only a committed cursor; hint processing is coalesced and bounded.

Car/result indexes return 50 entries. Public main photos transfer in 256 KiB chunks, authorized against the named car's current picture. Signed current profiles omit their inline picture only on the new route. Session heads preserve captured configurations, stints, drivers, standings and summaries; measured laps use 250-row pages in original payload order. Per-session tokens invalidate pages after corrections, withdrawals and epoch replacement but remain stable across unrelated edits. Result index/lap queries avoid reconstructing all configurations and original images. Existing complete-session writes remain atomic and keep the 8 MiB/50,000-lap limits.

The API response ceiling is 8 MiB. No supported payload is silently truncated. Full non-media core-model loading, collection-sized reconciliation after history expiration, and bounded full metadata within a selected session still exist. These public reads don't replace the private replica protocol; the aggregate media cap is removed by Phase 8's separate safeguards. See schemas, examples and client instructions (internal development reference). Host-side tests are not acceptance of actual Timing/Telemetry client implementations.


## Portable collection backups

Phase 7 uses version 2 `.sfpbackup` containers with an ordered logical manifest, individually hashed records and separate deduplicated original attachments. Worker export/staging report progress and cancellation. Restore validates a separate database, creates a verified recovery backup, then commits through the existing atomic SQLite writer with previous-revision recovery and a fresh sync epoch. Full previous-revision exports and Dealership recovery backups use the same format. Legacy JSON backups and public interchange formats remain supported within their bounds.

See the [format, privacy, limits and recovery contract](PORTABLE-BACKUPS.md). Phase 8 now separately qualifies multi-gigabyte active collections with normal domain validation. Aggregate original media has no 200 MiB cap; metadata and individual-operation guards remain. Native Linux/macOS acceptance remains outstanding.

## Resource qualification

Phase 8 adds storage usage to Settings, disk-space preflight for commits, lazy-media size checks before legacy serialization, and query-page save acknowledgements without a discarded full snapshot. Ordered list queries force indexed lookups from manifest references. Additive maintenance indexes on field-version revision and change-log size avoid unnecessary full scans and overflow-page reads. They are created transactionally for existing format-3 files without changing identities, wire contracts or the storage version.

The former aggregate cap is replaced by a 200 MiB working-metadata guard. See [the limits, compatibility audit and remaining acceptance gates](STORAGE-LIMITS.md).

## Startup and derived overview counters

The eager compatibility path reconstructs one decoded metadata model, with lazy original-media handles. Current-format desktop startup uses the deferred path described above. It verifies field digests and asset-reference integrity while streaming record rows, and rejects duplicate/missing/orphaned manifest references. The isolated loaded model is validated in place; the public migration helper still clones caller-owned input by default. Verified manifest and sparse media-reference bookkeeping are reused, while older domain migrations retain the repacking path.

Query index version 7 adds `query_totals`. Insert/update/delete triggers maintain its counts inside the authoritative write transaction, including cascade deletes and rollback. Version 6 receives only the new counter projection; other stale versions rebuild. These are derived values, never stock authority. Storage format remains 3 and no public API contract changes.

Saved inactive Dealership replicas are loaded on demand. Their identity hint is only for status; opening a current-format copy uses the same deferred validation path as the personal collection; older formats retain complete validation/migration. File protection lists do not need a loaded replica. Main-process media sweeping and shutdown consult only an already-loaded copy.

## General writes and metadata-only reviews

General domain commands now execute against transaction-local copy-on-write drafts. Untouched records retain identity; changed containers detach before mutation. Validation and persistence failure never publish a draft. Lazy media accessors survive both drafting and snapshot creation. Targeted car/field commands keep their existing fast paths. Generic commands retain bounded cross-record stock and identity validation. Validated copy-on-write predecessors allow unchanged cars/parts and Timing session bodies to reuse prior checks. Changing a session, signing key, database identity or replica policy revalidates the affected Timing data; load/import/restore still perform full validation. Weak size caches reuse unchanged subtrees only on that trusted draft path.

Partial packing compares record identities and serializes only changed bodies, while retaining authoritative manifest ordering and deletion lists. The writer still commits record fields, indexes, undo data, media references and the change log atomically. Replica catch-up reads and verifies only the changed envelopes, reuses unchanged records, and commits its cursor in the same transaction. Whole replacements retain full validation.

General Dealership proposals optionally negotiate `reviewBaseline: 1` and send `baselineVersion: 1`. The digest covers the sanitized ordered manifest plus ordered record-envelope digests; original attachment hashes are included through those envelopes. Bookkeeping, collection revision and the private Timing key are excluded. Older bounded proposals remain supported. A legacy pending proposal on a collection beyond the legacy checksum bound requires a fresh comparison and explicit conflict confirmation; it is not silently accepted or discarded. See the private sync handoff for the exact algorithm.
