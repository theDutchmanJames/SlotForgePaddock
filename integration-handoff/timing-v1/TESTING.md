# Validation and remaining acceptance work

Validated on Windows against updated Paddock source on 31 October 2026.

| Check | Result |
| --- | --- |
| `npm run check` | Passed syntax checks |
| `npm test` | **246 passed, 0 failed** |
| Timing integration suite (included above) | **23 passed, 0 failed** |
| Full isolated Electron workflow suite | **151 checks passed; no renderer errors** |
| Visual inspection | Imported-session view and session details checked; dark 1440px and light 960px layouts |

## Covered cases

- Actual local HTTP server/client requests: authentication, separate browse/car-submission/Timing permissions, revocation, Origin rejection, actual dynamic port and capability response.
- Permission revocation and database replacement while a body is still uploading; wrong/missing database identity; missing cars; archived cars with explicit warnings.
- Malformed JSON, wrong media type/encoding, unsupported version, invalid numeric types/units/date formats, unknown fields, array/numeric bounds and oversized fixed-length/chunked uploads.
- Identical/concurrent retries write once; object-key reordering does not conflict; changed same-revision payload conflicts; older revision is stale.
- Complete correction, withdrawal, withdrawal-before-original, explicit reinstatement, removal of a previous car's contribution, source-scoped sessions/tracks and receipt lookup.
- Actual server stop/start with a reopened on-disk store; capture-key persistence; retry after restart; durable tombstones; backup restore; tampered backup rejection; storage failure leaves no partial mutation and a retry can subsequently succeed.
- Renamed cars retain identity/configuration digest; technical changes yield a different digest; pre-race snapshots remain accepted and unchanged after the car is modified. Tampered/cross-car configurations are rejected.
- Multiple cars/heats, endurance drivers/stints, invalid/pit laps, non-record laps, virtual/unlinked entries, unknown distance, independent adjusted standings, optional computed-summary cross-check.
- Existing sharing, car-submission review, manual records, inventory, jobs and history remain independent. Public profile/export privacy checks pass.
- Published schema equals the runtime definition; all example requests are accepted by the receiver with the demo database; responses match their documented schemas.
- Desktop permission controls, HTTP-delivered sessions beside manual records, correct Timing-specific notification, driver/configuration details, correction/withdrawal display and responsive themed layout.

## Reproduce

From the Paddock repository:

```sh
npm run check
npm test
node --test tests/timing-integration.test.cjs
node scripts/export-timing-handoff.cjs
node scripts/timing-demo-host.cjs
```

The last command starts the artificial in-memory host, prints its address/database ID/temporary Timing code, and stays running until Ctrl+C. It does not open the user's app data. Use the fixtures against that host with the headers described in CONTRACT.md. Run schema regeneration **before** tests if the definition is deliberately changed; the fixture/schema consistency test detects stale generated files.

Desktop checks are part of `tests/smoke.cjs` and `tests/timing-integration-smoke.cjs`, launched by Electron with `--smoke`. The completed run used `.qa/timing-full-profile`, a dedicated disposable profile, and wrote `.qa/smoke-result.json`. Normal user data and `.qa/test-collection` were not used. The app's existing smoke harness resets its own test store; never direct it at a real collection.

## Not yet validated

- **No claim of a completed Timing-to-Paddock product integration:** the other project still needs its client, persistent cache/outbox, profile capture and race-result serializer. These tests use an automated local client and artificial fixtures.
- **No physical two-computer Wi-Fi acceptance test.** Router isolation, firewall rules, VPNs, device sleep and reconnect discovery need testing with actual devices. Existing automated discovery tests are not a substitute.
- Native macOS/Linux runtime and installer testing remain outstanding.
- Sudden power loss was not induced. Atomic save/reopen behavior and injected storage failure are tested; backup rollback semantics are documented separately.
- Very large sustained race archives were not load-tested. The existing whole-document JSON store remains bounded by 200 MiB, with an 8 MiB session limit and no automatic tombstone purging. This implementation is for reviewed session batches, not live telemetry streaming.
- The shipped v0.16.3 executable is unchanged. Run/build the updated source to use this API. Source saves migrate to database schema 9; older binaries cannot read schema-9 saves.

## Suggested joint acceptance run

Connect the actual Timing client to an isolated Paddock collection; cache two cars; capture their configurations; finish a reviewed multi-heat/endurance race offline; alter a car in Paddock; reconnect and send the queued session twice. Confirm one session with the original captured configuration, correct valid/record-eligible laps, and no virtual mileage. Correct it, withdraw it, restart both apps, and replay an old queue item. Confirm no resurrected result and no doubled distance or wins. Repeat across two physical computers and each intended operating system before publishing a release with integration claims.
