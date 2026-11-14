# Quick Links

Quick Links is the last header button on Parts, Build from Scratch, Workshop,
Shopping List and Library → Parts catalogue. Search the grouped list and select
a website to open it in your default browser. Opening a link leaves the current
page and unfinished build intact. Escape or a click outside closes the menu.

The bundled shortcuts include manufacturers and suppliers. Where a link goes to
a retailer rather than the manufacturer, its label identifies that retailer.
Some manufacturers provide only a homepage or catalogue landing page.

Choose **Manage links…** to add a personal website, edit a destination or name,
move it between groups, or hide it from the menu. Expand an entry to edit it.
**Save links** saves the changes; **Cancel** discards them. Personal entries can
also be removed. **Restore bundled defaults** restores the included links while
preserving personal entries; save to keep that choice.

These preferences are stored in `quick-links.json` inside Paddock's desktop
profile. They are independent of collection switching, Review, Dealership Mode,
Timing and Telemetry. Collection backups do not include them. No website is
contacted when opening the menu; only selecting a shortcut opens the browser.

## Implementation and verification

- The main process validates names, groups, identifiers and HTTP/HTTPS addresses.
  Other protocols and embedded credentials are rejected. At most 200 personal
  links are supported.
- Opening resolves a saved, visible link identifier in the main process. The
  renderer cannot use this IPC handler to open arbitrary filesystem paths.
- Preferences use an atomic replacement and revision checks. Invalid data and
  unreadable files are not silently overwritten. The IPC route checks the trusted
  application frame and does not refresh or mutate a collection.
- Unit coverage: saved/reloaded preferences, conflicting edits, defaults,
  limits, unsafe addresses, hidden/missing links and corrupt-file preservation.
- Isolated Electron coverage: all five locations, search, keyboard controls,
  browser dispatch, management, cancellation, dark/light layouts, reload and
  preservation of unfinished builds. Browser dispatch is mocked in these tests.

Run `node --test tests/quick-links.test.cjs` and
`electron . --smoke --quick-links-only`. The latter uses the isolated `.qa`
profile and must never target a personal collection.
