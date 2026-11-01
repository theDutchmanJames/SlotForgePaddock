# Validation — 1 November 2026

## Completed

- `npm run check`: passed.
- `npm test`: **360 passed, zero failed or skipped**, including 18 Telemetry tests and the existing Timing, Dealership, storage and manual-record tests.
- `git diff --check`: passed (normal Windows LF/CRLF notices only).
- Real Telemetry client compatibility: imported the current `SlotForge Calculator/src/paddock-client.cjs` without modifying it, connected it to a disposable local Paddock HTTP host and cache, and checked three session imports, zero downloads on an unchanged refresh, one download for a correction, withdrawal handling, and removal reconciliation. All passed.

The API tests cover authentication and Dealership password rotation; database identity and browser-origin rejection; non-GET rejection; pinned pagination and byte limits; malformed filters; captured configurations after edits; source-scoped tracks; corrections and withdrawals; restarts and equal-revision restores; removed/archived/missing cars; multiple heats and endurance stints; virtual and pit laps; event privacy, stream limits, backpressure and shutdown cleanup; and published schema/fixture agreement.

Review also covered the completed Telemetry handoff. The host now implements its long-poll changes endpoint, changeToken alias and browsing summaries, with inclusive-from/exclusive-to date boundaries. Tests cover timeout, missed-change catch-up, cancellation, combined SSE/wait limits, immediate revocation cleanup and failed persistence producing no notification. The actual client compatibility check was rerun after these changes.

## Scope and limitations

These are automated local HTTP tests, not a physical two-computer Wi-Fi acceptance test. No production database, installed profile or Telemetry source was changed by the compatibility test. No renderer/UI changes were required in Paddock for this API, and desktop UI acceptance is separate. The host API ships in v1.0.1.

Telemetry still owns its UI and adoption of the optional snapshot tokens, filters and server-sent events. The original revision-only client continues to work but can retry when unrelated database saves occur. Only already-delivered Timing sessions are exposed; manual performance entries and Timing sessions never uploaded to Paddock are not included.

## Source ownership

Telemetry's initial uncommitted patch supplied `src/telemetry-export.cjs`, `tests/telemetry-export.test.cjs`, `docs/TELEMETRY-RESULTS.md`, and edits to `src/network.cjs`, `src/timing-schema.cjs` and the generated Timing schema. Paddock reviewed and extended those files in place, preserving the original routes. Additional Paddock changes add Dealership stream revocation, this handoff/fixtures/export script, syntax checks and README links. No second competing results interface was created.
