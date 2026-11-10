# Rebuilding a car

A rebuild creates a **new physical configuration with its own car ID**, linked to the original. The original remains in the collection as an archived historical record; its existing photos, setups, work history, manual tests and imported race results stay with it.

## Start and plan

- On a car: **More → Start rebuild**.
- In **Build from Scratch → Rebuild an existing car**.
- In **Workshop → New workshop job**, choose **Rebuild** and the **Rebuild into a linked new car** work plan.

Starting creates a Workshop job and a saved builder draft. Select fitted parts or complete assemblies to reuse, then add replacements from inventory or the catalogue using the diagram. At least one reused or new part is required. Empty positions are allowed. A reused component and a replacement cannot occupy the same technical position.

Choose whether to copy the original main photo and untracked specifications. Replacing/removing a tracked motor, pinion, driven gear or front/rear tyres clears its dependent rated/measured RPM, voltage, torque, tooth-count or tyre-diameter values; enter the replacement's specifications. New component selections also clear these old values. Reused gear specifications feed the ratio calculator. The new car starts with its own private notes; ownership/private notes and race history are not copied.

Use **Save plan & update shopping** to resume later and create purchases for missing parts. Shopping entries name the build and open it directly. Saving again reconciles quantities instead of duplicating the purchase. Receive the parts into stock before completing the car. Stock is not reserved and nothing is fitted until completion. If the original changes, **Refresh original** and check the revised selections. Other active Workshop jobs must be completed or cancelled first. A rebuild's checklist must be finished and Waiting for parts cleared before completing it.

## Complete

**Review & save to Cars** shows the parts to fit and the number of unselected pieces to return. One atomic transaction:

1. Saves a **Before rebuild** snapshot on the original.
2. Creates the successor, transferring selected reused parts and intact assemblies.
3. Returns other fitted components to **Used spares**, keeping assemblies together.
4. Installs the selected replacement stock, and optionally saves an **As built** setup.
5. Completes the Workshop job, archives the original as **Rebuilt**, and links both car pages.

The original technical values remain a record of its pre-rebuild state. The **Rebuilt as** and **Rebuilt from** cards sit beneath Current configuration. Follow either card to the other car. A successor can later be rebuilt again, producing a chain of distinct records.

Cancel an unfinished project from its Workshop job; cancellation removes its draft and unreceived planned purchases without transferring parts. Received stock and purchase history remain. Completed links cannot be restored as a second active original or permanently deleted individually. Full database reset retains its existing explicit confirmation/recovery rules.

In Dealership Mode, starting a project, saving a plan and editing its Workshop job save directly. Opening **Build Editor** reads the existing draft without submitting another change. Completing a rebuild creates a new car and still requires Review; the original remains unchanged until approval.

## Timing and Telemetry

New Paddock work and setups use the successor. Timing catalogues see the original archived and the successor as a new active car. Existing race captures, queued deliveries, corrections and withdrawals keep their original IDs and configurations—even when delivered after the rebuild. They are never silently moved to the successor, and old mileage/records are not counted twice.

The additive rebuild integration contract (internal development reference) lets clients look up the successor. Timing can use that information when selecting a car for a **future** race; its client must add that navigation to offer an automatic successor choice. Existing cached/offline race captures remain attached to their original car. Telemetry keeps analysing the delivered historical sessions, with an optional lineage lookup for cross-build comparisons.

Complete backups preserve rebuild links and drafts. Ordinary car export/import packages remain independent copies and do not transfer database-local lineage links.
