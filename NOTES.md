# NOTES

Template importer for the Hive Inspect take-home.

- Live app (no login, open it and go): https://hive-importer-nu.vercel.app/
- Repo: https://github.com/ridhikj1020/hive-importer
- Input I used: InterNACHI Residential from Spectora, exported with Export to spreadsheet, then Export HTML Text. It is in `fixtures/`, see `fixtures/README.md`.
- The live app opens on that template, already imported. It cannot be deleted. Copy it if you want to play.

Longer detail on the mapping is in `docs/IMPORT_MAPPING.md`. This file is the short version plus the parts the brief asks for.

## What it does

Upload a Spectora HTML-text export and it becomes a real template in Postgres: templates, sections, items, comments. You can rename sections, items and comments, edit comment text with bold, italics, lists and links, and it saves. You can copy a template and edit the copy without touching the original. Everything is in Supabase, so it is all still there after closing and reopening.

The improvement I picked is the **import report**. The customer in the brief has spent four years tuning this template and will not retype it. Before they trust a new tool they need to see what came across and what did not. So after every import there is a page that answers "did my content survive?" with checks a person can read, and a list of everything that was missing, unsupported or tidied, each one linking back to the comment it is about.

## How I checked it

- **Reader against a second reader.** The spreadsheet library I started with (ExcelJS) quietly changed 282 cells: text stored as `&amp;` came back as `&`. Counts and names all still looked right, so nothing would have flagged it. I found it by comparing its output with openpyxl cell by cell. I replaced it with a small reader of my own (`readXlsx.ts`) and kept that comparison as a test. All 4,653 non-empty cells now match.
- **Row by row.** Every one of the 392 imported comments is compared with its source row: section, item, name, type, raw text, choices, units, recommendation, order, answer type, category, default value.
- **Text and links.** The visible text of every comment is compared before and after cleaning (392 of 392 the same). Links: 43 in the file, 43 in the template.
- **Row accounting.** rows imported + skipped + blank = rows in the sheet. Shown on the report.
- **Against Hive.** Hive Inspect's own import of the same file shows 13 sections, 69 subsections, 392 fields. Mine gives the same counts.
- **Saved edits and copies.** Tested against real Postgres (PGlite, plus my Supabase database): edits survive closing and reopening, editing a copy leaves the original unchanged, editing the original leaves the copy unchanged, and deleting the original does not hurt the copy.
- **Failure cases.** Wrong export (plain text), CSV, old binary .xls, a Word file renamed, a truncated file, missing columns, an empty sheet, bad rows (skipped and listed by row number), hostile and broken HTML, over-size files. Each gives a plain message and writes nothing. On the live site you can drag any .txt file onto the upload box to see it.
- **Another export.** I only had one real export, so I built a synthetic one with reordered columns, accented characters, rows for one item split apart, unknown columns and photo columns, stored three different ways inside the spreadsheet file. It imports the same way each time.
- **Whole app.** 59 automated tests. I also ran the built app against a local database and drove it in a headless browser: upload, report, jump from a report issue to the comment, rename, bold edit, copy, edit the copy, reset. That found two real bugs, both fixed (the database driver double-encoded the import data, and every page opened its own connection). Then I tested the deployed site by hand: import, wrong file, edit and reload, copy, delete.

Not tested: browsers other than Chrome, and anything on a phone (the brief says desktop only).

## Supported input

- A Spectora HTML-text export. It is really an .xlsx inside, Spectora just names it .xls, so the importer looks at the bytes and not the file name.
- Up to 4 MB and 20,000 rows, first sheet only.
- Refused with a plain message: legacy binary .xls, CSV, the plain-text export, other zip files, damaged files, sheets without the Spectora columns.

## Missing from the export vs not supported by my importer

The brief asks for these to be told apart, and the report tags every issue that way.

**Missing from the export** (the file never had it):
- The template name. I take it from the file name, and you can rename it.
- Template-level settings such as report introduction, summary text and rating labels.
- Section icons, section descriptions and item descriptions.
- Sections or items with no comments. There is no row for them, so they cannot appear.
- The video address in the "Doorknob Hole" comment. The file has the empty video box and no address.
- Text for 9 limitation or defect comments. They are empty in the file.

**In the export but not brought across as-is by my importer:**
- Default photos: kept as references, not downloaded.
- HTML the editor cannot show (tables, images, iframes, styles): the tag goes, the text stays, the original is kept.
- Unknown columns: kept, not shown.
- Comment category, recommendation and estimate cost: imported and stored, but my editor does not show or edit them. Hive's does.

**Formatting and links:** all text is treated as HTML. The editable copy keeps paragraphs, bold, italic, underline, lists and links (http, https, mailto, tel). Everything else is cleaned out. The comment text as exported is stored separately and never edited, so there is always a way back ("Put back the exported text" on any edited comment).

## Known limitations

- A choice that contains a comma cannot be told apart from two choices. The file has no escaping.
- Section and item order is not stored as a number in the file. I use the order rows first appear.
- Entity clean-up (`&amp;` to `&`) is applied to section, item and comment names. In this file only section and item names had any, so comment names are untested on real data.
- Answer types `date` and `range`, and category `-1`, never appear in my real file. They are handled and covered by tests with made-up data only.
- Choices are shown but cannot be edited. Comments cannot be reordered, added or deleted, and neither can sections or items.
- No login. Anyone with the link can import, edit and delete, except the example template, which is protected. Fine for a review, not for real customers.
- The text box uses `document.execCommand`, which browsers call deprecated but still support. The server cleans whatever it receives anyway.

## What I cut, and why

- **A model in the import step.** The format is structured, so a plain parser can be checked against the sheet and proved right. A model can invent or drop content, and I would then need a second checker for the model.
- **Login.** One shared workspace so a reviewer lands on something immediately.
- **Reordering, adding and deleting sections, items and comments; editing choices.** The brief asks for names and comment text. I put the time into making the import trustworthy instead.
- **Photos, template-level settings.** Not in the export, or too big for two days.
- **A second improvement.** I picked one and did it properly.

## What I found using Hive Inspect

I imported the same file into Hive and opened it.

- It says it imported successfully and nothing else. No list of what changed or was skipped.
- "You have unsaved changes" appears right after import and is still there after a reload, though nothing was edited and the template is already saved. It is hard to know whether the import is safe.
- **Temperature** is a number field with Fahrenheit and Celsius units in the file. In Hive it is a plain Text field with no units. Hive's Information comments only offer Checkbox, Multiple Choice and Text, so it has nowhere to put a number. The file has four number fields. I checked one.
- The empty video box in Doorknob Hole was dropped with no notice. The text is fine.
- Category: the file gives Doorknob Hole, Major Corner Cracks and Paint Cracking the same value. Hive shows Recommendations for two and Safety Concerns for Doorknob Hole. I could not work out why.
- What survived well: structure, order and counts, bold text, the link in Paint Cracking, paragraphs, and the default value (as "auto-select").

Overall Hive's import is good at keeping content. What it is missing is telling the inspector what did not survive, which is the gap my report fills.

**Binsr:** FILL IN. Either write what you saw (what it accepts, what it shows after import, what it dropped, how editing feels, one thing Hive could learn), or say why you skipped it, for example that you spent the time on making the import checkable.

## AI tools

FILL IN and change this so it is true for you. A starting point:

I used Claude to build this. It wrote most of the code and the tests. I set up the environment, ran everything, checked the results against the real export and against Hive, tested the deployed app by hand, and decided what to cut. I am responsible for what is in the repo. There is no model in the running product.

## Time spent

FILL IN with your real numbers. Rough hours per part:

| Part | Hours |
|---|---|
| Spectora and Hive exploration, reading the export | |
| Importer, schema and tests (with Claude) | |
| Web app (with Claude) | |
| Setup, Supabase, GitHub, Vercel | |
| Checking against Hive, writing these notes | |
| Video | |
| **Total** | |

## Credits

- Started from `create-next-app` (Next.js 16, TypeScript, Tailwind). Everything in `src/`, `supabase/`, `tests/` and `scripts/` is new.
- Libraries: fflate and fast-xml-parser (reading the file), sanitize-html, htmlparser2 and entities (cleaning HTML), postgres (database driver), vitest and tsx (tests), PGlite (Postgres in the tests and for local trials).
- openpyxl, run once, to make the independent cell check in `fixtures/oracle/`.
- Hive Inspect's docs, for the words sections, subsections and comment types.
- Claude, for writing code with me.