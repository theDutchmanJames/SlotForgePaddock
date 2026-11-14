# Shopping requirements from builds and workshop jobs

Shopping is a checklist. Changes to a build or job do not silently rewrite a
person's shopping decisions.

## Creating and updating requirements

- First saving a new build can generate its missing loose parts. Reused installed
  parts and complete assemblies are separate from new purchases.
- Later build changes use **Review shopping changes** (build editor), or
  **Review build changes** on that build's shopping list.
- Active saved-setup jobs offer **Review parts from job**. General jobs use manually
  added parts, supplies or free text. Rebuilds use their build draft.
- Reviews compare current checklist quantities with current missing quantities.
  Select individual changes or Select all changes. Manually adjusted quantities
  are excluded from bulk selection and need individual selection.
- Deleted rows and Done rows are excluded from requirement proposals. Their part
  identity remains associated with the source so later refreshes do not recreate
  unwanted rows. Undo/reopen allows them to participate again.
- Moving an item to a different list preserves its source. Supplier, notes and
  receipt history also survive approved requirement changes.

## Calculation and lifecycle

Missing quantity is outstanding loose-part demand minus available stock. Stock
excludes fitted parts and components in assemblies. Fitted substitutes satisfy
setup steps. Assemblies are not expanded into implicit loose-part orders.

A reviewed change updates the checklist quantity, including quantities already
added to stock. A requirement no longer needed is marked Done, keeping its
original quantity and history. Duplicate legacy requirement rows are flagged for
individual handling rather than silently combined.

Plans never reserve inventory. The shopping page retains a collapsed warning
when several plans require the same available stock. Cancelling or completing a
build/job retains shopping rows and receipts, with the source status recorded.
Generated list names follow source renames; custom list names stay unchanged.

## Implementation and validation

`src/shopping-requirements.cjs` provides `preview` and `apply`. Apply rechecks the
source, revision, selected identities, current stock and individual-part limits
inside the normal transaction. Reads do not mutate the collection. Source
registration in `planning.shoppingChecklistSources` distinguishes first creation
from later edits, including a build initially saved with no missing parts.

Legacy automatic-reconciliation commands remain compatible but now preserve
existing checklist decisions. Existing legacy rows are adopted without quantity
rewrites. Stock receipts retain their immutable history.

Tests cover first generation, manual changes, moved lists, Done/deleted protection,
substitutes, rebuild reuse, cancellation, duplicate legacy rows, individual parts,
SQLite restart, failure rollback, Dealership and shared-library preservation.
Electron tests exercise the actual selectable review, bulk-selection exclusions,
Done/stock workflow and source links using isolated databases.
