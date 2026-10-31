# English manufacturer catalogues

Download the current kit from **Import & Export → Manufacturer catalogues → Download import kit**, or use the [standalone JSON template](templates/slotforge-catalogue-kit.json). It includes all supported part and workshop-supply types, exact allowed classification combinations, examples, translation vocabulary and a final self-check for the AI.

Give your AI the complete template and the manufacturer or retailer pages to use. The required output language is English, including product descriptions, packaging, notes and specification descriptions. Brand names, model names, SKUs, URLs, measurements and standard units retain their identities. British English terms such as tyre and aluminium are preferred.

## Improve an existing list

Attach both the existing list and the current template, then use this prompt:

> Review this existing catalogue using the current SlotForge template's instructions and classification reference. Return the complete corrected JSON in English. Revisit every missing classification using the stated product purpose and source evidence. Preserve row order, manufacturer/SKU identities, numerical measurements and unrelated facts. Do not update source-check dates unless you actually recheck those sources. Keep genuinely unresolved products with a specific English explanation in reviewNotes. Do not invent facts, types or references. Keep the current instructions and reference in the returned JSON so another AI can continue reviewing it.

The guide distinguishes fitted car parts from workshop supplies, full tools from replacement bits, tyre treatment from bearing oil, and combined gear sets from single gears. Added types cover exterior body details, gear sets, wrenches/spanners, driver bits, setup gauges, work mats and tyre treatment. These types require the updated Paddock source; v0.17.1 predates them.

Source evidence still matters. Vocabulary hints are not automatic classification rules, and the app does not translate, scrape or silently reclassify your entries. Blank or unsupported classifications remain visible for correction before import. Existing non-English files are still readable; the new language requirement guides AI generation rather than rejecting old collections.

Import through the existing review screen and select the products you want. Catalogue imports create **zero-owned stock**, not quantities you possess. A gear-set SKU is one catalogue product; it does not automatically create an owned assembly.

For maintainers: regenerate the standalone template with `node scripts/export-catalogue-kit.cjs` after changing the instructions or taxonomy. Automated tests check it against the app's generated kit.
