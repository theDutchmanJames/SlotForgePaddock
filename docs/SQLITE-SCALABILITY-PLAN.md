# Paddock SQLite scalability plan

Updated 3 November 2026. This consolidates the agreed phased direction and adds targeted reads, validation, field updates and change delivery throughout Paddock. It is an implementation plan, not a claim that these features are already built.

The objective is straightforward: a small edit should require a small amount of work, even in a large collection. Related changes must still commit together, existing data must survive migration, and Timing, Telemetry and Dealership connections must remain compatible.

## Implementation record

Implementation began on 3 November 2026. See [transaction inventory and contract](SQLITE-TRANSACTIONS.md) for phase 0 and [phase reviews](reviews/2026-11-03-sqlite-scalability.md) for findings, evidence and remaining gates. Publication and releases remain separate actions.

Current checkpoint: phases 0–7 have implementation and review records, with their stated platform/client acceptance limits. Phase 8 implementation and local qualification are complete, with the external acceptance limits recorded below. Phase 4 includes the SQL read layer, page-specific local screens and editor contexts, persisted result/pace summaries, and compatibility adapters for the existing Timing and Telemetry endpoints. See the phase review for validation evidence.

Showroom, Workshop, supplies, assemblies, shopping, Build from Scratch, selected stock/technical details, Settings, Library, Connections and Import & Export now use scoped projections. Editors request their target records and complete compact choice metadata; they no longer fall back to a full renderer collection. Long browsing lists have page controls. Full original photos remain lazy.

Core processing is bounded by the working-metadata safeguard: the Store still loads the non-media model, complete selector metadata scales with the number of choices, and a configuration comparison can load the selected car's saved setups. Legacy remote sharing still uses its existing cache. Notifications refresh the active page by collection revision rather than selectively invalidating individual records. Phase 5 adds negotiated durable Dealership change batches, atomic replica cursors, chunked snapshots with separate assets, bounded notification/retry queues and selective independent-field approvals. Existing Timing/Telemetry APIs and the single Dealership password remain unchanged. See the [sync contract and fixtures](../integration-handoff/dealership-sync-v2/README.md) and phase review for evidence. Phase 6 host-side scalable integration reads are implemented and reviewed: optional public catalogue/result change cursors, separate public main-picture chunks, signed profiles without inline photos, session metadata and paged laps. See the [client adoption handoff](../integration-handoff/scalable-v1/README.md). Existing client behavior remains compatible. Timing/Telemetry client adoption and physical multi-computer acceptance are still outstanding gates; they are not claimed complete by host tests. Phase 7 now implements portable backup/recovery on the host and desktop; its results and remaining platform gates are below. Phase 8 adds pre-serialization guards, disk-space preflight, storage usage, and larger-fixture qualification. Phase 8 now removes the aggregate media cap after active multi-gigabyte qualification, keeping a separate bounded working-metadata guard. Native-platform and physical-network release acceptance remain outstanding. See [storage limits and outstanding gates](STORAGE-LIMITS.md).

## Starting point

The reviewed first implementation uses SQLite records containing JSON, with deduplicated attachments stored separately. Unchanged records and photos are not rewritten. Existing car review proposals already omit unchanged fields. However, startup and transaction preparation still load, clone, validate or compare much more of the collection than an ordinary edit needs. SQLite approval still writes the affected car record rather than a dedicated field column.

The first implementation's review passed 453 automated tests and 193 desktop checks. Its findings and limitations are recorded in [SQLite storage](SQLITE-STORAGE.md). At that baseline the 200 MiB logical collection limit remained. Phase 8 below records its replacement; per-photo limits and existing network contracts remain.

## Decisions that apply to every phase

- Each computer owns its local SQLite database. Computers exchange authenticated API messages; they never open each other's SQLite files over Wi-Fi.
- One domain transaction engine owns mutations. Local edits, approved proposals, stock operations and accepted integration results use it. Review is an approval layer, not a second implementation of the business rules.
- One user action is one atomic operation, potentially containing several targeted writes. Individual fields are not independently committed when their correctness depends on each other.
- Proposal payloads describe intended actions. Replication messages describe committed effects. Clients cannot bypass stock or configuration rules by submitting arbitrary SQL or generic unrestricted field patches.
- Notifications and successful acknowledgements follow durable commit. A commit includes the affected records, history, revisions, operation receipt and replication-log entry.
- Full originals, privacy rules, car/database IDs, configuration signatures, captured race configurations, corrections and withdrawal semantics survive the transition.
- Existing contracts remain supported. Breaking wire-format changes require a separately advertised version and a tested fallback or clear compatibility error.
- No automatic scraping, AI integration, remote internet access or independent editing masters are introduced by this work.

## Example of the intended behaviour

An ordinary livery edit submits the car identity, operation identity, changed livery value and the concurrency information needed to compare against the editor's starting state. It does not include the car's photographs or unrelated fields.

In personal mode, Paddock validates and commits that edit. In Dealership Mode, it first stores the proposal; the official car remains unchanged until approval. Approval checks the current affected values and commits the accepted edit, history, review outcome and revision together. Other computers receive the resulting small change batch.

A motor replacement is different. The engine must inspect the relevant car, old and new installations, stock quantities and any assembly constraints. Returning the old motor, installing the new one, updating configuration and writing history form one transaction. A failure rolls back all of them.

“Only what changed” means avoiding unrelated application data and work. SQLite may still rewrite storage pages and indexes internally. Custom JSON fields may also require a small containing object to be rewritten; there is no requirement to create a physical SQL column for every user-defined field.

## Phase 0 Establish contracts and measurable baselines

Create an operation inventory covering cars and history, custom fields and choices, parts, supplies, installations, assemblies, builds, setups, jobs, shopping, maintenance, imports, review, settings, Timing sessions and Dealership replication. Record each operation's reads, writes, invariants, side effects and privacy scope. Include cascades such as deletion and choice renaming.

Specify the internal command/result interface and a proposed versioned change-feed contract before clients implement it. Define absent versus null versus empty values, removals, stable record IDs, ordered lists, operation IDs, database identity, revision ordering, conflict responses and transaction grouping. Use IDs for list members rather than mutable array positions. Exact public paths and schemas must be published as fixtures when the new API is implemented; names in this plan are not endpoint commitments.

Measure startup to usable screen, list/detail reads, local saves, proposal submission, approval, catch-up, Timing ingestion and Telemetry queries. Separate main-thread blocking, database time, validation time, bytes transferred, records touched and peak memory. Use real decodable images in representative fixtures, not only synthetic base64 strings.

Gate: the operation inventory and compatibility matrix are complete; reproducible baselines exist for 100, 500 and 1,000 cars within today's limits; the current regression suite passes. Send a handoff for Timing's client work when the interface is concrete. Timing's SQLite schema does not need to match Paddock's.

## Phase 1 Establish the transaction and repository boundary

Introduce repository methods for bounded reads and typed domain commands. First adapt existing operations without changing their behaviour. Route all mutation entry points through this boundary; audit direct Store replacements and integration writes so none can bypass it accidentally.

Run database work in a dedicated worker with a serial write queue. Avoid passing whole collections between workers and the main process. Keep reads consistent and make shutdown wait for acknowledged work or report an interrupted operation accurately.

For each command, load its dependency set, validate it and commit related changes atomically. Maintain database constraints for relationships, uniqueness and stock rules where feasible; use domain validation for rules spanning several records. Detect stale dependencies inside the transaction. Validation must account for new matching records as well as records already read, for example a newly created installation consuming stock.

Start with field edits, then migrate inventory/assembly/build/job operations, and finally imports, reviews and integration commands. Unconverted operations may temporarily retain the existing broad validation path behind the same interface; record them explicitly and do not claim they are optimized.

Gate: every converted operation matches the existing engine on disposable fixtures, including its history and rollback behaviour. Failure injection between dependent writes leaves no partial stock, review or configuration changes. A single ordinary field edit does not clone or validate the entire collection.

## Phase 2 Migrate to targeted persistent records and durable changes

Design a hybrid schema around access patterns. Core identities, revisions and frequently edited, filtered or sorted fields get typed columns and indexes. Technical fields and custom values use related tables or bounded JSON structures where appropriate. Arrays with independent lifecycles, including photos, installations and lap records, get stable identities and queryable relationships. Preserve immutable historical snapshots as snapshots.

Update only the affected columns or related rows. Keep any search indexes or derived summaries consistent within the transaction, or explicitly mark them pending and rebuildable. A no-op edit must not create a review, advance revisions or emit a change.

Persist a monotonically ordered change log, transaction identity, entity revisions, deletion markers and retry receipts in the same commit as the data. A batch must be visible either completely or not at all. Record enough before-state for supported recovery and exact conflict checks; do not depend on formatted or truncated UI descriptions.

Replace full-collection conflict hashing on ordinary edits with targeted concurrency checks. Unrelated field edits can coexist. Same-field changes, deletes, and operations whose stock/configuration dependencies changed require comparison or revalidation. Define behaviour for a value changed away and back: use relevant version information, not timestamps alone. Approval still remains required; an unrelated edit merely stops being a false conflict.

Migrate from storage format 1 through a staged, verified migration that keeps the original recoverable. Preserve legacy JSON field ordering wherever existing signatures or digests depend on it. Adapters must reproduce existing public DTOs rather than exposing SQL rows directly.

Gate: restart, migration interruption, duplicate delivery, concurrent edits, no-op edits, correction and withdrawal tests pass. One-field edits touch only their dependency/affected records and metadata; unrelated photos, cars and sessions are not read or rewritten. Old pending proposals still review correctly through a compatibility adapter.

## Phase 3 Load media on demand and bound its lifetime

Store media with stable asset IDs, hashes, MIME types, dimensions and byte lengths. Ordinary car/part queries return metadata and asset references. Read original bytes only when displaying, exporting or transferring them. Preserve imported originals; never replace them silently with thumbnails.

Generate and cache thumbnails away from the main thread. Bound decoded-image and thumbnail caches. Replace the window-lifetime registry with explicit leases for visible views, open editors, uploads and exports so cache eviction cannot break an unsaved form.

Garbage collection must retain assets referenced by current records, pending proposals, history/recovery requirements and active operations. Stage new assets until their referencing transaction commits; reclaim abandoned uploads safely. Handle interrupted uploads and backups without missing or orphaning live media. Media access inherits collection permissions; a hash is not authorization.

Gate: startup does not hydrate originals; repeated browsing, editing, cancelling imports and switching collections reaches a bounded memory plateau. Originals round-trip byte-for-byte through migration, backup and current integrations. Removing a photo during an open viewer/export behaves predictably.

## Phase 4 Make the UI and integrations read only what they need

Replace whole-collection renderer snapshots with page-specific queries: overview counts, paginated car/part lists, selected car details, setup/history pages, review queues and session/lap pages. Use indexed searches and deterministic pagination. Virtualize long lists where measurements show it is needed.

Keep a bounded renderer cache and invalidate only affected views after a committed batch. Preserve selection, scroll, filters and unsaved input. Discard stale responses after changing collection, page or query; tie pagination to a defined revision/snapshot so concurrent edits do not silently skip or duplicate results.

Provide SQL-backed adapters for existing Timing catalogue/profile and Telemetry browsing endpoints. Reconstruct the exact historical configuration that raced. Do not recompute records or mileage from every historical session on each screen refresh; maintain tested, rebuildable summaries from eligible physical results.

Gate: representative overview, search, detail, review and lap-history screens work without a full collection IPC payload. Query cost depends on requested/affected data. Existing public API fixture and privacy tests remain unchanged and pass.

## Phase 5 Make Dealership synchronization durable and incremental

Replace the restart-sensitive in-memory change journal with the committed log. Connected clients receive a lightweight “changes available” signal and fetch ordered batches after their last applied cursor. Coalesce notifications and use bounded catch-up batches. Heartbeats and occasional recovery checks remain; quiet connections should not repeatedly transfer collections.

A client atomically applies each complete batch and advances its cursor. Duplicate batches are harmless, gaps are detected, and reconnect/restart resumes from the last durable point. Bound retry frequency with backoff. Slow clients cannot accumulate an unlimited queue in host memory.

Make proposal delivery idempotent by source/operation identity and content digest. Lost acknowledgements must not duplicate work. Re-review current affected values at approval, allow selection of independent changes, and show dependent changes as an inseparable group. Explicit override of an installed component must perform the correct stock-return operation, not just overwrite its label.

Define a bounded retention policy for changes, tombstones and operation receipts. Do not silently accept an ancient retry as a new operation after its receipt expires. A cursor older than retained history triggers the agreed prominent out-of-date message and an explicit replacement workflow. Back up the existing copy and retain or explicitly resolve unsent proposals before replacement; never silently discard them.

Transfer required full snapshots as bounded, verifiable chunks from one consistent database revision, with assets transferred separately and deduplicated. Verify the staged copy before switching it live. Interrupted transfers leave the previous usable copy intact. Preserve Dealership's existing single user-chosen password and access model.

Gate: disconnects, restarts, lost acknowledgements, stale cursors, same/different-field edits, deletes, partial approvals and stock conflicts pass local server/client tests. Network payloads for ordinary field edits remain independent of collection/photo size. Complete a physical multi-computer acceptance run before claiming LAN behaviour is verified.

## Phase 6 Coordinate Timing and Telemetry through versioned APIs

Paddock owns the host API, collection/configuration data and transaction engine. Timing owns its local cache, race execution and outgoing results queue. Telemetry owns its analysis cache and client. No shared database file, SQL schema or SQLite synchronization protocol is required between apps.

Advertise optional capabilities for catalogue changes, media access and scalable result/session reads. Produce schemas, examples, correction/withdrawal fixtures, pagination/cursor semantics and a compatibility matrix in dedicated handoff folders. Client implementations are separate work; do not edit their repositories as part of this plan without authorization.

Timing may refresh linked cars from a catalogue change cursor and fetch only changed profiles/media. It must keep its local race cache and capture the configuration before racing. Finalized results remain structured, idempotent session submissions. A session correction is an atomic replacement of that session's contribution; do not turn measured laps into independently editable arbitrary field writes or weaken existing revision semantics merely to reduce payload size.

Telemetry receives changes for delivered, corrected and withdrawn sessions and fetches only needed sessions/laps. Preserve validity, pit flags, virtual participant exclusions, driver changes and record eligibility. Corrections and withdrawals must invalidate derived records, distance and cached analysis consistently.

Gate: existing Timing/Telemetry clients work with existing supported payload sizes, and new capability-aware clients pass shared fixtures. Old clients must receive explicit size/version errors where a new large operation cannot be represented; no silent truncation. Full new-client acceptance requires coordination with those apps, not just host tests.

## Phase 7 Stream backups, restores, imports and recovery

Introduce a versioned portable backup package with a manifest, bounded record streams and separate media. Create it from a consistent database snapshot and pin required assets while exporting. Write incrementally, report progress, support cancellation and publish the finished file only after verification. Include private data and keys only according to the established full-backup versus shared-export rules.

Restore into a separate staging database, validate schema, identities, references, media and signatures, and retain a recovery copy before switching. Preserve the existing previous-revision export capability through bounded undo/recovery storage; do not replace it with an incomplete journal extract. Define crash-safe switching and disk-space checks for the peak migration/restore footprint.

Keep legacy JSON backup/import support within its documented limits. Large collections use the new format. Never create an oversized “compatible” JSON file that existing readers cannot reopen. Portable car packages and manufacturer imports stay versioned and bounded, with batch processing where necessary.

Gate: multi-gigabyte test backups/restores use bounded memory, preserve complete data, and survive cancellation, corruption, disk-full conditions and interruption. Restore a backup on each supported platform. Signing secrets, private documents and pending proposals receive explicit completeness/privacy tests.

Phase 7 implementation status: portable format 2, background export/staging with progress/cancel, complete previous-revision exports, verified recovery backups, atomic activation, corruption/cancellation/failure checks and Dealership recovery conversion are implemented. The 2.1 GiB storage transport benchmark passes with bounded attachment memory. Phase 8 now validates active multi-gigabyte restore staging under the separate metadata guard. Native Linux/macOS restore runs remain explicit acceptance gates; they are not inferred from Windows transport tests. See [format documentation](PORTABLE-BACKUPS.md) and the [review record](reviews/2026-11-03-sqlite-scalability.md). Phase 8 qualification follows below.

## Phase 8 Replace the collection-wide cap and qualify releases

Remove the 200 MiB logical collection cap only after phases 1–7 have eliminated its whole-collection memory and transfer dependencies. Audit every size check and document whether it protects an individual request, image, import, record, pending queue or the old total collection. Keep useful per-operation limits; separately decide new original-photo limits after decode-memory and transfer tests.

Replace the total cap with resource-aware safeguards: free disk space, bounded requests/pages, bounded caches, background jobs with progress and cancellation, and understandable compatibility messages. Do not advertise unlimited storage. Show database/media usage and practical backup guidance.

Qualify with 100, 500, 1,000 and 5,000-car fixtures, many catalogue parts, large lap histories and multi-gigabyte media. Include duplicate and unique photos, sparse and heavily customized cars, pending reviews and offline replicas. Publish measured results, remaining limits and minimum supported versions.

Gate: all data, integration, performance and platform acceptance criteria below pass or have an explicitly agreed release limitation. Review each completed phase before the next; do not combine an unverified migration, protocol change and cap removal into one release.

Phase 8 implementation and local Windows qualification are complete. General mutations use copy-on-write drafts, review summaries reuse unchanged records, SQLite packing and replica catch-up operate on changed record bodies, host snapshots stream, and general-review digests avoid original-media reads. Active 2.1 GiB collections passed domain operations, Timing corrections/withdrawals, reviewed changes, localhost replication, restart and validated backup round-trip. The 200 MiB aggregate media cap is removed; a separate 200 MiB working-metadata safeguard remains because core validation still processes non-media records. Existing individual-file and legacy transport limits remain. Native macOS/Linux, physical LAN, cold-start and upgraded external-client acceptance remain release gates, not silently waived requirements. See [the limit audit](STORAGE-LIMITS.md) and the review record.

## Acceptance and regression matrix

| Area | Required evidence |
| --- | --- |
| Migration | Legacy JSON and first SQLite format; exact identifiers, custom values, ordering-sensitive snapshots, media and keys; interrupted staging/publication; untouched recovery source |
| Transactions | Field edits, stock/assembly/build changes, history and review outcome commit together; injected failures and queue retries; no notification before durability |
| Conflicts | Independent fields, same field, delete/edit, changed-away-and-back values, dependency/stock changes and stale approval screens |
| Replication | Duplicate, reordered and missing delivery; restart; offline/outdated copy; expired cursor; log pruning; slow client; snapshot replacement with pending work |
| Integrations | Old/new client matrix; renamed/archived/missing cars; captured configuration; multi-car sessions; corrections, withdrawals and virtual/pit/invalid laps |
| Media and backup | Original bytes, transparency and metadata; bounded cache; open editor/viewer leases; interrupted transfer; corrupted package; disk full; restore completeness |
| UI | Search, filters, pagination, counts, custom fields, manual records, field selection, themes, keyboard operation and unsaved form preservation |
| Performance | Startup, p50/p95 action latency, main-thread stalls, memory, SQL reads/writes and network bytes at increasing collection sizes |
| Platforms | Packaged Windows, macOS and Linux SQLite/worker/migration tests; physical LAN host/client tests reported separately from automated local tests |

Initial performance objectives on a documented reference computer: no main-thread task over 50 ms for an ordinary field edit; local edit acknowledgement p95 below 200 ms; Dealership proposal acknowledgement p95 below 300 ms on an idle LAN; first usable collection view below 2 seconds at 1,000 cars. These are targets to measure, not current guarantees. Large imports, migration and media transfer may take longer but must remain responsive and show progress. Report cold/warm runs and hardware; do not hide failing targets by testing only tiny fixtures.

The stronger architectural acceptance test is scaling: an ordinary single-field edit must not read or serialize all cars, all photographs or all lap history as the collection grows. Relevant global constraints still need efficient indexed checks, and large intentional bulk actions still perform proportional work.

## Delivery and rollback rules

Each phase ships with migration/recovery notes, updated fixtures, meaningful regression tests and a review of the changed paths. Preserve the current release's data until the new storage is verified. Test migrations on copies first; never use the personal collection as a test fixture. A binary downgrade must not open newer storage blindly: document the supported restore/export path and reject unsupported storage versions explicitly.

Avoid two independently writable implementations during transition. Use adapters or comparison runs on disposable data; once a command is converted, its production writes use one authoritative path. Retire obsolete whole-model code only after its consumers have moved and the compatibility tests prove it is no longer needed.

Implementation proceeds phase by phase; GitHub publication, release creation and other apps' client changes are separate actions.
