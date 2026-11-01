# Dealership Mode — shared collections

Available in v0.19.0. Back up your collection before upgrading: schema-11 saves cannot be reopened in v0.18.x or older.

Run the same Paddock app on your home or club computers. Enable **Dealership Mode** on one computer: it holds the official collection, approves changes and serves Timing. Other trusted computers keep a separate saved copy of that collection. Their personal collection stays separate.

## Set up the dealership computer

1. Open the collection you want to share across your trusted computers.
2. In **Connections → Dealership Mode**, choose **Enable Dealership Mode…**.
3. Name the computer and confirm that this collection may be shared in full. Paddock saves a recovery backup first.
4. Start sharing. Give the other trusted computers the displayed **address including its port** and the separate **dealership code/password**. You can choose **Set dealership password…**.

Trusted club access includes private club ownership records, documents, stock, jobs, proposals and results. Give this password only to computers authorised to hold that complete collection. The existing public browse, car-submission and Timing permissions remain separate and do not grant this access.

## Join from another computer

1. Open **Connections → Dealership Mode → Connect to a dealership…**.
2. Enter the dealership computer's address and port, the dealership password, and a name for this computer.
3. Paddock downloads a separate club copy and opens it. **Open personal collection** returns to this computer's original collection; **Open saved collection copy** returns to the club.

Joining does not merge existing personal databases. To contribute personal cars, use the existing reviewed car-submission or file-import workflow. One saved club connection is supported per installation.

Passwords are held in memory for the running session. Reconnect after restarting Paddock. As with existing sharing, starting the host again creates new codes/passwords and may select a different port. Use the current details shown by the dealership computer.

## Propose, compare and approve

- Edits on a club copy **and on the dealership computer itself** become proposals. The official car or stock record stays unchanged until approved.
- **REVIEW → Dealership changes** lists pending changes and recent decisions. Only the dealership computer offers the approval controls.
- The comparison shows the original, current and proposed values. Blank initial fields and bookkeeping timestamps are omitted. Up to 200 changed fields are listed; **Full submitted change** exposes the complete command, replacing inline image/document bytes with a size description. Use smaller batches for large catalogue imports.
- Approval revalidates the command against the current database, including available stock. A failed validation does not partly apply a change.
- If approved content changed after the proposal was created, the dealership computer must explicitly confirm the fresh comparison. If it changes again while that comparison is open, the reviewer must reopen it.
- Conflict detection is deliberately conservative: a change anywhere in the approved collection can require confirmation. Queuing another proposal alone does not create a content conflict.
- Existing car edits submit only the changed fields, so approving a name change does not reset an unrelated configuration field. Other operations show their full effects for review.

Incoming public car packages keep their existing **Incoming cars** review workflow on the dealership computer. Finalised Timing sessions retain their existing separate permission and API: results reviewed in Timing are stored directly by the dealership computer and then distributed to connected club copies. They do not require a second Dealership changes approval.

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
| `club-device.json` | Computer identity, pairing information and durable outbox; no connection password |
| `club-backups/` | Recovery snapshots before setup, replacement or leaving, and explicitly discarded outboxes |

The latest recovery path is shown in Connections. These are private files. Normal complete backups include private collection data. A copy omits the dealership computer's Timing capture-signing secret and cannot re-host or become a dealership computer through ordinary backup restore. Replacing a live club database with a general backup is blocked. Dealership transfer/disaster recovery is not automated in this first implementation; retain the dealership computer's profile and backups.

The database schema is now 11. Older collections migrate on opening and save in the new schema on their next change. Keep a backup before returning to an older app version; old releases cannot read schema 11.

## Timing and network scope

Point Timing at the **dealership computer's address and current port**, using the existing Timing permission. The Paddock Timing v1 contract is unchanged. Approved catalogue changes and finalised results become visible in connected club copies. Timing's live browser, local racing cache and outgoing queue remain the responsibility of the Timing app.

Club connections use private/local IPv4 addresses and existing local-network HTTP sharing. They are not an encrypted or internet-facing service. A shared club password authorises a trusted computer; the displayed computer name is not a verified individual account. No remote-access service is added. Guest Wi-Fi isolation or a firewall can prevent local connections.

Current limits: 10 notification streams, 200 pending proposals, 5,000 retained review identities, 16 MiB per proposal, and the existing 200 MiB database limit. The recent change journal retains at most 32 revisions / 32 MiB; a gap requires a confirmed snapshot update. Review history is retained to recognise retries; automatic archival is not implemented.

## Validation

Automated tests use independent databases and real HTTP connections on one Windows computer. They cover three-instance propagation, conflicting edits, stock contention, approval/rejection, persistence failures, lost acknowledgements, restart recovery, outdated-copy confirmation, permissions, malformed requests, Timing result copies and incremental updates without repeating photographs.

Electron tests exercise the actual Connections, car editor and Review screens. Physical three-computer Wi-Fi operation and this feature's native macOS/Linux behaviour still need hands-on testing.

Before using a live club collection, try a small disposable collection on the three computers: propose competing edits, approve one, review the other's conflict, then disconnect a copy, change the dealership computer and reconnect. Confirm that the outdated warning and recovery backup appear before replacement.
