# Paddock → Timing integration handoff

**Contract: Timing integration v1.** This is the Paddock host implementation, not the Timing client. Existing car sharing, car submission review, JSON imports and manual performance records remain separate.

**New client brief, 1 November 2026:** [Dealership Mode handoff for Timing](DEALERSHIP-MODE-HANDOFF.md). Timing's scope is to browse public cars, select them for racing and return finalised results. The brief explains Paddock's club replication for context, the separate permissions, and the public API's current refresh limitations. Dealership Mode is included in v0.19.0.

Start with [CONTRACT.md](CONTRACT.md). The exact request/response shapes and limits are in [timing-v1.schema.json](timing-v1.schema.json). [Fixtures](fixtures/) contain artificial, executable examples. [TESTING.md](TESTING.md) records validation and limitations.

**Catalogue refresh upgrade, 1 November 2026:** Optional `catalogueRevision` is included in v0.19.0. Timing can skip catalogue downloads after private edits or race-result uploads. See [CATALOGUE-REVISION-HANDOFF.md](CATALOGUE-REVISION-HANDOFF.md) for semantics, compatibility and cross-project test results. The schema and status/collection fixtures have been updated; session requests remain v1.

The 31 October review tightened measured-lap validation across heats and added the receipt warning `SESSION_REQUIRES_CORRECTION` for earlier stored sessions with overlapping intervals. Such sessions retain their original payload but contribute no statistics until corrected or withdrawn. See the contract for recovery semantics. Valid v1 request shapes are unchanged.

## Connect in five steps

1. For Dealership Mode, enable it in Connections and choose a password. Use the displayed address **and dynamic port** plus that same remembered **Dealership password** in Timing. It authorises results immediately (`permissions.timingResults: true`) and survives host restarts. A legacy sharing host still uses its dedicated temporary Timing credential.
2. Timing's Electron **main process** discovers hosts or accepts an address, then calls `GET /v1/status` with `Authorization: Bearer <code>`. Pair with the returned database `id`; persist that identity. Check `capabilities.timing.versions` contains `1` and `permissions.timingResults` before uploading. Older hosts without Timing capabilities still support collection browsing.
3. Browse `/v1/collection` using the existing pagination protocol. Fetch `/v1/timing/cars/{carId}` with `X-SlotForge-Database: <paired-id>`. Cache the public car profile and the **entire opaque configuration object** locally. Refresh/capture before a race when connected; if racing from cache, retain the actual cached capture and show its age. Do not fabricate a fresh capture timestamp.
4. After Race Director review, save a complete session locally and queue `POST /v1/timing/sessions`. Supply the immutable pre-race capture for each linked physical car. Queue retries retain the same source ID, session ID, revision and JSON content. Never change a payload while keeping its revision.
5. Persist the successful receipt. To correct results, upload a **complete replacement** with a higher revision. To withdraw, send the small withdrawal envelope with a higher revision. Failed transfers stay in Timing's outgoing queue. Paddock persists before acknowledging.

## Minimal Node request

```js
// Run in Electron main. Do not send Origin or use a renderer fetch.
const headers = {
  Authorization: `Bearer ${connectionCode}`,
  'X-SlotForge-Database': pairedDatabaseId,
  'Content-Type': 'application/json'
};
const response = await fetch(`${hostAddress}/v1/timing/sessions`, {
  method: 'POST', headers, body: JSON.stringify(savedSession),
  redirect: 'error', signal: AbortSignal.timeout(15000)
});
const receiptOrError = await response.json();
// Only mark delivered after a 200 receipt with matching database/source/session/revision.
// See CONTRACT.md for how to handle stale revisions, conflicts and retryable failures.
```

`hostAddress` is `http://<private-IPv4>:<actual-port>` or localhost for development. Do not hard-code a port or follow redirects. Apply a response-size limit in the production Timing client. Profile pictures can be up to 12 MiB of data-URL text; a 16 MiB profile response cap is sufficient for this contract. Collection transfers use their existing 32 MiB/page response cap.

## What Timing implements

- Connection UI, discovery client, pairing and capability negotiation.
- Persistent installation ID, linked-car cache, class mapping and stable `(databaseId, carId)` identity.
- Configuration capture and association with each session participant.
- Reviewed session serialization, revision ownership, corrections/withdrawals and durable outgoing queue.
- Local racing when offline; a network fault must not interrupt race execution.

Paddock owns physical cars and configurations. Timing owns measurement and classification. Simulated fuel, wear, damage, failures and Virtual Rival settings stay in Timing. They do not modify Paddock inventory, maintenance or workshop jobs.

## Try the examples

From the Paddock repository, run `node scripts/timing-demo-host.cjs`. This starts an **isolated artificial database** and prints its address and temporary Timing code. Use the provided JSON fixtures unchanged against that host. Normal → correction → withdrawal share one session identity and increasing revisions. Multi-heat and endurance use independent session IDs. A normal session with optional cross-checked statistics is also provided.

Do not send unchanged fixtures to a real collection: their database/car IDs and signed configurations intentionally belong only to the demo database. A real client must fetch real profiles and build its own payloads.

Release v0.17.0 includes this host API. The older v0.16.3 executable predates it. The Timing client must still be implemented and tested in the Timing project.

## Custom password compatibility

Dealership passwords are remembered and accept 4–128 printable ASCII characters. Timing source inspected on 1 November 2026 accepts 8–128 characters: use at least eight until Timing lowers its minimum to four and updates the connection wording. The request header and endpoints are unchanged. Legacy custom credentials remain session-only with an eight-character minimum. See DEALERSHIP-MODE-HANDOFF.md for the precise client change.
