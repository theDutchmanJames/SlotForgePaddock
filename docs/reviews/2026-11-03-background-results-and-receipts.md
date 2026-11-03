# Background results, targeted invalidation and durable saves

Review completed 3 November 2026. Application version remains 1.2.0. This work does not publish a release.

## What changed

- Timing uploads parse JSON, validate captured configurations and laps, calculate derived results, and commit in a persistent worker. A successful HTTP response still follows the durable commit. Existing in-memory/synchronous helpers remain available.
- Timing receipt lookup reads the named source/session record in that worker, rather than materializing the complete session list.
- SQLite records affected public car IDs in the same transaction as part/installation changes. An unused spare or a stock-quantity/location change produces no car invalidation. Fitted component renames and changed installations invalidate their dependent cars, including both sides of a reassignment/removal.
- Public change feeds apply their batch limits to the requested kind. Large catalogue-only changes no longer reset car or result caches merely because many private stock records changed. Older dependency journal entries and excessive fanout retain the conservative reset response.
- Ordinary personal-database desktop saves carry stable command IDs. SQLite commits the fingerprint and exact JSON result alongside data, indexes, undo and change history. An identical retry returns the saved result; reusing an ID for different content fails. No-op results are also durable without advancing the collection revision.
- Renderer retries retain their ID after transport/uncertain-result errors, including across a renderer reload when browser storage is available. An acknowledged subsequent action gets a new ID. The receipt protects replay of the same identified command; this is not an automatic recovery queue for every abandoned editor or imported file.
- Dealership proposals keep their existing IDs, permissions and review protocol. Timing retains its source/session/revision idempotency protocol. Local desktop command receipts do not introduce another public API or credential.

## Review findings and fixes

1. **Lazy photographs and structured cloning.** Worker transport would evaluate photo accessors on the caller thread. Internal transport now carries immutable asset metadata and reattaches accessors in the worker. The photo-edit regression test records zero original-image reads on the calling thread. Live main-process asset handles remain pinned during the worker commit.
2. **Rejected first saves.** Initializing a collection inside the worker could leave the main process expecting a nonexistent file after validation failed. Initialization now completes through the existing persistence path before the command begins.
3. **Lost acknowledgement after commit.** Worker exits/timeouts are marked uncertain. Recovery waits for the terminated worker, reloads the committed generation, and preserves the command ID. A real worker-exit test commits an entry, exits before acknowledgement, and retries without duplication.
4. **Failures while preparing the UI response.** A committed save can succeed even if view refresh or media projection fails. Such failures preserve the retry identity rather than turning the next attempt into an unrelated save.
5. **Queue growth outside the worker queue.** Waiting on the collection lock also retains upload buffers. Domain work is bounded to 16 pending operations and 32 MiB of pending request bytes per store, in addition to the shared worker queue limit. Authorization is checked after obtaining the lock. Busy network requests get a retryable server failure.
6. **Public invalidation precision.** Dependency queries inspect old and new installations inside the transaction. They query changed-part dependencies together, not once per imported part. Removed cars retain explicit removal operations. Combined direct/dependent invalidation sets remain bounded.
7. **Receipt atomicity and restore.** A simulated receipt insertion failure rolls back the data, indexes and change cursor. Restore/replacement clears local receipts when the storage epoch changes; an old command with its old epoch is rejected.
8. **Bulk-operation results.** Large results use lossless compression rather than a small uncompressed receipt ceiling. Replay restores the exact result, including detailed bulk rows. Receipts are bounded to 100,000 identities and 32 MiB of encoded result data per epoch; reaching a limit rejects and rolls back the new save instead of silently forgetting retry protection. Individual decoded results retain the existing 200 MiB metadata working bound.
9. **Dealership routing.** The renderer uses the actual `role` field to keep local command IDs out of coordinator/member proposal flows.

## Validation

| Check | Result |
| --- | --- |
| Complete Paddock Node regression suite | 670 passed, no failures or skips |
| Timing v2.1.0 Paddock client tests, using this host | 122 passed, no failures or skips |
| Telemetry Paddock client and real-host interop tests | 23 passed, no failures or skips |
| Electron desktop workflow suite | 210 checks, zero renderer errors |
| Windows ASAR-packaged worker probe | 8 checks passed on Electron 45.1.0 / SQLite 3.53.4 |
| Syntax checks | Passed |

Coverage includes duplicate/conflicting/stale deliveries, corrections and withdrawals, wrong identities, permissions, concurrent saves, manual records, captured historical configurations, stock validation, queue pressure, compressed receipts, actual worker failure after commit, restore epochs, lazy photographs, legacy change journals, dependency fanout, exact portable backup restoration, and existing sharing workflows. The packaged probe exercises workers from inside `app.asar`, not just Node source modules.

Tests use artificial collections and local servers. No real collection was migrated or edited. Timing and Telemetry source was not modified. These checks do not claim a new two-computer Wi-Fi test or macOS/Linux runtime test.

## Responsiveness measurement

Reproduce with `node scripts/benchmark-result-worker.cjs`. This creates disposable databases and compares synchronous and background receipt of identical artificial sessions. Timers measure main-thread availability, not frame rate or network latency.

| Laps | Path | Total processing | First timer | Largest timer gap |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | Synchronous | 91 ms | 91 ms | 91 ms |
| 1,000 | Background, cold worker | 181 ms | 7 ms | 27 ms |
| 10,000 | Synchronous | 563 ms | 564 ms | 564 ms |
| 10,000 | Background, warm worker | 611 ms | 9 ms | 19 ms |

The improvement is responsiveness during processing. Total work still takes time, and writers still serialize to preserve stock and review consistency. Explicit full exports/restores, legacy full-snapshot peers and unrelated UI operations retain their existing loading boundaries.

## Compatibility

Timing v1, Telemetry v1 and scalable-v1 response schemas, configuration signatures, IDs, units, credentials, browser-origin checks and upload limits remain unchanged. Background processing returns the existing committed receipt, not HTTP 202. Clients already consuming car invalidation IDs automatically benefit; no client update is required.

The updated scalable handoff explains the narrower invalidation behavior and retained reset fallback. Command receipts are local auxiliary SQLite records and are not exposed as car data, shared credentials or Timing results.

Local test logs and packaged probes are in the ignored `.qa/background-*` files. Source tests and the benchmark are checked-in candidates; disposable databases and builds are not repository assets.
