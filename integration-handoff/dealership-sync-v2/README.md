# Dealership synchronization v2

This protocol is for trusted Paddock copies on a local network. It does not change Timing or Telemetry's public APIs. Each computer owns its own SQLite file; SQLite files are never opened over the network.

## Negotiation and authorization

Use the existing `/v1/status` identity, `permissions.club`, connection password and database ID. Then GET `/v1/club/status` with `Authorization: Bearer <Dealership password>` and `X-SlotForge-Database: <id>`. A host supporting this protocol adds `syncVersion: 2`. Older hosts continue to use the existing v1 snapshot/change protocol. The public `/v1/status` schema is unchanged.

All endpoints below require Dealership access, the matching database header and a LAN source. Existing browser Origin protection remains enforced. These are trusted full-collection copies, including private collection records; they are not public catalogue exports. The Timing capture-signing key is excluded and is always null on a copy. Device passwords are never collection records.

## Feed

GET `/v1/club/sync/changes?epoch=<epoch>&after=<sequence>`.

The response has `version: 2`, `epoch`, `latest`, and `identity: [databaseId, revision]`. On success it also has `entries`, `next`, and `more`. A response requiring replacement has `snapshotRequired: true` and `reason` (`epoch`, `expired`, or `transaction-size`). It does not contain a partial transaction.

Each entry contains:

- `sequence`: the next durable sequence, exactly one greater than the previous cursor.
- `from` and `to`: database ID/revision pairs.
- `manifestBefore` and `manifestAfter`: SHA-256 hashes of the exact UTF-8 JSON manifest, preserving member order.
- `manifestChanges`: ordered replacements (`path`, `value`) or array splices (`path`, `splice: {start, remove, items}`). Paths address the manifest, not arbitrary files or SQL.
- `changes`: record removals (`key`, `before`, `remove: true`) or field deltas (`key`, `before`, `header`, `fields`). `before` hashes the previous record envelope, or is null for an insertion. Each field has a JSON-encoded scalar path and either a JSON-encoded value in `json`, or `remove: true`.

The record header contains the ordered object shape, attachment references and the digest of the rebuilt `{value, refs}` envelope. The codec is defined by `src/sqlite-records.cjs`; fixtures demonstrate the exact wire representation. The special record `["timing","key"]` is excluded. The source manifest may still reference that record; the receiver supplies null. Receivers add `club.replica: true` locally.

The host returns at most 32 transactions and approximately 2 MiB of committed log JSON per request. A transaction exceeding that bound requires a replacement snapshot. No record or transaction is silently truncated. `more` means fetch the next batch using `next`. Data and the new cursor commit in one local SQLite transaction. Old duplicate batches do not apply again; gaps, changed baselines, invalid hashes and overlapping stale commits cannot advance the cursor.

## Notifications and recovery

GET `/v1/club/events?sync=2` opens the existing SSE channel. A message contains only the current `revision`. Changes coalesce for 25 ms; a 15-second heartbeat also carries the revision so a missed signal can be recovered quietly. Equal revisions do not fetch a collection. Clients retain one pending catch-up target, not a queue of every notification. A slow socket with more than 64 KiB queued is disconnected. The existing maximum is 10 connected copies.

Reconnect resumes from the cursor stored with the local copy. Network retries back off from 2 seconds to 30 seconds. Permission, corruption, expired-history and validation failures remain visible. A copy behind retained history enters the existing prominent out-of-date state. Replacement requires explicit confirmation; the old copy is backed up first and unsent proposals remain in the device outbox. A host behind the saved copy cannot silently rewind it.

## Snapshot and attachments

1. GET `/v1/club/sync/snapshot` returns `{version:2,id,size,digest,cursor,chunkSize:1048576}`. Cursor contains `epoch`, `after`, `revision`. The offer freezes one committed revision.
2. GET `/v1/club/sync/chunk?id=<id>&offset=<byte offset>` returns `{id,offset,size,data}`. `data` is base64 encoding of up to 1 MiB of UTF-8 snapshot metadata. Verify lengths, offsets and the complete SHA-256 digest before interpreting it.
3. Metadata contains `{manifest,rows}`: the manifest is a JSON string; rows are `[recordKey, envelopeJson]` pairs. Attachment bodies and the signing-key record are absent.
4. GET `/v1/club/sync/asset?id=<snapshot id>&hash=<SHA-256>&offset=<byte offset>` retrieves a referenced attachment in 1 MiB chunks. For a feed attachment, omit `id`. Response fields are `hash`, `offset`, `size`, `data`, `meta`. Hash the exact assembled UTF-8 stored string (including a photo data-URI prefix); do not decode and re-encode it. The client independently derives metadata and rejects bodies above 28 MiB; existing photo/document validation limits still apply.
5. Existing local attachments are reused by content hash. New bodies are verified in a temporary SQLite asset store, then imported into the copy's atomic commit. Validate the reconstructed database before committing. An interrupted or corrupt transfer leaves the previous copy and cursor intact.
6. GET `/v1/club/sync/release?id=<id>` releases an offer, including on failure. Offers expire after two minutes without a request; each successful snapshot/asset access renews that idle timeout. At most two offers are retained concurrently. Transfer responses are capped at 4 MiB; snapshot metadata is capped at 220 MiB. These are transport ceilings; the separate working-metadata guard is 200 MiB and there is no aggregate original-media cap.

Staging files are removed after transfers. Crash leftovers with this subsystem's exact temporary names are eligible for cleanup on a later start after 24 hours. The host streams snapshot metadata to a temporary file from one read transaction, without assembling its full JSON string. The receiver still assembles bounded snapshot metadata and validates the resulting domain model. Incremental catch-up decodes only changed envelopes and commits only changed bodies plus the authoritative cursor.

## Proposals and reviews

The existing `/v1/club/proposals` endpoint remains in use. New clients add `deliveryEpoch`, obtained from the negotiated host's field-review epoch. The generated proposal ID is globally unique and its digest binds `sourceId`, the operation and its exact content. Repeating the same ID/content returns the durable receipt, including after restart; conflicting content is rejected. An unknown operation from an expired epoch is rejected for renewed review. A known receipt is acknowledged even after its epoch changes.

Receipts remain with review history: maximum 5,000 total, with at most 200 pending. This is a fail-closed retention policy: the host does not evict receipts and then accidentally accept old retries as new. At capacity, new proposals are rejected explicitly. The change log separately retains at most 256 transactions/32 MiB, with another 32 MiB cap on assets retained only for replay. Deletions are retained within that log; a missing prefix requires replacement.

Independent `car.save` text fields can be selected at review. The decision stores `acceptedFields`; the remaining fields are not applied. Technical/stock, assembly, setup and other dependent commands remain inseparable and use existing transaction validation. Existing explicit incoming-car stock overrides return the fitted parts to Used spares atomically. Simulation, review conflict checks, stock checks and the final commit remain authoritative.

Errors retain existing HTTP behavior: authentication failures 401/403, database mismatch 409, invalid Dealership requests 400 with `code: CLUB_REQUEST_FAILED` and a useful `error` message. Retry transient network/5xx/429 failures; retain rejected proposals for user attention. Never interpret an unrelated successful response as a proposal acknowledgement.

## Validation boundary

Automated tests use independent local server/client instances and disposable files. They cover restart, retries, corruption, cursor atomicity, concurrent application, retention, deletion, partial approvals, stock returns, media deduplication, authorization and compatibility. A physical multi-computer LAN acceptance test remains necessary before claiming hardware/network validation. No Timing or Telemetry client changes are required for this Paddock-only protocol.

## Optional general-review baseline version 1

Current hosts add `reviewBaseline: 1` to the private `GET /v1/club/status` response alongside `syncVersion: 2`. Clients must wait for this advertisement before sending `baselineVersion: 1` on a proposal. Independent text-field proposals continue using their existing `conditions`; this extension handles general commands without field conditions. The public Timing/Telemetry APIs are unchanged.

For `baselineVersion: 1`, `base` is a lowercase SHA-256 digest built as follows, with UTF-8 and compact JSON throughout:

1. Parse the authoritative ordered manifest. Remove root entries named `club`, `revision`, and `catalogueRevision`. Remove the `key` entry in the `timing` object. Keep all other member/array ordering. Feed its JSON string to SHA-256.
2. Select every record except records rooted at `club`, the two root revision records, and `["timing","key"]`. Sort record keys by UTF-8 byte order (SQLite BINARY order).
3. For each record feed `JSON.stringify([recordKey, envelopeDigest])` to the same hasher, with no separator. `envelopeDigest` is SHA-256 of the exact canonical `{value,refs}` JSON envelope reconstructed by the codec. Stored record headers already contain this verified digest. Attachment content hashes are included in `refs`; original bytes are never needed here.
4. Finalize the hash as lowercase hexadecimal.

The `review-baseline.json` fixture gives an input snapshot and expected digest. Host and replica compute the same value despite private signing keys, receipt/review bookkeeping and different local replica flags. Other data changes invalidate it. Approval still simulates the current operation, validates stock/dependencies and checks a fresh token; this hash never grants permission or bypasses validation.

Absent `baselineVersion`, hosts preserve the legacy logical-JSON checksum within its 220 MiB bound. A legacy pending proposal on a larger collection is marked conflicted and requires an explicit current comparison/override. Its receipt and identity remain intact. New clients connected to older hosts retain the bounded legacy behavior and show a clear compatibility error if that checksum would exceed the bound. Unknown baseline versions are rejected. No second password or permission is introduced.
