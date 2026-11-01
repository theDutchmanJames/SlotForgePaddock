# SlotForge Paddock → Telemetry handoff

Paddock owns this host implementation. Telemetry owns its connection UI, offline cache and analysis. **Use this contract for further client work. Do not run the earlier Telemetry `install-host.cjs` over this implementation**: it would replace the expanded API with the original minimal patch.

## What is ready

- The original `GET /v1/telemetry/results` and individual-session endpoints, including `revision=R` downloads, remain compatible.
- Additive metadata supports browsing by car, source-scoped track and date.
- Optional `snapshot=S` pins a results snapshot across unrelated database saves and detects restored backups even when their database revision matches.
- `GET /v1/telemetry/changes?since=…&wait=25` implements Telemetry's long-poll notification contract, using the index's `changeToken`. Active entries include the expected browsing `summary`.
- `GET /v1/telemetry/status` also provides a small content-change check.
- `GET /v1/telemetry/events` provides an authenticated notification stream. It does not download laps or replicate private database contents.
- Corrections replace a session; withdrawals remain visible; a full successful index refresh also detects removed sessions after a restore.
- Existing Timing uploads, manual performance records, collection sharing and Dealership review remain independent.

Use the existing **Dealership address and user-defined password**. There is no new permission toggle or password. Legacy hosts continue accepting their Timing credential. The analysis endpoints themselves only read; the shared Dealership credential retains its other existing permissions.

## Client implementation checklist

1. Discover a host or enter its LAN address including the actual port. Fetch `/v1/status`, verify `capabilities.telemetry.version === 1` and `permissions.timingResults === true`, and remember its database ID.
2. Send the password in `Authorization: Bearer …` and the paired ID in `X-SlotForge-Database` on every Telemetry request. Connect from Electron's main process; browser-origin requests are rejected.
3. Use the advertised long-poll changes endpoint, re-arming from the token of the completed import. Alternatively, open the optional SSE stream before synchronising. Coalesce notifications while a download is running, and repeat the change check afterwards.
4. Read the **unfiltered** result index. Keep its `snapshot`; pass it on every continuation page and detail download. Follow `nextOffset` exactly. The database revision may change while the snapshot stays unchanged.
5. Key cached sessions by **database ID + Timing source ID + session ID**. Compare `resultHash` to download only new or changed entries. It includes payload hash and receipt metadata. Keep `contentHash` for verifying the canonical Timing payload, and retain session revision/state.
6. Check `/v1/telemetry/status` again before committing. If its snapshot differs, discard the staged refresh and retry with bounded backoff. Commit the complete cache update atomically; leave the last good offline cache intact on any failure.
7. Exclude withdrawn entries from analysis. Remove cached entries absent from a completed unfiltered index. Accept restored lower revisions when returned by the verified host; do not use a greater-than comparison to decide whether data changed.
8. Keep downloaded results available offline. On reconnect, discover the current port if necessary, confirm database identity, and reconcile the index. Notification events are hints, not a replayable change log.

The existing revision-only Telemetry client remains supported. Snapshot-aware clients must compare **snapshot**, not insist that all `databaseRevision` values match. New response fields are additive; clients should tolerate them.

## Deliverables

- [Exact API contract](CONTRACT.md)
- [Standalone JSON Schema](telemetry-v1.schema.json), including inherited Timing payload/receipt definitions
- [Example index](fixtures/index.json), [host capabilities](fixtures/host-status.json), [small change check](fixtures/change-status.json) and [event](fixtures/change-event.json)
- Complete results for [normal racing](fixtures/normal-result.json), [multiple heats](fixtures/multi-heat-result.json), [endurance](fixtures/endurance-result.json), [correction](fixtures/correction-result.json) and [withdrawal](fixtures/withdrawal-result.json), each with a matching index
- [Car-filtered index](fixtures/filtered-car-b.json) and example error bodies
- [Long-poll changed response](fixtures/changes.json) and [timeout/unchanged response](fixtures/unchanged.json)
- [Validation results and implementation ownership](VALIDATION.md)

Fixtures are artificial. Generate them with `node scripts/export-telemetry-handoff.cjs`; run `node --test tests/telemetry-export.test.cjs` for local HTTP tests. The generated schema is checked against the executable definitions. The host API is included in Paddock v1.0.1. Update previously installed v1.0.0 binaries before connecting. There is no Telemetry client implementation in this project.
