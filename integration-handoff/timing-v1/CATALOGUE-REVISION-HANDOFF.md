# Paddock catalogue revision upgrade — 1 November 2026

Included in Paddock v0.19.0 in response to Timing's catalogue handoff. No Timing source was changed.

## What Timing receives

- Optional `catalogueRevision` on authenticated `GET /v1/status` and every `GET /v1/collection` response, paged or unpaged.
- A persistent nonnegative safe integer, updated atomically only when the public collection projection changes. Approved car changes trigger refresh; pending/rejected changes, private history and saved Timing results do not.
- Existing whole-database `revision`, pagination query parameters, 409 handling, credentials and result permissions remain unchanged. Sharing protocol 2 and Timing integration v1 remain unchanged.
- A consistent counter across pages of an accepted transfer. Private changes during pagination still invalidate the old whole-database revision.

Timing's supplied implementation already supports this optional counter. Keep its fallback to `revision` for older hosts, compare inequality, and save the counter from the complete transfer. Do not add extra polling or private club access. Profile capture before racing remains necessary: the collection counter does not describe profile-only availability or configuration signatures.

The exact projection, migration, restore and compatibility rules are in [CONTRACT.md](CONTRACT.md#catalogue-refresh-revision-additive-1-november-2026). The response schemas are `$defs.status` and `$defs.collection` in [timing-v1.schema.json](timing-v1.schema.json). Updated examples:

- [Status](fixtures/status-response.json)
- [Collection first page](fixtures/collection-page-1.json)
- [Collection final page](fixtures/collection-page-2.json)

## Verification

- Paddock: **314 automated tests passed**, including 11 focused catalogue-revision tests; application syntax checks passed.
- Timing: **68 existing Paddock-client tests passed with no skips**, run with `PADDOCK_SOURCE` pointing to this working source. These include actual Paddock HTTP and discovery tests.
- An additional actual-client/local-host check confirmed: initial catalogue download; status-only check after saved race results; status-only check after a private edit; catalogue refresh after a public rename.
- Club-copy tests verify that pending proposals retain the previous counter and approved changes deliver the authority's updated counter to both copies.

Tests used isolated artificial databases and local sockets on one Windows computer. Physical multi-computer Wi-Fi acceptance and native macOS/Linux acceptance of this upgrade have not been performed. The app UI is unchanged by this upgrade.
