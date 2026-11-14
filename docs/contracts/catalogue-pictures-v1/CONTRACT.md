# Catalogue pictures v1 — Phase 1 contract

The v1 formats were frozen on 13 November 2026. **Phase 5 picture application, Dealership review and recovery are now implemented.** Phases 3–4 provide [request export, private journals, safe downloads and local previews](../../CATALOGUE-PICTURE-REQUESTS.md). Response import validates the entire file before automatically downloading eligible previews; selection and application remain separate explicit actions. Phase 2 implements [manual assembly photographs](../../ASSEMBLY-PHOTOGRAPHS.md) using these resource budgets and the existing command/receipt infrastructure. The schemas and pure validators are unchanged. No public Timing/Telemetry endpoint or capability has changed.

Source: `src/catalogue-pictures-contract.cjs`. Published machine definitions: [schema.json](schema.json), [limits.json](limits.json). External-AI instructions: [AI-INSTRUCTIONS.txt](AI-INSTRUCTIONS.txt). Synthetic examples: `tests/fixtures/contracts/catalogue-pictures-v1`. Export deterministically with `node scripts/export-catalogue-pictures-contract.cjs`.

## User-facing defaults

The two steps are **Standard Catalogue — add product information**, then **Illustrated Catalogue — add pictures to existing entries**. Keep the existing Standard Catalogue format and behavior. Existing manually entered products can use Step 2 directly.

Choose one manufacturer, parts and/or workshop supplies (both enabled), missing pictures only (enabled), category/search filters and explicit selected rows. Owned and zero-stock entries are eligible. Export at most 100 rows per file, with a new request ID per file. Do not create new parts from an image response.

Importing completed JSON validates the entire response before automatically fetching eligible image URLs through the bounded downloader. Invalid files never fetch URLs. Existing previews, missing links, changed targets and rows with save attempts are skipped. Only rows returned in this file enter the batch. The user can stop downloads, retry failed rows, see current/proposed pictures and sources, select rows, then confirm application. Combined imports validate all selected files atomically before fetching, and keep the original per-file request/item identities. Their private journal stores ordered membership, remaining download work and the explicit stop state. Opening a saved batch resumes waiting downloads unless stopped; failed URLs require an explicit retry. A confirmed import or reconciled approval can resume queued downloads but never selects or applies newly ready pictures. Existing-photo replacements remain unchecked on download and excluded from bulk missing-photo selection. The explicit **Select all ready pictures** action selects all ready previews in the request, across pages and filters, including replacements and rows without references or with AI notes. Individual checkboxes allow exceptions. Selection never applies a picture. **Select all ready pictures** selects all ready rows; the fixed bottom-right **Finish import** button respects the existing selection. **Confirm import** stays in the same footer and shows the total and replacement count. Completed requests with no selected pictures offer **Done** without a further write. If downloads were waiting, the window remains open for a fresh selection and confirmation of those pictures. Otherwise the window closes only after every chosen row has a confirmed applied/unchanged or pending-review outcome, with imported and submitted-for-review messaging kept distinct. Failed, uncertain or stopped batches stay open for recovery. Loading an image proves neither identity nor accuracy.

Assembly photographs are optional and manual. Creation and existing-assembly controls support choose/replace/remove; installed assemblies do not need dismantling. Changing a photograph does not change stock, installation or configuration. Dismantling retains the photograph on the historical assembly record.

## Files and strict interpretation

The schema's default root is a returned `response`. `$defs.request` is the blank exported file; `$defs.journal` is private trusted mapping; `$defs.intent` and `$defs.receipt` describe future internal picture operations, **not newly available IPC/HTTP endpoints**.

The only response fields the AI may fill are each row's `imageUrl`, `imagePageUrl`, and `notes`. It may omit `instructions`, reorder rows or omit unreturned rows. All header values and row product context must match the stored request exactly. An empty response list means nothing was returned. It is not deletion or an instruction to clear pictures. Unknown rows, duplicate row IDs, changed product fields and unknown schema properties fail validation before downloading.

Require valid UTF-8 JSON without duplicate object keys, finite numbers, supported version and no trailing commentary. Limit actual input to 2 MiB before parsing, regardless of Content-Length. A response is not authority for record IDs, stock, baseline hashes or recovery generations. Lost/unknown local request journals fail with `REQUEST_NOT_FOUND`; create a fresh request, never infer targets by product name/reference.

Use current public product fields (`name`, `maker` mapped to `manufacturer`, reference, category, type) for context; no quantities, personal notes, prices, location, ownership or photographs. An existing imported product URL is included only when it still identifies that product; omit unsuitable legacy URLs. Manufacturer grouping uses trimmed, NFKC-normalized, case-insensitive names, but returned text must preserve the original exact context.

Each selected record gets its own opaque item ID. Identical SKUs across stock lots or parts/supplies do not merge their identity. Download bytes may be cached once; approvals remain separate.

`productHash` is SHA-256 of canonical JSON with sorted object keys for `{kind,name,manufacturer,reference,category,partType}`. It intentionally excludes item ID, source-page URL and stock fields. The current projection must use the same rules; never hash a whole record containing quantities/private fields instead. Authoritative target identity is `(kind, recordId)` from the journal, not this fingerprint.

## Snapshot and replacement semantics

Read active database ID, recovery ID, target, field revisions and revision floor consistently together. A request's recovery ID is the database change epoch; it is not a connection password or installation identity. An ordinary concurrent save may advance the global revision without invalidating the target.

Baseline fields are `{revision, productHash, pictureHash}`. The current contract projection includes `revision`, `fieldFloor` and `pictureVersion`. Derive pictureVersion from the maximum of the record wildcard version and the versions for picture plus picture-provenance fields. The existing SQLite writer already stamps extracted asset-reference changes; use that evidence, not `updated` timestamps. Picture add/remove/replace and provenance edits must all participate. If field history has expired or current revision predates the baseline, require a fresh preview even when hashes match.

`compareTarget` reports READY only when target identity, recovery generation, relevant product context, picture hash and field versions still match. Quantity/location changes alone do not block it. Deleted targets are not recreated. A part belonging to an assembly uses a dedicated image-only command instead of the full stock editor.

For parts/supplies a productHash is required. For assemblies it is null; they have no AI product context. A manual part/supply photo still gets a product baseline so a changed reference cannot silently acquire a stale photograph.

Set intents contain an approved assetHash, explicit replaceExisting flag and optional provenance. A nonempty current baseline requires replacement consent. Remove intents contain neither asset nor provenance and require the normal removal confirmation. Assembly intents cannot contain AI provenance. A same-image row is skipped/recorded unchanged rather than silently updating its provenance.

Never send raw source links to an editor command and have it download during the transaction. After successful decoding, put original bytes into owned staging and pass a verified local asset reference. Commit resolves and rechecks those bytes. A client cannot attach an arbitrary guessed stored hash without a scoped, valid asset lease/upload reference.

## Hashes, transaction and retry contract

- `sourceBytesHash`: SHA-256 of the exact downloaded binary bytes.
- `assetHash` / `pictureHash`: existing Paddock asset digest of the canonical data-URI string. Missing picture is null at the contract boundary (normalize absent/empty storage values).
- `requestHash`: SHA-256 of canonical intent JSON, including operation identity, expected baseline and final asset/provenance, excluding transport envelopes and temporary filesystem paths.

These hashes are not interchangeable. The fixtures use synthetic digests and cannot authorize real assets.

One image mutation is atomic: update picture/reference, provenance, relevant field versions, durable operation receipt and existing change log together. It must not change a race configuration or touch car performance. A library-wide batch can complete in bounded per-entry operations; the progress display must say which committed, failed or await authority review.

Persist a fresh operationId and exact intent **before** first dispatch. Same operation ID/content returns its previous authoritative receipt; different content conflicts. Receipt lookup precedes baseline validation on a retry (otherwise the operation would conflict with its own earlier successful write). Both lookups and write paths check database/recovery identity. Fixing a URL or rebasing after review creates a new attempt/operation only after an older uncertain operation has been reconciled. A failed status check is not proof that a commit never happened.

The receipt schema covers durable final states `applied` and `unchanged`. A pending Dealership submission is a separate proposal receipt, not a final picture receipt. Do not present Submitted as Applied. Native transaction rollback handles disk failure after preflight; acknowledgment only follows commit.

## Private journal and lifecycle

The `$defs.journal` descriptor is immutable: original blank request and exact trusted per-row mapping/baselines. It is not the AI-facing file. Persist it atomically before exporting the request. Future storage lives under Paddock's user-data directory, indexed by database/recovery/request identity. It contains no image bodies or credentials. This is local workflow state, not a second collection database and not part of the shared racing catalogue.

Mutable job/attempt records are separate from this immutable descriptor:

| State | Meaning / recovery |
| --- | --- |
| Awaiting response / Unreturned | Preserve the request and missing rows for later; no network work. |
| No image / Needs attention | Empty URL, uncertain match or changed target; cannot apply until explicitly resolved. |
| Downloading | Restart as Needs download after interruption; never reuse a partial file. |
| Download failed | Preserve the error and link; retry only on user action. |
| Ready | Full validated bytes and content hash present; selection itself is not approval. |
| Applying / Outcome uncertain | Exact operation persisted; look up/retry it, without minting another identity. |
| Submitted | Pending authority decision; retain proposal association and required assets. |
| Applied / Unchanged | Durable receipt reconciled; do not replay because a newer photograph now differs. |
| Rejected / Cancelled | Terminal for that attempt; not permission to undo already committed rows. |
| Stale | Recovery changed, target missing/changed or baseline expired; re-review or export anew. |

On restart, reconcile uncertain outcomes before clearing staging. The same rule applies to cancellation. Cancel remaining work; keep committed rows and already received host proposals until their decisions/cancellations are reconciled. Closing the modal pauses presentation, not an implicit destructive cancel.

Allow at most 100 nonterminal request files and 16 MiB of journal metadata per Paddock profile. Check these limits before export; offer explicit discard/archive of resolved requests, never evict pending/uncertain work automatically. Resolved journal entries may be removed after 30 days, but authoritative command receipts follow their existing independent retention rules. An old response whose journal is gone cannot recreate a request.

Keep unpinned preview files at most 72 hours. Pin selected/currently active previews, uncertain operations and unresolved delivery/proposals. The total 64 MiB staging quota still applies: pause the next download and offer apply/clear/resume instead of deleting pinned files or increasing the limit. The implementation must reserve quota before starting two simultaneous downloads and wait for in-flight reservations before declaring a capacity pause. Waiting items are not failed downloads. Release temporary originals and thumbnails only after a durable successful receipt, or after confirming the downloaded bytes already equal the stored picture. Keep receipts and saved library assets. Persist detached-file cleanup before unlinking, retry interrupted cleanup, and retain pending, uncertain and failed-save evidence for recovery. Partial files are never shown as ready.

Database restore invalidates old-generation work without changing its epoch automatically. The main library backup preserves applied pictures/provenance, not the profile's unsubmitted request journal; restore or move to another PC requires a new request for unapplied rows. Do not silently lose workflow files or claim a complete database backup includes them.

## Resource and network admission

The exact constants are in limits.json. They are part of this v1 processing contract:

| Budget | Value |
| --- | --- |
| AI file / rows | 2 MiB / 100 rows |
| Combined input | Up to 100 files, 16 MiB total JSON; existing journal budget also applies |
| Source binary | 9,437,166 bytes maximum; existing 12 MiB data URI including MIME prefix still checked |
| Image formats | PNG, JPEG, WebP; require successful decode of actual bytes |
| Dimensions | Each dimension <=16,384; positive width × height <=24,000,000 pixels |
| Decode / download concurrency | One decoder, two downloads |
| Decode deadline | 10 s; terminate the isolated decode job on expiry |
| Redirects / timeouts | Three redirects; 15 s per request including DNS, 30 s total per item including redirects |
| Preview staging | 64 MiB total, disk backed, across jobs |
| Thumbnail | <=512px per side, <=2 MiB encoded, preserve proportions and alpha; never enlarge |

Reject animated/multi-frame images for v1; no conversion of an animation to an undisclosed first frame. Validate dimensions/frame count before large native allocations, then decode in an isolated worker with cancellation/time budget. A 24MP RGBA raster alone costs ~96 MB; memory testing must also account for codec buffers and thumbnails. Phase 4 exercises a synthetic 24MP PNG in Electron and records process memory samples; these measurements are not a universal codec memory ceiling. Never silently resize an oversized original to make it fit.

These decoder admission limits apply to new pictures entering this feature, not retroactively to every stored photograph. Do not make an existing collection fail validation because an older, valid original exceeds the new enrichment decoder budget. Existing-photo preview handling must use bounded derivatives or a clear unavailable-preview state rather than an unbounded decode.

Use public HTTP/HTTPS on their standard ports only; no credentials or fragment. `link()` validates URL syntax only. It deliberately does **not** establish that the destination is public. The downloader must resolve and reject private/loopback/link-local/multicast/reserved/mapped addresses, pin the vetted address for the connection while preserving TLS hostname verification, and repeat admission for every redirect. Refuse HTTPS-to-HTTP downgrades. Do not forward cookies, authentication, referer headers or environment proxy credentials. No retries that bypass a denied address or failed certificate.

Enforce body limits while streaming regardless of server headers. Reject unsupported content encodings, abort on deadlines/cancellation and release quota/connections. Decode sniffed content; a URL extension or image Content-Type alone is insufficient. HTML/SVG/error responses do not become stored pictures. Source-page links are optional context, never fetched automatically for images.

Logs show bounded host/status/error context, not full query-bearing image URLs (which may contain temporary access tokens). Stored provenance retains the user-approved source URL; render it escaped and open via the existing external-link policy. The renderer only receives scoped local preview URLs, never arbitrary staging paths or remotely loaded images.

## Dealership and peer compatibility

Current `dealership-policy.cjs` reviews catalogue imports but treats ordinary part/supply/assembly edits as routine. Preserve that distinction: an illustrated catalogue batch follows catalogue review; a manually chosen assembly photo remains routine. Do not route the latter through catalogue import and create a review loop.

Before enabling future actions, register them explicitly in the command allowlist, policy, compact payload, validation, field/version checks, scoped persistence and worker routing. Older hosts that do not support them must report Unsupported operation; do not fall back to a full part edit or unrestricted patch. The Phase 1 contract introduced no runtime capability; Phase 5 now advertises the Dealership-only capability documented below.

Stage downloads on the initiating computer. Submit verified assets through supported transfer paths, within existing 16 MiB proposal and other transport limits, rather than causing the host to fetch AI URLs. Group entries into bounded review batches and show counts before submission. Account for both old and new photo evidence when sizing; if a single replacement cannot fit a legacy path, refuse that path clearly while preserving the request and existing picture. Do not increase the network limit in this feature. Host approval rechecks picture baselines and applies only explicitly accepted entries.

Timing/Telemetry APIs, shared-library identity/recovery semantics, race history and car thumbnails are unchanged. Optional assembly pictures/provenance must survive validation, packing, lazy media, shared-engine writes and backups before activation. Test existing snapshots and older compatible writes; if either peer drops these fields, coordinate the engine release rather than claiming compatibility based on optional JSON fields alone.

## Review gates and scope of evidence

Phase 1 tests validate the frozen files with an independent JSON Schema validator, exercise pure matching/conflict rules and check current photo-size boundaries. Existing catalogue, assembly, photo, shared-library and integration regressions must continue to pass. They do not test a not-yet-implemented downloader, journal, command router, assembly editor or installed-app interaction.

Phases 2–5 must implement and qualify those runtime paths. In particular, verify SSRF admission and memory bounds, durable journal/receipt recovery, proposal cancellation, current-field protection and actual image bytes. Source hashes and baseline scope should accompany later client qualification. No user database is used as test input; no release is authorized here.

## Phase 5 implementation

The frozen v1 JSON formats above are implemented for parts and workshop supplies by the image-only `catalogue.picture` command. It takes `{intent,picture}` with a canonical original data URI; the intent and receipt use the frozen schemas. No URL is fetched in a save or approval transaction. Persistent operation identities are stored before dispatch. The private request journal is now version 3; older clients must not rewrite it.

Local command receipts fingerprint the canonical intent (which includes original-byte and asset hashes), not file paths or the photo transport envelope. Actual supplied bytes are validated against those hashes even on retries. Picture, provenance, relevant field versions, changelog and receipt commit together. Unchanged pictures retain their existing provenance.

Dealership `/v1/club/status` now advertises `cataloguePictures: 1`. Clients use the existing authenticated, bounded `POST /v1/club/proposals` with action `catalogue.picture` and proposal ID equal to `intent.operationId`. The host decodes incoming bytes before retaining a new proposal. Approval records a v1 picture receipt in the proposal in the same transaction as the image change. Rejection leaves the product untouched.

`GET /v1/club/catalogue-picture-receipt?operationId=...&requestHash=...&recoveryId=...` requires trusted Dealership credentials and the existing `X-SlotForge-Database` header. Returns `{status:"absent"}`, `{status:"pending"}`, `{status:"rejected"}`, or `{status:"accepted",result:<v1 receipt>}`. Identity/recovery and request hash are checked before reporting the result. Invalid access or a failed lookup never means absent. Older hosts are refused clearly without falling back to full product edits. No public Timing/Telemetry capability or endpoint changed.

One selected entry is one bounded proposal, so Review can approve or reject pictures independently. Both old and new original sizes count toward 16 MiB admission. A stale target cannot be forced through approval with the general conflict checkbox. Stop only halts remaining dispatches; already pending proposals remain pending until the host approves or rejects them.
