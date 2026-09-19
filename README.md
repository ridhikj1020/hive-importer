# Template importer

Import a Spectora HTML-text template export, edit it, copy it, and keep it.

Status: importer, schema and checks (drop 1). The web app comes next.

## Layout

```
src/lib/importer/      parse a Spectora export (pure functions, no I/O beyond the file you pass in)
  readXlsx.ts          reads cells straight from the workbook XML
  richText.ts          sanitizes comment HTML and reports what it changed
  parseSpectoraExport.ts   validation, grouping, reconciliation, issue report
  toDbPayload.ts       shape sent to the import_template() database function
supabase/migrations/   schema, import_template(), duplicate_template()
tests/                 45 tests: real fixture, failure cases, another export, Postgres
fixtures/              the Spectora export used, plus an independent oracle of its cells
docs/IMPORT_MAPPING.md what maps where, what is missing vs unsupported, how it is checked
scripts/               import-report.ts (CLI report), make-oracle.py
```

## Setup

```bash
npm i fflate fast-xml-parser htmlparser2 sanitize-html entities @supabase/supabase-js
npm i -D vitest tsx typescript @types/sanitize-html @types/node @electric-sql/pglite
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"import:report": "tsx scripts/import-report.ts"
```

Database (Supabase): open the SQL editor and run `supabase/migrations/0001_init.sql` once.

Environment variables (copy `.env.example` to `.env.local`, and set the same in Vercel):

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL` | Supabase project settings, API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page. Server only. Bypasses row-level security. |

The browser never talks to Supabase. Tables have row-level security on and no policies, so the
public anon key can do nothing.

## Check it

```bash
npm test                # 45 tests, about 30 seconds (the Postgres tests boot a WASM database)
npm run import:report   # prints counts, reconciliation and every issue for the committed export
```
