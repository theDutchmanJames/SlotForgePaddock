# Scoped first-write review — 3 November 2026

## Result

Normal desktop writes no longer materialize the complete collection before their first commit. The store remains deferred after successful scoped saves. Public Timing, Telemetry and Dealership contracts, identities, storage format 3, original media and application version 1.1.2 are unchanged.

The implementation reuses existing command validation in scoped workspaces. It merges changed records into the full committed directory, preserving all omitted records and ordering. Persistence remains one SQLite transaction covering fields, asset references, indexes, undo, change history and size counters. The next deferred view is constructed before persistence and published only after acknowledgement.

## Loading boundaries

- Car text/history edits, favourites, archiving and maintenance entries load the selected car plus common settings/definitions. Unchanged fields from whole editor forms are compacted before choosing the scope.
- Preferences, columns, custom fields, supplies and incoming packages use their own relevant groups.
- Stock, assemblies, setups, jobs and shopping retain complete connected-stock validation. This deliberately checks other cars' installations and reserved quantities. These commands no longer load unrelated Timing sessions, documents, submissions or old history just to save.
- Part deletion additionally checks historical stock references. Document actions load documents; catalogue imports include supplies; build actions include drafts; choice renames include manual tests used by reusable choices.
- Timing delivery reads the addressed session and referenced cars. Configuration signatures, duplicate/conflicting/stale revisions, corrections, withdrawals and archived/missing-car handling remain unchanged.
- Dealership simulation, proposal receipt and approval use scoped records. Approval commits the selected changes and receipt together. Field-condition checks read the named car instead of loading every car.

Explicit full snapshots/JSON exports, migrations, restore, full replica operations and arbitrary internal compatibility transactions retain their full-validation path. Legacy Dealership peers that need whole-snapshot checksums intentionally use a fully loaded predecessor. These boundaries are not claimed to be single-record operations.

## Review findings and fixes

1. A sparse workspace must never replace an entire array. Manifest merging preserves omitted entries, handles prepend/append ordering and rejects new record-key collisions. Index-keyed planning arrays remain complete scopes.
2. Old deferred getters cannot be reused against a new on-disk revision. Each commit creates a fresh revision-bound view, while explicit full predecessor snapshots remain immutable.
3. A queued asynchronous command may acquire its lock after another caller requested a full snapshot. The execution path now checks the actual state at lock acquisition.
4. Workspace validation cannot enforce whole-collection size limits by itself. Revision-bound SQL size counters now update atomically from changed record envelopes, media lengths and manifest punctuation. Missing/stale counters rebuild once using SQL shapes and byte lengths. Restore repairs rebuild the counters. Tests compare counters with complete serialization and independent SQL measurement, including Unicode, media replacement/removal, session correction and whole replacement.
5. The first implementation rescanned all SQL sizes on every save, slowing repeated writes. Incremental counters removed that regression without constructing the model.
6. Legacy peer checksums require the previous complete model. Legacy connection setup explicitly prepares it; modern peers remain deferred.
7. Scoped Timing storage failures retain the existing API error codes. Database revision, target file and current-state checks remain enforced before publication.
8. Existing signed sessions must not receive a newly generated replacement signing key. First profile capture now refuses this invalid state without writing.
9. Removed the now-unused first-write preparation method. Full validation helpers remain for operations that actually require them.

Unopened unrelated corruption is not repaired or discarded by a scoped edit. An independent preference/text edit may succeed; accessing the corrupt record or attempting a dependent stock operation fails integrity checks. Full validation remains available at migration, restore and explicit full-model boundaries. This is a deliberate change from blocking every first write on every unrelated body.

## Validation

- Complete automated suite: **651 passed**. Seventeen new scoped-write cases cover bounded reads, exact preservation/undo, stock sharing, stale/concurrent edits, mixed snapshot callers, photo focus, Timing corrections/withdrawals, Dealership field selection, atomic limits, corrupted dependencies, extension fields, workshop/shopping/manual tests, stock-return overrides and size-counter rebuilds, older-writer epoch/sequence invalidation and missing Timing signing keys.
- Final focused review/Dealership/scoped suite: **60 passed**.
- Desktop workflow suite: **210 checks passed**, no captured renderer errors. One earlier run hit an asynchronous review-checkbox assertion; two complete subsequent runs passed without changing UI code or weakening the assertion.
- Windows ASAR: scoped first save, unloaded Timing history, persisted edit and portable backup export/staging workers passed, with an exact restored-collection comparison. Electron 45.1.0 / SQLite 3.53.4.
- Synthetic **208 MiB original-photo collection**: scoped first edits, stock, maintenance, Timing duplicate/correction/withdrawal, general reviewed change, full localhost sync, incremental catch-up, restart, original hash verification and validated portable backup round-trip passed. Ordinary operations read zero original images; catch-up transferred **4,373 bytes / five record bodies**. Active-workload peak RSS was about **253 MiB**, including integration/backup work.

No installed user collection was edited. Native macOS/Linux, physical multi-computer LAN and OS cold-cache performance were not tested here.

## Performance measurement

`node scripts/qualify-first-write.cjs` compares three fresh-process runs per path using disposable copies of the synthetic fixture: 5,000 cars, 10,000 parts and 10,250 measured laps. OS caches are warm; timings cover backend acknowledgement, not renderer paint or physical network transit.

| Measurement | Former full-load boundary | Scoped boundary |
| --- | ---: | ---: |
| First car edit | 3,823–4,104 ms | 674–690 ms |
| Deferred-model records read | 20,107 | 9 |
| Following maintenance save | 137–171 ms | 91–99 ms |
| Process peak RSS | 210–211 MiB | 125–126 MiB |

The scoped samples deliberately use an older fixture without size counters, so the first save includes their one-time SQL rebuild. Subsequent writes update only changed-record sizes. The directory still scales with record count; stock operations still scale with their connected dependency group. These measurements are not universal performance guarantees.

Local reports: `.qa/first-write-qualification.json`, `.qa/scoped-final-tests.log`, `.qa/scoped-review-final.log`, `.qa/scoped-package-result.json`, `.qa/scoped-active-26.json`.
