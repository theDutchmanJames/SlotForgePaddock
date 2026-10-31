SlotForge part and workshop icon library

113 monochrome SVG icons. Original 62 drawings supplied by the user in
slotcar-library-62-icons.zip. The 51 additions cover 15 further part/general
symbols and all 36 workshop supply types in the current catalogue.

All artwork uses a 256 x 256 view box. Additions use rounded 8px strokes.
These are simplified identification symbols, not dimensioned drawings.

renderer/icon-catalogue.js defines labels, categories, automatic mappings and
the five colour presets plus theme default. Renderer colours adapt to the
selected light/dark tone; no manufacturer-to-colour assignment is assumed.

Run npm run build:icons to regenerate additions and renderer/icon-art.js.
scripts/build-icons.cjs is the editable source for the new artwork. Existing
original SVG files are preserved; their fixed root colour is omitted from
the generated inline artwork so icons inherit the app's selected colour.
