# Portable backups · format 2

Paddock's default complete backup is a **`.sfpbackup` file**. It contains a versioned logical collection and separate original attachments in a SQLite container. It is independent of the application's live SQLite tables and can be moved between operating systems. Native restore acceptance on Linux and macOS remains a release qualification task; Windows has been exercised locally.

Use **Import & Export → Create backup**. Progress appears at the bottom right, with Cancel during export, verification and staging. **Restore a backup** validates a separate staging database before asking to replace the current collection. Before replacement, Paddock saves a verified recovery backup in `recovery-backups` beside the live database. **Settings → Database → Export previous revision** writes a complete backup of the preceding committed revision, including its original attachments.

## Automatic backups

**Settings → Database → Automatic backups** makes the same complete `.sfpbackup` on a schedule. It is on by default: once a week, keeping the newest 5, in the **Automatic backups** folder inside Paddock's own profile folder. That standard folder is deliberately not in Documents, which OneDrive or iCloud often upload, because backups contain private collection details. Choose **Change schedule…** for daily, weekly or monthly backups and how many to keep (1–50), and **Choose folder…** for another folder, ideally on a second drive or USB disk. **Back up now** makes one immediately; **Open folder** shows the files.

- An automatic backup only starts while you are not using Paddock: its window is in the background or minimised, or there has been no keyboard or mouse input for two minutes. When you start working in Paddock again, an automatic backup in progress stops at once and runs again later. A backup started with **Back up now** finishes like **Create backup**.
- Files are named `SlotForge-Paddock-auto-<collection>-<computer>-<date>-<time>.sfpbackup`. When there are more than you keep, only the oldest files with that pattern **for this collection on this computer** are removed, only after a newer backup has been verified and saved, and never a file dated after the new backup (in case the clock was wrong). Your own backups, other computers' backups in a shared folder and other files are never touched. After a reset or restore, the new collection gets its own series; old files stay until you remove them.
- A chosen folder that is missing, such as an unplugged USB drive, is not created. A folder that does not respond within 15 seconds, such as a sleeping network drive, counts as missing. Settings shows the problem and Paddock tries again an hour later. The standard folder is created when needed.
- Paddock leaves free space on the drive after a backup: 5% of the drive, at least 1 GB and at most 20 GB. If there is not enough, the backup is skipped and Settings says so.
- Temporary files from a backup that was cut off by a crash or power cut are removed from the folder once they are more than a day old.
- The settings belong to this computer, not to the collection, so they are not part of backups, Dealership copies or Timing. A Dealership copy is not backed up automatically; the dealership computer backs up the official collection.

The save dialog also offers **Legacy JSON backup**. Existing version 1 JSON backups still restore through validation and migration. Old Paddock versions cannot read `.sfpbackup`; select JSON when an older version requires it, subject to that version's schema and size support. Selected-car packages, Timing exports and manufacturer catalogues retain their existing versioned JSON formats.

## Contents and privacy

Complete backups contain all logical collection records: cars and private ownership fields, stock, assemblies, installations, setups, drafts, workshop jobs, supplies, maintenance, manual performance, received Timing sessions and their correction/withdrawal histories, captured configurations, Timing signing key, private documents, research, custom fields, settings, saved views and pending/reviewed Dealership proposals. Original stored photo/document strings are preserved exactly and deduplicated by content hash. No resizing or recompression takes place.

These files are **not encrypted**. Hashes detect corruption; they do not authenticate whoever supplied a backup. Treat complete backups as private. Public car packages remain the appropriate sharing format.

Device settings, Dealership passwords, pairing configuration and the device's outgoing proposal queue live outside the collection and are not copied into this format. Keep the profile when moving a dealership computer. Discarding unsent proposals still writes a separate, bounded proposal JSON recovery file. A portable collection backup alone does not transfer host authorization to another computer.

## Container contract

SQLite `application_id` is `0x53464250`; `user_version` is `2`. Exactly three non-internal tables are accepted, without application views, triggers or extra indexes:

```sql
CREATE TABLE metadata(name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE records(key TEXT PRIMARY KEY, json TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
CREATE TABLE assets(hash TEXT PRIMARY KEY, value BLOB NOT NULL) STRICT;
```

`metadata` has exactly these names:

| Name | Stored text |
| --- | --- |
| `created` | Export time, ISO 8601 UTC |
| `identity` | JSON `[databaseId, revision]` |
| `manifest` | Ordered typed tree described below |
| `recordCount` | Decimal number of record rows |
| `assetCount` | Decimal number of distinct attachment rows |
| `digest` | Lowercase SHA-256 aggregate digest |

A manifest node has one property: `{"record":"<record-key>"}`, `{"array":[nodes...]}`, or `{"object":[["property",node],...]}`. The ordered object pairs preserve JSON property order used by existing replication and Timing digests. Each record must be referenced exactly once. A record key is a JSON array of path strings: for example `["cars","id:car-a"]`. ID-bearing array entries use `id:<id>`; Timing sessions use `session:<JSON source/session pair>`; other array entries use `index:<offset>`. Imported record identities must agree with the reconstructed collection paths.

Each `records.json` is the exact JSON text of:

```json
{"value":{"id":"car-a","picture":null},"refs":[{"path":["picture"],"hash":"<64 lowercase hexadecimal characters>"}]}
```

`value` is the complete logical record. `refs` replaces media placeholders with attachment values. Reference paths contain own property names or non-negative array indexes; duplicate paths, unsafe traversal, missing placeholders, missing blobs and unreferenced blobs are rejected. Records without media have an empty `refs` array. `digest` is SHA-256 of the UTF-8 bytes of `json`.

`assets.value` contains the exact UTF-8 bytes of the original stored string: a photo data URI or a document base64 string. `hash` is SHA-256 of those bytes. This deliberately avoids decoding and re-encoding originals during backup. Image/document metadata is derived again from verified bytes during restore, rather than trusted from the file.

The aggregate SHA-256 receives, in order, UTF-8 encodings of these JavaScript `JSON.stringify` results, with no separators between updates:

1. `[2, created, identityText, manifestText]` — identity and manifest are their stored strings.
2. `[key, recordDigest]` for each record in SQLite binary `ORDER BY key` order.
3. `[assetHash, byteLength]` for each attachment in binary `ORDER BY hash` order.

Changing property ordering changes the digest. A reader verifies the counts, all record and attachment digests, aggregate digest, SQLite integrity, schema, collection identity, domain references, stock invariants and stored Timing signature rules before activation.

## Bounds and lifecycle

- Manifest and individual record JSON: 32 MiB each. Record keys: 2,048 characters. Individual attachment: 28 MiB of encoded bytes. Existing domain limits remain stricter where applicable: photo data URIs 12 MiB, document decoded content 20 MiB, Timing submissions 8 MiB, and **working metadata 200 MiB (original media excluded)**.
- Export copies attachments inside SQLite and verifies them in 1 MiB chunks. Staging derives metadata one attachment at a time. Original image memory does not accumulate with archive size; manifest sets and non-media collection metadata still scale with record count.
- A worker performs portable export, verification and staging. The source read transaction fixes one revision. The Store reserves its write queue during export: asynchronous saves wait; synchronous commands report busy. This avoids main-thread SQLite lock waits while a long backup reads the same file. Backup completion/cancellation releases the queue.
- Temporary output is created beside the selected destination. Only after a complete verification is it renamed over the destination. A crash before publication leaves any existing destination intact; an unpublished `.slotforge-backup-<UUID>.tmp` can remain beside it. Such files are never offered as completed backups. They may be removed after Paddock is closed.
- Restore checks free space conservatively before staging and again before recovery/activation. These checks cannot reserve disk space against other programs; real write failures still roll back. The staging database, recovery copy, live database and SQLite journal can coexist, so allow several times the archive size in free space.
- Restore rechecks the selected collection and revision after dialogs and immediately before committing. Hosting stops before activation. One SQLite transaction publishes records, original media references, indexes, identity, the full previous revision and a fresh synchronization epoch. No live file swap or half-restored collection is exposed. Failed writes leave the old committed data and cursor intact.
- Cancellation is disabled during the final atomic commit. Normal cancellation/failure removes staging files. On the next start, the single-instance owner reclaims only UUID-named files in its reserved `backup-staging` directory. Recovery backups are retained.
- Dealership enable, copy replacement and leaving save portable recovery backups under `club-backups`. Desktop and asynchronous synchronization paths use the worker. Synchronous programmatic helpers retain their synchronous behavior for compatibility. Device outboxes remain separate.

The `validate:false` staging option exists only for internal transport benchmarks. The desktop never supplies it. A multi-gigabyte transport test is **not** evidence that an active collection of that size is supported yet.

## Verification

`node --test tests/portable-backup.test.cjs` exercises complete round trips, historical revisions, privacy, pending proposals, result corrections/withdrawals, cancellation, corrupted/truncated/oversized files, forged record identities, source changes, stale approvals, rollback, SQLite disk-full failure and process interruption. Existing network, replication, JSON compatibility and desktop suites also run.

`node scripts/benchmark-backup.cjs 32` and `node scripts/benchmark-backup.cjs 272` create disposable 256 MiB and 2,176 MiB attachment archives under `.qa`, round-trip their storage representation in child processes, verify exact record/attachment hashes, measure peak RSS, report whether the resulting collection opens, and remove the generated large databases. These are transport tests; `npm run qualify:large` additionally runs normal active domain operations and validated staging above the old cap. They need several GiB of free disk space. Results remain as small `.qa/phase7-backup-benchmark-*.json` reports.
