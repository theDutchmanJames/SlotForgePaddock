# SQLite transaction boundary and operation inventory

Phase 0 specification, 3 November 2026. Public Timing, Telemetry and Dealership v1 contracts are unchanged. The new change feed below is a design contract until its host implementation and published schema exist.

## Operation inventory

Every row includes database identity, revision, transaction receipt and history/change-log metadata where appropriate. “Reads” lists dependencies, not a permission to load every record in those collections. Bulk operations deliberately read more than ordinary edits.

| Commands | Required reads | Atomic changes and invariants |
| --- | --- | --- |
| car.save, car.favourite, car.archive | Target car; changed-field definitions; choice aliases; installed component dependencies for technical edits; photo focus for changed photos | Target fields/revision, relevant reusable choices and history; retain installation-managed fields and photo focus rules |
| car.duplicate, new car.save | Source/public fields or new input, field definitions, car count | New physical ID, defaults, choices, creation history; never copy private ownership/race history implicitly |
| car.bulk, choice.add, choice.rename | Selected/matching cars, definitions, aliases, installation guards and affected saved views | Review-confirmed bulk changes, choices/aliases and affected histories; no alias chains or accidental installed-part replacement |
| part.save, part.appearance, part.delete | Target part; active and historical installations; assembly components/history; setups, jobs, shopping and drafts referencing the part | Stock/type/classification/icon changes; rename propagation and car revisions; reject deletion or tracking changes with protected references |
| part.install, part.remove | Car, part, current installations and assembly membership | Installation, stock quantity/used-spares lot, car configuration/revision and history; no negative/overbooked stock |
| assembly.create, assembly.replace, assembly.install, assembly.remove, assembly.dismantle | Assembly, components, installations, target car, saved setups/jobs and available stock | Complete assembly movement/replacement and stock/car/history updates; component quantities remain consistent |
| build.draft.save, build.draft.delete, build.create | Draft, selected parts/assemblies, available stock, definitions | Draft or new car, selected installations, stock use, optional setup and history; draft does not reserve stock |
| setup.save, setup.apply | Target car, current/target configuration, installations/assemblies, stock and job relationships | Immutable setup capture or reviewed complete application; settings-only versus physical changes remain distinct |
| job.start, job.edit, job.note, job.fit, job.remove, job.setting, job.complete, job.cancel | Job, car, target setup, installations/assemblies and stock as appropriate | Job state/log, physical changes and car history; status and fitting preconditions enforced together |
| planning.job.save/check/photo/photo.remove | Job and associated plan/checklist/media | Plan/checklist/media changes; stable step/photo IDs; no implicit physical stock edits |
| planning.shopping.add/remove, planning.receive | Purchase, catalogue part, job association, already-received state | Purchase/receipt, owned stock and history; a receipt cannot be applied twice |
| planning.shelf.save/remove, planning.focus | Shelf or focus record and referenced cars/photos | Ordered membership/focus; no missing or stale photo references |
| supply.save, supply.archive, supply.delete | Target supply, classification and image | Supply fields/status/removal; supply stock is distinct from fitted parts |
| work.add, test.add | Car, selected setup or current installations, job, track/driver choices | Manual history/performance snapshot and choices; manual records remain separate from Timing |
| document.add/remove | Car, attachment, per-car count and revision | Private document and car history/revision; validate content and ownership |
| custom.add, columns.save, view.save/delete, settings.save | Definitions, name uniqueness, selected columns, settings and featured car | Definition/view/preferences changes; preserve valid references and public catalogue revision semantics |
| catalogue.apply | Reviewed selection, manufacturer references, current catalogue matches | Imported catalogue entries/updates and import receipt; do not fabricate owned stock |
| submission.add, submission.review | Package identity, pending outcomes, selected incoming/current car fields, stock overrides, shared setups | Idempotent inbox entry or selected approval, used-spares returns, car/setup/history and outcome in one commit |
| Dealership proposal receive/review/reject | Source operation identity, proposal, current affected dependencies and reviewer state | Durable receipt or atomic approved domain operation plus review outcome; official data unchanged while pending |
| Timing profile signing-key creation | Host identity and current signing key | Initialize once durably; no key in replica/public exports |
| Timing session receive/correct/withdraw | Source/session identity and revision, captured signatures, referenced cars and previous contribution | Whole session acceptance, receipt, car associations and derived contribution changes; invalid/pit/virtual distinctions preserved |
| Restore, Dealership snapshot replace/leave | Current identity/revision, pending operations, verified staged data and backup | Explicit full replacement boundary; never disguise a whole replacement as an ordinary edit |

All current mutation entry points converge on Store and the shared commit boundary. Club simulation uses a disposable Store; targeted car approval commits its affected records and review outcome, while complex approval retains full validated packing. Timing currently calls Store.transact for signing keys and session records. These broad paths remain compatibility fallbacks until individually converted, and must retain full validation while unconverted.

## Internal command and repository interface

The intended command envelope is `{ operationId, databaseId, action, payload, expected }`. Operation identity is generated once per user intent and retained for retries. Actor/source comes from the authenticated connection context, not an untrusted display name. `expected` contains the entity/field/dependency version checks needed by that action. A command resolves to a durable result or a structured error; it never publishes an uncommitted draft.

Repository reads return bounded records with identity/revision. They run against the same transaction snapshot as validation. Writes are allowlisted operations such as updating car fields or recording an installation, not SQL supplied by the caller. The committed result contains `{ operationId, databaseId, revision, result, changes }`; UI adapters can temporarily provide the old snapshot response while consumers migrate.

Error categories: INVALID_INPUT, WRONG_DATABASE, NOT_FOUND, CONFLICT, DEPENDENCY_CONFLICT, DUPLICATE_CONFLICT, STORAGE_FAILURE, UNSUPPORTED_VERSION and CURSOR_EXPIRED. Existing API error contracts keep their original codes; adapters map internal failures explicitly.

No-op handling happens after normalization and authorization. An identical edit does not increment revisions or create history/review. Reusing an operation ID with different normalized content is an error, including after a prior rejection. A failed storage attempt does not publish a successful receipt.

## Changed-field semantics

- Missing property means leave unchanged. Empty string, null and explicit removal are distinct; only fields whose schema allows null/removal accept them.
- Stable IDs address records and list members. Reordering is an explicit order operation; duplicates/missing members are invalid.
- Expected values include presence and relevant version, not only displayed text. Same-field ABA changes (A to B to A) still count as intervening changes.
- Related stock/configuration changes are one dependency group. Selective approval can omit independent changes but cannot split a stock-return/install transaction.
- Historical snapshots remain immutable. A current technical edit must never rewrite a setup or captured race configuration.

## Planned change-feed contract

The feed is capability-negotiated and scoped to the authenticated database and permitted audience. A cursor identifies a durable committed position and feed epoch. Each batch has a transaction ID, previous/next cursor and ordered record changes. No page may expose half a transaction. Oversized transactions use a bounded staged transfer with an explicit final commit marker.

State and its log entry commit together. A client commits changes and its cursor together. Duplicate delivery is harmless; an unknown gap or changed epoch requires resynchronization. Stream notifications contain only an available cursor/revision; the durable feed is authoritative after lost events or restart.

Deletion markers, operation receipts and change history have independently documented retention. Expired cursors return CURSOR_EXPIRED and snapshot requirements. Expired retry identity must not silently become a new mutation. Full synchronization uses a consistent staged snapshot and verified assets, with explicit user confirmation for replacing an outdated existing copy.

No public route/version is assigned by this specification. Publish exact schemas, paths and fixtures together when the feed is implemented; do not ask Timing to implement against these illustrative shapes alone.

Implemented separately: Dealership field review extension 1 (internal development reference) negotiates exact preconditions for ordinary textual car edits. It does not expose the internal SQLite journal or replace the replication feed.

## Compatibility matrix

| Consumer | Preserved behaviour | New capability only when negotiated |
| --- | --- | --- |
| Existing Paddock personal profile | Original identity/data, previous revision and legacy backup import | Storage migration is local and verified |
| Existing Dealership peer | Existing password, proposal/review and snapshot protocol | Durable cursors, field preconditions and staged snapshots |
| Timing v1 | Catalogue/profile shapes, signatures, result revision/retry semantics | Catalogue deltas and separate media access |
| Telemetry v1 | Session filtering, snapshot identity, corrected/withdrawn states | Bounded lap queries/change-feed extensions |
| Manual records/imports | Original domain validation, stock guards and private-field rules | Streaming large packages through a separate version |

Old endpoints keep bounded payload limits and explicit errors. Never truncate results or silently change signed JSON ordering. Database storage formats and API versions evolve independently.

## Review gate

Phase 0 review checks this inventory against mutation dispatchers and external Store transaction callers; validates that review still gates official edits; preserves full validation for fallback operations; and records baseline tests/timings without treating backend timings as desktop startup or physical LAN measurements. Subsequent phases update implementation status in the scalability plan rather than implying this specification is already implemented.
