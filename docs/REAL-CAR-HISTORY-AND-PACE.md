# Real Car History and Compare pace

Implemented in the working source after v1.0.1; not yet released.

## Real Car History

Open a car and choose **Real Car History → Edit history**. Everything is optional.
Record the full-size entry represented by the model: livery classification, team,
drivers, event/circuit, year, race number, qualifying and finishing result, notes,
and up to 20 source links. Classification defaults to **Unverified**. Results are
text so DNF, DNS, class results and incomplete information can be recorded honestly.

Reference photographs have their own gallery (up to eight images) with captions,
credits and source links. They do not replace the slotcar's showroom photographs.
Source links open in the default browser only when clicked. Research tools run
only when requested; no automatic verification or image downloads are performed.

The record is saved on the car and included in full backups and Dealership review
and replication. Paddock car packages include history text and sources. The existing
additional-photos export option also includes reference photos. A text-only import
does not delete destination reference photos. Duplicating a model copies its
real-car research, not its physical race/service history.

The lightweight public catalogue, Timing profiles and Timing-format car exports
remain unchanged and do not carry real-car research. Older Paddock versions do not
understand this new package field; use matching versions to transfer it.

### Research with your own AI

1. Open the car's **Real Car History** section and choose **Download research template**.
2. Give that JSON file to your own AI, optionally with URLs of relevant sources.
   Ask it to follow the instructions in the file and return the completed JSON.
3. Choose **Import research JSON…** on the same car.
4. Review each proposed value beside the saved value. Select only the fields to
   accept, then choose **Import selected fields**.

Paddock contains no AI service, credentials or AI requests. The template includes
only the car's identifying fields and empty research fields, plus its database/car
IDs. It excludes ownership, private notes, photographs, technical setups and lap
records. The user chooses whether to share the file with an external service.

Instructions explicitly request English descriptions, consulted source links,
uncertainty, and no guessing. Proper names retain their original spelling. The
importer checks the declared language and structure; it cannot verify that prose
is English or that a source supports a claim. Blank values are skipped. The
default Unverified classification is not proposed as a replacement. No selection
is made automatically. Unselected fields and reference photographs are preserved.

The format is `slotforge-car-research`, version `1`, language `en`. `target` holds
`databaseId` and `carId`; it must match the selected car. `research` uses the keys
`classification`, `team`, `drivers`, `event`, `year`, `raceNumber`, `qualifying`,
`finish`, and `history`. Each entry contains a string `value`, an array of
`sourceUrls`, and a string `uncertainty`. `sources` lists `{title, url}` objects;
every field source URL must also be listed there. The downloaded file contains
the complete editable structure and instructions. Keep its identity and format
fields unchanged, and return JSON without Markdown fences.

Limits: 1 MB file; 500 characters per value (20,000 for history); 1,000 per
uncertainty; 20 sources with 200-character titles and 2,000-character HTTP/HTTPS
URLs. Accepted fields retain their import method, source links and uncertainty
under **Imported research · sources and uncertainty**, including in backups and
Paddock packages. Editing a field manually removes its old import evidence.
Concurrent car changes invalidate an open review instead of overwriting them.
Dealership copies use the existing proposal/review workflow when saving.

### Generic webpage reader

**Read webpage…** accepts a user-supplied public HTTP/HTTPS URL. It looks for
English-labelled key/value table rows and definition lists, standard page
descriptions, and supported JSON-LD descriptions or labelled properties. It uses
the same field-by-field review and preserves the final page URL as the source.
Multiple proposed values for a field are kept separate; choose one. It does not
determine which race entry matches the model, infer livery classifications,
translate prose, search the web, or use AI or website-specific adapters.

Complex race results tables, PDFs, photographs, login/challenge pages and
JavaScript-only content are unsupported. Some pages offer only a description;
some offer no usable fields. Website compression or unsupported text encodings
may also prevent reading. Use another page, manual entry, or the research
template in those cases. Extraction does not establish historical accuracy.

Requests carry no browser cookies or credentials and do not execute page scripts
or fetch embedded resources. Only public addresses on standard HTTP/HTTPS ports
are allowed; DNS addresses are checked and pinned, redirects are rechecked.
Each request is limited to 15 seconds, three redirects and 2 MB of HTML.
Only one webpage request runs at a time. Nothing polls in the background.

## Manual session conditions

**Performance → Record test** already records track, lane, driver, voltage, laps,
best/average lap and a configuration snapshot. It now also records direction
(Unknown / Clockwise / Anticlockwise) and traction-magnet status
(Unknown / With magnets / Without magnets). They describe the test at that time,
not the car's current specifications. Older tests retain Unknown values.

Timing v1 has lane/heat/stint/driver data and captured configurations but no
structured session voltage or direction. Its magnet description is free text.
Comparison therefore treats these three conditions as Unknown for delivered
Timing sessions. Future structured context needs coordination with Timing; this
change does not alter the Timing API, signed configurations or stored payloads.

## Compare pace

### Lane records

Each car's **Performance** page includes **Lane records**: the fastest eligible
measured lap for each Timing track identity and lane, with driver, date, session,
heat, lap number and the configuration recorded before racing. **View record**
shows the historical specifications and links to the underlying session.

Only active, non-overlapping sessions with a physical linked car contribute.
Invalid, pit and non-record-eligible laps are excluded. Accepted corrections and
withdrawals recompute the summary, allowing the next eligible lap to become the
record. Equal times keep the earliest recorded occurrence. Track identity is
scoped to the Timing installation, so same-named tracks are not silently merged.

Manual tests with a track, lane and positive best time appear as **reported
manual bests**, separately from measured Timing records. Manual track names match
case-insensitively. Missing lanes do not create records. Their configuration and
recorded conditions remain visible, but individual-lap validity cannot be checked.
Records span different conditions; inspect voltage, direction and magnet status
when comparing them. Unknown conditions stay unknown.

### Shared-history pace comparison

Open **Cars → Compare pace**, or use the button in a car’s **Performance** section. Select two recorded sessions, either for the same car or different cars. Search the paged car list and filter sessions by track name, then choose lane and driver filters independently. Click **Compare recorded pace**.

The comparison reads both accepted history formats in one SQLite snapshot, using the configurations recorded for those sessions. It compares average and median valid pace, population standard deviation, separate personal/track-eligible best laps and uninterrupted 5/10-lap averages. Invalid/pit laps cannot set records, and missing clocks cannot establish an uninterrupted run. Results include sample sizes and warnings for small samples, unknown evidence, mixed lanes/drivers, different source-scoped tracks and changed lane lengths. No setup improvement is inferred automatically.

Changed captured specifications are highlighted; current car settings never fill gaps in old evidence. Archived cars remain inspectable. Withdrawn, virtual, unlinked and quarantined contributions are excluded. Corrections invalidate old selections; change notifications clear an open comparison and ask for a refresh. Database restores require the new recovery generation. All reads run in the background, and only the two selected participants’ lap values are processed.

Historical evidence is comparable only after acceptance. This feature does not enable historical approval or richer incoming writes.

### Similar pace for manual and earlier Timing records

Choose **Manual & earlier Timing runs** inside Compare pace.
Choose a reference car, a particular session/stint, a metric and a tolerance in
seconds. Same lane and same driver name are enabled by default and can be relaxed.
Track, recorded direction, voltage and magnet status must match. Unknown matches
Unknown with an explicit warning; this does not prove equal conditions.

Metrics:

- **Best lap:** minimum record-eligible valid non-pit measured lap; for manual
  tests this is the collector's reported best, explicitly labelled as such.
- **Median:** median of all valid non-pit measured laps in a stint.
- **Best 5 or 10 laps:** minimum average of an uninterrupted sequence of that many
  valid non-pit measured laps within one stint. Invalid/pit laps, missing lap
  numbers, gaps in measured times, and stint boundaries break the sequence.

Each candidate car uses its fastest matching run for the chosen metric. Compare
that value with the selected reference run, include candidates within the absolute
tolerance, then order by smallest difference. Show the closest 50 matching cars,
with counts, source/session, driver, lane and captured technical specifications.
This is a finder for possible competitive grids, not a prediction of race outcome.

Timing tracks use source ID + track ID. Manual track names match case-insensitively
and remain separate from Timing identities. Driver-name equality is not verified
person identity. Manual average figures cannot produce a median or sustained run.
No data is inferred from current gearing, motor RPM, tyres or magnets.

Only current accepted Timing revisions contribute. Withdrawn, virtual, unlinked
and overlapping sessions are excluded. Archived/missing cars are excluded from
candidate selection. Corrections replace their previous contribution. An open
comparison is a read-only snapshot; reopen after incoming results or corrections.

No new database schema version is needed: history and manual conditions are
optional, validated additions to existing car/test records. Older backups work.

## Editable values and custom fields

Built-in values can be entered and edited manually. Their field names and types,
including the livery classifications, are predefined. **Settings → Custom fields**
allows additional text, choice, number, date, yes/no and notes fields; fill these
on a car's **Edit details → Custom** tab. The research JSON uses its documented
history fields only; arbitrary JSON keys do not create custom fields. Imported
Timing measurements remain governed by corrections sent from Timing.
