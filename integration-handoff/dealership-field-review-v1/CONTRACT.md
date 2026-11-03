# Dealership field review extension 1

This additive extension is for Paddock peers. Timing and Telemetry do not submit catalogue edits and do not need to implement it. Existing passwords, permissions, `/v1/club/proposals`, review approval and snapshot endpoints remain unchanged.

## Negotiation

An authenticated `GET /v1/status` response may advertise:

```json
{
  "capabilities": { "club": 1, "clubFieldReview": 1 },
  "clubFieldReview": { "version": 1, "epoch": "28a756bd-cacb-44d6-bcef-2a5bbed2ade0" }
}
```

Use this extension only when both declarations are present. An older host receives the existing proposal with its whole-collection `base` digest. An older proposal on a newer host retains that comparison behaviour. This extension is not the planned durable replication feed.

## Supported operation

Only `car.save` for an existing car, with a nonempty `payload.data` containing exclusively top-level textual fields from Paddock's `TEXT_FIELDS`, qualifies. Technical components, images, arrays, custom values and real-car-history objects continue using the existing dependency checks and whole-state conflict comparison. Compact unchanged values before constructing the proposal.

The existing proposal adds `conditions`:

```json
{
  "version": 1,
  "epoch": "28a756bd-cacb-44d6-bcef-2a5bbed2ade0",
  "revision": 42,
  "carId": "example-car",
  "fields": [
    { "field": "livery", "present": true, "value": "Original" },
    { "field": "team", "present": false }
  ]
}
```

`revision` is the database revision of the editor's local starting snapshot, not the car revision. `epoch` comes from the connected host. Each proposed key appears exactly once, in `Object.keys(payload.data)` order. A present value is a string of at most 20,000 UTF-16 code units; an absent field has no `value` property. An empty string is present, not absent. Payload/domain validation still enforces each field's actual restrictions.

`base` is the lowercase SHA-256 of the UTF-8 `JSON.stringify(conditions)` bytes, preserving the submitted property order. IDs and other proposal fields retain their existing rules; the complete proposal remains limited to 16 MiB. Conditions must cover exactly the proposed fields. Malformed conditions are rejected, not silently downgraded.

## Approval and conflicts

The host stores receipt identity/content and conditions durably before acknowledging. Review compares current presence/values and persistent last-change revisions for the proposed fields. Car creation/deletion and archived status are dependencies too. A change from A to B and back to A still conflicts, including after restart. Unrelated field changes do not invalidate the comparison token.

A mismatched epoch, future starting revision, expired version history or missing car is a conflict. Deleted-field/record version markers are retained for 10,000 database revisions; older starting revisions require explicit conflict review. Existing-field versions remain stored. Migration establishes a conservative floor at its starting database revision. Restoring/replacing an identity or moving the database revision backwards establishes a new epoch.

The existing review UI still requires approval. Conflicts require reopening/comparing and an explicit override; missing cars and domain-invalid operations cannot be overridden into another car. Approval prepares against the latest state and commits the car, history, revision, review outcome, field versions and internal change journal atomically. The comparison token includes current relevant values and versions, so a same-field edit after preview invalidates the token.

## Verification and limits

`tests/field-review.test.cjs` exercises negotiation over a local authenticated server, unrelated edits, ABA/restart, missing or expired conditions, legacy proposals, targeted receipt/rejection/approval and injected rollback. These are local automated tests, not a two-computer LAN qualification. Receipts and the existing shared snapshots remain bounded by the original collection/review limits.

Raw SQLite change logs contain private information and are not a public API. They must not be exposed as an unfiltered network endpoint.
