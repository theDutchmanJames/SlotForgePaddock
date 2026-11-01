# Telemetry API review — 1 November 2026

Scope: all uncommitted Telemetry host changes since v1.0.0, including network routing and lifecycle, Dealership password revocation, projections, schemas, generated fixtures, tests and client handoff documentation. The completed Telemetry-side contract was also read from the neighbouring project; that project's source was not modified.

## Findings addressed

1. **Client contract mismatch (P1).** The host supported SSE and snapshot fields, while Telemetry's completed contract negotiated a `/v1/telemetry/changes` long-poll endpoint, `changeToken` and per-entry browsing summaries. Core downloads worked, but the intended automatic refresh could not negotiate the documented interface. Added the advertised changes endpoint and compatible metadata; kept the existing routes, revision-only clients, snapshot pinning and optional SSE. Held waits finish on change or timeout, and are bounded to 25 seconds. Both notification types share a ten-connection cap.
2. **Date-filter boundary mismatch (P2).** The host treated `to` as inclusive; Telemetry's contract uses an exclusive end. Adjacent requested ranges could therefore repeat a boundary session. Corrected the comparison and added exact-boundary tests. Also aligned optional source filtering: track IDs may be searched across sources, but their returned identities remain source-scoped and must not be merged.
3. **Notification lifecycle gap (P2).** Closing/revoking SSE responses left cleanup to the later response-close event, and queued writes did not check `writableEnded` or `destroyed`. Cleanup now immediately clears the timer and removes the client, with late-write guards and response-error handling. The same lifecycle covers long-poll cancellations, rotation, identity replacement and shutdown. Regression tests verify no write reaches an ended response and slots are immediately reusable.

Documentation now explicitly states that driver IDs are participant-scoped, not cross-session person identities. The handoff generator updates timestamps on the addressed record instead of assuming the affected record is last. Standalone handoff documentation no longer depends on a discovery fixture outside its ZIP.

## Verification

- **360 automated tests passed**, zero failed/skipped, including 18 Telemetry tests.
- Syntax checks and `git diff --check` passed.
- Actual existing Telemetry client, imported read-only from its project: connection, three session downloads, unchanged sync with zero downloads, correction, withdrawal and removed-session reconciliation all passed against a disposable local host/cache.
- Added checks for long-poll changes and timeout, malformed queries, password/identity revocation, request cancellation, combined notification limits, ended responses and failed disk writes. Failed saves neither advance the token nor notify a waiting client.
- Existing tests cover snapshot restore/restart semantics, captured configurations, private-field exclusion, byte/count limits, multi-heat/endurance/virtual/pit laps, schemas and generated examples. Timing and Dealership regressions passed as part of the full suite.

No remaining defect was identified in this review. Validation was automated on one computer; physical two-computer Wi-Fi testing and Telemetry's adoption of the new notification capability remain separate acceptance steps. No release or production-data modification was performed.
