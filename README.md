# Template importer

Import a Spectora HTML-text template export, edit it, copy it, and keep it. Every section, item
and comment is kept, and anything that could not be brought across is listed on an import report.

## What is in here

```
src/lib/importer/       parse a Spectora export (pure functions)
  readXlsx.ts           reads cells straight from the workbook XML
  richText.ts           sanitizes comment HTML and reports what it changed
  parseSpectoraExport.ts  validation, grouping, reconciliation, issue report
src/lib/db/             client.ts (one Postgres connection) and queries.ts (all SQL)
src/app/api/            import, list, read, rename, edit comment text, reset text, copy, delete
src/app/                home (upload + list), templates/[id] (editor), templates/[id]/report
src/components/         the editor, inline rename, small rich-text box, upload form
supabase/migrations/    schema and database functions, run in order
tests/                  59 tests: real export, failure cases, another export, Postgres, HTTP API
fixtures/               the Spectora export used, plus an independent oracle of its cells
scripts/                seed.ts, dev-db.ts, import-report.ts, make-oracle.py
docs/IMPORT_MAPPING.md  what maps where, what is missing vs unsupported, how it is checked
```

## Setup

```bash
npm i fflate fast-xml-parser htmlparser2 sanitize-html entities postgres
npm i -D vitest tsx @types/sanitize-html @electric-sql/pglite @electric-sql/pglite-socket
npm rm @supabase/supabase-js          # not used: the app talks to Postgres directly
npm pkg set scripts.test="vitest run" "scripts.import:report=tsx scripts/import-report.ts"
npm pkg set "scripts.seed=node --env-file=.env.local --import tsx scripts/seed.ts" "scripts.dev:db=tsx scripts/dev-db.ts"
```

### Try it locally without Supabase

Real Postgres (PGlite) with the same migrations. Use two terminals.

```bash
# terminal 1: leave running (Ctrl+C to stop)
npm run dev:db

# terminal 2: create .env.local from .env.example using the local lines, then
npm run seed
npm run dev          # open http://localhost:3000
```

If `dev:db` will not start after being killed hard, delete the `.pglite` folder and start again.

### With Supabase

1. In the SQL editor, run the files in `supabase/migrations/` in order: `0001`, `0002`, `0003`.
2. In Supabase click **Connect**, copy the **Transaction pooler** connection string, and put it in
   `.env.local` as `DATABASE_URL`. If your password has special characters, URL-encode them.
3. `npm run seed` puts the example template in. It is safe to run twice.

The browser never talks to the database. Tables have row-level security on and no policies, so the
public Supabase key can do nothing. The connection string is a secret: server side only.

## Check it

```bash
npm test                # 59 tests, about 70 seconds (each Postgres test boots a WASM database)
npm run import:report   # counts, reconciliation and every issue for the committed export
npx next typegen && npx tsc --noEmit
npm run lint
npm run build
```
