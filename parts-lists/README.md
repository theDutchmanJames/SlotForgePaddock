# Parts lists

Ready-made parts catalogues for SlotForge Paddock. They are optional and supplied separately from the app: Paddock works without them, and nothing here is installed automatically.

The same files are attached to every [release](https://github.com/theDutchmanJames/SlotForgePaddock/releases), next to the app downloads.

| Catalogue | Edition | Parts | Workshop supplies | Total entries | Download |
| --- | --- | ---: | ---: | ---: | --- |
| NSR | November 2026 | 1,199 | 38 | 1,237 | [NSR-Parts-List-11-2026.zip](NSR-Parts-List-11-2026.zip) |
| ScaleAuto | November 2026 | 1,269 | 132 | 1,401 | [ScaleAuto-Parts-List-11-2026.zip](ScaleAuto-Parts-List-11-2026.zip) |
| Slot.it | November 2026 | 753 | 61 | 814 | [Slotit-Parts-List-11-2026.zip](Slotit-Parts-List-11-2026.zip) |

Each ZIP holds JSON files grouped by product category, plus the notes and price list that came with them.

## Import a list

1. Download and unzip the list you want.
2. In Paddock, open **Import & Export**.
3. In the parts catalogue importer, select the catalogue JSON files together.
4. Review the products and proposed updates, then import.

New references start at zero owned stock. Your existing quantities, photos, installations and personal details stay as they are. More detail is in the [catalogue import guide](../docs/CATALOGUE-IMPORT.md).

## Check before you import

- Some entries use product types Paddock does not know: 52 in NSR, 51 in ScaleAuto and 77 in Slot.it. Correct their classification in the import review before selecting those entries.
- Product facts and indicative prices have not been independently verified.
- The files are kept exactly as they were supplied.

## For maintainers

Every `.zip` file in this folder is attached to a release automatically when it is published (the "Attach parts lists" step in [the release workflow](../.github/workflows/native-release.yml)). To publish a newer list, add its ZIP here, remove the one it replaces, and update the table above.
