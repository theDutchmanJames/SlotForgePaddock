# Windows installer and portable

`npm run dist` builds both Windows x64 downloads. `npm run dist:installer`
and `npm run dist:portable` build them individually.

- `SlotForgePaddock-<version>-Setup.exe`: assisted, current-user installation,
  selectable application folder, desktop and Start menu shortcuts.
- `SlotForgePaddock-<version>-Portable.exe`: the existing self-extracting
  portable, with its unpacking splash.

Both run the same application and startup loading screen. Installation does
not require a different database format or a Timing/Telemetry update.

## Data and upgrade rules

Keep `appId` (`nl.slotforge.database`), package name (`slotforge-database`)
and product name (`SlotForge Paddock`) stable. The installer registration and
the existing Electron profile depend on those identities. The runtime retains
its established user-data path before changing its visible application name.

Application files belong in the installation folder. Collections, media,
settings, credentials, backups and shared-library discovery remain in their
existing locations outside that folder. Do not put personal files or manually
relocate a database into the installation folder: upgrades replace that folder.

The NSIS include in `build/installer.nsh`:

- limits installation to the current account;
- accepts an empty new folder or a folder marked for this application ID;
- rejects unrelated populated folders, a redirected installation directory,
  and database files directly inside the installation directory;
- refuses installation or uninstallation while the app process is running,
  including background/tray mode, rather than terminating it;
- retains app data on uninstall and rejects the explicit
  `--delete-app-data` command-line option.

Silent operations fail with 1618 while the app is running, 1603 for an unsafe
destination/check failure, or 1639 for unsupported options. Interactive users
can quit the app safely and retry.

Portable-to-installed migration uses the same Windows account and existing
profile/shared-library paths. Open the installed app once: the existing local
library publisher refreshes its background-launch registration to the installed
executable. Loose portable downloads are left alone. Uninstalling does not
remove the shared database needed by Timing; the removed executable cannot
provide Paddock's background service until Paddock is reinstalled and opened.

## Qualification, 15 November 2026

The actual NSIS installer was exercised with a separate QA application ID,
shortcuts and redirected application-data folders. Synthetic data contained
two cars, a photo, an accepted Timing result with laps, background settings and
a backup. The user's live profile/database was not used.

Passed:

1. Portable-first startup followed by installation: unchanged data files,
   identical logical collection, refreshed installed launcher registration.
2. Refusal to install into an unrelated populated folder.
3. Reinstall/upgrade refusal while the old app was running, without killing it
   or replacing its application archive.
4. Actual version upgrade from QA 91.0.0 to 91.0.1: obsolete application files
   removed; every existing data file retained byte-for-byte.
5. Upgraded app startup and registered background startup: the same original
   cars, photo, Timing history and settings loaded successfully.
6. Uninstall refusal while the background app was running, and rejection of
   explicit data deletion.
7. Uninstall/reinstall: all data and backups retained; original collection
   reopened; loose portable executable unchanged.
8. Final QA uninstall: test installation removed, test data retained.

The production Setup and Portable payloads were extracted and checked against
the corrected startup sources, including application-frame authorization.
Neither contains the QA bootstrap as its entry point. Full automated suite:
1,709 passed, seven skipped, zero failures. Integration coverage is from that
suite and the synthetic Timing history/launcher checks; these installer tests
did not run a live Timing or Telemetry UI against the user's collection.

Local evidence is in `.qa/installer-lifecycle/phase1.json`, `phase2.json`,
`.qa/installer-regressions.log`, and the installer build logs. QA identities,
fixtures and bootstrap files are excluded from production packages.
