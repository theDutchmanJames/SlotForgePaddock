# Startup feedback

All desktop builds start loading `renderer/opening.html` alongside collection preparation.
Database startup does not wait for the loading window to paint.
The main window stays hidden until its renderer has populated the first screen
(or rendered its database error). The loading window closes after the main window
is shown. Background-library launches keep both windows hidden. Closing the
loading window uses the normal coordinated shutdown, including pending writes.

The first-screen handoff accepts only IPC from the trusted main frame. Windows
file URLs normalize drive-letter casing and equivalent percent-encoded unreserved
characters (including the tilde in Windows short paths) to match Chromium; different windows,
child frames, paths, queries and fragments remain rejected. Renderer
crashes and load failures follow the startup error path. A 30-second handoff
timeout reveals the main window's existing “Opening your collection…” message
instead of terminating a slow query. A missing loading-page asset cannot block
database opening indefinitely.

Windows single-file portable builds additionally show `assets/startup-splash.bmp`
while NSIS unpacks the application. Regenerate that asset with `npm run build:splash`
after changing the loading-page branding. It is a 500×340, 24-bit bitmap generated
from the same HTML/CSS and approved application artwork; there are no estimated
percentages. This static splash ends before Electron starts. A short process-launch
gap between the two windows remains possible.

`scripts/portable-splash.cjs`, configured as the packaging `afterPack` hook, adapts
the pinned electron-builder portable template to enter silent mode for the existing
`--slotforge-library-start=` command. That prevents an extraction splash during
Timing's automatic background launches without adding arguments to the protected
launcher contract. The hook leaves non-portable targets alone and fails the build
if the expected template structure changes. Requalify this hook when upgrading
electron-builder. Do not change registrations to add `/S`: existing Timing clients
validate the argument structure.

Validation:

- `node --test tests/startup-feedback.test.cjs tests/local-launcher.test.cjs`
- `electron tests/startup-window-smoke.cjs` (normal, `--scenario=cancel`,
  `--scenario=database-error`, `--scenario=background`)
- The same smoke supports `--app-root=<absolute resources/app.asar>`.
- Build the Windows portable target and verify the extraction splash and silent
  background launch separately. Smoke tests use isolated profiles and library roots.

This changes startup presentation only; collection schemas and integration payloads
are unchanged. The portable still extracts on each launch.
