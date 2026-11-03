# SQLite performance refinement — 3 November 2026

This pass reduces work performed while preparing ordinary saves. It does not change the storage format, review policy, public integration contracts or app version.

## Findings and changes

CPU profiling of a synthetic 5,000-car / 10,000-part collection with 10,250 measured laps found two avoidable costs:

- Prepending a history entry through a draft Proxy visited and drafted displaced entries. Reading a list also eagerly enumerated its child descriptors. Drafts now register original children on access or copy; `push` and `unshift` move references on the detached array while retaining already-accessed child drafts. Other array operations retain their existing behaviour.
- General save preparation rebuilt persistence keys for unchanged lists. It now reuses unchanged subtrees from the exact committed manifest and compares records only within changed branches. Full packing remains available when there is no committed baseline.

No validator was removed. Identity, stock, references, transaction atomicity, revision checks and review conflict handling remain in force. Lazy image accessors and original bytes remain intact. The optimizations introduce no persistent model cache.

## Review and regression coverage

Added focused tests for edits through retained child references after multiple insertions, local references to newly inserted records, borrowed array methods, exception rollback, untouched object identity, lazy accessor preservation, read-only draft traversal, unchanged-inventory traversal, and equivalence between partial and full packing after additions, removals, reordering and shape changes.

The complete Node suite passes **619 tests**, with zero failures; syntax checks pass. The rebuilt Windows ASAR passes SQLite saves, scoped acknowledgements, original-photo preservation, export/staging workers, atomic restore, previous-revision recovery, duplicate Timing delivery after restore and host API checks.

The complete hidden Electron suite passes **210 workflow checks**. Two transient screenshot captures needed a retry; the suite completed successfully. These desktop checks use isolated synthetic profiles, not the user's installed collection.

## Repeatable backend measurements

`node scripts/qualify-storage.cjs` on Windows x64, Node 24.21.0, Ryzen 5 3600, approximately 32 GiB RAM. Warm OS cache; separate child measurement processes. Each size includes twice as many parts as cars and 10,250 laps. Five maintenance saves per size; p95 is effectively the slowest of those five samples. These are synthetic backend measurements, not physical network timings or guarantees for every machine.

| Cars | Maintenance save p95 before → after | Maximum synchronous preparation before → after |
| --- | ---: | ---: |
| 100 | 23.8 → 23.7 ms | 10.7 → 7.1 ms |
| 500 | 34.3 → 25.1 ms | 19.0 → 10.0 ms |
| 1,000 | 53.8 → 36.7 ms | 35.7 → 16.1 ms |
| 5,000 | 235.3 → 125.7 ms | 185.5 → 78.1 ms |

At 5,000 cars, maintenance save time fell approximately **47%**, and its maximum synchronous preparation fell approximately **58%**. The write still submits two record bodies, writes ten scalar fields and reads no original images. The measured peak process RSS was 388.6 MiB versus 442 MiB previously; this includes the complete benchmark workload and is not an isolated live-heap measurement.

The same run measured targeted-edit/detail p95 at 140.6 ms, host-local proposal p95 at 62.4 ms, and backend open plus overview at 2442.5 ms for 5,000 cars. Targeted edits, proposals and startup were not the focus of these changes; differences in those measurements should not be attributed solely to this optimization.

Reports: `.qa/tuning/baseline-qualification.json`, `.qa/phase8-qualification.json`. Inspector profiles in `.qa/tuning/` were used to locate costs; headline timings above come from the unprofiled qualification script.

The active 208 MiB original-photo fixture also passed validated staging, ordinary editing, stock installation, maintenance, Timing duplicate/correction/withdrawal handling, general reviewed changes, full localhost replication, incremental catch-up, restart, exact-original hashing, portable export and independently validated restored staging. Catch-up transferred 4,373 bytes and submitted five record bodies; ordinary operations read zero originals. This is a regression run above the former aggregate limit; the prior 2.1 GiB qualification was not repeated for this tuning pass.

## Remaining limitations

Global reference and stock checks, changed-list copying, manifest serialization and some index work remain proportional to collection size. The 5,000-car general-save preparation still exceeds the aspirational 50 ms budget. This pass does not claim to eliminate every possible UI stall. Native macOS/Linux execution, physical two-computer LAN behaviour and OS cold startup have not been revalidated here.
