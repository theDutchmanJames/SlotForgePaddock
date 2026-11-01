# Dealership and responsiveness review — 1 November 2026

Scope: changes after the previous collection-planning review (`0a5ebb1`),
through v0.19.0 and the unpublished Connections and responsiveness changes.
Inspection covered workshop/shopping UI changes, native release automation,
Dealership proposals and replication, catalogue revisions, Timing contract
compatibility, persistence, renderer refreshes and documentation. Fixes were
initially completed locally and are now included in v0.19.1. The database schema
is unchanged.

## Findings fixed

| Area | Finding and correction |
| --- | --- |
| Review propagation | Approving a package that was already imported changed the proposal status without advancing the database revision. Connected copies could keep showing it as pending. Every approval now advances the revision, while duplicate imports still create only one inbox item. |
| Durable proposal queue | Enqueueing, acknowledging or discarding proposals changed the in-memory queue before saving it. A disk failure could leave memory and disk disagreeing. These operations now publish the new queue only after the device file has been saved. Recovery copies and duplicate-safe retries are preserved. |
| Receipt validation | Any successful JSON response could clear a queued proposal. Delivery now requires a matching proposal ID and recognised review status before removing it. |
| Interrupted first connection | Pairing was saved before the first snapshot had downloaded and passed validation. An interrupted download could leave an unusable saved pairing. Initial downloads are now verified before pairing is committed. |
| Disconnect recovery | Failed settings saves or saved-copy cleanup could leave the app partly disconnected, or prevent joining another dealership. Failed pairing writes preserve the current state; a disconnected leftover file cannot be opened as an active copy and does not block a fresh connection. Cleanup errors are reported, and a recovery backup is retained. |
| Quiet reconnect | A successful reconnect at the same revision did not clear the old error or notify the UI. Connected status is now published even when no collection data changed. |
| Shared custom fields | Background reads updated records but omitted the accompanying field metadata. Newly shared fields now become available in the column picker and reusable-choice metadata. |
| Collection switching | A background reply could apply another collection's data before the explicit switch had updated the UI's storage context. Background refreshes now require matching database and storage identities, as well as a non-stale revision. |
| Startup notifications | An update arriving during the initial database read could remain pending indefinitely. It is now scheduled after initialisation completes. |

The review also removed a duplicate Connections CSS declaration. The earlier
removal of redundant validation and cloning was checked against snapshot
isolation, Unicode limits, rollback and atomic persistence tests. Existing
permissions, signature-key redaction, reviewed conflicts, stock validation and
manual performance records remain intact.

Regression cases are in `tests/club.test.cjs`,
`tests/database-performance.test.cjs` and `tests/connection-review-smoke.cjs`.
The desktop cases run as part of the normal isolated smoke suite.

## Validation

- **326 automated tests passed**, with no failures or skipped tests.
- **187 isolated Electron workflow checks passed**, with no captured renderer
  errors. The 13 affected Dealership/refresh workflows were rerun after the final
  status-notification and cleanup-message adjustments.
- Application syntax checks and `git diff --check` passed.
- The synthetic 27 MiB benchmark still completes with the responsiveness changes:
  workshop save 155 ms, proposal 531 ms, approval 432 ms in the final run.
  These are local single-run measurements, not network guarantees.

## Cross-project findings for Timing

The current Timing checkout was tested read-only with `PADDOCK_SOURCE` pointing
at this reviewed Paddock source. Its suite contained 77 tests: 75 passed and two
failed in `tests/paddock-audit.test.js`:

- **failed archive persistence restores the linked car before a later successful
  save**: the linked car remained marked archived after the simulated disk failure.
- **ordinary errors mentioning archived files do not mark a car unavailable**:
  refresh did not reject the simulated ordinary read error.

Both cases replace the Timing client's profile method locally; neither calls the
Paddock host. They should be investigated in the separate Timing task. No Timing
source was modified by this review. The actual Paddock host/client cases passed.

## Limits

Tests use disposable data and profiles, not the user's collection. Network
checks run over real HTTP on one Windows computer; they do not constitute a new
physical Wi-Fi or macOS/Linux acceptance test. Existing native build workflow
configuration and builder checks were reviewed, but no release builds were
published. Large initial photo transfers and synchronous durable writes can
still cause delays; this review does not introduce a background database worker.
