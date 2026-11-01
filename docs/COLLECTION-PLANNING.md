# Stock planning, setups, reports and showroom shelves

These features are included in v0.18.0.

## Before opening an existing collection

Create a complete backup using your current version. Version 0.18.0 migrates
the database to **schema 10** when it is next saved. Published v0.17.x executables
cannot reopen a schema-10 database. All planning data is included in complete
backups; the public car package and Timing v1 API remain unchanged.

## My stock, Catalogue and Shopping list

Open **Parts → Stock** and choose a view:

- **My stock** includes records with owned quantity above zero, including parts
  currently fitted or reserved in assemblies.
- **Catalogue** includes every part reference, including imported entries with
  zero owned quantity. It does not imply that you own the manufacturer's range.
- **Shopping list** holds intended purchases. Choose a catalogue part, quantity
  in individual pieces, optional active workshop job, supplier, expected date and
  notes. Add a catalogue record first if the part is not listed yet.

Select a part and use **Add to my stock** to record received parts directly, or
**Add to shopping list** to plan a purchase. **Receive parts** supports partial
deliveries. Each confirmed receipt updates both the stock quantity and the
shopping record together. Received purchases remain as history; entirely
unreceived shopping items can be removed. Inventory referenced by a shopping
record cannot be deleted while that record remains.

Receiving stock does not fit it to a car or clear a job's waiting flag. Check the
physical parts and continue the workshop job separately. An individually tracked
record can contain at most one item; use separate records for separate identities.
The shopping picker excludes already-owned individual identities and dedicated
assembly stock. Purchase against the original catalogue record instead. An
unowned individual identity can have only one outstanding piece on order.

The Overview counts **owned part types** as inventory records with quantity above
zero. The smaller line shows available individual pieces and total catalogue
entries. Different lots/conditions can still be separate inventory records.

## Compare configurations

Open **Car → Setups → Compare setups**. Choose any two saved configurations for
that car, or compare either with **Current car**. Technical values and tracked
inventory quantities are shown separately. **Show differences only** hides
unchanged rows. A missing inventory snapshot in an older setup means unknown;
the comparison does not treat it as an empty car. Imported public setups also
have unknown inventory because car packages do not transfer physical stock.
Each column retains its recorded part names; a corrected name alone is not
counted as a physical replacement.

Links below the comparison open workshop jobs and manual tests directly linked
to the selected saved setups. Comparisons are read-only. Applying a setup still
uses the existing reviewed parts/substitution workflow.

## Plan a workshop job

Open a job and select **Edit plan** to set its priority, target date,
waiting status and up to 50 checklist steps. Check steps as you finish them.
Complete every step and clear **Waiting for parts** before completing the job.
Cancellation remains possible and preserves recorded physical changes.
Quick successive checklist clicks are saved in order.

The job's shopping section shows its linked purchases. A setup job also offers
**Shopping need** beside outstanding individual component targets. Review the
quantity yourself: stock may be available elsewhere or a substitute may be more
appropriate. Assemblies can be sourced through individual catalogue components
using the job's shopping section.

Attach up to eight **Before / After** photographs, with captions. They stay in the
job after completion. These are private workshop records; they are not added to
public car photographs or shared with Timing. Editing job plans does not change
the car's actual technical configuration or historical setup snapshots.

## Print or save a PDF

Use **Cars → Print / PDF** for selected cars (or all cars matching the current
filters), or **Car → More → Print / PDF** for one car. Choose:

- **Car cards** with a photograph, useful specifications and a desktop QR link.
- **Setup sheets** with technical specifications and tracked parts; for one car,
  select a saved setup or its current configuration.
- **Club scrutineering sheets** with recorded specifications and blank inspection
  fields. These do not certify compliance with any club's rules.
- **Collection inventory**, with purchase details excluded by default. Select the
  explicit purchase option to include acquisition date, seller, price and currency.

Review the preview, save the PDF, and print using your PDF viewer. Up to 500 cars
can be selected per report. Historical setup notes and private ownership notes
are not printed. Recorded specifications are not substitute measurements.
Current setup sheets use current part names, while saved setup sheets retain
their historical names. The PDF footer prints in the page margin without adding
an extra sheet.

QR links use `slotforge-paddock://car/<database-id>/<car-id>`. A compatible desktop
installation must register that protocol and have the matching collection open.
They do not expose a public web page or provide mobile access. Development runs
do not register themselves as the operating system's handler. Database and car
identities, not names, determine the destination. Moving a portable executable
may require reopening it to refresh its registered location.

## Curate the Showroom

Use **New shelf** to select cars, name the shelf and order it with the arrows.
Select a shelf to browse and present just those cars. The normal showroom search,
usage and favourite filters still apply. Shelf ordering takes precedence over
the sort selector. Archived cars stay in the saved shelf but are hidden until
restored. Deleting a shelf never deletes its cars.

Use **Car → More → Photo framing**, or **Frame photo** in the photo viewer, to
adjust the focal point of a photograph. Save each photograph's framing separately.
The Showroom and car images use it in Fill mode; Fit mode continues to display the
complete photograph. Original image data is unchanged. Replacing a photograph
resets its old framing.

**Presentation** opens a clean slideshow of the current selection. Move to the
top or bottom edge, or tab to controls, to reveal them. Arrow keys change cars,
P pauses/plays, and Escape closes. This works in the app window; use Full screen
when you want it to occupy the display.

Shelves and framing are private preferences stored with the collection and
included in complete backups. They are not part of shared car exports.

## Scope

The wider navigation/UI redesign remains a separate phase requiring design
previews first. Performance analytics and remembered network connections remain
deferred. No Timing client changes are included here.
