# Dealership Mode — shared collections

Dealership replication is available in v0.19.0. The single remembered password and separate hosting controls described here are available in v0.20.0. Back up your collection before upgrading: schema-11 saves cannot be reopened in v0.18.x or older.

Run the same Paddock app on your home or club computers. Enable **Dealership Mode** on one computer: it holds the official collection, approves changes and serves Timing. Other trusted computers keep a separate saved copy of that collection. Their personal collection stays separate.

## Set up the dealership computer

1. Open the collection you want to share across your trusted computers.
2. In **Connections → Dealership Mode**, choose **Enable Dealership Mode…**.
3. Name the computer, choose and confirm a password (4–128 printable ASCII characters), and confirm that this collection may be shared in full. Paddock saves a recovery backup first and starts the Dealership.
4. Give Paddock and Timing the same displayed **address including its port** and **Dealership password**. Use **Start Dealership**, **Stop Dealership** and **Change password…** on this card. Existing Dealerships without a saved password first show **Set password…**.

Trusted club access includes private club ownership records, documents, stock, jobs, proposals and results. Give this password only to computers authorised to hold that complete collection. The password grants all application permissions, including public car browsing, submissions for review, private replication and Timing results. Legacy sharing credentials and controls are not used while hosting a Dealership.

## Turn Dealership Mode off

On the original collection, choose **Connections → Turn off Dealership Mode… → Back up & turn off**. This works even when hosting is offline or no password is configured. It stops Dealership hosting and removes the dealership banner and review routing. Cars, stock, setups, racing history and the same-computer shared library remain available.

A full recovery backup is saved first. Pending dealership proposals are not applied; they and previous dealership decisions remain in that backup. Other computers retain their saved copies but cannot submit to the old dealership. Enabling the mode again creates a new dealership connection.

**Stop Dealership** only pauses network hosting; it leaves the mode enabled. For a downloaded collection copy, use **Open personal collection** or **Disconnect from dealership…** instead.

## Join from another computer

1. Open **Connections → Dealership Mode → Connect to a dealership…**.
2. Enter the dealership computer's address and port, the dealership password, and a name for this computer.
3. Paddock downloads a separate club copy and opens it. **Open personal collection** returns to this computer's original collection; **Open saved collection copy** returns to the club.

Joining does not merge existing personal databases. To contribute personal cars, use the existing reviewed car-submission or file-import workflow. One saved club connection is supported per installation.

The host remembers its password across hosting and app restarts. Joined Paddock copies remember their connection password too; reconnecting pre-fills it. Hosting can select a different port after restart, so use the current address. A deliberate password change invalidates the old password and connected copies must reconnect with the new one.

## Save everyday changes; review important changes

- Routine changes save directly on both the dealership computer and connected copies: existing car fields, themes and preferences, inventory, Workshop jobs, shopping, documents and build drafts. Revision and stock checks still apply.
- New cars, duplicates, completed builds/rebuilds, saved setup changes, catalogue imports, bulk car/catalogue operations and permanent car deletion require approval. Their official records stay unchanged until approved.
- Update both Paddock instances and reconnect to enable direct member saves. Older pending proposals are retained for explicit review; they are not silently approved.
- **REVIEW → Dealership changes** lists pending changes and recent decisions. Only the dealership computer offers the approval controls.
- Review cards and comparison headings identify the affected car by name, with the operation and work/job title beneath it. Car references use stable identities; cars with identical names are not matched together.
- The comparison shows the original, current and proposed values. Blank initial fields and bookkeeping timestamps are omitted. Up to 200 changed fields are listed; **Full submitted change** exposes the complete command, replacing inline image/document bytes with a size description. Use smaller batches for large catalogue imports.

- Approval revalidates the command against the current database, including available stock. A failed validation does not partly apply a change.
- If approved content changed after the proposal was created, the dealership computer must explicitly confirm the fresh comparison. If it changes again while that comparison is open, the reviewer must reopen it.
- Conflict detection is deliberately conservative: a change anywhere in the approved collection can require confirmation. Queuing another proposal alone does not create a content conflict.
- Direct existing-car edits send changed fields and reject stale revisions. Lost acknowledgements retry the same durable command. Review remains available for proposals queued by older versions.

Routine saves do not grant permission to bypass important-change approval. The private `/v1/club/commands` route requires the existing Dealership credential, correct database identity and current recovery epoch; `/v1/club/status` advertises `routineWrites: 1`. Timing and Telemetry do not use this private route.

Incoming public car packages keep their existing **Incoming cars** review workflow on the dealership computer. Finalised Timing sessions use the same Dealership password and the existing Timing API: results reviewed in Timing are stored directly by the dealership computer and then distributed to connected club copies. They do not require a second Dealership changes approval.

### Incoming cars: select fields and return replaced stock

Under **Review → Incoming cars**, technical specifications are separate choices.
For example, accept a pinion or tyre update while leaving the driven gear and
front tyres unchanged. Existing text values may be replaced directly.

A change that conflicts with a fitted inventory component starts unchecked and
shows **Returns fitted stock**. Selecting it explicitly authorises returning the
fitted quantity to **Used spares** before applying the incoming specification.
An individual part retains its inventory identity; quantity stock is returned as
a separate used lot. Owned quantities are conserved. The new specification is
text: it does not automatically fit a different inventory item.

For an assembly component, only that component is released. Other components
stay fitted and grouped. If the final component is released, the empty assembly
is retired. Removal history and earlier setup snapshots are retained.

**Select changes without stock returns** selects ordinary changes; stock returns
still require an individual selection. **Clear selection** leaves every field
unchecked. A stale comparison or failed save applies neither the field edits nor
the stock returns. Approval on the dealership computer persists and replicates
both together.

## Quiet updates and disconnected computers

While connected, Paddock keeps one notification stream open. A database change sends a small revision notification; the computer requests the corresponding changes and saves the verified result. Unchanged photographs and records are not resent. A small heartbeat every 15 seconds checks the connection. An idle shared-club connection does not repeatedly download the database.

If a computer reconnects with a different revision, a prominent **This shared copy is out of date** banner appears. The saved copy remains available for browsing, but new edits are blocked. **Back up & update…** shows the revisions and asks permission before replacing the club copy. The update preserves the personal collection and any unsent proposals. If the dealership computer changed again before confirmation, Paddock asks for a fresh confirmation.

A disconnected copy is available for reading. This first implementation does not support starting new offline edits, automatic host election or multiple independent writable hosts. If the dealership computer is unavailable, reconnect to it when it returns; do not promote an outdated copy.

## Delivery, backups and recovery

Proposals are saved in a durable local outbox before sending. The dealership computer saves each receipt before acknowledging it. Retrying the same proposal does not create a second review item, including after restart or a lost acknowledgement.

In Connections, **Retry saved proposals** resends an uncertain delivery. **Discard unsent proposals…** saves a separate recovery file before clearing the retry queue. Discarding a retry does not cancel a proposal that the dealership computer already received: reject that proposal in Review if necessary.

Data files live beside the application's normal database:

| File or folder | Purpose |
| --- | --- |
| `database.json` | This installation's original collection, or its official dealership collection |
| `club-copy.json` | Separate saved club copy, marked as a replica |
| `club-device.json` | Computer identity, remembered host/connection passwords, pairing information and durable outbox; local to this installation |
| `club-backups/` | Recovery snapshots before setup, replacement or leaving, and explicitly discarded outboxes |

The latest recovery path is shown in Connections. These are private files. Normal complete backups include private collection data. A copy omits the dealership computer's Timing capture-signing secret and cannot re-host or become a dealership computer through ordinary backup restore. Replacing a live club database with a general backup is blocked. Dealership transfer/disaster recovery is not automated in this first implementation; retain the dealership computer's profile and backups.

The database schema is now 11. Older collections migrate on opening and save in the new schema on their next change. Keep a backup before returning to an older app version; old releases cannot read schema 11.

## Timing and network scope

Point Timing at the **dealership computer's address and current port**, using the same remembered Dealership password as Paddock. It authorises results immediately, with no additional enable switch or Timing password. Reconnect with the current address if the port changes. Current Timing source accepts passwords of 8–128 characters; accepting 4–7 character Dealership passwords requires its small validation update. The Paddock Timing v1 contract is unchanged. Approved catalogue changes and finalised results become visible in connected club copies. Timing's live browser, local racing cache and outgoing queue remain the responsibility of the Timing app.

Club connections use private/local IPv4 addresses and existing local-network HTTP sharing. They are not an encrypted or internet-facing service. A shared club password authorises a trusted computer; the displayed computer name is not a verified individual account. No remote-access service is added. Guest Wi-Fi isolation or a firewall can prevent local connections.

Current limits: 10 notification streams, 200 pending proposals, 5,000 retained review identities, 16 MiB per proposal, and the existing 200 MiB database limit. The recent change journal retains at most 32 revisions / 32 MiB; a gap requires a confirmed snapshot update. Review history is retained to recognise retries; automatic archival is not implemented.

## Validation

Automated tests use independent databases and real HTTP connections on one Windows computer. They cover three-instance propagation, conflicting edits, stock contention, approval/rejection, persistence failures, lost acknowledgements, restart recovery, outdated-copy confirmation, permissions, malformed requests, Timing result copies and incremental updates without repeating photographs.

Electron tests exercise the actual Connections, car editor and Review screens. Physical three-computer Wi-Fi operation and this feature's native macOS/Linux behaviour still need hands-on testing.

Before using a live club collection, try a small disposable collection on the three computers: propose competing edits, approve one, review the other's conflict, then disconnect a copy, change the dealership computer and reconnect. Confirm that the outdated warning and recovery backup appear before replacement.


Collection recovery files created before enabling, replacing or leaving a Dealership now use verified `.sfpbackup` containers. Asynchronous paths write them in a background worker. Pending/reviewed proposals stored in the collection are included; device passwords, pairing and unsent-device queues remain separate. The unsent-proposals recovery file retains its JSON format. See [portable backup and recovery](PORTABLE-BACKUPS.md).
