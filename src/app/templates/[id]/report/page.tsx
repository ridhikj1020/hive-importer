import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { getImportReport, getTemplateTree, type ReportIssue } from '@/lib/db/queries';
import { UUID_RE } from '@/lib/api';
import { Badge, cn, primaryButtonClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

const ORIGINS: { key: ReportIssue['origin']; title: string; blurb: string }[] = [
  { key: 'invalid_input', title: 'Rows that could not be imported', blurb: 'These rows could not be placed in the template. Nothing is hidden: every one is listed here with its row number.' },
  { key: 'missing_from_export', title: 'Missing from the export', blurb: 'The Spectora file never contained this, so no importer could have brought it across.' },
  { key: 'unsupported_by_importer', title: 'In the export, not brought across as-is', blurb: 'The file had it, but this importer or the editor cannot show it. The original stays saved with the comment, nothing was deleted.' },
  { key: 'normalized', title: 'Tidied while importing', blurb: 'Brought across, with the form adjusted. The meaning and the visible text did not change.' },
];
const SEVERITY_TONE = { error: 'red', warning: 'amber', info: 'gray' } as const;

export default async function ReportPage(props: PageProps<'/templates/[id]/report'>) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const tree = await getTemplateTree(db, id);
  if (!tree) notFound();
  const report = await getImportReport(db, id);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <p className="text-sm"><Link href="/" className="text-stone-600 hover:text-stone-900">All templates</Link></p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Import report</h1>
          <p className="mt-1 text-stone-600">{tree.name}{report?.sourceFilename ? <span className="text-stone-400"> from {report.sourceFilename}</span> : null}</p>
        </div>
        <Link href={`/templates/${id}`} className={primaryButtonClass}>Open template</Link>
      </div>

      {tree.copiedFrom && (
        <p className="mt-6 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          This template is a copy of {tree.copiedFromName ?? 'another template'}. The import report belongs to the original file. <Link className="font-medium underline" href={`/templates/${tree.copiedFrom}/report`}>Open the original report</Link>.
        </p>
      )}

      {!report ? (
        !tree.copiedFrom && <p className="mt-8 text-stone-600">This template has no import report.</p>
      ) : (
        <>
          <section aria-labelledby="checks" className="mt-8 rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="checks" className="text-lg font-semibold">Did your content survive?</h2>
              {report.reconciliation.ok ? <Badge tone="green">All checks passed</Badge> : <Badge tone="red">Needs a look</Badge>}
            </div>
            <ul className="mt-4 space-y-3 text-sm">
              <Check ok={report.reconciliation.rowsBalanced && report.counts.rowsSkipped === 0}
                title="Every row in your file is accounted for"
                detail={`${report.counts.dataRows} rows in the file = ${report.counts.rowsImported} imported + ${report.counts.rowsSkipped} skipped + ${report.counts.rowsBlank} blank`} />
              <Check ok={report.reconciliation.structureBalanced}
                title="The template has the same shape as the file"
                detail={`${report.counts.sections} sections, ${report.counts.items} items, ${report.counts.comments} comments (${report.counts.byType.info} informational, ${report.counts.byType.limit} limitations, ${report.counts.byType.defect} deficiencies)`} />
              <Check ok={report.reconciliation.textPreserved}
                title="Comment text is word for word the same"
                detail={`Compared before and after cleaning, for all ${report.reconciliation.checkedComments} comments. ${report.counts.commentsWithHtml} have formatting or links, ${report.counts.commentsWithEmptyText} have no text in the export.`} />
              <Check ok={report.reconciliation.linksPreserved}
                title="Links are kept"
                detail={`${report.counts.linksImported} of ${report.counts.linksInSource} links in the file are in the template`} />
            </ul>
          </section>

          {ORIGINS.map((o) => {
            const list = report.issues.filter((i) => i.origin === o.key);
            if (list.length === 0) return null;
            return (
              <section key={o.key} className="mt-8" aria-labelledby={`o-${o.key}`}>
                <h2 id={`o-${o.key}`} className="flex items-center gap-2 text-lg font-semibold">{o.title} <Badge>{list.length}</Badge></h2>
                <p className="mt-1 text-sm text-stone-600">{o.blurb}</p>
                <ul className="mt-3 divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
                  {list.map((i, n) => <IssueRow key={n} issue={i} templateId={id} canLink={!tree.copiedFrom} />)}
                </ul>
              </section>
            );
          })}

          <section className="mt-10" aria-labelledby="limits">
            <h2 id="limits" className="text-lg font-semibold">What a Spectora export cannot tell us</h2>
            <p className="mt-1 text-sm text-stone-600">Silence in the lists above does not mean these were checked. The file simply cannot say.</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-stone-700">
              {report.exportLimitations.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}

function Check({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold', ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{ok ? '✓' : '!'}</span>
      <div>
        <p className="font-medium">{title}<span className="sr-only">{ok ? ': passed' : ': failed'}</span></p>
        <p className="text-stone-600">{detail}</p>
      </div>
    </li>
  );
}

function IssueRow({ issue, templateId, canLink }: { issue: ReportIssue; templateId: string; canLink: boolean }) {
  const where = [issue.section, issue.item, issue.comment].filter(Boolean).join(' / ');
  return (
    <li className="p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
        <span className="font-mono text-xs text-stone-500">{issue.code}</span>
        {issue.sourceRow !== null && <span className="text-xs text-stone-400">row {issue.sourceRow}</span>}
      </div>
      <p className="mt-1.5 text-stone-900">{issue.message}</p>
      {where && <p className="mt-1 text-stone-500">{where}</p>}
      {canLink && issue.commentId && (
        <Link href={`/templates/${templateId}?comment=${issue.commentId}`} className="mt-1.5 inline-block font-medium text-amber-700 hover:underline">Show in template</Link>
      )}
      {issue.detail && Object.keys(issue.detail).length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-stone-500">Details</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-stone-50 p-2 text-xs text-stone-700">{JSON.stringify(issue.detail, null, 2)}</pre>
        </details>
      )}
    </li>
  );
}
