# Shopping List — Phase 4 execution plan

> Historical implementation reference. The current checklist workflow is documented
> in [Shopping List](SHOPPING-LIST-PAGE.md). Order and receipt records remain
> preserved, but normal shopping now uses Done with optional inventory addition.

Approved scope: supplier grouping, bulk ordering, partial deliveries with explicit
allocation between shopping lines, receipt correction, and optional prices/totals.
On 13 November the user confirmed: split deliveries; keep stock unreserved.

## Behaviour

- Group the filtered, paginated page by supplier, keeping each original purchase
  and its build/job/list links separate. Selection is explicit and page-bounded;
  show the selected count. Do not merge source lines just because parts match.
- Mark selected quantities ordered after a confirmation. This records an order
  already placed by the user; it never contacts a retailer. No stock changes.
- Receive selected lines in one transaction, with individual quantities that the
  user can adjust for a partial delivery. Repeat part IDs aggregate stock once
  per entered quantity; each receipt stays attached to its original source line.
  Check every line before committing, and reconcile requirements only after the
  complete delivery. Free-text items must be linked to stock first.
- Cancel an outstanding ordered quantity explicitly, preserving an audit entry.
  Active requirements return to To buy; ended plans retain only still-outstanding
  orders and received/corrected history. No stock changes.
- Optional unit price is per piece/item, with a three-letter currency label and
  up to two decimal places. Use integer hundredths; show unknown prices as unknown,
  not zero. Totals are estimates excluding shipping/tax, separated by currency.
  Order and receipt audit entries capture the price and supplier at the time.
- Correct an individual new receipt by reversing some/all of its intake, with a
  reason and confirmation. Preserve the original receipt and append a correction.
  Let the user return the originally ordered portion to outstanding orders.
  Never reverse more than the uncorrected receipt quantity or currently available
  loose stock. Do not dismantle assemblies or remove installed parts. Historical
  aggregate-only receipts have no invented receipt identity or date and cannot
  be corrected through the per-receipt action.
- Keep zero-net-received corrected purchases as history. Normal supply corrections
  change the owned item/container count, not recorded consumable volume.

## Invariants and compatibility

Purchasing remains private, additive v1 metadata in schema 11. Existing receipt
payloads remain supported. New commands use revision checks, normal transaction
rollback and durable command receipts. All ordinary purchasing operations remain
routine Dealership actions. Public Timing/Telemetry car and race contracts stay
unchanged. No app version bump, release or personal-data migration is included.

## Qualification

Test multi-source bulk orders/deliveries, duplicate/stale inputs, free-text linking,
partial delivery, mixed currencies and missing prices, corrected receipts with
installed/reserved stock, cancellation and rebuild completion, legacy data, disk
failure/restart/retries and shared-library/Dealership compatibility. Exercise the
real desktop flows in an isolated profile. Review implementation and run the full
regression suite before completion.

## Using the page

1. Optionally enter a supplier, unit price and currency using **Edit**.
2. Choose **Group by supplier**, then select purchases on the current page.
3. **Mark selected ordered** records an order already placed outside Paddock.
4. **Receive delivery** shows one quantity per selected purchase. Adjust each
   quantity to split a partial delivery, or enter zero to skip a purchase.
5. Open **History** on a purchase to inspect its orders and receipts. **Correct a
   receipt** reverses an intake mistake with a reason. It is not a stock disposal
   or an automatic supplier-return workflow.

A correction attributes the original ordered portion first, whether or not the
user restores it to outstanding orders. A later correction cannot restore that
same ordered portion again. Cancelled or fully reversed generated purchases stay
under **Received / history**, including when their net quantity is zero.

Totals cover all purchases matching the current filters, including other pages.
They use the current unit price as an estimate; the history separately preserves
prices captured when each order or receipt was recorded. Different currencies
are never combined. Selection is limited to the displayed page and is cleared
when the database, list, filters, grouping or page changes.

## Review coverage

- Atomic bulk validation, partial receipts and duplicate stock identities across
  builds; requirements refresh only after the complete allocation is received.
- Order cancellation, completed/cancelled plan history, per-receipt corrections,
  fitted and assembly stock protection, supplies and free-text linking.
- Exact price arithmetic, missing prices, separate currencies, immutable historical
  prices, legacy receipt totals and opening order balances.
- SQLite restart, duplicate acknowledgements, conflicting retries, recovery fences,
  competing writers and injected receipt-storage failure with full rollback.
- Filtered totals across pages, explicit editor context and no loading of unrelated
  racing history. Shared Timing/Paddock workers preserve purchase metadata.
- Routine Dealership ordering, delivery, cancellation and correction replicate
  without creating Review proposals. Timing/Telemetry API contracts are unchanged.
- Desktop navigation, grouping, prices, selection, confirmation, receipts,
  corrections and cancellation; existing shopping/build/workshop flows retained.

All verification uses isolated databases and profiles. This is local automated
qualification, not a claim of testing two physical computers or the user's data.

### Verification result — 13 November 2026

- Full regression suite: **1,531 tests: 1,526 passed, 0 failed, 5 skipped**.
  Skips are optional joint-thumbnail qualifications requiring their separate setup.
- Final focused purchasing, requirements, query and shared-worker run after the
  audit-shape hardening: **61 passed, 0 failed**.
- Five isolated desktop suites passed **24 checks**, with no renderer errors:
  orders, shopping, requirements, planning and routine builds. Dark/light layouts
  were inspected, including the 1,000-pixel window.
- Syntax checks: **206 files**. `git diff --check` passed.
- Fixed during review: receipt corrections now consume their original ordered
  attribution even when not restored, preventing later corrections from reviving
  it; zero-net generated histories survive reconciliation; invalid correction
  containers and audit identities are rejected explicitly.

Implementation remains local. No app version bump, GitHub push or release was
performed. Personal collection data was not opened or modified by these tests.
