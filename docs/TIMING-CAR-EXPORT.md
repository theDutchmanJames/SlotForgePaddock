# Export cars from Paddock into Timing

This is a JSON file transfer. It does not require hosting, pairing or a network connection.

1. In Paddock, open a car and choose **More → Export this car**, or select several cars in **Cars** and click **Export**.
2. Set **Export format** to **SlotForge Timing**. Optionally include additional photographs.
3. Save `slotforge-timing-export.json`.
4. In Timing, open **App Settings → Import and Export**, expand **Import**, choose the file and confirm the import.

Timing imports cars and their race classes as **new copies**, with new Timing IDs. Importing the same file again creates more copies; it does not update existing cars or establish a live Paddock link. Names that clash may receive Timing's `(imported)` suffix.

## Included fields

| Paddock | Timing |
| --- | --- |
| Maker | Brand |
| Marque | Manufacturer |
| Model, or car name when model is empty | Model |
| Scale | Scale |
| Race class label | Included racing-class definition and remapped car reference |
| Current motor | Motor |
| Current rear tyres | Tyres; front tyres are not substituted |
| Valid pinion and driven-gear tooth counts | Gearing, for example `9/27` |
| Current weight | Weight |
| Main photograph | Main picture |
| Additional photographs, when selected | Extra pictures |

Paddock's car name is retained in the file's `name` field, but Timing builds its visible title from Brand, Manufacturer and Model. The current configuration is used; saved setups are not transferred.

Ownership, prices, storage, private notes, custom fields, technical notes, documents, inventory, workshop history and performance sessions are excluded. Other technical fields have no corresponding standard Timing field and are omitted. No simulated tyre compound, damage setting, lap counter or service counter is inferred from physical car records.

**SlotForge Paddock package** remains the default export format for Paddock-to-Paddock sharing, including its existing optional setup snapshots. Choose it when the recipient uses Paddock.

## Compatibility and validation

The exporter produces Timing's `slotforge-timing-export` format, `fileVersion: 1`, with `items.slotcars`, `items.raceclasses` and `customFields`. Export identities are scoped to the Paddock database and physical car, although Timing's file importer deliberately replaces those IDs when making copies.

Checked against the actual local Timing **1.99.4** `transfer.check` and `transfer.apply` implementation using an isolated database: multiple cars, racing-class remapping, rear tyres, gearing, repeated import and reopening persisted data passed. This verifies file compatibility, not the separate live Timing integration.

This option is available in updated Paddock source. The published v0.17.1 executable predates it.
