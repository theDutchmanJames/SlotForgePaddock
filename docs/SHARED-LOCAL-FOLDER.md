# One shared local library

Timing and Paddock open the same canonical SQLite file independently, through the same bundled storage engine. Neither application needs the other process running. The ordinary Cars/Slotcars and racing-history screens use that file. This replaces the earlier interpretation of “local sharing” as transferring cars between two authoritative databases.

The previous HTTP discovery, connection, reviewed transfers, Dealership replication and public integration contracts are retained. They are separate compatibility/network features and do not authorize or route direct local writes.

## Startup and existing collections

The first upgraded application discovers the existing Paddock collection and/or active Timing storage. Existing Paddock identity and file location are retained. Timing JSON or its selected SQLite generation is read without alteration, backed up, and adopted automatically. Original IDs become durable aliases; names and manufacturer/reference combinations do not merge physical cars automatically.

Original Timing fields and lap evidence remain in the same shared database. Historical records with sufficient evidence appear in shared racing history. Unsupported originals remain browsable without inventing timing validity, configuration, distance or record eligibility. Adoption completion is a one-time cutover, not a repeating import from abandoned files.

When only one application is used, it writes directly to the shared file. The other sees current data when it reopens. Concurrent applications refresh their normal screens from shared change notifications/cursors. SQLite serializes commits, revision checks prevent conflicting edits, and durable receipts make uncertain retries safe.

## Implementation

- Common facade and exact contract: `packages/shared-library/index.cjs` and `CONTRACT.md`.
- Paddock-owned domain engine: `src/shared-library-*.cjs`.
- Timing-owned, read-only old-storage converter: vendored `src/timing-legacy/`, including its manifest.
- Reproducible engine package: `node scripts/package-shared-library.cjs <empty destination>`.
- Ordinary startup activation: `src/shared-library-activation.json`, **enabled** after joint qualification with the matching Timing shared-folder implementation. No connection or import workflow is required.

The canonical library registration is per OS account. An existing registered database which is missing or corrupt is never silently replaced with an empty collection. A deliberate restore/reset rotates recovery identity; uncertain old commands cannot be silently resubmitted. A durable replacement receipt allows registration recovery if the owning process stops after replacing the database.

Small Timing companion edits use field overrides. They preserve the immutable original/media chunks, and commit atomically with canonical car changes. Full originals are limited to 200 MiB per preserved record and compressed into bounded chunks compatible with portable backups. Windows backup paths are checked before adoption.

## Qualification completed in this workspace

- Automatic Timing-first adoption from JSON and active SQLite, including rejection of stale JSON selection.
- Paddock-first identity preservation and separate-car preservation when both collections already exist.
- Two OS processes saving concurrently, competing edits, and reopening after the peer closes.
- Durable alias/source identity, lost-response retries, atomic car/companion conflict rollback and paginated snapshot protection.
- Backup roundtrip of original evidence and later field overrides; unchanged media assets on small edits.
- Complete worker-owned backup facade, guarded by database/recovery/revision, with exclusive publication and no overwritten destinations.
- Interrupted adoption after records commit but before receipt publication resumes without duplicate cars or sessions.
- Restore identity checks, interrupted replacement registration recovery and process death while holding the bootstrap lock.
- A 500-car catalogue remains paged; a one-field edit reads no photograph bytes.
- Native Paddock startup using a disposable pre-existing Timing profile: normal Cars/history views, original lap fallback, live external changes and edits back to the same file, without Review.
- Existing sharing, Timing, Telemetry, history and portable-backup compatibility tests: 142 passing.

These are isolated synthetic-data tests and native **source-app** checks. They are not a claim that matching installed release builds or a user's long-lived personal database have passed the complete workflow.

## Matching app builds and qualification

Use the new shared-library source packages for **both** apps. The older frozen 2.2.0 Timing activation ZIP and older installed candidates do not contain this correction. A shared-file-capable Timing version is required; the version number alone does not identify the tested source snapshot.

The simultaneous native source-app test passed: Timing's normal editor updates Paddock Cars, normal Timing race finalization appears in Paddock Performance, and Paddock's normal editor updates Timing's normal Slotcars view. Both processes use the exact same file/database identity. Viewing and routine edits create no Review. The ordinary enabled Paddock startup also passed Timing-first and Paddock-first tests without a gate override.

The common engine provides guarded whole-library restore, recovery backups, durable retry receipts and registration recovery after worker death. Canonical custom fields and service counters are shared; imported counter baselines prevent old laps being counted twice. Normalized racing statistics exclude original-only evidence; physical service counters retain original token laps without inventing measured lap performance. Unsupported original sessions remain available as explicitly labelled original evidence.

Shared custom-field definition deletion is not exposed in Timing yet. macOS/Linux and real personal databases have not been executed in this qualification. These are Windows source-app checks; no public release has been published.

An older application still writing its old private database during adoption is detected and stops cutover explicitly. It is not silently treated as a shared-file writer. Both applications need matching upgraded implementations.
