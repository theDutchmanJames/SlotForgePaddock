# Parts lists

Ready-made parts catalogues for SlotForge Paddock. They are optional and supplied separately from the app: Paddock works without them, and nothing here is installed automatically.

The same files are attached to every [release](https://github.com/theDutchmanJames/SlotForgePaddock/releases), next to the app downloads.

| Catalogue | Edition | Parts | Workshop supplies | Total entries | Download |
| --- | --- | ---: | ---: | ---: | --- |
| Avant Slot | November 2026 | 180 | 0 | 180 | [Avantslot-Parts-List-11-2026.zip](Avantslot-Parts-List-11-2026.zip) |
| BRM | November 2026 | 673 | 1 | 674 | [BRM-Parts-List-11-2026.zip](BRM-Parts-List-11-2026.zip) |
| Carrera | November 2026 | 914 | 4 | 918 | [Carrera-Parts-List-11-2026.zip](Carrera-Parts-List-11-2026.zip) |
| Fly | November 2026 | 146 | 0 | 146 | [Fly-Parts-List-11-2026.zip](Fly-Parts-List-11-2026.zip) |
| NSR | November 2026 | 1,199 | 38 | 1,237 | [NSR-Parts-List-11-2026.zip](NSR-Parts-List-11-2026.zip) |
| PCS | November 2026 | 274 | 0 | 274 | [PCS-Parts-List-11-2026.zip](PCS-Parts-List-11-2026.zip) |
| Policar | November 2026 | 203 | 0 | 203 | [Policar-Parts-List-11-2026.zip](Policar-Parts-List-11-2026.zip) |
| Racer Sideways | November 2026 | 368 | 11 | 379 | [RacerSideways-Parts-List-11-2026.zip](RacerSideways-Parts-List-11-2026.zip) |
| Revoslot | November 2026 | 301 | 0 | 301 | [Revoslot-Parts-List-11-2026.zip](Revoslot-Parts-List-11-2026.zip) |
| ScaleAuto | November 2026 | 1,269 | 132 | 1,401 | [ScaleAuto-Parts-List-11-2026.zip](ScaleAuto-Parts-List-11-2026.zip) |
| Scalextric | November 2026 | 591 | 0 | 591 | [Scalextric-Parts-List-11-2026.zip](Scalextric-Parts-List-11-2026.zip) |
| Sloting Plus | November 2026 | 636 | 78 | 714 | [SlotingPlus-Parts-List-11-2026.zip](SlotingPlus-Parts-List-11-2026.zip) |
| Slot.it | November 2026 | 753 | 61 | 814 | [Slotit-Parts-List-11-2026.zip](Slotit-Parts-List-11-2026.zip) |
| Staffs | November 2026 | 366 | 29 | 395 | [Staffs-Parts-List-11-2026.zip](Staffs-Parts-List-11-2026.zip) |
| Thunderslot | November 2026 | 131 | 3 | 134 | [Thunderslot-Parts-List-11-2026.zip](Thunderslot-Parts-List-11-2026.zip) |

Together: 15 catalogues with 8,361 entries.

Each ZIP holds JSON files grouped by product category, plus the notes and price list that came with them.

## Import a list

1. Download and unzip the list you want.
2. In Paddock, open **Import & Export**.
3. In the parts catalogue importer, select the catalogue JSON files together.
4. Review the products and proposed updates, then import.

New references start at zero owned stock. Your existing quantities, photos, installations and personal details stay as they are. More detail is in the [catalogue import guide](../docs/CATALOGUE-IMPORT.md).

## Check before you import

- Some entries use product types Paddock does not know. Correct their classification in the import review before selecting those entries. The number per catalogue: Avant Slot 5, BRM 23, Carrera 3, Fly 7, NSR 52, PCS 0, Policar 41, Racer Sideways 4, Revoslot 1, ScaleAuto 51, Scalextric 10, Sloting Plus 54, Slot.it 77, Staffs 1, Thunderslot 3.
- Two BRM entries have a product name longer than Paddock's limit of 200 characters. Paddock refuses those two until the name is shortened in the JSON file.
- Product facts and indicative prices have not been independently verified.
- The files are kept exactly as they were supplied.

## For maintainers

Every `.zip` file in this folder is attached to a release automatically when it is published (the "Attach parts lists" step in [the release workflow](../.github/workflows/native-release.yml)). To publish a newer list, add its ZIP here, remove the one it replaces, and update the table above.
