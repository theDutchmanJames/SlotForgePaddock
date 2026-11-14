# Wishlist — foundation, interface and purchases

Status: Phases 1–5 implemented and qualified. Final paired Windows packaged-app
qualification passed on 2026-11-14 against Paddock 1.4.0 and Timing 2.2.2 candidates.
Wishlist is enabled in Paddock's source following explicit user approval on
2026-11-14. The enabled Windows package was requalified with the unchanged Timing
2.2.2 candidate. Nothing has been published or installed over users' apps.
No personal collection migration or client update is performed by the tests.

## Membership

Cars may carry `collectionStatus: "collection" | "wishlist"`. An absent property
means `collection`. Existing cars are not rewritten. Ownership text such as
Wanted or Ordered, usage labels, and archival state do not determine membership.
Wishlist entries use the existing car identity, specifications, price/currency,
photos, research, documents and custom fields. New Wishlist entries default to
ownership text Wanted; changing that text does not mark them purchased.

Ordinary `car.save` edits cannot change membership in either direction. A
duplicate retains membership; archive/restore does not purchase a car. Merging
across membership states is rejected. Purchase is a separate atomic operation,
reviewed when using a Dealership collection.

## Queries and storage

The internal SQLite reader accepts `collectionStatus` for car list/count
queries. It filters authoritative scalar fields before counting or pagination.
Unscoped internal reads still include all cars, including Wishlist and archived
records, for backups, collection replication and integrity checks.

No SQLite schema/index-version upgrade is necessary. The existing scalar-field
indexes support membership predicates; the overview subtracts an indexed count
of active Wishlist records from its existing car total. Opening an old database
does not hydrate or rewrite all cars to add defaults.

Normal Cars lists, selection, Overview counts, Showroom choices, cover and
presentation candidates exclude Wishlist entries. Wishlist queries serve the
separate Wishlist tab. Full backups and Dealership snapshots preserve membership
and all associated data. Existing collection capacity limits still count both
kinds of record.

## Physical and integration boundaries

Wishlist cars cannot receive tracked installations, applied setups, workshop
jobs, rebuilds, manual physical work or test records, or new signed race
configurations. Written technical fields and saved specification snapshots
remain possible. Domain checks cover eager and scoped/lazy writes; failed
operations leave stock, cars and history unchanged.

Ordinary Wishlist creation/editing uses Dealership's direct-change policy.
Normal owned-car creation retains its existing approval policy.
The Dealership status advertises `wishlist: 1`; pairing remembers that
capability. New clients block Wishlist writes to an older host before adding
anything to the outgoing queue, preventing silent conversion to an owned car.

The updated Paddock public catalogue, scalable catalogue, shared-file catalogue
and targeted shared editor reject/exclude Wishlist cars. Ordinary car-package
and Timing exports reject Wishlist selections rather than silently converting
them to owned cars. Public change feeds return a removal for a Wishlist identity
so a consumer cannot treat an invalidation as a raceable car. Established owned
car API response shapes are unchanged. Existing Timing and Telemetry history is
not reclassified or removed.

**Activation boundary:** older Timing installations bundle their own copy of
the shared-file engine. Paddock cannot change an already-installed reader. Before
enabling Wishlist entry in the UI, Timing must ship the Phase 4 qualified bundle
and finish its app-level cache, notification and restoration checks. No claim of
Wishlist support in older independently bundled engines is made here.

## Remaining activation work

Timing's compatible bundle rollout and installed-app confirmation are deferred.
After those checks and confirmation that connected Paddock computers use compatible
builds, enable the feature in a coordinated release. Phase 5's Paddock-side checks
do not claim that an older installed Timing reader is compatible.

## Phase 5 — final Paddock qualification

Actual JSON-to-SQLite upgrade tests preserve legacy ownership text and usage
labels without changing membership. Reopening retains photos, identity and one
purchase event. Independent SQLite writers reject stale purchase requests and
cannot commit two purchases for the same car.

Pending Dealership purchases survive restart and restoration of a backup. Review
found and fixed a stale-approval gap: comparison tokens now include the database
recovery identity. Restoring a backup invalidates an already-open comparison,
even when restored car values match. The pending proposal remains available for
a fresh comparison and deliberate approval; no new transport or client fields
are required. This protection applies to other Dealership comparisons too.

Electron checks cover required confirmation, cancellation, stale forms keeping
the user's input while preserving newer saved details, archive/restore, purchase,
window reload, Showroom inclusion and pending/rejected/approved Dealership Review.
Dark and light screenshots are checked after the compositor has painted the
current page; modal closure and minimum-window layout are asserted independently.
Tests use temporary libraries and the isolated smoke profile only. Timing and
Telemetry source and all personal databases remain unchanged.

## Phase 2 — interface

The Cars page has My Cars and Wishlist tabs, sharing the existing gallery,
table, search, sorting, usage filters, column configuration and editor. Wishlist
entry defaults to Wanted and uses the existing price/currency fields, labelled
Price. Photos, documents, product research, custom fields and specification
snapshots use the existing workflows. Ownership text cannot purchase a car.

Each tab has its own saved-view scope. Old saved views without a scope still
belong to My Cars. Tab switches clear selection, search, usage filters and
archive filtering; Select all and print queries filter membership before
pagination. Usage suggestions and active counts respect membership. Opening a
Wishlist detail page and returning takes the user back to Wishlist.

Wishlist details hide physical work, maintenance, racing, rebuild, installation,
setup application and ordinary export actions. The domain protections from
Phase 1 remain authoritative. Archiving/restoring and duplicating a Wishlist
entry preserve membership. Phase 3 adds the purchase action described below.

`src/wishlist-activation.json` now enables the interface for normal app startup.
The renderer receives the activation value from the main process. The temporary
smoke-only activation bypass has been removed, so UI tests exercise the same
activation path as the normal application. Before final qualification this gate
was disabled while the isolated smoke test exercised the planned interface.

Phase 2 tests cover a 520-car mixed collection, scoped counts/filters/pagination,
selection across multiple pages, saved-view persistence through deferred writes
and restart, legacy saved views, invalid scopes, and detail/print/editor contexts.
Electron checks exercise actual entry and editing, photographs, price labels,
archive/restore, saved views, selection, Showroom exclusion, light/dark rendering
and the inactive production gate. Fixtures live only in temporary databases and
the isolated `.qa` test profile.

## Phase 3 — mark purchased

An active Wishlist car's detail page offers **Mark purchased**. The confirmation
shows its existing purchase date, seller, price and currency, allowing optional
corrections. No date or price is invented. Confirmation changes membership to
`collection` and ownership to `Owned`, appends one purchase history entry, and
keeps the original ID, photos, documents, specifications and other history.
Archived wishes must be restored first. Ordinary edits still cannot change
membership, and there is no reverse purchase operation in this phase.

Local purchase is immediate and returns to the same car in My Cars. The car is
then available to Showroom and the existing Timing catalogue/profile and shared
library readers. Public catalogue revision and car invalidation advance together
with the purchase transaction. No racing results or physical stock are created.

In Dealership Mode, both member and coordinator purchases create a named Review
proposal. Until approval, the car stays on Wishlist and its detail page shows
**Purchase awaiting Review**. Repeated requests do not create another pending
purchase for that car. Rejection leaves all car data untouched. Approval applies
the purchase and its history entry atomically. The submitted car revision remains
authoritative even when a reviewer confirms unrelated collection changes: if the
car itself changed, reject the stale proposal and submit a fresh purchase.

The dedicated `car.purchase` command requires the car ID, its current revision
and `confirmed: true`. Optional `details` allow only `acquired`, `seller`, `price`
and `currency`; omitted keys preserve existing values. Dates and non-negative
prices are validated before commit. Scoped writes load the target car, preserving
unrelated records. Durable command/proposal receipts protect lost-response
retries, including after restart. A restored database's new recovery epoch blocks
uncertain pre-restore command retries.

Dealership status additionally advertises `wishlistPurchases: 1`. Pairing and
reconnection remember this capability; clients refuse to queue a purchase to a
host without it. Existing Timing and Telemetry endpoint shapes are unchanged.
This does not replace the remaining independent-client qualification phase.

`tests/wishlist-purchase.test.cjs` exercises eager and deferred writes, exact data
preservation, invalid/stale requests, failed persistence, catalogue notifications,
restart retries and backup restoration. Routine Dealership tests cover real local
host/member replication, duplicate submission, rejection, stale approval and old
host capability handling. `tests/wishlist-purchase-smoke.cjs` exercises purchase
and cancellation, pending/rejected/approved Review, and Showroom inclusion through
the Electron UI, using only the isolated test profile.

## Phase 4 — compatibility qualification and Timing handoff

The common engine now advertises `capabilities.wishlistFiltering: 1`. Independent
bundles must be upgraded explicitly; the unchanged engine version number alone
is insufficient. The local Timing bundle was audited and reproduced the problem:
it listed a synthetic Wishlist car. The same real Timing client with Paddock's
candidate bundle correctly excludes wishes, edits and prepares purchased cars,
and sees the same ID after reopening. This does not update installed Timing.

Qualification covers independent shared-file workers, 105 mixed records, SQL
overview pagination, purchase invalidation, stale page tokens, recovery identity
changes and restoration to a pre-purchase backup. The real local Telemetry client
downloads unchanged accepted results, corrections and withdrawals from a loopback
Paddock server while wishes are added and purchased. Test profiles are disposable.

Review fixes: rich historical/native acceptance now rejects Wishlist car links
even when their captured configuration is null; pending evidence is preserved.
Timing's class-label projection excludes labels present only on Wishlist cars.
Neither fix changes or removes previously accepted history. Standard Timing and
Telemetry response shapes, existing connections and credentials stay unchanged.

The local handoff is `integration-handoff/wishlist-v1/README.md`, with a packaged
engine, SHA-256 manifest, synthetic before/after JSON examples, membership schema,
source fingerprints and an installed-app acceptance checklist. Coordination files
remain outside release packaging. `tests/wishlist-compatibility.test.cjs` includes
three standalone tests and two optional real-client tests enabled by explicit
local source paths; the cross-project tests were run during this qualification.

All connected Paddock clients also need Wishlist-aware builds before activation.
New members refuse unsupported host writes, but a host cannot repair an older
member's renderer. No personal library or other project's source was modified.

## Verification

`tests/wishlist-foundation.test.cjs` uses disposable databases. It covers legacy
defaults, invalid membership, protected transitions, scoped writes, photo/data
preservation through restart and backup, Dealership snapshot retention, paged
queries, owned counts, Showroom exclusion, duplication, exports, shared reads,
public notifications and atomic rejection of physical workflows.
The routine Dealership tests also exercise actual loopback host/member
replication and rejection of writes when the host capability is absent.

Qualification on 2026-11-13: full Node suite 1,559 passed, zero failed,
five optional joint-thumbnail checks skipped (1,564 total). Electron Showroom
regression checks passed for Groups, cover modes, presentation, navigation and
light/dark layouts. The final Portal error-message refinement passed all 12
Wishlist tests, including Portal exclusion and the shared-folder worker. Syntax
and whitespace checks passed. These are isolated local automated tests, not a
two-physical-computer or old-installed-Timing activation qualification.

Phase 2 qualification on 2026-11-13: full Node suite 1,563 passed, zero failed,
five optional joint-thumbnail checks skipped (1,568 total). The Wishlist,
existing car overview and Showroom Electron checks passed, including photo
decoding, saved-view application, search, archive/restore and minimum-window
layout. All 217 syntax checks and the whitespace check passed. Review fixes
included scoped print contexts, membership-specific usage suggestions and
clearing selections when a detail link crosses between My Cars and Wishlist.
Personal data was not opened or migrated by these tests.

Phase 3 qualification on 2026-11-14: full Node suite 1,573 passed, zero failed,
five optional joint-thumbnail checks skipped (1,578 total). All 27 targeted
purchase/Dealership tests passed. The combined Wishlist and purchase Electron
checks passed, including actual local purchase and Dealership rejection/approval.
All 219 syntax checks and the whitespace check passed. Tests used disposable
databases and the isolated smoke profile; no personal collection was changed.
Public activation remains disabled, and no two-physical-computer or independently
installed Timing/Telemetry qualification is claimed by these results.

Phase 4 qualification on 2026-11-14: full Node suite with the real local Timing
and Telemetry client checks enabled: 1,584 passed, zero failed, five optional
joint-thumbnail checks skipped (1,589 total). The 39 focused compatibility/history
checks passed, as did all 220 syntax checks and whitespace validation. All 267
candidate bundle files matched their manifest and current engine sources.
Review also repaired an older live-mapper assertion to allow Timing's exact
historical-note wording correction while retaining byte-identical frozen fixtures
and strict comparison of every evidence/statistics field. Public activation is
still off; the Timing handoff calls for bundle rollout, first-run cache refresh,
blocked-result handling and final installed-app acceptance.

Phase 5 qualification on 2026-11-14: final full Node suite **1,587 passed, zero
failed, five optional joint-thumbnail checks skipped (1,592 total)**. All 52
targeted Review/recovery checks and the combined Wishlist/purchase Electron
checks passed. The five candidate-engine/client checks passed before the
in-memory-only fallback refinement; the final full suite also exercised those
clients against the final source engine. All 220 syntax checks passed, changed
files were rechecked after refinements, and whitespace validation passed.
The refreshed 267-file handoff bundle includes the final Review fix. Activation
and installed Timing qualification remain deferred; no personal data was used.

## Final paired Windows package qualification — 2026-11-14

Fresh `electron-builder --win --dir` builds used each project's installed Electron
runtime (Paddock 45.1.0; Timing 45.0.0). The actual Windows executables ran together
against synthetic collections in disposable AppData and LocalAppData directories.
Only a test bootstrap and package entry point were added to the QA archives;
655 original Paddock files and 1,183 original Timing files remained byte-identical.
Both packaged Wishlist activation files remained false. The test controller exposed
the Wishlist UI only in the disposable Paddock renderer to exercise its purchase form.
OS protocol/login registration was suppressed by the test bootstrap.

The paired lifecycle passed in three scenarios: Timing first with existing JSON
storage, Timing first with existing SQLite storage, and Paddock first followed by
Timing. Both apps reported the same isolated `library.sqlite`. Checks covered:

- Wishlist exclusion from Timing's normal catalogue, editor and race selectors;
  existing ownership text `Wanted` remains visible.
- Actual purchase confirmation, same car ID, retained photo/specifications/setup,
  automatic refresh while both apps run, and a valid race configuration capture.
- Purchase while Timing is closed and correct availability after reopening.
- Dealership pending/rejected purchases remaining excluded, pending Review surviving
  restart, approval becoming available, and repeated approval producing no duplicate.
- Restoring a pre-purchase backup while both apps run, removing the reverted car
  from Timing's catalogue and selectors and blocking a new race capture.
- Unchanged pre-existing Timing sessions/laps and no renderer crashes or errors.

An additional paired run exercised the actual packaged network client against the
packaged Dealership host over localhost: pending/rejected wishes stayed out, approval
added the same ID once, and disconnection retained the complete catalogue cache.
A separate real-PNG check verified the purchased photo decoded as a 512px thumbnail
in Timing. Screenshots were inspected.

Focused Paddock tests passed (51, with two optional local-client cases run separately);
all five exact-packaged-engine/client checks passed, including the real Telemetry
client's history/correction/withdrawal workflow. Timing's focused suite passed all
41 tests with its optional real-Paddock projection enabled. All 223 syntax checks
and whitespace validation passed. No production defect or source change was needed
in this qualification round.

This qualifies Windows unpacked application directories, not an installer upgrade,
code signing, macOS/Linux execution or communication between two physical computers.
Older installed Timing/Paddock clients are not made compatible by these tests.
The local `integration-handoff/wishlist-v1/PACKAGED-QUALIFICATION.md` records hashes,
evidence locations and the unchanged activation state for coordinated rollout.

## Activation — 2026-11-14

After explicit approval, enabled Paddock's UI flag and removed the smoke-only
bypass. No membership migration, database schema, API, sharing permission or
Timing/Telemetry source changed. Timing's qualified bundle already filters wishes
using `wishlistFiltering: 1`; its bundled copy of this Paddock UI flag does not
control Timing's catalogue and does not need changing.

The fresh enabled Windows package passed normal startup and the paired SQLite
Timing-first lifecycle without setting the renderer flag from the QA controller:
live and closed-app purchases, same-ID race preparation, preserved photo/setup and
history, pending/rejected/approved Dealership purchases, restart, duplicate approval
and restoring a pre-purchase backup while both apps run. The actual packaged network
client/host checks also passed, including offline catalogue retention. All 49 focused
domain/integration tests passed with the real Timing and Telemetry clients enabled.
The Electron creation/editing/photo/filter/archive/purchase workflows passed.

Activation evidence is in `.qa/wishlist-activated/` and the local handoff's
`ACTIVATION.md`. Earlier disabled-gate reports remain historical qualification
evidence. Existing installed older apps are not updated by this source change;
distribute compatible Paddock/Timing builds together. No release was published.
