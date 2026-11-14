# Assembly photographs

Assemblies have one optional `picture` using the existing PNG/JPEG/WebP data-URI asset representation. No database schema version changes. Old records can omit it; an empty string means no photograph. Originals remain deduplicated SQLite assets, outside working metadata. Dismantling keeps the photograph on the historical assembly record.

## Desktop workflow

- Parts → Assemblies → Build assembly includes an optional photograph chooser.
- Existing cards offer Add photograph / Edit photograph. Choose or remove the image, then Save photograph; Cancel preserves the original.
- Cards use bounded 512px previews. Clicking a photograph opens the original in a fitted viewer. An assembly icon appears without a picture.
- Photo edits work in storage and while installed. They do not move stock, change components, update car specifications or add maintenance, setups or race records.

The manual chooser checks actual format, source size, dimensions and animation/container markers before asking a dedicated renderer worker to decode the image. Only one admission decoder runs, with a ten-second deadline and termination on timeout. Files must fit the existing 12 MiB encoded-image budget (approximately 9 MiB source), 24 million pixels and 16,384 pixels on either side. Oversized originals are rejected, never silently resized. Originals are unchanged; preview derivatives preserve proportions and transparency and do not enlarge small images. These new admission limits do not retroactively invalidate older stored assets.

## Internal commands and concurrency

`assembly.create` accepts an optional `picture`. It remains an atomic component-reservation command using its existing collection revision check.

`plan('assembly.photo', {id})` returns the selected assembly's picture, database ID, recovery ID, collection revision and picture hash. The renderer uses only the four baseline fields below in the save payload:

```json
{
  "id": "assembly-id",
  "expected": {
    "databaseId": "database-id",
    "recoveryId": "recovery-generation",
    "revision": 123,
    "pictureHash": null
  },
  "picture": "data:image/png;base64,...",
  "replaceExisting": false
}
```

Send this through the existing `assembly.photo` mutation and durable command envelope. A renderer-issued media URL is expanded by the existing trusted media boundary; URLs are not stored as photographs. Removal uses `picture: ""` and `removeConfirmed: true`. Replacement of an existing photo needs `replaceExisting: true`. Other mutation fields are rejected.

The save checks identity, recovery generation, baseline retention/future revisions, current picture hash and SQLite field versions (including change-away-and-back conflicts). Unrelated location or stock changes do not invalidate the photo baseline. Missing or dismantled targets are not recreated. Identical images are no-ops. The existing receipt mechanism handles uncertain retries before rechecking stale baselines.

The normal deferred save changes only the selected assembly and collection revision. It does not load the complete stock dependency group. Its original bytes use the existing media, backup and retention paths. Full-image decoding happens at the manual chooser; domain writes also enforce encoded-image, dimensions and container/frame bounds. Existing legacy backup validation remains compatible.

## Dealership and integrations

Manual assembly photographs are routine changes, not Review proposals. `/v1/club/status` advertises the additive private capability `assemblyPhotos: 1`. A connected client checks it before creating an assembly with a picture or editing its picture. An older host receives neither command, preventing silent image loss on its older `assembly.create` implementation. Update the host and reconnect to enable these controls across Dealership connections. Ordinary photo-free assembly creation remains compatible.

This does not add a Timing or Telemetry endpoint, permission or payload field. It does not change car thumbnails, shared-library identities, result capture or technical configuration snapshots. Compatibility tests exercise the current Timing vendored engine writing a car in a database containing an assembly photograph.

Illustrated Catalogue requests, image-link downloads, picture-import Review and provenance journals remain for subsequent phases.
