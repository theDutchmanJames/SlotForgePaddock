# Shopping List

Shopping List is a dedicated checklist with a green accent. It brings together
General shopping, named lists, Build from Scratch plans and workshop jobs.

## Find, add and finish

- **Find a Part** searches catalogue names, references and manufacturers as you type.
  Manufacturer, main-group and type filters narrow the dropdown matches; they do
  not hide items already on your shopping list. At most 20 matches load at once.
- Click a match to add one to the selected list. From **All Items**, additions go
  to **General shopping**. New additions appear immediately, newest first.
- **All Items** includes every list. The sidebar switches between individual lists;
  its counts show unfinished items. Large lists use pages of 30 rows.
- Adjust quantity inline, move a row to another list, open its details, or delete
  it with Undo. Moving lists keeps build/workshop links. Deletion hides the row
  without reversing stock, erasing receipts or recreating the requirement later.
- **Done** offers either a simple tick or **Add to stock & mark done**, with an
  explicit quantity and confirmation. Completed rows remain below unfinished rows.
  Reopening never removes stock; previously added quantities cannot be added twice.
- **Add shopping item** supports searchable catalogue parts, workshop supplies and
  free text. Quantity and destination list are prominent. Supplier, price/currency,
  link, notes and a workshop job are under Optional details.

Free-text items need only a name and quantity. To add them to inventory, first
link them to an existing part or supply. If necessary, create that record with
zero owned stock in Parts or Workshop supplies. Linking retains the original
free-text description. Supply receipts count containers, not inferred volume.

## Builds and workshop jobs

First saving a new build can populate its missing parts. Later changes are offered
through **Review shopping changes** in the build editor or **Review build changes**
on its shopping list. Saved-setup jobs offer **Review parts from job**.

Choose the proposed additions, quantities or no-longer-needed items to apply.
Manual quantity changes require individual selection; Select all changes leaves
those choices alone. Deleted items and Done ticks remain unchanged. There is no
page-wide Update requirements button. See [requirement rules](SHOPPING-LIST-REQUIREMENTS.md).

## Existing records and compatibility

Old order balances, receipt records, prices, dates and source links are retained.
Normal shopping no longer exposes order/receive stages. **Stock history** still
shows earlier orders and receipts and supports explicit receipt corrections.
Inventory changes and checklist completion commit together, with revision checks
and durable command receipts protecting retries.

Checklist state is additive at `purchase.checklist`:
`{version:1, quantity, done, deleted, manualQuantity?}`. Legacy `quantity`, `received`
and purchase audit fields remain valid. The new commands are
`planning.checklist.edit`, `.done`, `.delete`, `.restore` and
`planning.shopping.applyRequirements`. Detail edits accept `checklistQuantity`.

Dealership advertises `shoppingChecklist: 1`; clients refuse checklist operations
against an older host instead of silently losing them. Timing and Telemetry car
and racing contracts are unchanged. Shared-library car writes preserve shopping
state, and public car exports do not include private purchasing data.

## Responsive checklist writes

Adding, deleting, restoring, changing checklist quantities/lists and ticking Done
without adding stock use a scoped shopping transaction. It validates the shopping
ledger and reference identities, reads the affected stock record when its tracking
rules are needed, and preserves other planning data. Only changed records are
written. Revision checks, atomic persistence and durable retry receipts still apply.
Explicit stock additions use a scoped stock/receipt transaction: read and validate
the target part or supply, its active installations/assemblies, and related build
or workshop requirements. Only the affected stock record and shopping changes are
written. The shared shopping ledger still checks receipt identities and arithmetic;
this does not load or validate every stock record. Bulk deliveries and receipt
corrections retain their existing wider transaction paths.

Single-part receipts refresh only related requirement sources, including legacy
plans awaiting their first checklist generation. They preserve manual quantities,
list choices, Done/deleted ticks, and unrelated plans. Requirement quantity changes
still require explicit user selection.

Shopping search reads compact catalogue descriptors and loads only the displayed
matches. The page resolves its shopping references without loading the full parts
catalogue. Immediate checklist buttons use the saved screen returned by the command;
they do not fetch an editor context or reload an already-current page.

`tests/shopping-performance-smoke.cjs` exercises 3,001 catalogue parts and 200
shopping rows in an isolated Electron profile, including last-page deletion and
adding from a later page. Run with `--smoke --shopping-performance-only`.

`tests/shopping-stock-write.test.cjs` covers scoped stock additions with over 3,000
parts, legacy and current build links, accepted workshop substitutes, stock limits,
assembly ownership, supply history, rollback, competing saves and durable retries.
