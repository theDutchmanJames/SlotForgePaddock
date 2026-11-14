# English manufacturer catalogues

Download the current kit from **Import & Export → Standard Catalogue → Download research templates**, or use the [standalone JSON template](templates/slotforge-catalogue-kit.json). Choose the complete catalogue or selected research groups. Selected groups are saved as separate JSON files in a new folder, so existing files are not overwritten. Each template includes the relevant specifications checklist, allowed classifications, English instructions and a final self-check for the AI.

Give your AI the complete template and the manufacturer or retailer pages to use. The required output language is English, including product descriptions, packaging, notes and specification descriptions. Brand names, model names, SKUs, URLs, measurements and standard units retain their identities. British English terms such as tyre and aluminium are preferred.

## Focused research and product variants

**Tyres** and **Wheels & accessories** have separate research templates. Both still use the existing **Wheels & tyres** category in Paddock. Complete wheel-and-tyre sets belong to the Wheels & accessories template.

The instructions ask for every actual product variant, not one representative of a range:

- Tyres: every published compound and size combination, material, hardness with its scale, inner/outer diameter, width, front/rear application, wheel compatibility and pack quantity.
- Motors: can family and dimensions, RPM with rated voltage, torque with units and test conditions, shaft dimensions/configuration, weight and mounting compatibility.
- Gears, wheels, axles and bearings: relevant tooth counts, module/pitch, bores, dimensions, materials and fastening methods.
- Chassis, pods, guides, suspension, body parts, electronics, fasteners and workshop supplies: checklists appropriate to their function, dimensions and published compatibility.

Unknown facts stay unknown. The AI must not invent size/compound combinations, SKUs or compatibility, or reinterpret a torque rating labelled only “grams”. One sold kit stays one product. Unavailable ranges and unresolved coverage issues can be reported in top-level `coverageNotes`, shown during review. These instructions improve research but cannot guarantee an AI has found every product or interpreted every source correctly.

## Coverage and indicative prices

When downloading research templates, choose **EUR, USD or GBP**. The choice applies to the complete kit or every selected group file. The standalone template in `docs/templates` leaves currency unset and instructs the AI to ask before researching.

Every group now includes a range-coverage checklist, in addition to its specification checklist. In particular, chassis research explicitly includes **motor pod kits and conversion kits**, not just bare pods: layout, offset, stiffness, compatible chassis, included components and separately required parts. A pod-led kit remains one Motor pod product; its components do not become invented SKUs or owned assemblies. Other groups cover overlooked variants, accessories and service components too.

The prompt asks for an indicative price for every product. Prefer a published price in the chosen currency; otherwise provide a clearly labelled estimate with an explanation. Converted prices are estimates, with the original currency and conversion basis explained. This permission to estimate applies only to prices—specifications, references and compatibility must still be supported by sources.

Prices appear in product review and manufacturer catalogue information. They do **not** change owned stock, purchase costs, shopping prices or inventory values. Pack prices are explicitly distinguished from prices per piece or item.

The optional product `price` object uses:

```json
{
  "amount": 24.5,
  "currency": "EUR",
  "status": "estimate",
  "basis": "pack",
  "explanation": "Indicative estimate based on comparable motors; pack of one.",
  "sourceUrl": "",
  "checkedDate": ""
}
```

`amount` is a finite number from 0 to 1,000,000; currency is EUR/USD/GBP; status is `published` or `estimate`; basis is `pack`, `piece` or `item`. Estimates require an explanation. Published prices require an HTTP(S) source without credentials and the actual checked date in YYYY-MM-DD form. Never use zero to represent an unknown price. Explanations are limited to 2,000 characters, URLs to 2,048. Correct price values in the JSON before importing.

Existing version-1 files without prices remain valid. The optional field stays in catalogue metadata, including backups and Dealership proposals. No Timing or Telemetry protocol changes are required. Research instructions improve coverage but cannot guarantee the completeness or accuracy of another AI's output.

## Import several catalogues together

Choose **Import catalogue files…**, select the completed JSON files together, then review them in one screen. Each row shows its source filename and row number.

Identical valid products are combined. Conflicting versions of the same manufacturer/reference require **Choose a file version**; inspect each version, choose one, then review or correct the product before selecting it. Nothing is silently overwritten. Products without references use their names for duplicate detection and need particular care.

Select products or entire groups, then **Review selected import → Import selected products**. Confirmation is required. Successful imports return to Import & Export. Dealership imports continue through the existing Review process. Back lets you retain an unfinished review during the current app session; it is not a durable saved draft.

New entries have zero owned stock. Updates replace catalogue facts only: existing local names, quantities, installed parts, photographs, personal notes and history are preserved. Invalid rows cannot be selected. An unreadable, empty or wrong-format file rejects the new file selection with a named error and leaves any previous review intact.

One batch supports up to 64 files, 16 MiB per file, 64 MiB of source files in total, and 5,000 source product rows / 16 MiB of product information combined. These bounds apply before duplicate collapse. Repeated template instructions are removed from the import payload. For larger collections, import fewer groups at a time. Standard product files and Illustrated Catalogue picture files are separate workflows.

## Improve an existing list

Attach both the existing list and the current template, then use this prompt:

> Review this existing catalogue using the current SlotForge template's instructions and classification reference. Return the complete corrected JSON in English. Revisit every missing classification using the stated product purpose and source evidence. Preserve row order, manufacturer/SKU identities, numerical measurements and unrelated facts. Do not update source-check dates unless you actually recheck those sources. Keep genuinely unresolved products with a specific English explanation in reviewNotes. Do not invent facts, types or references. Keep the current instructions and reference in the returned JSON so another AI can continue reviewing it.

The guide distinguishes fitted car parts from workshop supplies, full tools from replacement bits, tyre treatment from bearing oil, and combined gear sets from single gears. Added types cover exterior body details, gear sets, wrenches/spanners, driver bits, setup gauges, work mats and tyre treatment. These types require the updated Paddock source; v0.17.1 predates them.

Source evidence still matters. Vocabulary hints are not automatic classification rules, and the app does not translate, scrape or silently reclassify your entries. Blank or unsupported classifications remain visible for correction before import. Existing non-English files are still readable; the new language requirement guides AI generation rather than rejecting old collections.

Import through the existing review screen and select the products you want. Catalogue imports create **zero-owned stock**, not quantities you possess. A gear-set SKU is one catalogue product; it does not automatically create an owned assembly.

For maintainers: regenerate the standalone template with `node scripts/export-catalogue-kit.cjs` after changing the instructions or taxonomy. Automated tests check it against the app's generated kit.
