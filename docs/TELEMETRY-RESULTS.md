# Telemetry result downloads v1

Paddock now provides a read-only analysis API for delivered Timing sessions. Use the existing Dealership address and password; no extra toggle or credential is required. Legacy sharing retains its Timing credential.

The API preserves original laps, drivers, lanes, heats, validity/pit flags, classifications and the configuration captured before racing. It supports filtered session browsing, corrections, withdrawals, consistent paginated downloads, a lightweight change check and optional server-sent notifications. Telemetry owns the offline cache and analysis UI.

The original minimal Telemetry endpoints remain supported, with additive snapshot tokens and metadata. Paddock owns the host implementation; do not reapply the older Telemetry host installer over it.

- [Integration handoff](../integration-handoff/telemetry-v1/README.md)
- [Exact contract and client synchronisation rules](../integration-handoff/telemetry-v1/CONTRACT.md)
- [JSON Schema](../integration-handoff/telemetry-v1/telemetry-v1.schema.json)
- [Fixtures](../integration-handoff/telemetry-v1/fixtures/index.json)

Available from Paddock v1.0.1; v1.0.0 binaries do not contain it. No database migration is required. Automated tests use local HTTP and artificial databases; physical two-computer Telemetry acceptance is separate.
