# NOTES

Draft. Lines marked FILL IN need your own words or numbers before you submit.

## Supported input

- A Spectora HTML-text template export (Export to spreadsheet, then Export HTML Text).
- Detected by content: the file must be an Office Open XML workbook. Spectora names it `.xls`.
- Refused with a plain-language instruction: legacy binary `.xls`, CSV, the plain-text export,
  a Word file renamed, a truncated download, a sheet without the Spectora columns,
  files over 4 MB or 20,000 rows.

## Known limitations

See `docs/IMPORT_MAPPING.md`, section "Known limits" and "Two different kinds of not there".
Short version: empty sections and items cannot exist in this export format, choices that contain
commas are ambiguous, default photos are kept as references only, HTML the editor cannot show is
removed from the editable copy (raw is kept), and the video address in one comment is missing
from the export itself.

## How I checked

- Reader against an independent oracle: 4,653 cells equal to openpyxl.
- 392 rows compared one by one against the sheet.
- Visible text identical before and after sanitizing for 392 of 392 comments. 43 of 43 links kept.
- Row accounting balances: imported + skipped + blank = rows in the sheet.
- Counts equal Hive Inspect's own import of the same file: 13 / 69 / 392.
- Failure cases tested: wrong export type, CSV, legacy .xls, non-workbook zip, truncated file,
  missing columns, empty sheet, bad rows (skipped by row number), hostile HTML, malformed HTML.
- Another export: a synthetic workbook with reordered columns, unicode, split groups, unknown
  columns and photos, stored three different ways (inline, shared strings, formula strings).
- Database on real Postgres (PGlite): import atomic, edits survive close and reopen, copy is
  independent in both directions and after deleting the original.

- The whole app end to end: built with `next build`, run with `next start` against Postgres over the
  real wire protocol, and driven with a headless browser: upload, import report, deep link from a
  report issue to the comment, rename a section, edit comment text with bold, copy, edit the copy,
  original unchanged, reset to exported text. Two bugs found that way and fixed (a driver that
  double-encoded the JSON payload, and one connection per bundle).

Not yet checked: FILL IN once deployed (live URL, real Supabase, the Vercel build).

## The hard part

The first spreadsheet library I used (ExcelJS) silently changed 282 cells of the real export:
text stored as `&amp;` came back as `&`, because Spectora writes strings as formula-string cells
with doubly escaped XML and the library decodes them twice. Counts, structure and every visible
name still looked right, so nothing would have flagged it. I only saw it because I compared the
library's output against a second reader (openpyxl) cell by cell. That comparison is now a test
(`tests/oracle.test.ts`), and the reader is a small purpose-built one (`readXlsx.ts`) that decodes
XML entities exactly once.

## What I cut and why

Confirm or change each of these, they are what the app does today:
- No model in the import path. The format is structured, so a deterministic parser can be proven
  correct. A model could invent or drop content, and I would have to build a second checker for it.
- No login. One seeded workspace, so a reviewer lands on an imported template.
- No drag-to-reorder, no adding or deleting sections, items or comments, and choice lists are shown
  but not editable. The brief asks for names and comment text, so that is what saves.
- No template-level settings and no photo storage (photos are kept as references only).
- No login, so anyone with the URL can write. The seeded example cannot be deleted, copies can.

## The improvement I chose

Import report ("did my content survive?"). FILL IN in your own words: the customer has tuned this for
four years and will not retype it, so before trusting a new system they need to see what came across
and what did not. The report answers that with checks they can read, and every issue links back to the
comment it is about.

## Time spent

FILL IN

## Credits

Libraries only, nothing forked: fflate, fast-xml-parser, htmlparser2, sanitize-html, entities,
supabase-js, vitest, tsx, PGlite (test database), openpyxl (oracle, run once). Hive Inspect's
documentation was used as a reference for terms (sections, subsections, comment types).

## Hive feedback

FILL IN from your own use. One thing seen so far, verify it before you say it on camera:
after importing, the template page showed "You have unsaved changes" although nothing was edited.
