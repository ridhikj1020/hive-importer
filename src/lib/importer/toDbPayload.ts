import type { ParseResult } from './types';

/**
 * Shape sent to the import_template() Postgres function (see supabase/migrations/0001_init.sql).
 * One call = one transaction: either the whole template lands, or nothing does.
 */
export function toDbPayload(result: ParseResult, overrides?: { name?: string }) {
  const { template, report } = result;
  return {
    template: {
      name: overrides?.name?.trim() || template.name,
      sourceFormat: template.sourceFormat,
      sourceFilename: template.sourceFilename,
      sourceSha256: template.sourceSha256,
    },
    sections: template.sections,
    run: {
      sourceFilename: template.sourceFilename,
      sourceSha256: template.sourceSha256,
      counts: report.counts,
      reconciliation: report.reconciliation,
      exportLimitations: report.exportLimitations,
    },
    issues: report.issues,
  };
}

export type ImportPayload = ReturnType<typeof toDbPayload>;
