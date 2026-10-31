# Development & release history

## Review of changes since 0.16.2 — 31 October 2026

Reviewed the changes since the previous documented review: branding and release documentation, native installer builders, Build from Scratch gearing, motor performance calculations and comparison, and the Timing host integration. The review covered renderer behaviour, validation, database persistence and compatibility, network authentication and permissions, retry/correction semantics, generated schemas and handoff fixtures. Existing sharing, submissions, manual performance records and inventory workflows remain covered by the full regression suite.

| Priority | Confirmed issue | Correction |
| --- | --- | --- |
| P2 | A schema-valid session name containing many supplementary Unicode characters passed the API but failed storage validation. | Stored display names now use the same Unicode-aware schema validation as submissions, including after withdrawal. |
| P2 | One participant could have overlapping measured laps across different heats despite non-overlapping stints, inflating performance and mileage. | New submissions reject overlapping intervals across all heats. Previously accepted sessions remain readable and visibly require correction; the whole session contributes no statistics until corrected or withdrawn. |
| P2 | The first Timing configuration capture persisted its signing key and incremented the database revision without refreshing the desktop snapshot. | The host publishes a quiet revision change; the desktop refreshes without presenting a false incoming-car notification. Later captures do not write or notify again. |
| P3 | Extremely small positive motor/tyre values could produce infinite force or a zero-power curve with non-finite plotted coordinates. | Unrepresentable force is omitted and underflowing power curves are disabled with an explanation. Normal physical calculations are unchanged. |
| P2 | A quick native rebuild could treat untouched installers from a very recent previous run as fresh output. | Builders compare file metadata before and after packaging as well as checking size and modification time before reporting success or writing checksums. |

Regression evidence is in `tests/recent-code-review.test.cjs`, `tests/recent-code-review-smoke.cjs` and `tests/desktop-builder.test.cjs`. Existing boundary checks also confirm that trailing line terminators are rejected in Timing identifiers and signatures. No obsolete feature code was identified for removal in the reviewed additions.

The Timing v1 request format and database schema 9 remain unchanged. The response warning enum now includes `SESSION_REQUIRES_CORRECTION`; the contract, generated schema and handoff ZIP describe that compatibility case. Corrections continue to use a higher revision, and original accepted payloads remain intact while awaiting correction.

Validation: **253 automated tests and 154 isolated Electron workflow checks passed**, plus application syntax checks, with no captured renderer errors. The correction notice was visually inspected. Detailed results are recorded in [the integration testing report](../integration-handoff/timing-v1/TESTING.md). Testing uses a disposable `.qa/review-full-profile`, never normal user data or `.qa/test-collection`. Physical two-computer Wi-Fi, native macOS/Linux execution, power-loss behaviour and large sustained archives remain acceptance work. The existing v0.16.3 downloadable binary is not rebuilt by this review.

## Timing integration host — source update after 0.16.3

Paddock now exposes Timing integration v1 with explicit capabilities, a separate permission/code, signed current-configuration captures and a dedicated session API. Sessions use persistent source/session IDs and monotonic revisions. Identical retries are acknowledged without another write; corrections replace prior contributions, and withdrawals retain tombstones. Imported results are shown separately from manual tests with captured configurations, measured laps, classification, endurance drivers and revision history. Virtual entries do not affect physical-car statistics. Existing car sharing and submission review remain independent.

See the [integration handoff](../integration-handoff/timing-v1/README.md), [exact contract](../integration-handoff/timing-v1/CONTRACT.md), machine-readable schema and executable fixtures. This source update uses **database schema 9**, migrating schemas 1–8 in memory and saving with the existing recovery-copy mechanism. Older binaries cannot open schema-9 saves; keep a complete backup if retaining an older executable. Session records, withdrawal tombstones and the capture signing key are included in complete backups, never in public car exports.

Validation: 246 automated tests and 151 isolated desktop workflow checks passed, with no renderer errors. The integration-specific suite includes 23 local server/client and contract tests.

The Timing client is intentionally outside this repository. Local server/client and isolated desktop checks are documented in the handoff; physical two-computer acceptance, native macOS/Linux execution and power-loss testing remain outstanding. The existing synchronous whole-document persistence and 200 MiB cap remain; this bounded session API is not a high-volume streaming telemetry service.

[Back to the app overview](../README.md)

Technical notes, validation results and release history for SlotForge Paddock (formerly SlotForge Database). File paths and commands below are relative to the project root. Older release sections describe behaviour at that release; later sections may supersede them.

Working desktop copy, version 0.16.3. The official name is **SlotForge Paddock**.

## Theoretical build performance (after the first release)

Build from Scratch now accepts no-load RPM, torque in gf·cm, separate test voltages, motor/torque types and rear tyre diameter. A shared pure calculation model produces axle RPM, rollout, ideal speed, axle torque and force. A guarded linear brushed DC model adds peak power and interactive torque/power curves only for confirmed stall ratings at matching voltages. A frozen comparison reference is saved with the build draft. Specifications persist into car history and optional As built setups, are editable in Technical & parts, and follow the existing backup/sharing paths. Older drafts remain valid without new fields; schema 8 is retained. See [Theoretical performance](THEORETICAL-PERFORMANCE.md) for assumptions and formulas.

Validation includes 223 automated tests and desktop checks for curve endpoints, live updates, comparison references, voltage/type guards, draft reload, car creation, technical editing, immutable setups and light/dark layouts at 960/1440 pixels. This update is on the main branch and is not part of the original v0.16.3 Windows download.

## Build from Scratch gearing (after the first release)

The build page now calculates crown / axle gear teeth divided by pinion teeth. Counts can come from unambiguous catalogue specifications on loose parts or assembly components, with optional manual overrides. Part names are not parsed for numbers. Counts survive draft saves and complete backups, and are copied into the created car, creation history and optional As built setup. Existing drafts without gearing remain valid. Invalid counts are rejected before saving; neither gear is required for a partial build.

Validated at that stage with 216 automated tests and isolated Build from Scratch desktop checks, including live ratio changes, renderer restart, draft reload, car/setup persistence and 960/1440-pixel layouts. This source update is not included in the original v0.16.3 Windows download. Motor-RPM performance calculations were subsequently added as described above.

## Native installer builders (after the first release)

Linux and macOS now have normal and quick build launchers. Linux produces AppImage and Debian packages; macOS produces a universal DMG and ZIP by default, with optional Intel/Apple Silicon-only builds. See [Building installers](BUILDING.md) for prerequisites, commands, checksums and signing details. These additions are on the main branch; the original v0.16.3 release archive remains unchanged. Native installation testing is still outstanding.

## Run on Windows

Close any earlier copy, then open `dist/v0.16.3/SlotForge Paddock 0.16.3.exe` after packaging. No Node.js installation is needed for that executable. A new collection starts empty; existing collections are retained.

For development, double-click `Start SlotForge.cmd`, or run `npm ci` followed by `npm start` in this folder. If your npm installation skips dependency scripts, run `node node_modules/electron/install.js` once after installing dependencies.

## Official name — 0.16.3

The app is now **SlotForge Paddock**. The application header, window title, import wording, Windows executable name and GitHub homepage use the new name. Existing screenshots and historical release notes retain the branding of the version they show.

The internal package name, app ID, database schema and exchange formats remain unchanged. The existing user-data path is captured before setting the display name, preserving normal collections and explicit test-collection launcher paths. Earlier release folders are retained.

## Review of recent additions — 0.16.2

Reviewed Build from Scratch, saved drafts, stock/assembly installation, SVG contour rendering and interaction, manufacturer catalogue templates, parsing, matching, selected imports, metadata storage, backup validation, UI state, theme behaviour and their existing file/sharing boundaries. The 202-test baseline passed; additional regressions reproduced the following issues before the fixes.

| Priority | Confirmed issue | Correction |
| --- | --- | --- |
| P2 | Products without a reference could be offered as new on identical reimport, particularly short names such as M2. | Previously imported reference-free products now match by manufacturer and full normalized name. Manual and ambiguous stock matches still require review. |
| P2 | A delimiter in manufacturer/reference text could make unrelated products share a matching key. | Identity keys use unambiguous tuples rather than concatenated strings. |
| P2 | Incomplete catalogue metadata could pass backup validation and later fail when rendering specifications. | Stored metadata must match the complete validated canonical structure before restore or persistence. |
| P2 | An invalid category such as `__proto__` could crash the product correction dialog. | Category lookup accepts only the taxonomy's own entries; malformed rows remain correctable. |
| P2 | Select all new could include a product deliberately left unresolved, blocking confirmation. | Bulk selection respects each product's explicit review decision. |
| P2 | Refreshing matches could silently convert an already selected update into creation or an update to a different record. | Selections are cleared whenever their effective destination changes. |
| P2 | Typing while Save draft completed could incorrectly mark the newer text as saved. | Save captures a snapshot and leaves subsequent edits marked unsaved. |
| P3 | Selecting another part reset the zoomed diagram's horizontal and vertical scroll positions. | Diagram refresh preserves its viewport. |
| P3 | Alternative dark themes used the light-theme contour colours. | Contours follow the active theme's light/dark tone, including custom palettes. |

Removed an unused category-render callback argument and a duplicate empty supply-kind option. The original SVG remains intact. Database schema 8, owned stock, setup history and sharing formats are unchanged; source accuracy and real physical compatibility still require user review.

Validation: **205 data/logic tests and 141 isolated Electron workflow checks passed**, plus application syntax checks, with no captured renderer errors. Regression evidence is in `tests/catalogue-import.test.cjs` and `tests/new-additions-review-smoke.cjs`; SVG geometry, pointer and keyboard behaviour remain covered by `tests/build-smoke.cjs`. The packaged source and assets are checked byte-for-byte against the reviewed files.

A 5,000-product in-memory import/reimport check passed: all new quantities stayed at zero, all identical reimports were recognized, and the 5,000-product and 16 MB limits rejected oversized inputs. This is a synthetic data check, not a guarantee of performance with large photo collections. All desktop testing uses the isolated `.qa/profile`, never the user's `.qa/test-collection` or normal application data. Native macOS/Linux and physical two-computer Wi-Fi testing remain outstanding.

## Part contour highlights — 0.16.1

Build from Scratch highlights now follow the original SVG component silhouettes, including gear teeth, motor shafts, wires and chassis cutouts. Hover, selection and keyboard focus use a blue outline; assigned positions use green with a check beside their label. Paired components highlight together. Parts and labels remain clickable, while surrounding space and empty cutouts no longer act as rectangular targets. The original SVG file is unchanged: the renderer groups copies of its geometry for interaction and derives the outlines directly from those shapes.

Validation: application syntax checks and five focused Electron build-workflow checks passed. These include real pointer movement/clicks, both themes, keyboard activation, geometry preservation, draft/restart recovery and saving partial cars. Dark/light screenshots were inspected. No database migration is required; the previous full-suite results below remain the v0.16.0 baseline.

## Manufacturer catalogues and themed builder — 0.16.0

**Import & Export → Manufacturer catalogues** offers a downloadable JSON kit containing AI instructions, every supported part and workshop-supply category/type, field definitions and fictional examples. Give the kit and your chosen manufacturer/retailer URLs to your own AI, then import its completed file. Only the `products` array is imported; examples and category references are guidance. The app does not scrape websites or download product photographs.

The review groups products into expandable categories with individual and category selection, search and status filters. Large groups initially show 50 entries; Show 50 more expands them. Review lets you correct classification and basic product details, inspect specifications and source notes, and choose how to handle possible matches. Invalid rows cannot be selected, but other valid products can still be imported. Malformed specifications and duplicate source rows need correction in the original JSON file. Nothing is written until the selected import is explicitly confirmed.

Manufacturer/reference matching identifies updates and unchanged records; possible name matches and multiple existing stock lots require an explicit choice. Identical reimports are skipped. New parts and workshop supplies start at **zero owned quantity**; a manufacturer's pack size is product information, never a stock increment. Add quantities through the normal stock editor when you actually own the items. Existing-record updates replace only manufacturer catalogue metadata, preserving local names, classifications, stock quantities, installed parts, photographs, notes and history. Catalogue specifications, packaging, source URL and checked date remain available in the part inspector and workshop-supply details.

The file supports up to 5,000 products, 60 specifications per product and 16 MB total. Unknown facts should remain empty, and uncertain information should be flagged in review notes. Structural validation cannot verify the manufacturer's claims or physical compatibility. Reviews and corrections remain in memory when navigating away; closing/reloading the app loses an uncommitted review. A changed database requires Refresh matches before import. Confirmed changes are atomic and catalogue metadata is included in complete backups, but not shared-car packages.

Build from Scratch now uses the active theme's panel background and label colours, with visible outlines in dark mode. The diagram says **Motor pod** and **Universal schematic**, with no inline-layout requirement. Edit `renderer/build-diagram.svg`, then run `npm run build:diagram` to regenerate the bundled inline artwork.

This release retains schema 8. Automated checks use the isolated `.qa/profile`, never the normal collection or the user's `.qa/test-collection`. Native macOS/Linux and physical two-computer network validation remain outstanding.

Validation: **202 data/logic tests and 134 isolated Electron workflow checks passed**, with no captured renderer errors. New coverage includes selected category imports, classification corrections, duplicate and ambiguous matches, zero-stock ownership, catalogue metadata in backups, source-field validation, stale revisions, atomic write failure, large category lists, and themed diagram labels. Dark/light and narrow-window screenshots were inspected.

## Build from Scratch — 0.15.0

Open **Parts → Build from Scratch**, after Assemblies. The supplied exploded chassis SVG is bundled with separate keyboard-accessible click areas for 18 component positions, including the small screws and pinion. Click a component or label to choose inventory in the adjacent panel. Blue identifies the selected position; green and a checkmark identify assigned positions. Zoom offers Fit, 150% and 200%. Paired wheel/tyre/bearing/braid drawings share one assignment with an editable quantity; two is suggested when stock permits, but one is valid.

The inventory panel suggests relevant part types, supports search, and offers Show all parts for unusual builds. Beyond the drawing provides body, lighting, decoder/electronics, magnet, ballast and suspension positions, plus repeatable Other part assignments with custom descriptions. Use an assembly selects a stored physical unit and its existing technical positions; components cannot be selected again as loose stock or silently transferred from another car. The drawing is an inline schematic, not a compatibility checker or restriction on the car's layout.

Enter a car name and choose **Review & save to Cars**. Only one part or a populated assembly is required; no chassis, motor, complete axle or other particular position is mandatory. Review lists every actual component and quantity. Confirmation creates a normal car, fitted inventory and history together. Owned stock quantities remain unchanged, available stock decreases, and an optional **As built** setup preserves the initial configuration. The car opens immediately in Cars and supports the normal details, photographs, setups, workshop, maintenance and sharing features. Private build notes stay in the car's private notes and are not copied into shareable setup notes.

**Save draft** stores a private plan without creating a car or reserving inventory. Saved drafts survive restart and complete backup/restore. They may be empty or unnamed. Missing/deleted parts, changed assemblies and insufficient stock must be resolved before creating the car; draft references do not prevent unrelated inventory edits. Starting another build or loading a draft warns before discarding unsaved changes. Refresh stock keeps current selections. Saving the car removes only the draft used for that build. Unsaved work stays in memory while navigating, but use Save draft before closing the app.

Version 0.15 introduces **schema 8** for build drafts. Schemas 1–7 migrate in memory and are written in the new format on the next saved change, retaining the previous-file recovery copy. Older app versions cannot open a schema-8 database; retain a complete backup before upgrading if you need to return to an earlier release. Shared-car packages and the network protocol are unchanged; drafts remain private. Automated checks use `.qa/profile`, never the normal or user test collection.

Validation: **191 data/logic tests and 128 isolated Electron workflow checks passed**, with no captured renderer errors. Coverage includes minimum one-part builds, adjustable quantities, optional snapshots, stock aggregation, overlap rejection, stored assemblies, stale reviews, atomic persistence failure, draft recovery, schema migration and private-note exclusion. Real Electron workflows exercise diagram selection, keyboard use, draft switching/restart, confirmation/cancellation and desktop/narrow layouts. An initial full desktop run stopped on a Windows file-lock error in the isolated QA database; the complete rerun passed. Native macOS/Linux and physical two-computer network validation remain outstanding.

## Full code review and corrections — 0.14.1 (31 October 2026)

The review covered persistence and migrations, backup/restore and file handling, public/private field boundaries, JSON imports and approvals, stock and assembly accounting, setup application and job history, network permissions/retries/discovery, renderer navigation and modal state, presentation preferences, icons, styling, launchers and packaging. The existing tests passed before the review; the failures below were reproduced with additional tests before being corrected.

| Priority | Confirmed issue | Fix and regression evidence |
| --- | --- | --- |
| P2 | Clearing a part's owned quantity silently converted the empty input into zero, removing all unallocated stock from its record. | Require an explicit non-negative safe whole number in the data layer and part editor. Invalid edits leave the original record intact; entering zero deliberately remains valid. Tests cover empty/whitespace, null, boolean, array, missing, fractional and unsafe quantities. |
| P2 | A host status response without a database ID could mark an offline connection healthy and change its permissions without verifying that it described the paired database. | Require a nonempty string identity before accepting status. Missing/malformed identity leaves the cached collection and last successful sync intact, with the connection offline. A different valid identity requires explicit pairing. |
| P2 | After previously visiting Workshop supplies, opening a job elsewhere and choosing All workshop jobs could return to Supplies. Starting a setup job from a car had the same problem. | Entering or returning from a job selects the Jobs tab. Desktop regressions exercise both resume and new setup-job routes after visiting Supplies. |
| P3 | Importing another file while an earlier submission remained selected opened Review on the old car. | Select the newly received package and clear the earlier car selection. Import still requires approval before creating or changing cars; identical imports remain deduplicated. |

### Removed obsolete code

- Removed the unused `restore-setup` UI handler and its `setup.restoreSettings` backend operation. The visible Apply setup flow already supports settings-only configurations and reviewed inventory changes; its confirmation and snapshot-preservation tests replace the obsolete path's test.
- Removed the unreachable second duplicate-package check inside the transaction. The earlier validated content-and-identity check remains, including its collision protection and retry tests.
- Removed the redundant pending-document global, retaining the picked document only in the attachment dialog's save callback.
- Removed repeated Workshop guards already enforced by the parent renderer, and the unused photo-control class argument.
- Removed unused `three-col`, `danger-zone`, `nowrap`, `profile-photo-controls`, `collection-select-row` and `appearance-panels` CSS selectors after checking rendered and dynamically constructed class names. Theme tone classes and shared layout rules remain in use.

### Verification and remaining limits

Validation: **180 data/logic tests**, **124 isolated Electron workflow checks**, application syntax checks and no captured renderer errors. The workflow suite includes native JSON/backup dialogs with controlled test responses, local network submissions, guarded edits, document metadata, stock movements, setup jobs, Review, Showroom, themes, icons and overview layouts. Dark/light screenshots at desktop and 960 px widths were inspected. `npm audit` reported **zero known dependency vulnerabilities**; that is an advisory result, not a guarantee of security.

Regression cases are in `tests/audit-regressions.test.cjs`, `tests/audit-regressions-smoke.cjs` and the updated setup-application test in `tests/store.test.cjs`. Existing tests also cover rollback on failed writes, malformed imports, historical inventory references, stale revisions, public-data privacy and independent host/client processes. Packaging is checked against the reviewed source and assets byte-for-byte.

This patch retains **schema 7** and does not require a database migration. Automated desktop checks use `.qa/profile`; the normal collection and the user's `.qa/test-collection` are not test fixtures. Older release folders and recovery copies are retained.

Native macOS/Linux execution, physical two-computer Wi-Fi, real power-loss recovery and third-party document viewers still need device testing. Sharing remains a trusted-LAN HTTP feature. The main long-term engineering constraints are synchronous whole-document JSON persistence (200 MB cap), repeated full snapshots, and dense transaction/rendering code with global UI state. These deserve measured refactoring before high-volume timing integration; they were not replaced as part of this bug-fix review. Earlier release-specific validation counts below are historical.

## Customisable car overview — 0.14.0

Car details and Current configuration each have a Choose fields button. Add, remove and reorder up to 16 fields per panel, including private/custom car details and technical specifications, gearing and the calculated gear ratio. Each layout applies to every car in the local collection, persists after restarting and is included in complete backups. Restore default fields resets only the panel being edited; Cancel discards the draft. Shared views keep the standard panels and do not expose local customisation controls or private preferences.

The supplied small-pinion SVG replaces the existing motor-pinion artwork. Automatic Pinion icons and existing manual selections use the updated drawing and retain their chosen colour.

Validation: 178 data/logic tests and 121 desktop workflow checks passed. Coverage includes independent panel layouts, field ordering, custom values, defaults, cancellation, stale edits, persistence, backups, shared-view privacy, the supplied pinion artwork and dark/light layouts at 1440 px and 960 px.

## Parts category folders — 0.13.1

Parts → Stock starts with clickable main-category folders instead of the full inventory table. Each folder shows its number of part records and available/fitted/reserved pieces. Open a group to browse its parts and details, filter by type, or add a part with that category already selected. All groups returns to the folders. Search finds stock across all categories; clearing it returns to the folder view. Existing stock and assemblies are unchanged.

Validation: 175 data/logic tests and 117 desktop workflow checks passed, including a 100-part collection, folder counts, category changes, deletion, cross-category search, type filters and dark/light layouts at 1440 px and 960 px.

## Review hub and job editing — 0.13.0

The yellow REVIEW button in the header opens a dedicated page with Incoming cars, Workshop jobs and Maintenance sections. Incoming cars includes both JSON imports and submissions received over the club connection, with the existing selective approval workflow. Reviewing is done on the computer hosting the receiving database; opening Review while browsing a shared collection switches to the local database. Connections now contains only sharing and connection controls.

A soft red dot flags unresolved incoming cars and maintenance due today or overdue. Open workshop jobs and future reminders remain visible without turning on the dot. Maintenance is grouped by urgency; Open car and Plan workshop job (or Resume job) lead to the existing records. A new network submission updates the header without resetting review choices or notes.

Active general and setup jobs offer Edit on their cards and Edit details inside the job. Name and planned instructions are editable; the car, original setup target, inventory and prior progress are retained. Edits appear in job history. Closed jobs remain historical records, and stale edits are rejected rather than overwriting newer changes.

Validation: syntax checks, 175 automated data/logic tests and 112 desktop workflow checks passed. Desktop checks include JSON import approval, network submissions arriving during review, job edit cancellation and stale saves, maintenance reminders, persistence, and layouts at 1440 px and 960 px. Tests use an isolated QA profile.

## Timing-inspired interface — 0.12.0

The approved interface proposal is implemented across all nine main pages. Navigation now includes icons, section headings use tinted icon tiles, cards have soft depth and defined headers, and selected controls have clearer highlights. Amber identifies workshop work and blue identifies connections; every colour follows the active Timing palette, including custom themes. All existing stock, setup, sharing, import and approval actions remain connected to the real database.

Overview is now the starting page, with the editable three-line welcome banner, real collection/stock/job/reminder counts, current workshop jobs, recent activity and recently updated cars. Job cards are reusable across Overview and Workshop. A car's overview shows its active job, with photo controls underneath the image. New display preferences default to Fit, while an existing Fit/Fill choice is preserved. Photos retain their original proportions, and the Showroom spotlight and gallery use consistent 4:3 frames.

Settings has separate Appearance, Welcome banner, Database, Custom fields and Saved views sections. Library adds shortcuts for commonly used fields while retaining the full field selector. Import & Export separates car imports, car exports, complete backups and restores into four action cards. Submission review compares current and incoming values side by side and retains selective field acceptance. Car editors have a section rail with the existing fields and validation. Parts use the full table width until a part is selected.

The database format remains schema 7. This release does not migrate or seed the user's collection. The source launcher and test-collection launcher use the updated interface; the packaged executable uses the existing normal application data location. Live Timing and RaceCoordinatorAI integration is still a later phase.

Verified with 169 automated tests and 107 existing desktop workflow checks. Visual checks cover all main pages, all car tabs, review, supplies, job details and the car editor at 1440px/dark and 960px/light, with no horizontal page overflow or captured renderer errors. Checks use the isolated QA profile, not the user's collection.

## Part icons and colours — 0.11.0

The supplied 62-icon pack is integrated with 51 matching vector additions: 15 further part/general icons and 36 workshop supply icons. Every predefined part and supply type has an automatic mapping, falling back to its category for custom type names. Generic custom/other and assembly symbols are also available. SVG artwork inherits the chosen colour and scales without bitmap blur.

Add/edit a part or workshop supply and use Icon & colour. Automatic follows the assigned category and recognised type; the searchable picker offers all 113 icons, with a category filter and a manual override that remains selected when the category changes. Choose Theme default or one of five presets: Red, Blue, Green, Amber and Purple. Preset shades adapt to light/dark themes. Colours are per item: use them for manufacturer distinctions or any personal organisation scheme; the app does not assign colours to manufacturers automatically.

The part details panel also has an Icon & colour shortcut. It can change the appearance of reserved assembly components without editing stock, assemblies or installation history. Uploaded photographs remain the main visual, with a coloured edge when a preset is chosen. The saved icon becomes visible if the photo is removed. Cancel discards appearance edits. Changes survive restart, complete backup/restore, and stock transfers/returns; older records default automatically. The optional fields retain schema 7.

Artwork lives in `renderer/icons/`; `scripts/build-icons.cjs` holds the new vector drawings and generates the inline artwork bundle with `npm run build:icons`. Original user-supplied SVGs are preserved. The library is bundled locally and requires no network requests.

Verified with 169 automated tests and 107 isolated desktop workflow checks, including mapping coverage, repeat edits, backup validation, invalid appearance rejection, photos, assembly reservations, picker filtering, cancellation and restart persistence. All new drawings and the light/dark picker layouts were inspected; the editor has no horizontal or outer-dialog overflow at 960px and 1440px. The user's collection is not used by the checks.

## Timing file imports and calculated gearing — 0.10.0

Import & Export → Import cars from JSON accepts SlotForge Timing exports with `format: slotforge-timing-export` and `fileVersion: 1`, containing one or several slotcars. Cars enter REVIEW → Incoming cars for selective review before being added or changed. Native Database car packages still work. Timing IDs receive a stable namespace, so repeated imports update the same imported cars; separate cars with identical names remain separate. Cars entered manually in Database are not automatically matched by name. Importing the identical package again is detected without adding another submission.

Timing brand maps to slot-car manufacturer, manufacturer/model to real-car marque/model and display name, and tyres to rear tyres. Motor, scale, main/additional photographs and included racing-class names are transferred. Gearing such as `13/31` becomes pinion 13 and driven gear 31; weights such as `63gr` become 63 grams. Unsupported gearing/weight notation, missing class definitions, Timing tyre compound, lap/service counters, simulation factors and custom values are preserved as technical reference notes. Notes retain the original Timing ID for future integration. Empty values do not erase local specifications or photos. Accepting Technical specifications includes the imported reference notes; inspect that field before replacing existing notes.

This is file import, not live application synchronisation. It creates neither lap sessions nor workshop service records, and does not import tracks, drivers, race configurations, Timing photo crop settings or custom-field definitions. Reference notes use the normal technical-notes sharing rules. Existing limits still apply: 12 MB per photo, 40 additional photos per car and 200 MB per database (including retained review packages).

Gear ratio is calculated as driven gear teeth ÷ pinion teeth. Car overview, technical details, factory reference, setup cards and recorded configuration views show the result; the car editor recalculates current and factory ratios independently while typing. Results have two or three decimal places, rounded to three: 27/9 → 3.00:1, 27/8 → 3.375:1, 31/13 → 2.385:1. Missing, zero, fractional and non-numeric tooth counts show no ratio. The result is derived, so no redundant ratio value or database migration is needed; schema remains 7.

The automated suite passes 162 tests, including mapping, validation, repeat imports, reviewed updates and gearing edge cases. All 100 isolated desktop workflow checks pass with no captured renderer errors, including file-picker import, review, duplicate detection, live current/factory ratios and saved setups. Import and editor layouts were inspected at 1440px/dark and 960px/light. The supplied Timing 1.99.3 export was converted and all 22 cars/22 photographs accepted in memory; the user's collection and export file were not modified.

## Workshop cards and photo framing — 0.9.1

Active Workshop jobs have separate, fully clickable cards inspired by SlotForge Timing's race cards. Each shows the car photograph and name, job name, type, status, latest note or instructions, and updated date. Coloured edges distinguish setup jobs from general work; text and icons also identify the type. Completed and cancelled jobs remain available in a collapsed history section below the queue.

Car detail photographs and Showroom gallery images use consistent 4:3 frames, with centred images and no fixed image-height cap. The spotlight uses a wider frame that adapts to the window. Gallery photographs align along their top edges even when car names wrap. Fit / Fill controls on Showroom and the car overview share a locally remembered display preference: Fill fills the frame and may crop edges; Fit shows the whole photograph. The separate photo viewer always shows the whole image. Original photographs are unchanged.

Syntax checks and the existing 94 desktop workflow checks pass. Additional isolated checks cover whole-card job activation, closed-job history, Fit / Fill persistence, photo geometry and dark/light layouts at 1774px and 960px with no horizontal overflow. Copies of existing car photos were used for visual checks; the user's databases were not modified. Database schema remains 7.

## Showroom — 0.9.0

Showroom sits between Overview and Cars. It displays the existing active collection with a large spotlight and a photograph gallery. Pick the spotlight car from its selector; the preference is saved with the database and included in full backups. Main photographs are used first, with additional photographs as a fallback. Cars without photographs still appear with a placeholder. Add or change photos through Cars → Photos & documents. No illustrative/generated car photos are inserted into the collection.

Click anywhere on a gallery card to open its photo viewer. Browse additional photos, move between cars, or use View car to open the existing record. Arrow keys change cars, P toggles slideshow playback and Escape closes the viewer. Slideshow advances through the filtered collection every five seconds; pausing, closing, leaving Showroom or switching databases clears its timer. Hiding the app pauses playback. Full screen works for both the gallery and viewer, with visible exit controls. Only the trusted local app page receives Electron's fullscreen permission; other permissions remain denied.

Search, usage filters, favourites and sorting are independent of the Cars-page filters. Favourite stars use the existing car record, with revision protection and no extra work-history entry. Shared collections can be viewed but do not expose private favourite controls or spotlight settings. The gallery adapts to window width and the selected app theme; version 0.9.1 adds the Fit / Fill choice described above.

This version retains schema 7. Spotlight preferences and favourite flags survive full backups and remain excluded from car-sharing packages. The user’s test collection is not modified by automated checks.

Verified with **154 automated tests and 94 desktop workflow checks**, including native Escape/fullscreen behavior, rapid viewer reopening, slideshow cleanup, saved favourites/spotlight, photo navigation, escaped names and layouts at 1440px/dark and 960px/light. All 29 packaged application files match the checked source.

## Create jobs from Workshop — 0.8.0

Workshop → Jobs now has a **New workshop job** button. Choose a car and either General work / maintenance (job name and planned-work notes; no setup required) or Work towards a saved setup (only setups belonging to the selected car are offered). The existing Work in stages action on a car’s saved setups remains available.

General jobs support progress notes, leaving and resuming, completion and cancellation. Starting a job captures the car’s configuration without changing stock or specifications. Progress notes appear in the job log and car history; actual component/specification changes are still recorded on the car page. Completion and cancellation preserve the configuration at closure. Cancellation keeps earlier work. One active job per car is allowed across both types; cars with active jobs are labelled and disabled in the chooser.

Record work on the car page continues to log completed maintenance or modifications; it does not create a job. General jobs, plans and logs stay private, are preserved in complete backups and are excluded from car-sharing packages. Existing schema 1–6 databases migrate to **schema 7** on the first saved change, retaining the prior-file recovery copy. Older builds cannot read schema 7; use an earlier complete backup to return to an older build.

Verified with the regression suite, nine general-job backend checks and **82 isolated desktop workflows**, including creating both types from Workshop, progress persistence after reopening, cancellation, completion, stale submissions, car/setup selection and the 960px layout. The separate user test collection is untouched.

## Clickable part rows — 0.7.1

The entire stock row opens its part details, including the icon, description, stock counts and empty space. A pointer cursor indicates the clickable area; the name remains a native button for keyboard access. Verified with native mouse clicks across six row targets and Enter-key activation in the isolated QA profile. No database change is needed.

## Themes, welcome text and inventory deletion — 0.7.0

Settings now includes SlotForge Timing's eight preset colour themes: Dark, Light, Midnight blue, Forest green, Sunset orange, Violet, Carbon and yellow, and Ocean (light). Custom supports background, panels, text, quiet text, lines and accent colours, with live preview, readability warnings, automatic button-text contrast and copying a preset as a starting point. Cancel restores the saved theme. Palettes and colour helpers follow the local SlotForge Timing 1.99.3 source.

Settings → Welcome banner lets you edit the small heading, main title and description independently, preview changes and restore the original text. Text is displayed literally, wraps within the window and is limited to 120, 200 and 500 characters respectively. With default text, the main title continues to follow the database name. Themes and banner text persist in complete backups; they are not included in car packages or shared database views.

Parts → Stock → select a part → Delete part removes unused stock after confirmation. Parts referenced by current or historical installations, assemblies, setups, performance records, workshop jobs, car history or returned stock cannot be deleted. The review explains the references. Workshop supplies have a Delete action that removes the item, its photo and its amount history after confirmation; Archive remains available to keep history. Both deletion actions reject stale confirmations and preserve the original data if saving fails.

Version 0.7 reads database schemas 1–5 and upgrades to **schema 6** on the first saved change. The prior-file recovery copy is retained. Older app versions cannot read schema 6; use an earlier complete backup if returning to an older version.

Verified with 139 automated tests and 75 isolated Electron workflows, including every preset, custom preview cancellation, preset copying, banner escaping/reset, 960px layout, deletion cancellation, protected historical references, stale confirmations and persistence after reopening. The user’s separate `.qa/test-collection` profile is not used by these tests. Close and reopen `Start Test Collection.cmd` to use the latest source with that collection.

## Layout corrections — 0.6.2

Workshop now has a consistent 20px gap below Setup jobs. Upcoming maintenance and Recent work each size to their own content instead of stretching to equal heights. Recent work initially shows three entries, with Show more revealing five additional entries at a time and Show less returning to the compact view. The full history remains stored.

Toolbar dropdowns and search inputs align at their bottom edges and share a 42px control height, including the reusable-choice library. The corrections retain the existing text sizing and responsive single-column layout on narrow windows. No database schema change is needed.

Verified through the 65 existing isolated desktop workflows and additional layout inspection at 1440px/dark and 960px/light. Measurements confirm a 20px panel gap, equal 42px Library control heights, zero bottom-edge misalignment and no horizontal overflow. Recent-work expansion was checked from 3 to 8 entries and back to 3. All 21 packaged application files match the checked source.

## Working features

- Local persistent collection with permanent car identities; add, edit, duplicate and archive.
- Gallery/table views, search, multi-select usage filters, saved views and reusable field suggestions.
- Reusable-choice library with reviewed renames/merges, optional corrections to current cars and preserved historical snapshots.
- Reviewed bulk updates to collection fields and labels; configurable table columns and column order in saved views.
- Detailed current/factory specifications, ownership information, custom fields, main and additional photos.
- Private document attachments, opening temporary copies, exporting copies, and inclusion in complete backups.
- Quantity and individually tracked parts, stock checks, installation/removal, separate returned-used stock and history.
- Assemblies built from available stock, with installation, confirmed transfers, removal to storage and dismantling.
- Setup snapshots and comparisons, plus reviewed application of settings and tracked inventory, explicit substitutes and confirmed transfers from other cars.
- Persistent staged setup jobs with individual fitting/removal/setting steps, resume, actual-versus-target comparisons and cancellation that retains completed work.
- Assembly member replacement with dedicated replacement stock, released used parts and preserved group/history.
- Dated work journal, task-based calendar reminders and manual test records linked to setup snapshots.
- Selected-car exports and imports into a selective review inbox. Repeat package detection and preserved car identities prevent accidental copies.
- Complete backup and restore, including photos and private information.
- Local-network discovery, separate browse/submission codes, permission controls, automatic reads, reconnection and a clearly marked offline public view.
- Duplicate-safe manual retries for unacknowledged submissions; host review remains mandatory.
- Dark and light themes.

## Parts, assemblies and digital toolbox — 0.6

**Parts → Stock** now has 11 category groups with suggested part types: Body & interior; Chassis & mounting; Motors & motor parts; Gears & transmission; Axles & bearings; Wheels & tyres; Guides & pickups; Wiring & electronics; Suspension & handling; Screws & fixings; Other & custom parts. Choose a category, then select or type a part type. Custom types remain reusable. Existing categories are mapped to these groups; unfamiliar old categories are retained as a type under Other & custom parts.

Parts can store a photograph, manufacturer, reference, scale, dimensions, material/compound and compatibility notes. Category/type icons appear when a photograph is absent. These are original vector icons that follow the app theme, with specific variants for common parts such as tyres, braids and bearings. Filter stock by category/type or search names, references, manufacturers, locations and compatibility. Compatibility is descriptive; the app does not certify whether two physical components fit. Existing stock, identities, installations and history are retained. Returned used lots retain the part metadata and photograph.

**Parts → Assemblies → Build assembly** combines components into a physical unit ready to install, such as a motor pod or complete rear axle. The components remain identifiable and reserved together; installing, transferring or removing the assembly operates on the whole unit. “Group parts” was an alternative label for this same operation, not a separate feature. Version 0.6.1 restores the assembly wording and removes the separate whole-car builder. Add cars through Cars → Add car, then fit parts or assemblies to them. Existing cars and installations remain valid.

**Add setup** is visible beside Record work on every local car profile, including Overview, and within Setups. It saves the car's current specifications and installed components with a name, track/conditions and notes. Edit the configuration or record physical changes first to save a different setup. If the car changes while the dialog is open, reopen it to capture the latest configuration. Shared remote cars remain read-only.

**Workshop → Workshop supplies** is the digital toolbox. Its seven categories are Hand tools; Measuring & setup tools; Tyre & wheel equipment; Motor & electrical equipment; Cleaning & lubrication; Adhesives & consumables; Storage & transport. Each item has a type, manufacturer/reference, item or container count, location, condition, notes and optional photograph. Type, manufacturer and location entries are reusable suggestions. Tools/equipment are kept separate from consumables and cannot be installed as car stock.

For a consumable, optionally record the total remaining amount, its unit and a low-stock threshold. Fractional amounts are supported. Blank means unknown; zero means empty. The low-stock badge/filter applies when a known amount is at or below a recorded threshold. Units are user-entered labels, with no automatic conversion: update the amount as well if changing units. Changes to kind, quantity, amount, units or threshold retain their prior and new values in history. Archive an item to hide it from active stock; the Archived filter allows restoring it.

Toolbox records and part photographs are private local data included in complete backups, but excluded from car-sharing packages and network views. Photos contribute to the existing 200 MB database limit. Version 0.6 reads schemas 1–4 and upgrades to **schema 5** on the first saved change. Older app versions cannot read that upgraded database; retain a complete earlier backup if returning to an older version is necessary.

The separate sample collection still opens through **Start Test Collection.cmd** in this workspace. Close and reopen that app to load the updated source. Its three example cars and stock remain in `.qa/test-collection`; automated desktop checks use `.qa/profile` instead. No sample records are added to normal collections.

Version 0.6.1 validation: **125 automated tests** and **65 isolated Electron workflow checks**, including old-category migration, fractional/unknown/zero amounts, supply archive/history, backup privacy, native part-photo selection, stale setup rejection, restored assembly controls, and dark/light toolbox layouts at the minimum window width. Native macOS/Linux builds and physical two-computer Wi-Fi validation remain outstanding.

The unsigned Windows 0.6.1 portable build is placed separately in `dist/v0.6.1`. This correction retains schema 5 and the toolbox, category, photo and setup improvements.

Private purchase, ownership, location, inspection, custom-field and document-attachment data is not included in car packages or shared-network views. The export preview lists what will be included; extra photos and setup notes require selection. Complete backups contain all private data, including attachments.

## Local network use

On the club computer, open **Connections → Start sharing**. The app displays the local database name, addresses, a **Browse-only code**, and a **Browse + submit code**. Only the local host reviews submissions; neither code permits direct edits or remote approvals. Anyone given the submission code can send cars for review. Codes are group access credentials, not individual member accounts or verified identities.

On a member computer, choose **Find nearby databases**, select the club and enter its code. Manual address entry remains available. Both computers use the same app. Discovery publishes only the database name, identity and HTTP port in response to nearby requests; it never publishes codes or cars. Names are self-reported: verify the name and code with the club. Discovery uses IPv4 multicast on UDP port 47778 with a local-network TTL; the collection uses the HTTP port displayed by the host. The app does not change firewall or router settings.

**Pause submissions** blocks new uploads while allowing browsing. **Revoke codes** replaces both codes immediately; members need to pair again. Permissions are rechecked after an upload, before it is saved. Revoking access cannot withdraw public information already read. Stopping and restarting sharing generates new codes and may change its address/port; use discovery or the new displayed address to pair again.

Connected clients check the host approximately every five seconds while the app is open. They fetch a complete, consistent public snapshot only when its revision changes; older hosts without the status endpoint use full reads. **Pause auto refresh** disables automatic checks. A failed read retains the previous public snapshot with an **Offline / saved view** notice and last-check time. Reads retry with increasing delays up to about a minute. A Wi-Fi interruption can recover automatically while the host session and address remain unchanged. An invalid or revoked code stops retries until the user supplies a new code. A detected change of database identity at the same address stops further automatic reads and submission retries until explicit pairing. Individual reads have a 10-second timeout; a complete paged collection transfer has a 60-second deadline. Disconnect cancels outstanding reads and clears the shared snapshot. Failed pairing leaves an existing connection intact.

Connection codes, the shared snapshot and any unacknowledged submission retry copy are held in memory only. They are not saved to disk or included in backups, and are cleared when the app exits. Sharing and connection checks do not automatically start on app launch. A renderer reload retains an active connection from the running main process.

To submit, switch to the personal collection, select cars, and choose **Send to club**. Submissions stay pending until accepted in the host's **REVIEW → Incoming cars** screen. If the response is lost, **Connections → Retry same submission** resends the frozen package with its original identity, even if the local car has since changed. The host acknowledges an already received package without creating another inbox item. Retries are always explicit, never automatic. Resolve or discard the retry copy before sending another package or closing the app. Discarding the retry copy does not withdraw anything the host already received. After an app restart, ask the host whether an uncertain submission arrived before making a fresh submission.

Shared reads use bounded pages and detect a changed collection during transfer. Individual network submissions remain limited to 32 MB; use a file export for larger packages. Private documents and workshop records remain local. Background reads and new submissions preserve active host review choices and notes; refresh the inbox when ready. The host must remain running.

Guest Wi-Fi, router client isolation, VPN adapters and firewalls can block traffic even on the same Wi-Fi. If discovery finds nothing, try the host's displayed address. If that also fails, check that both devices can communicate and that the host permits SlotForge on the trusted local network. HTTP is not encrypted; do not expose this service to the internet. Native macOS/Linux networking and real two-computer firewall behaviour still need device testing.

### Connection validation — 0.5

105 automated tests and 54 isolated Electron workflow checks cover discovery, role enforcement, pause/revoke controls, read recovery, stale views, search focus, review preservation, cancellation, upload-time permission changes and duplicate-safe retries. A separate host process and client process also discover and communicate through the operating system's network stack. These are tests on one Windows computer, not a physical two-computer Wi-Fi sign-off. No timing integration is included in this release; the database remains schema 4, compatible with version 0.4.

For physical device acceptance: start sharing on computer A; discover it from B; verify both access codes; submit a test car and review it on A; temporarily disconnect B's Wi-Fi and confirm its saved-view notice and recovery; then revoke the codes on A and confirm B requires a new code. Repeat on the intended club network and each supported operating system. Use test collections for this check.

## Data and recovery

The app stores `database.json` in Electron's per-user `slotforge-database` data directory. Settings shows its exact location. On Windows this is normally `%APPDATA%/slotforge-database/database.json`.

Each operation validates a draft and writes it through a temporary file before making it active. `database.json.previous` retains the preceding file. This is a short recovery window, not a substitute for exporting backups. A corrupt database is not silently reset. A second normal process focuses the existing window rather than opening a competing writer.

Restore replaces the current database after an explicit warning. Car import is different: it queues reviewed additions or updates.

Version 0.4 reads existing version 0.1/0.2/0.3 databases and complete backups. The first saved change upgrades the database to schema 4, adding staged workshop jobs. Older app versions cannot open that upgraded file. Export a complete backup in the earlier app before upgrading if you need the option to return to it. Migration does not replace or seed your cars.

## Staged workshop jobs — 0.4

Open **Car → Setups → Work in stages** to start one active job for that car. The saved setup is the immutable target. Starting a job moves no stock and changes no specification. **Workshop → Resume job** rechecks the actual car and available stock, even after restarting the app.

Complete individual actions as the physical work happens:

- **Fit / confirm** selects available stock, an already installed component or a compatible assembly. Explicit substitutes retain their actual names; transfers from another car require a separate confirmation. An occupied position must be cleared first. Inventory-only rows retain their recorded position and quantity.
- **Return to used spares** removes a loose component or a whole assembly. Quantity stock becomes a separate used lot; assemblies remain intact.
- **Record adjustment** applies one target setting or untracked specification. Tracked component names follow the actual fitted stock. Settings already matching the target need no change.
- **Complete job** is available when every requirement is satisfied and extra tracked inventory is resolved. It saves the actual finished configuration separately from the target. An outside edit or assembly replacement can make an active checklist step outstanding again.
- **Cancel job** closes the job and saves its actual configuration without reversing completed physical work. Closed records remain available in Workshop. A new job can then be started for that car.

Every step is an atomic, revision-checked transaction. A stale screen, insufficient stock, occupied slot or failed save leaves the entire step unchanged. Missing stock does not prevent starting a job; it remains outstanding. Jobs are local and included in complete backups, but excluded from car packages and network views.

**Parts → Assemblies → Replace component** replaces one member at its existing position and quantity, in storage or on a car. Available quantity stock is split into a dedicated lot; the removed dedicated lot is released as Used. The assembly identity and its other installed members stay unchanged. Replacement history appears on the assembly, and an installed replacement also enters the car journal. Existing setup and test snapshots keep the previous components.

**Record test → Actual current car** now saves the current specifications and fitted inventory, including unfinished work and its active job reference. **View recorded configuration** shows that frozen snapshot later. Selecting a **Saved historical snapshot** remains an explicit option for retrospective entries. Earlier test records keep their specifications but do not acquire invented inventory history.

Version 0.4 validation: 90 automated tests and 44 isolated Electron workflow checks, including persisted job recovery, stale-step rejection, transfer confirmation, stock conservation, replacement rollback, actual test snapshots, cancellation and light/dark layouts. Windows is verified; native macOS/Linux builds and physical two-computer Wi-Fi testing remain unverified.

## Collection management — 0.3

**Library** gathers reusable values from car records, current/factory specifications, saved options, tracks, drivers and custom choice fields. Add an option before entering a car, or choose **Rename / merge** to correct a spelling or combine it with an existing value. The review shows the exact affected cars. You can change suggestions only, or also update matching current car values, including archived cars. Previous spellings resolve to the canonical suggestion; renaming back to an earlier spelling is supported. Earlier setups, tests, factory references, submission packages and journal entries are preserved. Fields controlled by installed inventory are explicitly skipped; correct those stock names in Parts. This library does not merge physical stock lots or individual components.

**Cars → Select filtered → Edit selected** updates up to 1,000 selected cars at once. Enable only the fields you intend to change: owner, location, ownership, availability, racing class, category, condition or packaging. An enabled empty value clears that field. Usage labels and tags support add, remove and replace; replacement with an empty list clears the labels. Review every before/after value before applying. The operation is atomic and rejects stale reviews, with a journal entry on each changed car. Technical specifications and inventory changes remain workshop operations.

**Cars → Columns** chooses and orders 1–16 table columns, including Name. Identity, ownership, technical and custom fields are available. The order is saved as the default table layout; **Save view** also captures its own columns along with filters, sorting and layout. Shared collections use public columns and do not expose private local values.

**Car → Photos & documents → Attach document** stores a private file with a title and category. Supported formats: PDF, TXT, CSV, DOCX, XLSX, ODT, ODS, PNG, JPEG and WebP. Each file can be up to 20 MB, with up to 100 documents per car. Base64-encoded files count toward the existing 200 MB total database limit. Original source files are untouched. Attachments are included in complete backups, excluded from ordinary exports/network reads, and not copied when duplicating a car.

**Open copy** hands a temporary copy to the operating system's default viewer. Edits in another app are not written back into the database; use **Export copy** to retain an editable copy of your own. Temporary copies are cleaned up when SlotForge closes where possible; an external viewer can keep a file locked. Removing an attachment requires confirmation and leaves its original source file and earlier backups untouched.

Version 0.3 validation: 73 automated tests and 36 isolated Electron workflow checks, including choice/history preservation, bulk-edit rollback, saved column order, schema migration, attachment backup/export privacy and document byte preservation. Native viewer handoff is checked using a test replacement rather than launching an external document app. Windows is verified; macOS/Linux builds and physical two-computer Wi-Fi testing remain unverified.

## Assemblies and applying setups

Use **Parts → Assemblies → Build assembly** to group components from available stock. Quantities are individual pieces. Quantity components are separated into dedicated lots; individual components retain their identity. Reserved parts cannot be fitted independently or counted twice. Assign a technical position when you want installation to update the corresponding car specification.

Install or transfer an assembly as a complete group. Removing it keeps the group together and marks its components Used. Dismantling a stored group releases its components to stock; dismantling an installed group leaves its parts installed separately. Existing setup snapshots and history remain unchanged. Use Replace component to change one member while retaining the group. Adding/removing positions or changing quantities still requires dismantling and rebuilding.

Open **Car → Setups → Apply setup**. Select actual components, review inventory movements and before/after settings, then confirm the physical work. The app reuses the original available stock where possible; substitute parts require an explicit selection. Components on other cars are listed by source car and need a separate transfer confirmation. Removed loose quantity stock goes into separate Used lots; removed assemblies stay together. Applied technical fields use the actual chosen components.

The full change is saved atomically, including the affected cars' histories. Missing stock, conflicting positions, a changed database or a failed save cancels the whole operation. Use Work in stages for changes spread across multiple sessions. A dismantled assembly needs a compatible replacement assembly before its old grouped setup can be applied. Quantity stock transfers move a complete installed quantity; split an installed lot through removal and reinstallation first if necessary. Exported car setups remain descriptive snapshots and do not transfer ownership of local stock.

Component selectors update named part fields, not measurements. Pinion and driven gear components have separate fields from their tooth counts. Direct edits and reviewed imports cannot replace an installed component's identity; use the workshop for physical replacements. Correcting an installed stock part's name updates the current car specification while keeping existing setup snapshots unchanged.

## Development and validation

Requires Node.js and npm for source builds. Runtime dependencies are pinned in the lockfile.

```text
npm ci
node node_modules/electron/install.js
npm run check
npm test
npm start
```

`electron . --smoke` runs the scripted desktop workflow against an isolated `.qa/profile` database and writes screenshots and `smoke-result.json` into `.qa`. It never uses the normal user collection. On Windows invoke through npm or use the executable under `node_modules/electron/dist`.

Package on the target operating system:

```text
npm run dist        # Windows portable executable
npm run dist:mac    # macOS DMG
npm run dist:linux  # Linux AppImage
```

The source targets all three desktop platforms. This build is validated on Windows only; macOS/Linux packaging and signing still need native verification. The initial Windows executable is unsigned.

## Full review and fixes — 0.2.1

Reviewed storage and recovery, car editing, inventory and assemblies, setup application, maintenance and test records, import/export privacy, submission review, network lifecycle, Electron isolation, renderer input handling, and packaging. The fixes include:

| Area | Fault corrected |
| --- | --- |
| Partial updates | Imported technical values could erase specifications omitted by the sender. Partial technical, factory and custom-value edits now preserve omitted values. |
| Installed parts | Direct edits could contradict tracked inventory, and renaming stock left current car specifications stale. Changes now respect installed parts; name corrections update current cars without rewriting saved setups. |
| Component positions | Installation selectors offered measurement fields such as weight. Named components and measurements now have separate positions. |
| Inventory edits | A stale editor could overwrite newer stock changes. UI saves now include the reviewed database revision. Tracking mode cannot change after a part has been used. Discarded individual parts can have their notes edited without restoring their quantity. |
| Validation | Backups could contain duplicate identities, malformed review outcomes, missing references or invalid setup inventory and still be accepted. Validation now checks these relationships before replacement. Reserved JavaScript property names are rejected as record IDs. |
| Shared snapshots | Empty setup names and duplicate snapshot identities are rejected on receipt, rather than leaving an unusable review item. |
| File export | Exporting to a chosen filename could overwrite a pre-existing sibling `.tmp` file. Exports now use unique, exclusively created temporary files, flush before rename, and protect the live database even through a hard-link alias. |
| Restore | Invalid backups could stop sharing before failing. Validation precedes confirmation, and sharing changes only after a successful restore. Cancelled and failed restores retain the current collection and sharing session. |
| Network size | A photo-heavy collection could exceed a single-response limit. Bounded pages now load the complete collection, detect concurrent changes, reject duplicate IDs and enforce an overall size limit. |
| Network lifecycle | Concurrent starts, disconnects during connection, repeated submissions and failed UI notifications now have consistent results. Oversized submissions fail before upload; successful submission messages require a host acknowledgement. |
| Review choices | An incoming submission could reset unchecked fields and the reviewer's note. The current review remains intact until explicitly refreshed or completed. |
| Forms | Repeated submit events could create duplicate records. Saving now locks the form and dismissal until completion. Invalid fields in hidden tabs reveal the correct tab. Custom numeric fields allow negative values. |
| Dates and reminders | Date-only values could display a day early outside UTC, and entering old maintenance later could replace a newer reminder. Calendar dates use local display, invalid dates are rejected, and reminders follow the performed date. |
| Collection state | Searches and filters could hide a newly connected collection. Database switching resets collection filters; older asynchronous snapshots cannot roll back newer renderer data. |
| Layout and labels | Long names could overflow narrow layouts; minimum-window wrapping and column sizing are corrected. Maximum-length car names can still be duplicated, and field suggestions include values already stored on other cars. |
| Validation cost | Assembly validation repeatedly scanned the entire inventory. Indexed checks now avoid those repeated scans. |

Validation: 58 automated tests, including a deterministic 350-step workshop exercise; 29 isolated Electron workflow checks; dark/light and minimum-window screenshots; and an npm dependency audit with zero reported vulnerabilities on 30 October 2026. The review uses the separate `.qa/profile` collection and temporary test files. It does not inspect or modify the normal user collection.

Limits of this review: Windows was exercised locally. Network tests use separate service/client instances on the same computer, including a collection larger than 32 MB; physical two-computer Wi-Fi/firewall behaviour remains unverified. Native macOS/Linux packaging, signing, crash/power-loss testing and an external penetration test were not performed. Passing these checks does not establish that every possible defect has been eliminated. Stricter validation refuses malformed backups instead of guessing repairs or discarding records. Existing valid version 0.1 and 0.2 data remains readable; preserve a backup before returning to an older app.

## Full code review and fixes — 0.5.1

Reviewed on 30 October 2026. The review covers all application source modules: persistence and migrations; car and catalogue mutations; parts, assemblies and stock conservation; setup application and staged jobs; tests and historical snapshots; packages and selective review; document/file handling; HTTP sharing and multicast discovery; preload/IPC and Electron isolation; renderer forms, asynchronous updates and packaging. Tests use in-memory stores, temporary files and the separate `.qa/profile`; the normal user collection was not read or modified.

### Confirmed findings and corrections

P1 means a privacy boundary failure worth prioritising; P2 means incorrect behaviour or blocked valid work; P3 means a usability/default-selection defect. These priorities describe the reproduced cases, not an external security assessment.

| Priority | Reproduction and impact | Correction | Regression evidence |
| --- | --- | --- | --- |
| P1 | A restored or hand-edited backup could contain unknown technical keys. Raw HTTP collection responses copied those keys, bypassing the public-field whitelist. | Project shared technical values through the explicit approved field list. Unknown local metadata remains local. | Restored unknown field checked against both `publicCar` and an actual HTTP response. |
| P2 | A package with duplicate photo IDs entered the review inbox but could not be accepted into a valid car. | Reject duplicate photo identities at package validation, before saving the submission. | Malformed package rejected; inbox remains empty. |
| P2 | Fitting the later of two identical inventory-only job rows could fail or be counted against the earlier row. | Match explicitly confirmed rows first and check prior assignments before moving parts. | Fit identical rows in reverse order; verify each has a distinct installation and no outstanding work. |
| P2 | Valid long setting values made a staged adjustment's generated journal text exceed its limit, rejecting the transaction. | Bound the readable summary and preserve full before/after values in structured audit data. | Change between two 15,000-character values and verify the complete stored change. |
| P2 | Renaming a long reusable value could exceed the journal limit and reject an otherwise valid correction. | Bound generated descriptions and store complete before/after changes separately. | Correct a 20,000-character value and verify the original survives in the audit entry. |
| P2 | Applying a setup with many long component descriptions could exceed the journal limit. | Bound the displayed summary; retain the complete movement list and actual configuration in the event. | Apply 60 fittings with long names/references; all 60 movements are retained. |
| P2 | When another database appeared at an existing address, the client reported failure but kept automatically retrying that address. | Treat a detected identity change as requiring explicit pairing; block subsequent automatic reads and pending-submission retries. | Replace host database identity and count requests after detection. This does not authenticate a server or prevent sending the first request needed to detect the mismatch. |
| P2 | Reusing an existing package ID with changed contents received a successful duplicate acknowledgement, concealing that the changed content was not saved. | Compare validated package contents before acknowledging a duplicate; require a new package identity for changed content. | Alter a car under the same package ID; reject it without changing the original inbox item. Existing identical-retry tests still pass. |
| P2 | Individual requests timed out, but a peer could prolong a multi-page transfer indefinitely relative to any overall deadline. | Add a 60-second deadline shared by the whole collection transfer, alongside per-request timeouts and disconnect cancellation. | Delayed transport aborts on the overall deadline without publishing a remote snapshot. |
| P2 | Host permission changes received during an open dialog could leave the Connections page stale after cancellation. | Flush deferred network rendering when the dialog closes, while retaining the existing protection for review fields. | Actual Electron permission update during a dialog, then cancellation. |
| P3 | An incoming submission rerendered the local collection and stole focus/caret position from its search input. | Restore active car/part search focus and selection after the background update. | Actual Electron incoming submission while typing in car search. |
| P3 | Two identical installed inventory-only fittings both defaulted to the same installation in Apply setup, causing the default review to fail. | Assign distinct matching installed defaults to each requirement. | Apply the untouched default selections and verify both fittings remain installed. |
| P2 | Applying an old setup after correcting a stock name wrote the old installation label into the new actual-configuration audit snapshot. | Resolve current stock names when creating the new snapshot; retain historical setup labels unchanged. | Assert corrected name in the new event and original name in the saved setup. |

Regression sources: `tests/full-review.test.cjs` (11 new backend cases) and `tests/full-review-smoke.cjs` (2 new real-renderer workflows). All new cases were reproduced as failing before their corrections. Existing tests also cover rollback on failed persistence, stale revisions, stock overbooking, assembly transfers, malformed imports, duplicate retries, revoked permissions, interrupted reads, privacy, migrations and escaped imported text.

### Validation and scope limits

The automated suite passes **116 tests**, and syntax checks pass for every JavaScript application module. The isolated Electron suite passes **56 workflow checks**, with no captured renderer errors. Dark/light and minimum-window screenshots are inspected. The npm dependency audit reports **zero known vulnerabilities** on 30 October 2026; this is an advisory-database result, not proof that the app or its dependencies have no security defects.

Network coverage includes real HTTP and UDP sockets and independent host/client processes on this Windows computer. Physical two-computer Wi-Fi, firewall/client-isolation combinations, native macOS/Linux builds, signing, real power-loss recovery and external penetration testing remain unverified. Native document viewer handoff uses a test replacement; opening documents in actual third-party viewers is not certified by these checks.

The Windows 0.5.1 build completed successfully and is placed separately in `dist/v0.5.1`. All 18 packaged source/renderer files were checked byte-for-byte against the reviewed workspace, along with the packaged version and entry point. The executable is unsigned. Valid schema-4 collections remain compatible; no schema migration or normal-profile rewrite is required by this patch. Malformed packages with duplicate photo IDs are now refused, including when found in a restored inbox. There is no silent repair or deletion of invalid records. Complete audit values are retained in database/backup records even when generated visible journal summaries are shortened.

### Engineering follow-up before broader distribution

- Sharing uses plaintext HTTP and shared group codes on a trusted local network. It provides neither encryption nor independently authenticated server identity or individual member accountability. A secure internet-facing service would need a separate design.
- Storage is a single JSON document with full snapshot cloning, validation and synchronous writes, capped at 200 MB. Photos, documents and per-step job snapshots contribute to that limit. High-volume lap integration needs a measured storage/retention design before implementation.
- Several core modules use dense, long functions and global renderer state. Smaller transaction handlers and a clearer view/update boundary would make future timing integrations easier to review. This patch fixes concrete failures without undertaking a broad rewrite.
- Run the documented physical two-computer acceptance procedure and build/test on macOS and Linux before describing those environments as validated.

## Planned next

Paddock’s Timing integration host is implemented in current source; the Timing client, RaceCoordinatorAI integration, physical two-computer acceptance and native macOS/Linux packaging still need validation. Later improvements include maintenance based on imported usage; richer ownership history; custom-field exchange; individual member accounts and an optional persistent offline cache; and signed updates.

Paddock receives reviewed Timing results through the documented v1 host API. Race control, measurement and hardware support remain the responsibility of Timing; RaceCoordinatorAI integration is still planned.

The original product scope and screen studies remain in `concept/`. They describe the broader target; the feature sections above describe the current implementation and its release history.
