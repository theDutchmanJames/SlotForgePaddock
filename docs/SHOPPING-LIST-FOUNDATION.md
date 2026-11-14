# Shopping List: Phase 1 foundation

> Historical implementation reference. The current checklist workflow is documented
> in [Shopping List](SHOPPING-LIST-PAGE.md). Order and receipt records remain
> preserved, but normal shopping now uses Done with optional inventory addition.

Phase 2 now activates the page and typed entry described in
[Shopping List: Phase 2](SHOPPING-LIST-PAGE.md). The boundaries below describe the
original Phase 1 deliverable.

Phase 1 adds purchasing metadata to the existing shopping records. It does not
replace the current screens, add a second inventory, change public car/racing
contracts, or enable free-text/supply purchases before their UI is implemented.

## Storage and migration

The collection remains schema 11. An optional, versioned extension under
`planning` contains `purchasingVersion: 1` and `shoppingLists`.
Existing shopping records keep their IDs, `partId`, `jobId`, `buildId`,
`buildName`, `buildCarId`, quantity, received total, supplier, expected date,
notes and timestamps. Each gains a `purchase` member:

```json
{
  "version": 1,
  "item": { "kind": "part", "id": "original-part-id" },
  "listId": "general",
  "ordered": 0,
  "legacyReceived": 2,
  "receipts": []
}
```

Migration runs inside the next shopping add/receipt or build shopping write.
`planning.shopping.migrate` is a revision-guarded internal Store operation for
explicit qualification; it is not a new LAN or public integration endpoint.
Simply opening a collection does not migrate it, alter its revision, or load
its entire model. Failed writes roll back migration and the requested operation
together. Repeating migration preserves previously generated list/receipt IDs.

General purchases use list `general`. Linked purchases use deterministic list
IDs derived from the job or build identity. A rebuild's job takes precedence
for grouping so its job purchases and build shortages share a single list.
All original links remain on the shopping record. Source IDs on lists may
outlive deleted jobs/builds; they are historical provenance, not live foreign
keys. Existing car-deletion handling continues detaching the live job link.

Old received totals become `legacyReceived`; no historical receipt dates,
prices or orders are invented. In particular, an expected date does not imply
an order. New legacy-format rows appended by compatible code are upgraded on
the next purchasing write.

## Quantities and receipts

- `quantity`: total purchase requirement, including received pieces.
- `received`: unchanged aggregate used by existing screens.
- `purchase.ordered`: outstanding ordered pieces, excluding received pieces.
- To buy = quantity minus received minus outstanding ordered.
- Received = legacyReceived plus quantities in the receipt history.

New shopping receipts append a unique ID, quantity, actual UTC receipt timestamp
and the portion fulfilled from outstanding orders. They decrease outstanding
ordered quantity first. Stock, aggregate received quantity and receipt history
commit atomically. Existing durable command receipts protect lost-response
retries; restored database epochs reject uncertain pre-restore retries.
Unlinked direct stock intake retains its existing behaviour.

Build recalculation and cancellation may reduce unordered requirements but
cannot remove outstanding orders or received history. No stock is installed,
reserved, or created merely by migration/planning. The ordering UI and the
explicit handling of no-longer-required orders belong to later phases.

## Item types and activation boundaries

`validateItem` defines three distinct identities:

- `{kind: "part", id}`: existing catalogue part.
- `{kind: "supply", id}`: existing workshop supply.
- `{kind: "free", name, maker, reference}`: no stock ID until resolved.

Only part entries are activated in stored shopping records in this phase.
The new page, list management, free-text/supply entry, inventory-target chooser,
ordering actions, supplier grouping and receipt correction UI remain subsequent
phases. Do not insert non-part rows into the legacy renderer.

## Compatibility and validation

Timing/Telemetry APIs, shared-library car identities and race evidence are
unchanged. Scoped writes preserve the extension; car packages do not export
private purchasing information. Portable backups retain lists and receipt
history. No new Review requirement is introduced for ordinary shopping.

Validation rejects unknown purchasing versions, malformed item identities,
duplicate or mismatched list IDs, negative/fractional quantities, excess orders,
duplicate receipts, impossible receipt dates and mismatched received totals.
Current limits are 10,000 shopping rows, 20,000 lists and 10,000 receipts per
purchase, within the existing collection metadata limit. Empty historical
lists are retained, not automatically removed.

Older Paddock executables that write purchase counters without recording the
new receipt history are not qualified to edit upgraded purchases. Timing's
car/history writes preserve purchasing data and do not use those counters.
This is not a change to Timing's or Telemetry's contracts.

## Verification

`tests/purchasing.test.cjs` covers legacy migration, deferred SQLite startup,
10,000-row migration, type definitions, invalid state, build/job links,
partial receipts, rollback, restart, portable restore and durable retries.
Existing planning, build, rebuild, scoped-write, Dealership, Timing, Telemetry
and shared-library suites remain part of qualification.
The isolated desktop run is `electron . --smoke --planning-only`.

Reviewed 13 November 2026:

- 18 purchasing tests passed, including two independent shared-library workers,
  competing receipts, SQL receipt failure and permanent car deletion.
- 159 focused planning/integration tests passed with loopback access.
- Desktop planning checks passed with no renderer errors (six workflows).
- Full suite: 1,481 tests, 1,475 passed, five optional joint-thumbnail tests
  skipped, one outdated thumbnail test mock failed. The mock lacked the
  existing assembly-photo callbacks; it was corrected. The affected thumbnail
  tests and final purchasing tests then passed together (29 tests).
- Application syntax checks and diff whitespace checks passed.

All writes used isolated test collections. This does not claim new testing
across physical computers or installed Timing/Telemetry applications.
