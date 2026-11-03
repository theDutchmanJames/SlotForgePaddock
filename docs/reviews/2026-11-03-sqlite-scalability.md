# SQLite scalability implementation and phase reviews

3 November 2026. Tests use disposable files and the isolated desktop QA profile. No personal collection is a test fixture. No version change or release is included.

## Phase 0 specification and baseline

The operation inventory and internal command/change-feed design are in [SQLite transactions](../SQLITE-TRANSACTIONS.md). Existing public endpoints are unchanged; the proposed feed has no public endpoint commitment until implemented and published with schemas.

Baseline backend measurements, before transaction changes:

| Cars | Logical size | Reopen and validation | Generic async edit |
| --- | --- | --- | --- |
| 100 | 16.7 MiB | 101 ms | 63 ms |
| 500 | 83.6 MiB | 410 ms | 136 ms |
| 1,000 | 167.2 MiB | 1,009 ms | 247 ms |

Review: checked Store command dispatchers, planning/workshop/job/toolbox/build operations, Timing's direct transactions, Dealership simulations/replacement paths, privacy scopes and existing v1 contracts. Physical LAN latency and first-usable-screen benchmarks remain separate measurements; these backend numbers are not substitutes.

## Phase 1 transaction foundation

Implemented a shared synchronous/asynchronous commit boundary, a persistent serial SQLite writer, asynchronous personal/incoming-review saves and asynchronous Dealership approval in the desktop. Preparation cannot publish state; failed persistence leaves data and subscribers unchanged. Direct compatibility Store methods remain available for integrations and tests.

Existing-car edits now prepare and validate the affected car, changed choices, installed-component guards and photo-focus dependencies. Unchanged records are shared internally and public snapshots remain detached. Complete editor forms are compacted first; no-op car edits produce neither a new revision/history nor a Dealership proposal. New cars and other domain operations still use the fully validated compatibility path. Persistence packing and UI snapshot transport still inspect more than the affected records; later phases must remove that work.

Review fixes:

- A worker-construction failure could leave rejected work queued for later replay. The queue now rejects and removes it; injected construction/exit failures are tested.
- Targeted simulation shares unchanged records. Approval therefore explicitly copies review state before setting its outcome, so a failed commit cannot mark the live proposal accepted.
- Custom-value limits are checked after merging with existing values; photo replacement removes stale framing; installed-part protection is unchanged.
- The async queue rechecks command preconditions against committed state, and publishes only after SQLite acknowledgement.

Verification: 465 automated tests passed, including 12 new targeted transaction/worker/review regressions. Differential fixtures compare mixed car edits with the full-validation implementation. Syntax and diff checks passed. The Windows packaged runtime passed the SQLite migration/worker/reopen probe. The complete desktop suite passed 193 checks with zero renderer errors, including final async approval wiring.

Five warm command samples per fixture produced the following local backend measurements (not LAN or complete UI timings):

| Cars | Command p50 | Command p95 | Queue local proposal | Approve locally | Proposal bytes |
| --- | --- | --- | --- | --- | --- |
| 100 | 12 ms | 13 ms | 64 ms | 56 ms | 935 |
| 500 | 34 ms | 41 ms | 241 ms | 227 ms | 935 |
| 1,000 | 54 ms | 60 ms | 476 ms | 464 ms | 935 |

The constant proposal size confirms that ordinary edits already send small review messages. Dealership latency still scales because of full-state digest, diff, validation and persistence preparation; it needs the planned durable targeted change path. Five samples are diagnostic, not statistically robust release qualification.

## Phase 2 field storage and review foundation

Storage format 2 separates object shapes from scalar/array field rows. Ordered reconstruction preserves existing JSON signatures and replication digests. Format 1 upgrade keeps a consistent original SQLite recovery copy and verifies both current and preceding revisions before committing the schema change. Those recovery files remain protected from export overwrite after restart.

Existing-car writes pack only affected records and metadata. Proposal receipt/rejection submits two records; a targeted car approval submits seven. Changed scalar fields update their own SQL rows; arrays remain bounded JSON leaves. Complex actions retain the full-validation/full-packing compatibility path. This is not yet a fully relational repository for independent lap/photo records.

The same transaction now writes a durable internal change journal, field versions and deletion markers. Journal retention is bounded by transaction count, JSON bytes and otherwise-unreferenced media. The raw journal is deliberately not exposed over the network because it contains private data and signing-key changes. Existing Dealership replication still uses its compatibility journal.

An additive, negotiated [field review contract](../../integration-handoff/dealership-field-review-v1/CONTRACT.md) supports top-level textual car edits. It detects same-field changes, absence, deletion, archival and ABA changes across restart. Unrelated edits no longer produce false conflicts. Existing proposals and complex operations keep conservative whole-state comparisons. Timing and Telemetry require no client changes for this extension.

Review findings and fixes:

- Retained journal entries initially did not pin their referenced media. Journal asset references now participate in garbage collection, with a separate 32 MiB retention budget and explicit cursor expiry.
- A changed extracted image leaves a null field placeholder unchanged. Its reference change now advances the field version, preventing a missed ABA conflict.
- Capability reads wait for pending saves and recheck authorization before reading committed version metadata.
- Failed targeted approval rolls back car values, field versions, history, review status and feed position together. The previous revision and comparison token remain valid for retry.
- Removed-field version retention has a floor: expired proposals require conflict review instead of trusting incomplete history.
- Partial writes require the exact cached committed base. Replaced Store state falls back to full packing.

Final verification: **485 automated tests passed**, syntax/diff checks passed, and the final complete Electron suite passed **193 checks with zero renderer errors**. A rebuilt Windows package passed migration, persistent-worker-inside-ASAR, exact original-photo and previous-revision checks. Fixtures cover local authenticated peer negotiation, old proposals, rollback injection, format 1 migration failure, corruption and bounded replay retention.

Repeated local backend measurements after targeted proposal/approval persistence:

| Cars | Command p50 | Command p95 | Queue local proposal | Approve locally | Proposal bytes |
| --- | --- | --- | --- | --- | --- |
| 100 | 13 ms | 14 ms | 34 ms | 34 ms | 1,110 |
| 500 | 20 ms | 34 ms | 107 ms | 102 ms | 1,110 |
| 1,000 | 31 ms | 50 ms | 194 ms | 193 ms | 1,110 |

The proposal grew slightly because it now contains exact field preconditions; its size remains independent of collection size. Main-thread work still grows in the old shared-snapshot/digest and renderer paths. These are five-sample backend diagnostics, not physical LAN or end-to-end UI guarantees.

## Outstanding phase gates

- Phase 1 foundation is implemented; complex commands retain explicitly documented full-validation fallbacks. Preparation outside SQLite is not yet fully moved off the main thread.
- Phase 2's scalar storage, journal and text-review foundation is implemented and reviewed. Independent array-item relationships, broader dependency/version checks, typed query adapters and complete public durable replication remain outstanding; this is not a claim that every phase 2 requirement is complete.
- Phase 3 is implemented as recorded below. Phases 4–8 remain planned. The 200 MiB cap is retained.
- Native macOS/Linux execution, physical LAN acceptance and other apps' new client implementations are not verified by local automated tests.

## Phase 3 — lazy media and bounded lifetimes

Storage format 3 adds verified media metadata and internal lazy accessors. Ordinary collection opening, validation, renderer projection and text saves avoid materializing unrelated originals. Existing public JSON remains unchanged. Background SQLite reads and renderer-worker thumbnail generation keep ordinary gallery decoding off the Electron main process.

Original caches, thumbnail caches, staged unsaved imports and retained journal snapshots have explicit budgets. Dialog leases and live snapshot handles protect media until consumers release it. Orphan cleanup accounts for current/recovery/journal references and live handles; garbage collection can delay disk reclamation until a later write or restart. See [storage notes](../SQLITE-STORAGE.md) for exact budgets and migration/recovery behavior.

Review findings corrected:

- Full legacy Dealership checksums initially caused repeated original reads after saves. Exact checksum computation now waits until a peer requests the journal entry, with immutable snapshot retention accounted for in the journal budget. This preserves the old protocol without putting that work on local save acknowledgement.
- Identical photos represented by lazy handles versus raw input could lose their saved focus. Focus comparison now uses content identity.
- Truncated JPEG marker sequences could overrun metadata parsing. Bounds checks now reject incomplete dimension metadata safely.
- Image-string validation caches and Store hash caches could retain original bodies outside the new original-cache budget. Their retention is reduced or cleared after persistence attempts.
- A locked staging file could report failure after a successful commit. Cleanup is now best-effort with retry, without undoing or misreporting the save.
- Array cloning/packing preserves internal lazy accessors; removed dialogs release their media lease as well as dialogs closed normally.

Verification: **500 Node tests passed**, syntax and diff checks passed, and the complete Electron workflow suite passed **193 checks with zero renderer errors**. One desktop attempt failed in Electron screenshot capture with `UnknownVizError`; a complete rerun passed. Tests cover format 2 migration and rollback, exact current/previous copies, metadata/body corruption, zero-original startup and text saves, unchanged-photo focus, exact legacy checksums, cancellation/staging cleanup, repeated browsing cache bounds, thumbnail concurrency and stale replies. Existing stock, reviews, manual records, Timing, Telemetry and Dealership tests remain passing.

The rebuilt Windows package passed lazy opening, exact original-photo delivery through the reader worker inside ASAR, the writer worker, migration and previous-revision recovery on Electron 45.1.0 / Node 24.22.1 / SQLite 3.53.4. Tests used temporary databases and the isolated QA profile; no personal collection was used.

Synthetic backend measurements with distinct 128 KiB photos:

| Cars | Reopen + validation | Original bodies materialized on open | Text command p50 / p95 | Local proposal / approval |
| --- | ---: | ---: | ---: | ---: |
| 100 | 61 ms | 0 | 17 / 19 ms | 31 / 40 ms |
| 500 | 314 ms | 0 | 33 / 37 ms | 74 / 68 ms |
| 1,000 | 638 ms | 0 | 52 / 53 ms | 155 / 131 ms |

These five-sample command measurements are backend diagnostics, not end-to-end UI or physical LAN guarantees. One-time verified migration remains eager. SQLite integrity checks can still read database pages; “zero original bodies” means no original image strings were materialized into the application model. Non-media records/lap histories still load into the full model. Legacy network digest generation and full JSON exports still perform collection-sized work. The next phase is bounded query/UI loading; later synchronization and streaming phases must address the remaining costs before increasing collection limits.

## Phase 4 — SQL read layer and first screen rollout

Implemented read-only, revision-bound queries; rebuildable metadata indexes; paginated Cars, stock groups/search, selected-car history/setup/document/manual-test views, review queues and imported session/lap views. Overview and review counts cover the complete database. Existing Timing profile/catalogue and Telemetry endpoints use SQL adapters without a contract change. Derived eligible-result summaries and lap read rows are maintained atomically with each stored session.

Review findings corrected:

- The first ordering join repeatedly traversed the manifest, causing a 1,000-car page query to take about 837 ms despite a small reply. Counts now avoid ordering joins, and ordered record/session queries materialize manifest references once. The same synthetic query now takes about 10 ms.
- Full editors could receive a partial page immediately after saving, hiding a newly created part from the editor's completion handler. Editors now retain explicit working context until completion and then reload the relevant page.
- A background response could replace a different page or discard working context while a dialog was open. Responses are checked against collection, storage path and view; dialog refreshes are deferred. Search focus/caret is preserved.
- Continuation pages now use snapshot tokens; stale pages restart explicitly. Out-of-range pages after changes recover rather than displaying an empty trailing page.
- SQL maintenance reminder ties now follow authoritative event order. Car overview retains its active job and separate recent-maintenance rows; maintenance journal pages retain modifications/installations/removals as well as service events.
- Review headers retain global counts. Reviewed Dealership decisions remain accessible through a paginated history view. Incoming review stock warnings query active technical assignments; acceptance still runs the original stock/validation transaction.
- A dialog-close listener initially referenced a helper before its script initialized. The focused desktop workflow caught the missed refresh; initialization now uses the existing DOM element directly.
- Integration reads wait for in-flight saves and recheck access. A failed post-commit page refresh falls back to a committed snapshot instead of reporting the durable save as failed.
- Derived indexes carry an identity/epoch/sequence watermark, so an older writer or a missing index causes reconstruction rather than reuse of stale summaries.

Validation: **514 Node tests passed**. The complete Electron suite passed **197 checks with zero renderer errors**; an additional focused run passed five query workflows, including accepting a paginated incoming review. Tests cover literal Unicode search, stable pages, whole-collection counts/selection, unsaved forms, reminder ties, derived-index rollback/rebuild, persisted summaries, exact Telemetry responses, restart, corrections, withdrawals, virtual participants and raced configurations after a rename. The Windows ASAR probe passed query reads, a background writer/index update, reopened storage and exact Telemetry index output. Tests used disposable databases and the isolated QA profile. No personal collection or physical two-computer LAN was used; Linux/macOS package execution remains unverified here. One full desktop attempt stalled before completion and was terminated; the subsequent complete run passed.

Synthetic warm car-page query measurements (seven runs, no photographs, metadata-only fixtures; backend query time, not startup or end-to-end UI):

| Collection | Records reconstructed | Page JSON | Full-model JSON | Median query | Maximum query |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 cars | 48 | 12 KiB | 24 KiB | 5.81 ms | 7.69 ms |
| 500 cars | 48 | 12 KiB | 119 KiB | 6.88 ms | 8.43 ms |
| 1,000 cars | 48 | 12 KiB | 238 KiB | 9.94 ms | 10.44 ms |

At this first rollout checkpoint the representative phase 4 browsing gate passed, but full UI conversion was not complete. The continuation below supersedes that UI status. The core model, complex editors and secondary screens listed in the storage notes retain compatibility paths. Metadata aggregates and public Telemetry index reconciliation still scale with the number of matching metadata records. Selective per-record invalidation, remaining full-context conversion, durable network synchronization, streamed backup and removal of the collection cap remain work for the plan. Do not describe this checkpoint as unlimited storage or a completed scalability migration. No version bump, commit, publication or release was performed in this phase.


## Phase 4 continuation — remaining screens and editors

Converted local Showroom, Workshop jobs, supplies, assemblies, shopping, Build from Scratch, technical/stock details, Settings, Library, Connections and Import & Export to scoped page projections. Editors request their target and complete compact selector dependencies instead of a whole renderer snapshot. Stock availability includes off-page installations and reserved assemblies. Showroom viewer navigation spans gallery pages; maintenance reminders and installation history have independent pagination. Cached pace runs are rebuilt with the result index and replaced on corrections/withdrawals.

Review findings corrected:

- A stale Stock selection could overwrite the assembly list in Build from Scratch. Selected-stock detail enrichment now runs only in the Stock view; a regression test covers the cross-tab case.
- Page refreshes could discard incoming-review notes and checkbox selections. The same review retains its draft, including explicit stock overrides, and database refreshes defer while an action or dialog is active.
- Changing a diagram position could reset the zoomed viewport during the asynchronous picker refresh. Scroll position and keyboard focus now survive that refresh.
- Empty filtered/favourite showroom results could look like an empty collection. Empty-state actions now use the whole collection's active count.
- Long part histories and maintenance reminders needed independent navigation. Each now has a complete paginated path without moving the main list page.
- Maintenance-to-job creation, shopping, saved drafts, reports opened from More, and catalogue match editors needed dependencies absent from their visible page. Explicit contexts now supply those records or compact choices; shopping checks include other pending purchases and assembly reservations.
- Delayed editor responses are checked against navigation, database identity and storage path. Missing technical-detail targets fail explicitly instead of rendering an absent car.
- The initial pace comparison path still scanned every lap. Comparison runs now live in rebuildable index version 6; tests compare them with the original model through normal/multi-heat/endurance sessions, corrections, withdrawals, restart and virtual-participant cases. Public Telemetry payloads exclude the private query cache.
- Tiny job/pace pictures use the thumbnail path. Closing pace comparison releases its working model. Spotlight selection checks picture presence without hydrating originals.

Legacy desktop tests that assigned page variables and immediately read synchronous DOM/model state were updated to await query completion or request their explicit editor context. Assertions for the original workflows remain in place. One full run stopped in Electron screenshot capture with UnknownVizError; it was not treated as a passing run.

Remaining boundaries: the authoritative Store still loads the non-media model, compact native-selector choices grow with collection size, a setup comparison can load that car's complete relevant history, and legacy remote sharing retains its public cache. Existing revision notifications reload the active page. This phase does not add incremental Dealership delivery, streaming backups, larger limits or new public API contracts. Phases 5–8 remain separate; the 200 MiB cap remains. No personal database, release, version bump or GitHub publication is part of this work.

Validation completed: **525 Node tests passed**, syntax checks and whitespace/diff checks passed. The complete Electron suite passed **202 checks with zero renderer errors**. The final Windows ASAR package passed scoped secondary-page reads, complete editor choices, cached pace runs, background writer/index commit, reopen, persistent result summaries, paged laps and exact Telemetry index equivalence. Runtime: Electron 45.1.0, Node 24.22.1, SQLite 3.53.4. Narrow-window Build from Scratch, catalogue review, Workshop and Dealership review screenshots were visually checked. Tests used disposable fixtures and the isolated QA profile. Physical two-computer LAN and Linux/macOS package execution were not retested here. Phase 4 screen/editor continuation is reviewed; work stops before Phase 5.

## Phase 5 — durable incremental Dealership synchronization

Added negotiated private sync version 2, using committed SQLite field/record changes and a persistent replica cursor. Public Timing/Telemetry interfaces and the remembered Dealership password remain unchanged. New peers avoid the legacy collection checksum/journal path, receive small revision signals, and retrieve bounded ordered batches. Snapshot metadata and hash-addressed originals travel separately; existing originals are reused. Source signing keys are excluded. Independent car text changes support selective approval; stock and dependent operations retain their existing atomic validation.

Review findings corrected:

- An initial capability placement would have changed the strict public Timing status schema. Negotiation now lives entirely in the private Dealership status endpoint; compatibility fixtures pass unchanged.
- Concurrent replica applications could use the same initial baseline. A commit-time compare against the stored epoch/cursor/manifest now rejects an overlapping stale apply; data and cursor remain one transaction.
- A disconnected transfer could still finish downloading. Generation checks at commit prevent publishing into a replaced connection.
- Staged lazy assets needed rebinding to the destination database before staging cleanup. The committed copy now remains independently readable after transfer and reopen.
- Initial joining could replace the recovery link with a second post-transfer backup. It now retains the pre-transfer copy; a test reads that backup and verifies its identity/data.
- New edits after an explicit epoch replacement could retain an old field-review epoch. Proposals now read the epoch committed with their current copy; a test delivers and approves the next edit after recovery.
- Snapshot temporary-file cleanup initially assumed its directory already existed. First-run construction now tolerates an absent directory, and cleanup/release tolerate locked obsolete files without losing live transfer slots.
- Network failures while reading a response body now retain transient retry behavior. Size and validation errors remain visible; queue backoff and cursor recovery do not discard proposals.
- Incoming proposals cannot supply official review outcome metadata. Reviewed records retain host-owned outcome fields and selected-field history.
- Slow clients and bursts no longer create an unbounded promise/message queue. Signals coalesce, catch-up retains one target and backed-up event sockets disconnect.

Retention is explicit: 256 transactions/32 MiB of change history, a separate 32 MiB replay-only asset ceiling, 5,000 durable proposal receipts/200 pending proposals, two two-minute snapshot offers, 1 MiB transfer chunks and bounded request sizes. At receipt capacity, new proposals fail closed. An expired cursor requires the existing explicit out-of-date replacement flow, preserving an old-copy backup and unsent outbox. New-client ancient operations from an unknown epoch are rejected; legacy receipts remain compatible.

Validation: **543 Node tests pass**, including 18 new synchronization/fixture tests. These cover local host/client HTTP, host/client restart, duplicate and conflicting delivery, missing history, deletes, corrupt/interrupted transfers, disk failure, overlapping applications, retained outbox, fresh epoch proposals, selective approvals, authorization/Origin/database identity, image deduplication and immutable snapshot metadata. Published protocol examples are decoded and hash-verified in the test suite. A 500-car fixture verifies that an ordinary field edit transfers under 16 KiB without reading original photo bodies. This is a payload check, not a physical-LAN latency claim.

The Windows ASAR probe passes private negotiation, chunked snapshot/image transfer, background writer changes, atomic cursor persistence, reopen/original-byte equivalence, excluded signing keys and remembered passwords (Electron 45.1.0, Node 24.22.1, SQLite 3.53.4). Syntax and whitespace checks pass. The earlier complete Electron run passed **203 checks with zero renderer errors**. A final full rerun stopped at screenshot capture with Electron `UnknownVizError` on Build from Scratch; it is recorded as failed, not a passing run. The final focused Dealership rerun passed **9 workflows with zero renderer errors**, including selective approval, creating/rejecting proposals, preserved local data on joining, explicit recovery with backup, submission after replacement and returning to the local collection. The narrow light-theme review dialog was visually checked. A `--club-only` smoke selector makes this focused run reproducible.

Boundaries: authoritative non-media metadata still resides in the core model; snapshot metadata assembly, final validation and replica packing remain collection-sized work. Recovery backups still use bounded JSON. The 200 MiB cap remains. This phase is not a new Timing/Telemetry interface, streamed multi-gigabyte backup or claim of unlimited storage. Tests use disposable databases and an isolated QA profile; physical multi-computer LAN and native Linux/macOS package execution remain unverified. No personal database, version bump, commit, GitHub push or release was part of this phase. Work stops before Phase 6.

## Phase 6 — optional public integration reads

Implemented the Paddock host side of `/v1/scalable`, with opt-in capabilities, durable catalogue/result invalidations, bounded public metadata pages, main-picture chunks, current signed captures without inline photos, session heads and measured-lap pages. The existing result-write protocol, manual records, permissions, Dealership password and public v1 response shapes are retained. Timing and Telemetry repositories were not edited.

Review findings and refinements:

- Default public status must remain compatible with strict existing clients. Capabilities are added only for an explicit `X-SlotForge-Extensions: scalable-v1` request; a separate discovery root also supports probing/fallback.
- The first result index selected whole session metadata rows. It now projects only index fields inside SQLite, excluding all captured configurations, stints, lap arrays and private query caches from the JS result page.
- Lap-page reads initially reconstructed every participant's configuration. They now load only token/participant identity metadata and the requested measured rows. Session-head reads omit the internal pace-run cache.
- A car revision alone cannot identify every configuration dependency change. Part/installation edits trigger conservative full catalogue reconciliation, with instructions to refresh captures even when car revisions match.
- Partial downloads need different consistency rules from list pagination. Listings bind to a committed database cursor; lap pages bind to a per-session content/receipt/epoch token. Corrections and withdrawals reject old pages; unrelated edits don't invalidate a session download.
- Main-picture downloads verify the requested hash against the current named car. Old or arbitrary/private asset hashes cannot be used as a generic asset-reader endpoint.
- The public feed projects identifiers only, detects missing history and middle gaps, bounds transactions/ID counts and requests reconciliation for oversized sets. It never truncates an operation into an apparently complete response.
- Notification streams retain one pending flush, coalesce bursts, carry only cursor hints, enforce backpressure and close on credential/database changes. Hosting owns two notification subscriptions now; the legacy lifecycle regression was updated to assert both are removed/recreated without accumulation.
- Complete measured lap reconstruction preserves original ordering, physical/virtual identity, pit/valid/record flags, distance eligibility, endurance drivers and captured historical setups. Derived summaries continue using the existing result rules.

The dedicated [handoff](../../integration-handoff/scalable-v1/README.md) provides the route contract, response schemas, cursor/reset rules, errors, size limits, client cache algorithm, compatibility matrix and 24 validated fixtures including normal, multi-heat, endurance, correction, withdrawal and media examples. Fixture generation uses artificial data and a disposable database. Schema definitions are independent of the old strict runtime schema.

Validation: **559 Node tests passed**, including 16 new integration tests. Coverage includes strict old status/profile/session responses, HTTP authentication/Origin/database checks, restart, duplicate/empty invalidation reads, 50-entry indexes, 250-lap pages, 32-transaction catch-up, oversized reset, archive/delete, expired history, source epoch reset, failed-save cursor durability, content-hash photo reconstruction, exact session reconstruction, correction/withdrawal tokens, virtual participants, stream permission revocation/backpressure/lifecycle and published-schema fixture validation. Syntax and whitespace checks passed.

The Windows packaged ASAR probe passed optional discovery, catalogue reads, signed configuration verification, existing HTTP session submission, paged lap retrieval, correction token rejection, withdrawal heads, background writer saves and reopen. Runtime: Electron 45.1.0, Node 24.22.1, SQLite 3.53.4. The final complete Electron run passed **203 checks with zero renderer errors**. The preceding run stopped at Electron screenshot capture with `UnknownVizError`; that run is recorded as failed. The smoke harness now retries only this specific capture error, at most twice with a short delay, while retaining all assertions and failing persistent capture errors. The final passing run did not need a retry.

Remaining acceptance gates: real Timing/Telemetry clients must implement and verify the opt-in protocol using this handoff; existing clients continue using their unchanged routes. No physical multi-computer LAN or native Linux/macOS package execution was performed here. The authoritative non-media model and some snapshot/session metadata processing still scale with data size. The 200 MiB collection limit, result submission limits and existing backups remain; phases 7–8 are separate. No personal collection, app version, GitHub publication or release was changed. Host-side implementation is reviewed; client adoption is not claimed complete. Work stops before Phase 7.


## Phase 7 — portable backup, restore and recovery

Implemented the version 2 .sfpbackup logical container, worker-based export/staging, integrity verification, progress/cancellation, full previous-revision exports, and atomic activation through the existing SQLite transaction boundary. Original attachments remain separate and deduplicated. The live collection is never replaced by a half-built file. Legacy JSON backup/import paths and existing public car/Timing/catalogue formats remain available within explicit limits. See [the exact format and lifecycle contract](../PORTABLE-BACKUPS.md).

Review findings and fixes:

- A corrupt/truncated SQLite input could throw during connection setup before the normal finally block, retaining a Windows file handle. Setup now closes on failure; replacement/retry tests cover this.
- Archive validation now checks application/version, exact tables and typed non-null primary-key columns, six metadata entries, per-row limits, manifest/reference uniqueness, record and attachment checksums, complete counts and SQLite integrity. Staging recomputes hashes from its attached snapshot to detect source changes after initial verification.
- Reconstructed record keys must match their actual collection identities; a forged manifest/key cannot populate misleading query indexes. Domain/reference/stock/signature validation runs before activation.
- Portable restore stays lazy through its return path and rebinds attachment handles to the committed destination before deleting staging files. It resets the synchronization epoch and atomically retains the preceding complete revision.
- Restores refresh matching attachment rows from the verified source rather than trusting an existing hash/metadata row whose bytes may be damaged. Ordinary incremental writes retain their no-rewrite path. A restore still requires its pre-restore recovery backup to succeed; this does not promise automatic recovery from every form of live database corruption.
- Export uses a reserved Store write queue plus a consistent SQLite read transaction. Pending asynchronous writes resume after export; no main-thread SQLite lock wait is introduced. Failed/cancelled export preserves an existing destination and removes its unpublished temporary file.
- Restore checks disk space, collection/revision and pending submission state around asynchronous work and confirmation. Hosting stops before the atomic commit. Connection-changing IPC is blocked during restore. Staging cleanup errors cannot turn a committed restore into a reported data failure; reserved abandoned stages are reclaimed at the next startup.
- The Dealership replacement path still used a whole JSON recovery snapshot. Enable/replacement/leave now create portable recovery files; desktop and synchronization paths run these in the background. Synchronous programmatic entry points remain supported, including in-memory test/embedded stores. Passwords, pairing and device outboxes stay outside collection backups.
- The generic JSON exporter now refuses files larger than the corresponding 256 MiB reader limit. Manufacturer catalogue reads enforce their 16 MiB limit during the read itself, including a file that grows after its initial stat.
- Progress styling uses the real theme variables. Desktop tests wait for asynchronous restores to complete. A review-note preservation test was also updated to await the actual query-page load before entering its draft, instead of mixing an out-of-band full snapshot with an unfinished navigation.

Validation: **586 Node tests passed**, including **27 dedicated portable backup tests**. Cases include private documents, pending Dealership proposals, original photo bytes, stock/manual records, signing keys, multi-heat/endurance results, correction/withdrawal retry identity, previous revision completeness, corrupted/missing/truncated/oversized content, source changes, forged record keys, hard-link/live-file protection, stale approval, cancellation, queued writers, failure rollback, real SQLite SQLITE_FULL injection, and child-process interruption before publication/during a transaction. Existing Timing, Telemetry, Dealership and JSON regression tests remain part of the full suite. Syntax checks passed.

The Windows packaged ASAR probe passed backup/staging workers, exact originals, async atomic restore, previous-revision recovery, duplicate Timing receipts after restore and the host status API. Runtime: Electron 45.1.0, Node 24.22.1, SQLite 3.53.4.

Transport stress tests used 32 and 272 distinct 8 MiB attachments. Both archives round-tripped with identical record digests and attachment hashes. The 256 MiB fixture peaked at 167.2 MiB RSS during staging and 123.0 MiB during export; the 2,176 MiB fixture peaked at 169.1 MiB and 129.2 MiB respectively. The large run took 58.9 seconds for staging, 28.3 seconds for export/verification, and 22.4 seconds for an additional verification pass. Reports are in .qa/phase7-backup-benchmark-32.json and .qa/phase7-backup-benchmark-272.json; large fixture databases were removed. These child-process measurements exercise the storage transport with internal domain validation disabled, then explicitly verify that ordinary Store validation still rejects the oversized active collection. They do not claim multi-gigabyte desktop collection support.

Remaining gates: native Linux/macOS restore execution, physical multi-computer acceptance and large active-collection qualification remain outstanding. Core non-media metadata validation still scales with collection size. The 200 MiB logical collection cap and per-operation limits remain until Phase 8. No personal collection, application version, GitHub publication or release was changed. Work stops before Phase 8.

Final Phase 7 desktop verification: **209 workflow checks passed with zero renderer errors**, including portable save, cancelled restore, verified recovery, full previous-revision export, progress/cancel controls and damaged-file rejection. The final run needed no screenshot retry. Earlier desktop runs included one failed review-note assertion caused by test setup entering text before its query navigation settled; the harness now awaits that navigation while preserving the original assertions. Two intermediate passing runs used the existing bounded retry for Electron UnknownVizError captures. The final Node, desktop and packaged checks all passed after the restore-media repair fix.

## Phase 8 — resource safeguards and qualification (cap-removal gate still open)

Implemented and reviewed:

- Legacy JSON export and public package limits are now checked using lazy metadata **before** serialization. A 257 MiB synthetic lazy export is rejected without reading its body or changing the existing destination. Old public catalogue clients receive an explicit paged-transfer error; oversized legacy Dealership snapshots receive HTTP 413 with `CLUB_SNAPSHOT_TOO_LARGE`.
- SQLite writes preflight free space for submitted metadata and new/replaced media, including external lazy assets, with a 16 MiB reserve. Failed preflight leaves committed data, previous revision and notifications unchanged; retry succeeds. This is an estimate, not a disk reservation. Existing transaction-failure and SQLITE_FULL tests still pass.
- Settings → Database reports physical file size, distinct current encoded media, retained media, logical collection usage and free space. The display distinguishes deduplicated storage from the logical cap and recommends portable backups.
- Query-page saves no longer clone a full response snapshot which the IPC handler immediately discarded. Personal edits, Dealership proposals and no-op responses support the scoped acknowledgement; legacy programmatic callers retain their existing snapshot response.
- The 5,000-event qualification exposed a quadratic ordered-list join. EXPLAIN QUERY PLAN showed SQLite scanning every ordinal for each matching record. Forcing ordinal-first indexed equality joins reduced the isolated four-event query from roughly **1,559 ms to 14.5 ms**. A filtered/reversed 1,200-event regression verifies authoritative order and pagination, with only the requested records reconstructed.
- Retention pruning scanned all field versions, and its log-size query traversed JSON overflow pages. Additive indexes on revision and on (sequence, bytes) remove these avoidable scans. Existing format-3 files gain the indexes transactionally; a regression verifies unchanged data/cursors and covering/range query plans. No storage-version bump or integration contract change.

Validation: **595 Node tests passed**, **210 full Electron workflow checks passed**, no captured renderer errors, syntax checks passed, and a Windows packaged-ASAR probe passed. The final desktop run retried two transient screenshot captures successfully; these were capture failures, not failed workflow assertions. The Settings screenshot was inspected. Packaged checks cover export/staging workers, exact originals, atomic async restore, previous-revision recovery, duplicate Timing delivery after restore, host status, storage usage and scoped save acknowledgements. Runtime: Electron 45.1.0 / Node 24.22.1 / SQLite 3.53.4. No personal collection was used.

### Measured qualification

Reference machine: AMD Ryzen 5 3600 6-Core Processor, Windows x64, 31.9 GiB RAM, Node v24.21.0. Disposable fixtures each contain 10,250 measured laps in 50 sessions, custom car values, history, stock/catalogue records, distinct and shared original photos, and pending review proposals. Each size runs in a fresh measurement process. OS filesystem cache is warm. Timings are milliseconds; memory is peak process RSS in MiB.

| Cars | Parts | Backend open + first overview | Local save + detail refresh p50 / p95 | Host-local proposal p95 | Peak RSS |
| --- | --- | --- | --- | --- | --- |
| 100 | 200 | 696 | 17.6 / 18.4 | 20 | 131 |
| 500 | 1,000 | 1008.2 | 27.4 / 29.2 | 27.4 | 162.4 |
| 1,000 | 2,000 | 1316 | 42.4 / 47.4 | 30 | 202.8 |
| 5,000 | 10,000 | 4069.2 | 185.2 / 209.8 | 91.1 | 504.3 |

At every size, ordinary saves read **zero originals**, submit six SQL record envelopes, change five records/twelve fields and write zero assets. The proposal payload is **1,110 bytes** at all four sizes. Projected overview payloads remain around **3.4 KiB**. Startup also hydrates zero original bodies, although SQLite integrity checking can still read their disk pages.

These are 20 edit samples and 10 host-local proposal samples per size. They are not cold-start measurements, Electron startup/paint timings, physical LAN round trips, or a guarantee for all configurations. Maximum synchronous command preparation ranged from 7.2 to 21.4 ms; that measures only preparation, **not** every main-thread task. In particular, a first 5,000-car overview query still takes about 101.5 ms. No claim is made that the <50 ms whole-main-thread target has passed.

### Gate decision and remaining work

**Do not remove the 200 MiB logical cap or declare Phase 8 release qualification complete.** The 5,000-car fixture takes about 4.07 seconds to open and produce its first backend page, peaks around 504 MiB RSS, and exceeds the 200 ms local acknowledgement/refresh objective at p95 (209.8 ms). The 1,000-car backend result meets the two-second objective, but desktop paint/startup has not been included.

Core startup still reconstructs/validates the full non-media model; broad fallback mutations, selector/comparison contexts, replica validation/packing and legacy collection/checksum adapters remain. The portable 2.1 GiB **transport** test from Phase 7 is not evidence that a 2.1 GiB active collection is qualified. Native Linux/macOS restore, cold desktop startup, repeated large-screen memory plateaus, slow multi-gigabyte snapshots, actual upgraded Timing/Telemetry clients and physical multi-computer acceptance remain open. No release limitation or permission to bypass these gates is assumed.

The detailed limit audit, compatibility requirements and next acceptance work are in [STORAGE-LIMITS.md](../STORAGE-LIMITS.md). No version bump, GitHub push or release was performed.

## Phase 8 follow-up — startup, memory and regression review

This follow-up supersedes the earlier performance failures above; it does not waive the remaining architectural/cap and external acceptance gates.

Findings fixed:

1. Startup retained headers, reconstructed JSON strings and parsed copies, then cloned the model for validation and repacked it just for persistence bookkeeping. Streamed record decoding now keeps one model, validates owned data in place, and reuses verified manifest/media-reference metadata. The public migration API retains its cloning default. Field digests, asset metadata, signature checks, integrity checks and legacy recovery are preserved.
2. Every page summary scanned all query records. Transactional derived counters now handle counts, stock totals, reserved quantities and incoming reviews. Tests compare them to independent full SQL aggregation through updates, deletes, rollback, restart and rebuild.
3. A counter-version upgrade initially rebuilt all car/lap projections. The reviewed implementation upgrades version 6 with one metadata aggregation and preserves those existing projections. A regression deliberately prohibits record-index rebuilding to verify that fast path.
4. Opening a personal collection eagerly loaded its saved Dealership copy. Status now uses a small identity hint; only opening the replica loads its model. Review found indirect eager loads in media sweeping, file-protection lists and shutdown too; those now consult only the loaded copy or derive protected paths without opening it. Remembered-password, offline copy and unsent proposal restart tests pass.
5. JSON byte measurement allocated generator tokens and index arrays for the complete collection. Direct measurement preserves native escaping, Unicode, sparse-array, omitted-value and toJSON semantics, including lazy originals without hydration. Deterministic nested-value comparison tests check native JSON byte counts.
6. Timing capacity-error classification depended on an outdated English message ('200 MB'). Collection-limit failures now carry a stable internal code and retain the public CAPACITY_EXCEEDED / HTTP 507 contract; ordinary storage failures remain STORAGE_FAILED / HTTP 500.

### Updated backend measurements

Same fixture definitions/hardware as above; separate measurement processes, warm OS cache, 20 edits and 10 host-local proposals per size. Counter indexes are already upgraded. These are not LAN measurements.

| Cars | Parts | Open + overview ms | Save/detail p50 / p95 ms | Proposal p95 ms | Peak RSS MiB |
| --- | --- | --- | --- | --- | --- |
| 100 | 200 | 254.5 | 16.9 / 19.9 | 21.0 | 106.5 |
| 500 | 1,000 | 392.1 | 25.0 / 26.2 | 22.9 | 129.2 |
| 1,000 | 2,000 | 637.7 | 34.1 / 38.4 | 27.1 | 154.4 |
| 5,000 | 10,000 | 1880.1 | 116.6 / 130.3 | 72.8 | 342.7 |

Maximum synchronous command preparation is 7.0 / 7.7 / 7.6 / 16.6 ms respectively. This is not a measurement of every main-thread task. A 5,000-car first backend overview takes 49.3 ms. Ordinary edits retain zero original reads, six submitted record envelopes, five changed records/twelve fields, zero asset writes; proposals remain 1,110 bytes at every size.

### Desktop memory observations

A real hidden Electron 45.1.0 / Node 24.22.1 run with the 5,000-car fixture reaches its rendered overview in **2,101.2 ms** from script entry (not OS process launch): Store open 1,650.4 ms, window creation at 1,911.3 ms, DOM loaded at 2,059.0 ms. The overview model is 3,822 JSON characters. This is warm-cache, already-upgraded storage, not a cold-start guarantee.

Across 120 page switches (Cars, Showroom, Parts, Workshop, Overview), renderer GC checkpoints show approximately 1.90–2.02 MB live JavaScript heap and a constant 256 DOM nodes on returning to Overview. Main working set after warm-up stays around 192–194 MiB. Renderer working set fluctuates around 140–162 MiB, ending at 141 MiB; its peak is 223 MiB. Working sets include Chromium/native/worker caches and do not equal live JavaScript memory. This run gives no evidence of a continuously growing navigation leak; it does not certify every editor or enormous lap history.

### Scope and remaining gate

The measured backend startup/save objectives on these fixtures now pass. **Phase 8 cap removal and release qualification are still open.** Core startup and some fallback/replica operations continue processing the full non-media model. Multi-gigabyte active collections, cold startup, native macOS/Linux and physical multi-computer acceptance are not established by these measurements. The existing 200 MiB logical cap stays enforced; no permission to waive those requirements is assumed. No app version bump, push or release.

### Final verification for this follow-up

- **603 Node tests passed**, including eight new focused startup/counter/integrity/encoding/capacity regressions.
- **210 full desktop workflows passed**, with no captured renderer errors. Two transient screenshot captures were retried successfully; no workflow assertions were retried.
- Syntax checks and `git diff --check` passed.
- The rebuilt Windows package passed ASAR export/staging workers, exact original-media retention, atomic asynchronous restore, previous revision recovery, duplicate Timing receipt after restore, authenticated host status, storage-usage queries and scoped async save acknowledgement/reopen checks. Runtime: Electron 45.1.0 / Node 24.22.1 / SQLite 3.53.4.
- Test logs: `.qa/phase8-startup-unit-final.log`, `.qa/phase8-startup-desktop-final.log`, `.qa/phase8-startup-package-probe.log`, `.qa/phase8-startup-check-final.log`. Backend measurements: `.qa/phase8-startup-qualification.log`; desktop measurements: `.qa/phase8-desktop-startup-reviewed.log`.

All fixtures and profiles were synthetic/disposable; the installed personal database was not used. The lightweight connection hint does not authorize or validate a replica: activation still opens the full Store and checks the saved identity. Rollback and existing integration semantics remain authoritative.

The final 1,000-car desktop check reached its rendered overview in **800 ms** from benchmark entry (Store open 444 ms), under the plan's two-second target. The same warm-cache/hidden-window limitations apply. Its 120-navigation GC checkpoints returned to 256 DOM nodes and approximately 1.96–2.09 MB live renderer heap. Evidence: `.qa/phase8-desktop-startup-1000.log`.


## Phase 8 completion — remaining metadata work and aggregate media cap

This section supersedes the earlier Phase 8 instruction to retain the aggregate cap. The user explicitly authorized finishing the remaining processing and lifting it after review. No installed personal database was used; version remains 1.1.2 and publication is separate.

Implemented:

- General commands draft changes with copy-on-write containers. Untouched records retain identity, and failed preparation/validation/SQL commits leave the committed collection unchanged. Existing atomic stock/build/review/Timing semantics remain.
- General persistence packs only changed record bodies and explicit removals. Replica catch-up reconstructs requested changed envelopes, reuses unchanged records and existing originals, and commits data plus cursor atomically. Full replacement remains validated.
- Review summaries no longer clone the full metadata model. A negotiated private `reviewBaseline: 1` hashes ordered manifest/record digests, including original hashes, without original bodies. Legacy pending reviews remain visible and require explicit conflict confirmation above the legacy checksum bound.
- Host snapshot metadata streams from one consistent SQLite read into a verified temporary file. Snapshot expiry is two minutes of inactivity, refreshed by requests, rather than two minutes of total transfer time.
- Photos/documents are excluded from the replacement 200 MiB working-metadata safeguard, with a conservative 256-byte allowance per reference. Logical usage remains visible. Disk reserve, original-file, request, backup-record, domain-count, queue and legacy compatibility limits remain.
- Validation and size accounting reuse unchanged validated objects only on the copy-on-write transaction path. Changed Timing records, keys, database identity and replica policy trigger the relevant checks; startup/import/restore continue full validation. Stock/reference relationships still run against the resulting collection.

Review findings fixed:

1. Native structuredClone cannot copy Proxy drafts. Snapshot helpers now use the JSON/lazy-media-aware clone; finalized command results contain plain objects.
2. New objects referenced both by a local variable and through a draft must retain the same mutation target. Drafting newly added raw objects had lost subsequent edits; the corrected finalizer is covered by deterministic mutation/reorder/truncation cases.
3. Replica migration previously assigned normalized submission packages into unchanged shared objects. It now replaces only changed submission records, preserving rollback isolation.
4. Failed snapshot output creation could leak the read handle or risk touching an existing destination. The writer now closes safely and only removes its own newly created incomplete output.
5. Scalar image extension fields could hydrate at record roots. Storage packing/loading, adoption, partial maps, scoped root copies and replica decoding now preserve those lazy handles too.
6. A remaining targeted-save check still applied the old logical cap. All active save guards now use metadata accounting; Timing retains explicit CAPACITY_EXCEEDED behavior for that resource limit.
7. The first final desktop run exposed an obsolete assertion expecting the removed-limit message. It now verifies the new media/metadata distinction and the full suite was repeated.
8. Added general-operation timing exposed repeated validation/hash/statistics work across unchanged Timing laps. Reusing validated immutable sessions and subtree sizes reduced the 1,000-car maintenance p95 from 320.4 to 53.8 ms in the synthetic benchmark. Corrupt changed payloads, changed signing keys, invalid names and insufficient stock still fail and roll back.

9. Narrowing the SQL Timing profile context initially omitted databaseRevision. Existing contract tests and desktop integration checks caught it; the explicit projection now retains identity, revision, signing context and relevant parts.
10. Assigning undefined to a draft accessor was incorrectly treated like an unchanged data property. The draft setter now distinguishes accessors from data descriptors; regression coverage verifies replacement without reading the accessor.

Remaining costs are explicit: startup integrity checking and metadata reconstruction, global identity/stock checks, manifest lists, full snapshot reception and some selectors still scale with bounded metadata. The separate metadata guard is not a claim that its byte count equals process RSS. Older format-3 binaries can retain the former aggregate cap; do not assume a large collection is downgrade-compatible. Large backups use portable format 2 rather than oversized legacy JSON.

### Final backend qualification

Windows x64, Node v24.21.0, AMD Ryzen 5 3600, approximately 32 GiB RAM. Warm OS cache; separate child measurement processes; 10,250 measured laps at every size; twice as many parts as cars. Twenty targeted edits, five general maintenance writes and ten host-local proposals per size. These times exclude Electron launch/paint and physical network latency.

| Cars | Open + overview (ms) | Targeted edit/detail p95 (ms) | Maintenance save p95 (ms) | Host proposal p95 (ms) | Peak RSS (MiB) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 369.9 | 23.4 | 23.8 | 19.2 | 113.4 |
| 500 | 591.7 | 28.7 | 34.3 | 25.4 | 150.4 |
| 1,000 | 805.5 | 37.9 | 53.8 | 28.7 | 175.2 |
| 5,000 | 2543.4 | 187.4 | 235.3 | 61.6 | 442 |

All these startup/ordinary-edit measurements read zero original photos. Maintenance submitted two record bodies and wrote ten scalar fields; the scoped car edit submitted six bodies and changed twelve scalar fields in five records. Metadata, media and derived indexes remain distinct. The 5,000-car general-maintenance result (235.3 ms p95, 185.5 ms maximum synchronous preparation) exceeds the aspirational ordinary-action budget; global validation is still proportional. Targeted car preparation stayed below 16 ms. Do not claim every operation meets the 50 ms preparation target or that the final startup/RSS numbers are identical to the earlier startup-only checkpoint.

### Final multi-gigabyte active qualification

272 distinct padded PNG originals, 8 MiB encoded each, plus the two Timing fixture cars: **2,176 MiB originals / 274 cars**. Fixtures are synthetic, disposable and generated beneath `.qa`. Normal validation remained enabled for both staging passes.

| Operation | Seconds | Peak process RSS (MiB) |
| --- | ---: | ---: |
| Validated initial staging | 62.70 | 174.7 |
| Active workflows + localhost replication | 110.07 | 298.6 |
| Portable export | 37.94 | 134.1 |
| Validated restored staging | 76.36 | 174.4 |

The active child opened in 3150.9 ms, measured 2176.12 MiB logical data and 0.183 MiB working metadata, and passed targeted editing, stock fitting, maintenance, duplicate Timing delivery, correction, withdrawal, general reviewed changes, full localhost copy transfer, incremental catch-up, restart and exact-original hashing. Catch-up transferred 4373 bytes and submitted 5 record bodies. Startup and ordinary operations read zero originals until the explicit original-image check. The active duration includes multi-gigabyte recovery backups and full transfer, not just the small edits.

Portable export and independently validated restored staging passed at the final revision. The large temporary databases were removed after success; the compact report is `.qa/phase8-active-272.json`. A smaller 208 MiB active fixture also passed earlier. No claim of physical LAN, cross-platform execution or OS cold-start timing follows from these measurements.

### Final regression and desktop evidence

- **615 Node tests passed**, zero failures; syntax checks passed. New coverage includes copy-on-write isolation, mixed local/draft references, accessor replacement, lazy extension images, exact metadata accounting, unchanged-session validation reuse, changed/corrupt session rejection, legacy pending-review override, executable baseline fixtures, streaming snapshot failure cleanup and idle-timeout renewal.
- **210 full Electron workflow checks passed**, with no captured renderer errors or screenshot retries in the final run. Earlier interim runs retried transient screenshot captures. Settings storage usage was visually inspected.
- The rebuilt Windows ASAR package passed native SQLite, export/staging workers, exact original media, atomic async restore, previous-revision export, duplicate Timing delivery after restore, host API, storage usage and scoped acknowledgement checks. Electron 45.1.0, Node 24.22.1, SQLite 3.53.4.
- A fresh 5,000-car real Electron run reached the overview in **2403.3 ms** from the benchmark entry, including a **1956.7 ms** Store open. This is hidden-window, warm-cache timing, not OS cold startup. Across 120 page switches, DOM count returned to 256. Main working set was 193.5–194.6 MiB after warm-up; renderer working set varied around 140–158 MiB and ended at 145 MiB. Chromium's performance.memory values were quantized in this run, so they are not reported as exact live-heap measurements. Process working sets and DOM counts support a stable browsing plateau on this fixture.
- Final unit/UI reports, startup measurements and packaged probe output are under `.qa/phase8-completion-*`; `git diff --check` passed. Earlier failed runs in this review were corrected and superseded by the final passing run.

Phase 8's cap-removal implementation and local Windows review are complete. **Release qualification remains limited:** native macOS/Linux runtime/restore, physical LAN, OS cold-start and actual optional scalable Timing/Telemetry client adoption were not tested here. Existing API compatibility passed host/client fixtures and desktop tests. General operations at the largest fixture still exceed the aspirational latency budget as quantified above. No blanket no-freeze, unlimited-storage or all-platform certification is claimed. No version bump, GitHub publication or release was performed.
