# SlotForge Slotcar Database Consolidated Concept

A desktop application for slot-car collectors, racers and clubs, with collection management and workshop history given equal importance. It starts with an empty database and works independently of race-timing software. The product name remains open between **SlotForge Garage** and **SlotForge Paddock**.

This is the consolidated concept from the discussion on 30 October 2026. It records the agreed direction and the working behaviour proposed during design; implementation has not started. Screen designs use illustrative records and are not functional software.

# Product scope

- Support Windows, macOS and Linux.
- One application can keep a personal database, share a database on the local network, and connect to another installation.
- Users manually create cars; there is no pre-populated manufacturer catalogue. Duplication and importing shared records reduce repeated entry.
- Personal collections will usually contain fewer than 100 cars. Larger collections and club fleets must remain practical.
- Track all kinds of slot-car parts, with extensible categories.
- Support reusable values, custom fields, tags, saved views, photos and attachments.
- Follow SlotForge Timing's visual style: horizontal main navigation, themed panels, rounded controls, familiar tables and forms, section rails, configurable colours and light/dark themes.
- SlotForge Timing and RaceCoordinatorAI integrations are core future features, implemented in the final development stage.
- Live timing, race control and hardware control are outside this app's core scope.

# Cars and collection organisation

Each physical car has a permanent identity independent of its name, manufacturer reference and collection number. Sharing retains that identity; duplicating a car creates another identity. A planned acquisition can be entered before ownership and completed when the car arrives.

Only a display name is required initially. Other information is optional, and unknown values remain blank. A correction is distinct from a physical modification.

| Group | Fields |
| --- | --- |
| Identity | Display name, collection number, slot-car manufacturer, product reference, real-car marque and model, scale, vehicle year/range, slot-car release year |
| Appearance and provenance | Livery, colours, represented race number, team, drivers and event/year, edition, individual serial number, factory/kit/scratch-built origin |
| Ownership | Ownership state, owner, acquisition date/method/source, price and currency, additional costs, dated valuation and source, disposal details |
| Condition and organisation | Condition and notes, packaging, completeness, collections/groups, availability, hierarchical storage, loans |
| Classification | Vehicle category, multiple racing classes, usage labels, tags, general description, favourites and archive state |
| Media | Main photo, additional photos, chassis/parts images, instructions, receipts and other documents |
| Extensions | Custom text, choices, multiple choices, numbers with units, dates, yes/no and long-note fields |

**Usage labels** are reusable and allow multiple selections. Starting choices: Collection / Display, Home racing, Club racing, Competition, and Testing / Development. Users can add labels such as Loaner or Restoration project. These replace the earlier simple Purpose field. Filters can match any or all selected labels and save the combination as a view.

Club ownership remains separate from club use. Vehicle category is separate from racing-class eligibility. Club inspection and approval are separate dated club records, not implied by selecting a class.

Collection numbers, storage, local tags and other organisational details can differ between the owner's database and the club's copy. A later submission must not overwrite local club information.

# Reusable input and privacy

Textual categories and component choices offer searchable existing values plus an explicit Add new option. Values become reusable after saving. Users can rename, merge duplicates and archive choices. Custom choice fields behave the same way. Numbers, dates and notes retain appropriate inputs rather than becoming indiscriminate labels.

A reusable motor definition can be named **NSR King Evo — 21,500 RPM**, with manufacturer, model, rating and rating voltage as separate optional details. This definition is not a specific physical motor. Many cars can use the same type; individually tracked motors have additional identities and histories. Rated specifications and measurements are distinct.

| Sharing category | Default treatment |
| --- | --- |
| Standard | Car identity, class, main image and current technical description appear in the sharing preview |
| Optional | Extra photos, setups, maintenance, testing, tags and other selected history can be included |
| Private | Prices, receipts, valuations, personal contacts, loans, storage and private notes are excluded unless explicitly selected |

Every transfer shows exactly what will be shared. Individual attachments and custom fields have sharing preferences. Shared-database permissions separately govern visibility. An omitted field means not supplied, never an instruction to delete an existing value.

# Technical information and parts

Factory specifications, the current physical configuration and saved setups are distinct. Unknown current information is not automatically assumed to equal the factory specification. Explicitly distinguish unknown from not fitted.

Technical groups cover body; chassis; motor and pod; rated/measured motor performance and voltage; transmission; front/rear axles, bearings and spacers; front/rear wheels and tyres; guide and pickup; wiring and lighting; digital systems; magnets; ballast; suspension; fasteners; overall measurements; and notes. Categories and fields can be extended.

Record units explicitly. Preserve manufacturer values separately from measured values and record measurement dates where relevant. Calculate gearing from tooth counts with a clear displayed convention.

| Record | Purpose |
| --- | --- |
| Component definition | Reusable description and specifications of a part type |
| Quantity stock | Interchangeable parts counted by specification, condition and location |
| Individual component | One identifiable physical component with measurements and history |
| Installation | The part, car, position, quantity and installation/removal dates |
| Assembly | A group of constituent parts that can be moved together or dismantled |

A package of two tyres adds two tyres unless it is intentionally tracked as an indivisible assembly. Do not double-count an assembly and its constituents as available stock.

Installing parts moves them from available stock to the car. Removal records a destination such as spares, inspection, another car or discarded. Used and unused stock stay distinguishable. Physical components cannot be installed in two cars at once.

Users may describe a fitted part without first entering inventory. Detailed tracking can be added later. Inventory corrections do not pretend that physical installation occurred. Selling a complete car can transfer its installed components; dismantling can return selected parts to stock. Historic installations survive disposal.

# Setups maintenance and performance

A setup version records the car, component types and tracked identities, quantities, measurements, adjustments, intended track/conditions, author, date, notes and attachments. Settings can include gearing, tyre diameter/treatment, ballast placement, axle play, ride height and body/pod screw positions.

**Save setup** captures a configuration; it does not move inventory. **Apply setup** compares the target with the car, checks availability and lets the user confirm the work actually completed. Missing parts remain visible. Substitutions and transfers from another car are explicit. Partial completion updates only confirmed changes and leaves remaining work outstanding.

Earlier setup versions retain their original values even when reusable definitions change. Tests and later race results link to the configuration actually used. A different physical component of the same type is recorded as such.

Maintenance entries record work, date, person, parts/materials used, notes and media. Reminders are task-specific and can use calendar time or usage. Replacing braids must not reset a motor-service interval.

Manual tests support date, setup version, track, lane, driver, voltage, optional lap figures and handling observations. Manual usage totals are labelled by origin so later timing imports can be reconciled without double-counting.

The timeline distinguishes modifications, servicing, tests, ownership events, corrections and sharing events. Archiving preserves history; changing a current configuration never rewrites a past test.

# Local network sharing

Every installation is the same application. Sharing and connecting are roles selected within it, not separate products. A user can retain a personal collection while browsing a connected club database.

Connections offers the current database, Share this database, available databases, saved connections, connected users, submissions and activity. Pairing uses a code or password. Local-network discovery has a manual-address fallback; Wi-Fi and wired clients can participate when the network allows communication.

The sharing installation handles requests and changes through an application service. Other computers do not directly open the same database file. Live access requires that installation to be running and reachable.

Working access roles are View, Edit and Manage, with explicit review authority and visibility restrictions for private information. Concurrent edits must detect conflicts rather than silently overwrite.

Everyone authorised to connect can submit cars and updates. Submitting does not itself grant direct editing permission. Explicit contributions and review come first; automatic cross-database updates are deferred.

A read-only cached view after disconnection is a proposed convenience, clearly showing its last update. Offline editing and later merging are not part of the initial networking design.

# Submissions and portable packages

Direct submissions and imported files follow the same review workflow.

1. Select one or more cars and the information to include.
2. Preview the outgoing package and privacy choices.
3. Send to a connected database or export a portable package containing the selected records and embedded media.
4. The recipient receives a pending submission. Existing shared records remain unchanged.
5. An authorised reviewer sees a new-car preview or field-level differences.
6. Accept all, accept selected changes, or reject with an optional explanation.
7. Preserve submission source, date and review outcome.

A first accepted submission creates a shared car record linked to the original identity. Later submissions target that record instead of duplicating it. Identical product names do not prove two cars are the same physical object.

Club-only inspections, approvals and storage remain local. Conflicts are visible; neither a newer timestamp nor a repeat import silently wins. If a record changes while review is underway, refresh the comparison before approval.

Shared records remain after the contributor disconnects. Deleting a personal copy does not automatically delete the club copy. Sharing a record does not transfer ownership.

Map imported reusable choices and custom fields where appropriate. A normal car package adds or updates reviewed records. Complete database backup and restore is a separate operation. Complete backups must include referenced media; restore consequences must be explicit.

# Future timing integration

SlotForge Timing and RaceCoordinatorAI are both intended integration targets, implemented last. The standalone app must remain useful without either installed.

| Information | Primary source |
| --- | --- |
| Car identity, technical specifications, setups and maintenance | Slot-car database |
| Recorded laps, sessions and race results | Timing application |
| Inspection and local approval | Receiving club |

The intended flow is startup retrieval of changed car information, followed by return of completed session data. Integration support is required in each timing application; merely sharing the database cannot enable this automatically.

Design now for stable car identities, external identity mappings, unique session/lap identities scoped to their source, provenance, revisions/corrections and duplicate prevention. Preserve setup snapshots for races, queue failed transfers, and expose last successful transfer and retry status.

RaceCoordinatorAI's reviewed API reference describes history APIs and CSV exports but does not list a dedicated car entity. Car matching and supported exchange direction remain investigation items for that final stage.

References: [SlotForge Timing](https://github.com/theDutchmanJames/SlotForgeTiming), [RaceCoordinatorAI](https://github.com/daufderheide/racecoordinator_ai), [RCAI API reference](https://github.com/daufderheide/racecoordinator_ai/blob/main/API_CALLS.md).

# Screen structure

Main navigation: Overview, Cars, Parts, Workshop, Connections, Import & Export, Settings. A visible database selector and connection/access indicator always identify where the user is working.

**Cars:** gallery and configurable table, search, reusable filters, any/all usage filtering, saved views, sorting, adjustable card details/columns, Add car, and selection-only bulk actions. Returning from a car restores the previous list context. Empty optional information generates no completion-score pressure.

**Car profile:** a full page with photo, identity, database context and actions. A left section rail contains Overview; Identity & ownership; Technical & parts; Setups; Maintenance; Performance; Photos & documents; History. Editing has clear Save and Cancel actions. Record work separates physical modifications from corrections.

**Parts:** searchable stock, individual components, assemblies, condition and location, available versus installed quantities, installation history and explicit transfers.

**Connections and review:** personal/club context, sharing controls, pending submissions, before/after comparisons, selective approval and protected club-only details.

Carry over SlotForge Timing's dark and light themes, accent colours, control shapes, tables, forms and section rails. The designs use the dark palette as the first visual reference: background #171b21, panels #222831, text #e8e6e1, muted text #98a0ab, borders #343b47 and accent #e5484d. The product name is intentionally provisional.

# Development sequence and open decisions

This sequence is proposed for implementation planning; it is not permission to start coding.

1. Foundation: cross-platform desktop shell, local storage, identity, media, backups and the shared visual system.
2. Collection: manual entry, reusable choices, gallery/table, usage labels, custom fields, saved views and car profiles.
3. Workshop: parts inventory, assemblies, installations, setup versions, maintenance and manual testing.
4. Exchange: portable car packages, identity matching, selective review and private-field handling.
5. Networking: share/connect, permissions, concurrent-edit handling and the same submission review over the local network.
6. Timing integration: SlotForge Timing and RaceCoordinatorAI, followed by validated round-trip results and correction handling.

Still open: final name; exact field vocabulary/defaults; detailed authentication and per-field visibility policy; backup retention; packaging/signing/update delivery for each operating system; offline cache scope; and the precise capabilities of both future timing connectors.

The screen drawings are visual proposals for reviewing hierarchy and workflow, not working software or a commitment to every sample label.
