import Link from 'next/link';
import { getDb, DatabaseNotConfiguredError } from '@/lib/db/client';
import { listTemplates, type TemplateSummary } from '@/lib/db/queries';
import UploadForm from '@/components/UploadForm';
import TemplateActions from '@/components/TemplateActions';
import { Badge, ErrorNote } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let templates: TemplateSummary[] = [];
  let problem: { message: string; hint: string } | null = null;
  try {
    templates = await listTemplates(getDb());
  } catch (e) {
    problem =
      e instanceof DatabaseNotConfiguredError
        ? { message: 'The database is not set up yet.', hint: 'Set DATABASE_URL and restart. The README has the steps.' }
        : { message: 'Could not reach the database.', hint: 'Check DATABASE_URL and that the schema was applied.' };
    if (!(e instanceof DatabaseNotConfiguredError)) console.error(e);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Template importer</h1>
      <p className="mt-2 max-w-2xl text-stone-600">
        Bring a template across from Spectora without retyping it. Every section, item and comment is kept, anything that could not be brought across is listed, and you can edit and copy the result.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2"><UploadForm /></div>

        <section className="lg:col-span-3" aria-labelledby="templates-heading">
          <h2 id="templates-heading" className="text-lg font-semibold">Your templates</h2>
          {problem && <div className="mt-3"><ErrorNote error={problem} /></div>}
          {!problem && templates.length === 0 && (
            <p className="mt-3 rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">Nothing here yet. Import a template to get started.</p>
          )}
          <ul className="mt-3 space-y-3">
            {templates.map((t) => (
              <li key={t.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/templates/${t.id}`} className="text-base font-semibold text-stone-900 hover:text-amber-700">{t.name}</Link>
                  {t.isProtected && <Badge tone="amber">Example</Badge>}
                  {t.copiedFromName && <Badge tone="blue">Copy of {t.copiedFromName}</Badge>}
                </div>
                <p className="mt-1 text-sm text-stone-600">{t.sections} sections, {t.items} items, {t.comments} comments</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Link href={`/templates/${t.id}`} className="text-sm font-medium text-amber-700 hover:underline">Open</Link>
                  <Link href={`/templates/${t.id}/report`} className="text-sm font-medium text-amber-700 hover:underline">Import report</Link>
                  <TemplateActions id={t.id} name={t.name} isProtected={t.isProtected} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
