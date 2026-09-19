# How a Spectora HTML-text export maps into the schema

Source used: InterNACHI Residential, exported from Spectora on 2026-09-19 with
Export to spreadsheet, then Export HTML Text. See `fixtures/README.md`.

## What the file actually is

- An Office Open XML workbook (`.xlsx` internally) that Spectora names `.xls`. The importer
  looks at the file's bytes, not its extension.
- One sheet, one row per comment, 42 columns, 392 data rows for this template.
- There are no rows for sections or items. The hierarchy is the `Section Name` and `Item Name`
  columns repeated on every row, and section/item order is the order of first appearance.
- 16 of the 42 columns hold data here. 26 are empty (10 default photos, 10 photo captions,
  Default Value 2, Default Unit Type, Default Location, Locked, Simple Format, Disable Photos).

## Column mapping

| Export column | Stored in | Notes |
|---|---|---|
| Section Name | `sections.name` | HTML entities decoded (`&amp;` to `&`), trimmed. Position = first appearance. |
| Item Name | `items.name` | Same treatment. Position = first appearance inside the section. |
| Comment Name | `comments.name` | Trimmed (11 names had trailing spaces). |
| Comment Text | `comments.body_raw` and `comments.body_html` | `body_raw` is the cell verbatim and is never edited. `body_html` is the sanitized, editable copy. |
| Comment Type | `comments.type` | `info`, `limit`, `defect`. Anything else skips the row and says so. |
| Category | `comments.category` | -1, 0, 1 or empty. Anything else is left empty and reported. |
| Multiple Choice Options | `comments.options` (text[]) | Split on commas. |
| Unit Type Options | `comments.unit_options` (text[]) | Same. |
| Recommendation | `comments.recommendation` | Verbatim. Values seen: `pro`, `monitor`. |
| Order (w/i item) | `comments.source_order`, `comments.position` | Position = stable sort on Order, file order breaks ties. |
| Answer Type | `comments.answer_type` | Stored as given. Seen: boolean, checkbox, number, text. |
| Default Value | `comments.default_value` | |
| Everything else | `comments.extra` (jsonb) | Estimates (10 / 1000 on every row), Uses, Last Modified, photos, and any column the importer does not know. Non-empty values only. Nothing is discarded. |

## Two different kinds of "not there"

The brief asks for these to be told apart. Every entry in the import report carries an `origin`.

**Missing from the export** (the file never had it, so no importer could bring it across):
- The template name. Taken from the file name, editable.
- Template-level settings: report introduction, summary text, rating labels, attached documents.
- Section icons, section descriptions, item descriptions.
- Sections or items with no comments. There is no row to see them by.
- The address of the video in the "Doorknob Hole" comment (row 311). The export has the empty
  embed container (`div.youtube-embed-wrapper`) but no video URL and no iframe.
- Text for 9 limitation/defect comments. They are empty in the export and imported as empty.

**Present in the export, not carried across by this importer:**
- Default photos and captions (kept as references in `extra`, not downloaded or stored).
- HTML the editor cannot represent: tables, images, iframes, `style` and `class` attributes.
  The tag is removed, its text is kept, the raw cell is kept, and the report says so.
- Active content (`<script>`, `on*` handlers, `javascript:` links): removed and reported.
- Columns the importer does not know: kept in `extra`, reported.
- Files that are not `.xlsx` content: legacy binary `.xls`, CSV and the plain-text export are
  refused with an instruction, not guessed at.

## Formatting, links and rich content

In this export: 198 comments contain HTML, 111 are bare text, 83 are empty.
The only tags are `p` (244), `a` (43), `strong` (1) and one `div`.

- Allowed in `body_html`: `p br strong b em i u s a ul ol li h3 h4 blockquote`.
- Links: all 43 survive. `http`, `https`, `mailto`, `tel` only. `target="_blank"` is kept and
  `rel="noopener noreferrer"` is added. YouTube links stay ordinary links.
- Non-breaking spaces (143 comments) are preserved.
- `&amp;` inside comment text is correct HTML and is left escaped. In names it is decoded.
- Bare text stays bare text. It is not wrapped or rewritten.
- Whitespace at the very start and end of `body_html` is trimmed. That is the only edit to text.

## How it is checked (all in `npm test`)

1. **Reader vs independent oracle.** All 4,653 non-empty cells read by `readXlsx.ts` equal the same
   cells read by openpyxl (`fixtures/oracle`, made by `scripts/make-oracle.py`).
2. **Row by row.** Each of the 392 imported comments is compared against its source row for
   section, item, name, type, raw text, choices, units, recommendation, order, answer type,
   category and default value.
3. **Text and links.** The visible text of every comment is compared before and after
   sanitizing (392 of 392 equal). Link count: 43 in, 43 out.
4. **Row accounting.** rows imported + skipped + blank = rows in the sheet.
5. **Against Hive.** Hive Inspect's own import of the same file shows 13 sections,
   69 subsections, 392 fields. This importer produces the same counts.
6. **Database.** The migration and both functions run on real Postgres (PGlite). Import is
   atomic, edits survive closing and reopening the database, and editing a copy never changes the
   original (or the other way round, or after deleting the original).

## Known limits

- A choice that contains a comma cannot be told apart from two choices. The export is
  comma-separated with no escaping.
- Empty sections and empty items cannot exist in this export format.
- Entity decoding is applied to Section, Item and Comment Name. In this file only Section and
  Item names contain entities, so decoding of comment names is untested on real data.
- Answer types `date` and `range`, Category `-1`, and default photos never appear in the real
  file. They are handled and covered by synthetic tests, not by real data.
- Only the first sheet is read. Files over 4 MB or 20,000 rows are refused.
