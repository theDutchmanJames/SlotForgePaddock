# Dealership proposal save performance

## Finding

A single history-field edit produced a 950-byte proposal in a synthetic 112 MiB collection, yet queuing it took 2,202 ms. Transfer size was not the main cause. The main process repeated validation/simulation, encoded collection photographs repeatedly after the string cache overflowed, hashed the collection and synchronously persisted the full JSON database.

## Changes

- Cache valid base64 image strings separately without retaining a second escaped copy. JSON encoding and hashes retain exactly the native JSON bytes.
- Reuse a local proposal's simulation only while its exact originating database state is still current. Network proposals continue to be validated independently.
- Compact real-car history to changed fields. Merge sparse changes before normalisation so unrelated fields/photos remain intact. Manually replaced values lose their stale evidence unless replacement evidence is explicitly supplied.
- Save incoming/local Dealership proposals asynchronously in buffered writes. Flush and atomically replace the database before acknowledging success. Keep the previous-file backup.
- Serialize asynchronous writes, prevent synchronous writes from overwriting an in-flight transaction, and publish the new state only after persistence succeeds. Recheck network permissions and identity after waiting. App shutdown waits for pending writes.

## Measurement

Run `node scripts/benchmark-review-save.cjs` from the repository root. It creates and removes its own disposable `.qa/review-perf-*` folder. `PERF_CARS` and `PERF_KIB` optionally change the synthetic collection size.

| Measurement | Before | After |
| --- | ---: | ---: |
| Queue one history-field proposal, 112 MiB collection | 2,202 ms | 457 ms |
| Proposal size | 950 bytes | 950 bytes |
| Simulations | 2 | 1 |
| Simulation time | 754 ms | 9 ms |

After the change, a 10 ms main-process heartbeat continued during persistence (24 ticks during the measured save plus a 20 ms settling interval); its maximum observed delay was 98 ms. This is a local synthetic benchmark, not a promise for every computer or a two-computer network test. Whole-collection integrity hashing still takes main-thread time. The JSON storage format still writes the full database; this change makes proposal disk writes asynchronous, not incremental. Approval, standalone edits and replica replacement retain their existing persistence paths.

## Verification

- 408 automated tests passed, including five new async persistence/proposal tests.
- Syntax checks passed.
- Hidden Electron UI check used a disposable profile: edited and saved a real-car history field, verified it entered Review without changing the approved car, then exercised named review cards, selective technical approval, stock return and livery styling. No renderer errors.
- Regression checks cover concurrent duplicate deliveries, permission revocation while waiting, atomic-write failure and recovery, exact JSON output, restart persistence, unrelated history preservation and sequential approval of independent history changes.

No personal collection was changed. These source changes are not a published release.
