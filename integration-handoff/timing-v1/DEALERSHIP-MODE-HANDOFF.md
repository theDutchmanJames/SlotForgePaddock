# Brief for the Codex instance working on SlotForge Timing

**Prepared 1 November 2026 against Paddock's current working source.** Dealership Mode is included in v0.19.0. The existing Timing integration v1 API remains unchanged.

Please inspect Timing's existing Paddock integration first, then implement or adapt only the missing work described below. Preserve working connection, cache, race-selection and result-delivery code rather than building a second integration.

## The user's requested scope

Timing needs to do exactly three things:

1. **View the connected Paddock database's public cars.**
2. **Select those cars for racing in Timing.**
3. **Send finalised race results back to that Paddock database.**

The user should be able to browse Paddock cars directly from Timing's car-selection workflow, select a car, race, then finalise the results. They should not need to export/import a JSON file or manually create a duplicate car first.

Local caching, configuration capture and reliable result delivery support this workflow. They are implementation details, not additional database-management features for the user.

**Timing does not edit Paddock cars, manage parts, synchronise whole databases, approve club changes or implement Dealership Mode.**

## Context only: what Dealership Mode does in Paddock

The same Paddock app can run on a main club computer, a personal computer and a racing laptop. One computer runs **Dealership Mode** and holds the official club collection. Other trusted Paddock instances keep separate saved copies of that collection. Their personal collections remain separate.

Catalogue/workshop edits from those instances, including the dealership computer, enter Paddock's Review system as proposals. Approved changes become official; rejected changes do not. Review detects intervening changes and rechecks stock before approval. Connected Paddock copies receive incremental updates through a private notification stream. An outdated returning copy gets a warning and requires a confirmed, backed-up replacement.

**All of this is Paddock's responsibility. It is background context for Timing, not a Timing implementation task.**

Timing connects directly to the **dealership computer's actual address and port**. Running Paddock on the racing laptop is optional. Timing must not read that laptop's `club-copy.json`, use its cached database as a host, or copy any Paddock database files. There is no automatic host failover in this phase.

Timing sees the official public car records, not pending edit proposals. Finalised results reviewed in Timing go directly into Paddock through the dedicated Timing results API. They do **not** wait for a second approval in Paddock's Club changes review. Paddock then distributes those stored results to its connected copies.

Full Paddock feature context: [Shared club collections](../../docs/SHARED-CLUB.md).

## Connection and permissions

On the dealership computer, the user enables Dealership Mode, chooses a password, and supplies that same **Dealership password** to Paddock and Timing. Dealership hosting has its own start/stop controls; legacy sharing controls are hidden and inactive.

- Use the **single Dealership password**. Status returns `{browse: true, submit: true, timingResults: true, club: true}`. Timing should continue using only catalogue/profile and timing-session routes. No private replication implementation is requested.
- Make requests from Electron **main**, not the renderer. Paddock rejects any `Origin` header; do not weaken that protection.
- Use the local HTTP address with its actual port. The host selects a dynamic port; never hard-code it. Discovery and manual entry are both supported by the existing contract.
- Treat credentials as opaque, case-sensitive text. Dealership passwords are 4–128 printable ASCII characters, without leading/trailing spaces. Current Timing `paddock.js` requires at least eight: lower its credential validator and any form minimum to four, update matching tests, and label the connection input "Dealership password" (with legacy Timing-code compatibility). Existing eight-character-or-longer passwords already work.
- Call `GET /v1/status` to establish the database identity and permissions. Persist the returned database `id` as the pairing identity.
- Check that `capabilities.timing.versions` includes `1`. Check `permissions.timingResults` before uploading. Read-only access can still browse cars; ask for the Dealership password (or a dedicated Timing credential on a legacy host) if results permission is false.
- Current Dealership hosts additionally advertise `capabilities.club: 1` and `clubId`. These describe Paddock's club-copy feature. Do not require them for ordinary Timing v1 compatibility, and do not use `clubId` instead of the database `id`.
- Addresses, ports and names may change. Reconnect to the same database identity; never silently pair with a different database found at an old address. Keep queued results tied to their original database.

The Dealership password is remembered on the host across restarts. A deliberate password change revokes old access; ports can still change on restart. Legacy hosts continue rotating their temporary codes/passwords. Retain queued results and existing permission checks, database identity checks and retry semantics. No catalogue or results protocol rewrite is needed.

## Browse and select cars

Expose the connected collection inside Timing's existing Slotcar Database and race car selectors. A label such as **Paddock · [collection name]** should make the source clear. Reuse existing class-selection behaviour while retaining Paddock's public race-class label.

Use these existing endpoints:

| Request | Timing's purpose |
| --- | --- |
| `GET /v1/status` | Check identity, capabilities, permissions and database revision |
| `GET /v1/collection` | Browse the public car catalogue |
| `GET /v1/timing/cars/{carId}` | Get the selected car's public profile and signed current-configuration snapshot |
| `POST /v1/timing/sessions` | Submit a reviewed session, complete correction or withdrawal |
| `GET /v1/timing/sessions/{sourceId}/{sessionId}` | Reconcile an uncertain delivery or revision conflict |

Every request uses `Authorization: Bearer <Dealership password>`. All `/v1/timing/*` requests also require `X-SlotForge-Database: <paired database ID>`.

For collection pagination, send `X-SlotForge-Pages: 1`. Follow `nextOffset` with `?offset=N&revision=R&database=ID`. Validate that all pages have the same identity and revision; restart a changed transfer on HTTP 409. Replace the local catalogue cache only after a complete, verified transfer. Never replace a good cache with half a download.

Identify each linked car by **(Paddock database ID, Paddock car ID)**. A name change updates the displayed name, not the link. Avoid duplicate local entries on refresh. Timing-owned cars remain independent. If Timing's existing selectors need local rows, use linked cached records internally; do not require a separate manual import step.

Archived cars are omitted from the collection listing; direct profiles report archive status. A disappeared or archived car should no longer be offered as an ordinary fresh selection, but retain its historical race association and queued results. Never relink by name.

### Refresh without flooding the network

The private `/v1/club/events`, `/v1/club/changes` and `/v1/club/snapshot` routes belong to Paddock replication. **The shared Dealership password authorises them, but Timing does not need them and should continue using its existing public catalogue flow.**

Timing v1 currently has no public catalogue push feed. Implement the requested browsable connected database using:

- Refresh on connection, opening the Paddock browser, and an explicit Refresh action.
- A fresh profile/capture check before starting a race when connected.
- If automatic browser refresh is needed, a single modest status check while the browser is visible—for example, every 30–60 seconds, with backoff on errors. Reload only when `catalogueRevision` changes, falling back to `revision` when either side lacks the optional counter. This interval is a client recommendation, not a server requirement.

The status `revision` covers the whole database: a queued proposal or saved result may change it even when public car details have not changed. Updated working source also exposes `catalogueRevision` on status and collection responses, so those private-only changes need no catalogue download. Pagination still uses `revision`. Neither counter is a car-configuration identity. See [the catalogue revision handoff](CATALOGUE-REVISION-HANDOFF.md).

Do not continually scan for hosts, fetch full catalogues each second, or poll separately for every car. If true push-based catalogue updates are desired later, ask Paddock for a separately permissioned public event endpoint; that endpoint does not exist today.

## Keep racing independent of the connection

Cache selected public profiles locally. Before racing, fetch and store the **entire opaque `configuration` object** from the profile endpoint, associated with that race participant.

Pin that configuration for the race. Do not replace it when the live catalogue refreshes, when Paddock approves a later edit, or when an upload retries. Paddock must receive the configuration actually selected for that race, not today's configuration.

A network outage must not interrupt race control, lap measurement or local result saving. Racing from a previously captured cached profile can continue with a clear offline/last-updated indication. Preserve its original capture time. If a car has no valid captured profile, do not invent one; clearly distinguish a local/unlinked entry from a Paddock-linked entry.

Timing v1 exposes current configurations only. Do not implement a Paddock saved-setup selector or fabricate a signature. Physical setup work remains in Paddock.

## Return finalised race results reliably

After the Race Director reviews and saves the session:

1. Save the reviewed session locally first.
2. Persist an outgoing item containing the target database ID, installation/source ID, stable session ID, revision and complete payload.
3. Submit asynchronously to `POST /v1/timing/sessions` using the captured participant configurations.
4. Verify the receipt's database/source/session/revision before marking delivery complete. Retain the receipt and enough local evidence to reconcile uncertain delivery.

The queue must survive Timing restarts. An uncertain transfer retries the same identity, revision and content. Corrections send a complete replacement with a higher revision; withdrawals send the documented higher-revision withdrawal envelope. Do not create a new session ID merely because a transfer failed.

Keep visible delivery states such as **Waiting to send**, **Sent** and **Needs attention**. Network failures back off and retry; permission failures need renewed access; validation failures need correction. Handle `STALE_REVISION` and `REVISION_CONFLICT` by querying the receipt and reconciling, not by endlessly retrying or silently inventing a newer revision.

Use the exact v1 schema for multiple heats, driver changes, laps, penalties and final standings. Milliseconds are integer durations, metres are distances, lanes are one-based, and timestamps are UTC ISO 8601 with millisecond precision. Measured lap performance and adjusted classification remain distinct. Invalid/pit laps cannot set records. Virtual Rivals must not contribute to a physical Paddock car's mileage or results.

Simulated fuel, tyre wear, damage and failures remain in Timing. Sending results must not modify Paddock's physical stock, maintenance or configuration.

A v1 session targets one Paddock database. Do not silently split one race into several host submissions or treat another database's car IDs as belonging to this host. Preserve unrelated/local participants using the contract's unlinked-participant rules where appropriate.

## Exact contract, examples and testing

Read [CONTRACT.md](CONTRACT.md), [timing-v1.schema.json](timing-v1.schema.json) and [the existing integration guide](README.md). This brief explains the intended client workflow; it does not redefine the wire format.

The [fixtures directory](fixtures/) includes normal, multi-heat and endurance sessions, a correction, a withdrawal, profiles, receipts and error examples. Fixtures use artificial database identities and signed captures. Do not send them unchanged to a real club collection.

From Paddock's source folder, `node scripts/timing-demo-host.cjs` starts an isolated in-memory Timing API host and prints its address and temporary credential. It supports the existing v1 fixture tests; **it does not enable Dealership Mode or simulate Paddock copy replication**. Use isolated Paddock profiles for the joint Dealership test.

Acceptance checks for Timing:

- Browse connected cars and select them through normal race selectors without a manual import.
- Rename a Paddock car: refresh its existing linked record without duplicating it.
- Leave a Paddock edit pending: Timing continues to see the approved record. Approve it: the next refresh shows the updated record.
- Capture a car, start racing, then approve another configuration change in Paddock. The race and submitted result retain the original capture.
- Disconnect during a race, finalise offline, restart Timing and reconnect. Deliver the saved result once; duplicate delivery must not double-count it.
- Correct and withdraw a result; replay an older queued item without resurrecting it.
- Test new host ports/passwords, denied result permission, another database at the old address, archived/missing cars and failed pagination.
- Include multiple heats, endurance driver changes, invalid/pit laps and a Virtual Rival.
- Verify that Timing never requests a private club snapshot or reads Paddock's database files.
- Finally test actual Timing → dealership computer → connected Paddock copies across physical computers. Results should appear against the correct car and original configuration in all updated copies.

Paddock's local validation passed 303 automated tests and 181 desktop workflow checks; those are not proof of the actual Timing client or physical Wi-Fi integration. Report the Timing files changed, its automated test results, any missing Paddock capability, and whether real multi-computer acceptance has been performed.
