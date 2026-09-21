# Template importer

Bring an inspection template across from Spectora without retyping it. Upload a Spectora
HTML-text export and every section, item and comment becomes a real, editable template stored in
Postgres. You can edit it, copy it, and see exactly what could not be brought across.

- **Live app (no login):** https://hive-importer-nu.vercel.app/
- **Decisions, limits, how I checked it, time spent:** [NOTES.md](NOTES.md)
- **What maps where, missing from the export vs not supported:** [docs/IMPORT_MAPPING.md](docs/IMPORT_MAPPING.md)

## Try it in five minutes

1. Open the live app. It opens on **InterNACHI Residential (example)**, already imported from the
   export in `fixtures/`. It cannot be deleted.
2. Click **Import report**. It shows what survived (392 of 392 rows, 43 of 43 links) and lists what was
   missing from the export or not supported. Click **Show in template** on the video issue.
3. Open the template, click a section or comment name to rename it, and edit some comment text (try
   bold). Reload the page: it is saved. An edited comment is marked, and **Put back the exported
   text** restores the original.
4. Click **Make a copy**, edit the copy, then open the original again. It has not changed.
5. Upload your own Spectora export, or drag any wrong file (a `.txt`) onto the upload box to see the
   failure case.

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
docs/IMPORT_MAPPING.md  the mapping, the limits, how it is checked
```

Stack: Next.js (App Router) and TypeScript, Postgres on Supabase, deployed on Vercel.

## Run it yourself

Needs Node 20 or newer.

```bash
git clone https://github.com/ridhikj1020/hive-importer.git
cd hive-importer
npm install
cp .env.example .env.local
```

Then pick one of two databases.

### Option A: local, no account needed

A real Postgres (PGlite) with the same migrations. It applies them for you. Use two terminals.

Put these two lines in `.env.local` (replace whatever is there):

```
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
DATABASE_SSL=disable
```

```bash
# terminal 1: leave running, Ctrl+C to stop
npm run dev:db

# terminal 2
npm run seed        # imports the example template
npm run dev         # http://localhost:3000
```

If `dev:db` will not start after being stopped hard, delete the `.pglite` folder and start again.

### Option B: Supabase

**Database initialization.** In the Supabase SQL editor, run these files once, in this order:

1. `supabase/migrations/0001_init.sql` (tables, import and copy functions, access rules)
2. `supabase/migrations/0002_protect_seed_and_touch.sql`
3. `supabase/migrations/0003_body_edited.sql`

Then in Supabase click **Connect**, choose **Transaction pooler**, copy the connection string, put your
database password in it, and set it as `DATABASE_URL` in `.env.local`. Then:

```bash
npm run seed        # safe to run twice
npm run dev
```

### Environment variables

| Variable | Needed | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. For Supabase use the transaction pooler string (port 6543). If the password has special characters, URL-encode them. |
| `DATABASE_SSL` | no | Set to `disable` only for the local database in Option A. Leave it unset for Supabase. |

The connection string is a secret. It is used only on the server and is never sent to the browser. The
browser never talks to the database: every table has row-level security on and no policies, so the
public Supabase key can do nothing.

## Deploy (Vercel)

1. Import the repo in Vercel. It detects Next.js.
2. Add the environment variable `DATABASE_URL` (the same pooler string).
3. Deploy. In Settings, Functions, choose the region closest to your database, then redeploy.
4. If Deployment Protection is on, turn Vercel Authentication off so reviewers can open the site.

## Check it

```bash
npm test                # 59 tests, under a minute (each Postgres test boots a WASM database)
npm run import:report   # counts, reconciliation and every issue for the committed export
npx next typegen && npx tsc --noEmit
npm run lint
npm run build
```
