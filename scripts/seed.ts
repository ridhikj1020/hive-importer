// Puts the committed Spectora export into the database as the protected example template.
// Safe to run twice: if the example is already there, it does nothing.
//   npm run seed        (needs DATABASE_URL in .env.local)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getDb } from '../src/lib/db/client';
import { findProtectedBySha, importTemplate, setProtected } from '../src/lib/db/queries';
import { parseSpectoraExport, toDbPayload } from '../src/lib/importer';

async function main() {
  const path = process.argv[2] ?? 'fixtures/InterNACHI_Residential_-2026-09-19.xls';
  const bytes = readFileSync(path);
  const parsed = await parseSpectoraExport(new Uint8Array(bytes), basename(path));
  const db = getDb();

  const existing = await findProtectedBySha(db, parsed.template.sourceSha256);
  if (existing) {
    console.log(`Example already seeded: ${existing}`);
    process.exit(0);
  }
  const id = await importTemplate(db, toDbPayload(parsed, { name: 'InterNACHI Residential (example)' }));
  await setProtected(db, id, true);
  const c = parsed.report.counts;
  console.log(`Seeded ${id}: ${c.sections} sections, ${c.items} items, ${c.comments} comments. Import checks ok: ${parsed.report.reconciliation.ok}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
