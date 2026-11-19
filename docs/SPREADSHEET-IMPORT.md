# Import cars from CSV or Excel

Open **Import & Export → Import car spreadsheet → Choose CSV / XLSX**.

1. **Check file:** choose the worksheet and the row containing column headings. CSV imports also let you choose comma, semicolon or tab separation. Use **Refresh file preview** to see changes. Date order, decimal separator and label separator are under **Date, number and label formats**. Click **Match columns**.
2. **Match columns:** the spreadsheet keeps its original headings, row numbers and cell alignment. Each column has a Paddock field button directly below its heading. Click it to search every editable field or filter by field group. **Do not import this column** greys out that column. Map one column to **Identity → Display name**; duplicate assignments are flagged before continuing. Scroll sideways for additional columns, then click **Choose cars**.
3. **Review & import:** tick the cars you want. Unmatched valid rows are initially selected; possible matches and repeated entries within the file are left out. **Review match** lets you explicitly choose a new car or a listed existing car. Selecting an existing car shows its current values alongside the spreadsheet. Tick individual fields and click **Keep this choice**, or return without changes. Filters and pages do not narrow the final import selection. The footer always reports totals across the entire file.
4. Click **Import … cars**, check the separate totals for new cars, updates and excluded rows, then confirm. Progress is saved per car. In Dealership Mode these are proposals for normal Dealership approval; receipt does not mean approval. **Done** closes the completed import. Previously skipped rows can be included later without replaying saved cars.

**Save for later** retains the current mapping or field selection. Resume through **Review → Spreadsheet imports → Saved imports**. Closing with the corner X leaves the last saved selection intact. Imports pause on an error; successful rows stay saved. Retry recovers the original operation rather than creating another car. **Review again** on a failed local row checks its durable receipt before allowing changes to its selection. Restoring a collection blocks replay of an old import.

Returning from review to column mapping asks for confirmation because it resets row choices and field selections. Mapping becomes fixed once saving has begun. The grid is a preview of your source values, not a spreadsheet editor; correct source-cell errors in the original file and import the revised file.

The file and mapping grids scroll through every spreadsheet row, with headings and assignments pinned at the top. Rows load as you scroll; larger files do not create thousands of on-screen rows at once. Scrolling preserves your field assignments and never imports a car.

## Fields and preservation

Available fields cover identity, ownership and collection details, Current specifications, Factory specifications, Real Car History, usage labels, tags and existing custom fields. Custom fields must be defined in Settings first. Current and Factory specifications are distinct; ambiguous headings such as “Motor” require your choice.

Blank cells never erase existing data. Updates include only selected fields. Installed-part conflicts are rejected; deselect those changes or manage the installation in Workshop. Photos, documents, inventory installations, saved setups, actual lap history, internal IDs and calculated values are not spreadsheet columns. Existing records and integrations continue using their normal IDs and write rules.

Manufacturer/reference, collection number and name matches are suggestions only. A product reference is not a unique physical car identifier, and the importer never merges cars automatically. New rows are ordinary My Cars entries; updating an existing Wishlist car preserves its Wishlist status.

## File handling

- One worksheet at a time, up to 5,000 data rows plus a heading, 200 columns and 16 MiB per source file. Larger files can be split.
- CSV supports UTF-8 and BOM-marked UTF-16. Export other encodings as UTF-8 first.
- Excel uses saved cell values and number formatting, including displayed leading zeros. Formulae are not executed; recalculate and save in Excel when cached results are missing or stale. Macros, hyperlinks and embedded pictures are not executed or downloaded.
- Text dates use ISO `YYYY-MM-DD`, or the explicitly selected day/month/year or month/day/year order. Currency is mapped separately from numeric prices. Blank or invalid required values are explained per row.
- Parsing runs in a bounded worker. Preview checks car metadata, and imports use individual durable car commands; media and the full collection are not sent to the renderer for review.
- Saved import reviews are private profile data in `spreadsheet-imports.sqlite`, separate from the collection and its exports. Removing a completed review never removes cars or Dealership proposals. Keep the original spreadsheet if you need to resume on another computer.

Existing Timing/Telemetry transport schemas are unchanged. Local imports use the same canonical car writes as Paddock's editor. Dealership proposals reuse the existing car-save approval protocol and retain the exact proposal for retries.
