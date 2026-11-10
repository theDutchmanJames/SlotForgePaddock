# Research a slotcar product with your own AI

Use this for the miniature's product information and original specifications. The separate **Real Car History** template researches the full-size car and racing entry.

## Workflow

1. Open the car's **Edit details** and enter its **Slot-car manufacturer** and complete **Product reference**, including suffixes. Add the scale and identifying model/livery details when known.
2. Open **Technical & parts → Research this slotcar**, or **More → Research slotcar…**.
3. Choose **Download slotcar template**. Give the JSON file to your own AI and, optionally, the manufacturer's product-page or catalogue URL.
4. Ask the AI to follow the included English instructions and return the completed JSON file. It should verify the manufacturer/reference pair, cross-check the variant and scale, and try to consult at least five independent sources. Three or more agreeing on an individual specification count as AI-reported verification; copied listings do not count as independent sources. Record agreement counts, shortages and conflicts in `uncertainty`. Leave disputed or unsupported values blank. URLs are optional.
5. Choose **Import slotcar research…**, check the product match and research notes, and select individual suggestions or use **Select all changes**. Use **Clear selection** to start again, or untick anything you do not want. Nothing is selected automatically. The separate product-match confirmation and current-configuration option remain manual.

Paddock has no built-in AI. Exporting/importing a template does not contact a website or send your collection anywhere.

## Product matching

The slotcar manufacturer and full product reference are the primary key. The miniature's name, real-car marque/model, scale, livery, race number and edition are cross-checks. An EAN, chassis family, real-car brand or similar model name is not a substitute for the product reference.

Import requires an `exact` identification with matching manufacturer/reference. `ambiguous` and `not-found` identifications are rejected. A supplied scale must match the existing car and proposed scale. Whitespace at the ends and letter case are ignored when comparing the AI's matched manufacturer/reference; reference suffixes and punctuation remain significant.

The original template identity must still match the current car. If its manufacturer, reference or scale changes, download a new template. Templates are also bound to the Paddock database ID and physical-car ID, so a file for one car cannot accidentally update another.

These checks validate consistency, not historical or product truth. Paddock cannot prove that the AI visited a URL or interpreted it correctly. Review the exact SKU, edition and production variant against the product box and available evidence. Verification is reported by the external AI, not independently checked by Paddock.

## What gets imported

- Selected identity fields: product category, racing class, car marque/model, scale, slotcar release year, represented vehicle year, livery, colours, race number, printed team/drivers, represented event, edition and product description.
- **Product category** (`category`) describes the type of miniature, for example GT, Prototype or Formula. **Racing class** (`raceClass`) is a documented class represented by that product, such as GT3 or LMP2. Both are editable suggestions, not a guarantee that the car meets your club's rules. Unsupported classifications stay blank. Owner, condition, location, purchase details and individual serial numbers stay manual.
- Selected original technical fields: body, chassis, motor, ratings, gearing, axles, bearings, wheels, tyres, guides, braids, lighting, digital compatibility, decoder, magnets, suspension, weight and dimensions.
- Technical suggestions go to **Factory reference**, preserving the car's current configuration by default.
- A car with **no current specification values and no fitted inventory** can explicitly initialise its current configuration from selected factory fields. This avoids mixing a replacement motor with the original motor's RPM/torque or combining changed gearing with guessed factory values.
- Sources and uncertainty for the selected fields and product identification are appended to **Factory reference → Technical notes**. Existing notes remain. Reimporting an identical selected block does not duplicate it. These notes are a record of what was imported, not a permanent assertion that a later manual edit has the same evidence.

The workflow does not create or install inventory parts, rewrite saved setups, change historical race configurations, download photographs, or edit private ownership data. Dealership edits use the normal proposal and approval process. Complete backups preserve factory reference notes; public integration catalogue data remains unchanged unless you explicitly initialise current specifications or change public identity fields.

## File contract

- `format`: `slotforge-slotcar-research`
- `version`: `1`
- `language`: `en`
- `target`: unchanged `databaseId` and `carId`
- `reference`: unchanged identifying context exported by Paddock
- `identification`: `status`, `maker`, `reference`, `scale`, `uncertainty`; optional `sourceUrls`
- `research`: allowed field keys, each containing `value` and `uncertainty`; optional `sourceUrls`
- Optional `sources`: objects containing `title` and `url`

The exact field list and instructions live in [the research model](../renderer/slotcar-research-model.js) and are included in every downloaded template. Slotcar and Real Car History research files use different format identifiers and cannot be interchanged.

New templates omit `sourceUrls` and `sources` entirely. Missing or empty source lists are accepted. Older version-1 files with URLs remain supported; supplied URLs must still be safe HTTP/HTTPS links listed in `sources`. Unknown values remain empty strings. Numeric specifications use plain positive decimal strings: millimetres, grams, volts, RPM and gf·cm, as labelled. Gear teeth are positive integers. Motor type uses `Brushed DC`, `Brushless` or `Unknown`; torque type uses `Stall`, `Rated running` or `Unknown`. A bare torque claim in grams must not be interpreted as gf·cm without evidence.

Limits: 1 MiB input file; 20 sources; 20 URLs per field; 500 characters per value (description: 3,000); 1,000 characters per uncertainty; source titles 200 characters and URLs 2,000. Combined factory notes remain subject to their existing 20,000-character limit. English is required by the prompt and the `language` declaration; Paddock does not automatically translate or detect the language of every sentence.
