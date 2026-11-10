# Development

Use Node.js 24 or newer. Install locked dependencies with `npm ci`, run `npm run check` and `npm test`, and start the desktop app with `npm start`. Use an isolated test profile for destructive or migration tests; never use a personal collection as a test fixture.

Production code lives in `src`, `renderer` and `packages/shared-library`. Tests and synthetic protocol fixtures are retained in `tests`; they are not included in packaged apps. Build scripts and the native release workflow are described in [Building installers](BUILDING.md).

Coordination handoffs, design drafts, test output and historical review notes are kept outside the published source. Release notes are on the [GitHub releases page](https://github.com/theDutchmanJames/SlotForgePaddock/releases).
