# Review: all changes since v1.1.0

Scope: all uncommitted changes after the preceding research/pace review and
v1.1.0 release (`3f6c439`). This includes Dealership review identities,
individual technical-field approval, fitted-stock returns and assembly handling,
livery presentation, sparse history proposals, JSON/photo encoding, asynchronous
proposal persistence, network wait handling, shutdown and the benchmark helper.

## Findings fixed

1. **Timing capture could fail during a proposal save (P2).** The first Timing
   car-profile request creates a persistent signing key. That route still tried
   to write synchronously while a proposal was being saved asynchronously. It
   now waits safely, then rechecks database identity and browse authorization
   before reading or creating the configuration capture.
2. **Idle-wait race between writers (P2).** A separate `await whenIdle()` allowed
   another writer to start before a resumed operation used the store, producing
   an avoidable busy error. `withIdle()` executes the operation in the same turn
   that observes the idle store. Dealership commands, incoming proposals,
   Timing results, public submissions and profile captures use this boundary.
   Queued local operations also reject a changed collection context.
3. **Repeated full-size photos in Review lists (P2).** Each pending/history card
   embedded the original photograph into its HTML, including collapsed history.
   Multiple reviews of one car multiplied the photo data parsed on each render.
   Lists now use car icons and names; the individual comparison retains its
   photograph. A regression verifies list markup stays small with a 1 MiB photo.
4. **Some review cards missed their car/job identity (P2).** Starting a job from
   a setup did not resolve the setup's car, and checklist operations could use
   the checklist-step ID instead of the job ID. Both now resolve through the
   correct stable identity. Part-removal cards also show the removed part name.
5. **Misleading comparison/removal text (P3).** A blank original car reference
   appeared as a missing car. It now remains “Not recorded.” Returning the final
   assembly component now reports that the assembly was dismantled instead of
   claiming that other components remain fitted.
6. **Benchmark failure cleanup (P3).** The new benchmark assumed `.qa` existed,
   accepted unbounded environment sizes, and could leave its heartbeat running
   on an error. It now creates its output parent, validates sizes before
   allocation, and closes timers/resources and removes only its own verified
   temporary directory on failure or success.

## Verification

- **418 automated tests passed**, zero failed/skipped; syntax checks passed.
- Tests cover concurrent writes and duplicate deliveries, failed writes followed
  by successful queued writes, partial disk writes, flush/backup/rename failures,
  atomic publication, exact JSON bytes, restart persistence, permission revocation
  and database replacement while a Timing lookup waits.
- Stock tests cover independent/individual stock, partial and complete assembly
  release, multiple overrides in one approval, rejected and repeated approvals,
  stale comparisons, failed persistence, quantity conservation and replication.
- Sparse-history approvals preserve unrelated fields and photos; changing a
  researched value without new evidence clears its stale provenance.
- Hidden Electron UI checks passed using a disposable profile: history editing
  through the Save button, named review cards, selective technical approval,
  explicit stock return, persisted inventory and all five livery classifications.
  Dark/light screenshots were inspected; no captured renderer errors.
- A separate hidden Electron check requested normal app shutdown during an
  intentionally delayed proposal save. Shutdown waited for persistence; reopening
  the saved file found exactly one pending proposal and an unchanged approved car.
- The 112 MiB synthetic benchmark measured **473 ms**, a 950-byte proposal and
  a maximum main-process heartbeat delay of 100 ms. The original baseline was
  2,202 ms. Results vary by machine and storage.

## Remaining limits

This is not a physical multi-computer Wi-Fi acceptance test. Main-thread
integrity hashing still causes short pauses. The JSON database still rewrites
the full file; asynchronous persistence currently covers proposal receipts.
Approval, standalone edits and replica replacement retain their existing save
paths. Native Linux/macOS builds were not run in this review.

No personal collection was modified. No commit, push or release was performed.
