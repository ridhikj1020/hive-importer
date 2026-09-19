// Usage: npx tsx scripts/import-report.ts fixtures/InterNACHI_Residential_-2026-09-19.xls
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseSpectoraExport } from '../src/lib/importer';

async function main() {
const path = process.argv[2] ?? 'fixtures/InterNACHI_Residential_-2026-09-19.xls';
const { template, report } = await parseSpectoraExport(readFileSync(path), basename(path));

console.log(`Template: ${template.name}`);
console.log(`Sections ${report.counts.sections} | Items ${report.counts.items} | Comments ${report.counts.comments}`);
console.log('By type:', report.counts.byType);
console.log(`Rows: ${report.counts.dataRows} in sheet = ${report.counts.rowsImported} imported + ${report.counts.rowsSkipped} skipped + ${report.counts.rowsBlank} blank`);
console.log(`Links: ${report.counts.linksInSource} in source, ${report.counts.linksImported} imported`);
console.log('Reconciliation:', report.reconciliation);
console.log(`\nIssues (${report.issues.length}):`);
for (const i of report.issues) {
  const where = [i.row && `row ${i.row}`, i.section, i.item, i.comment].filter(Boolean).join(' / ');
  console.log(`  [${i.severity}] [${i.origin}] ${i.code}${where ? ` (${where})` : ''}: ${i.message}`);
}
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
