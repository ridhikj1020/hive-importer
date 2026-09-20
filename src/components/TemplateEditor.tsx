'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { CommentType, TemplateTree, TreeComment, TreeItem, TreeSection } from '@/lib/db/queries';
import InlineEdit from './InlineEdit';
import RichTextField from './RichTextField';
import TemplateActions from './TemplateActions';
import { Badge, buttonClass, cn } from './ui';

const GROUPS: { type: CommentType; title: string; tone: 'blue' | 'amber' | 'red' }[] = [
  { type: 'info', title: 'Informational', tone: 'blue' },
  { type: 'limit', title: 'Limitations', tone: 'amber' },
  { type: 'defect', title: 'Deficiencies', tone: 'red' },
];

function firstItemId(tree: TemplateTree, focusCommentId?: string): string | null {
  const items = tree.sections.flatMap((s) => s.items);
  if (focusCommentId) {
    const hit = items.find((i) => i.comments.some((c) => c.id === focusCommentId));
    if (hit) return hit.id;
  }
  return (items.find((i) => i.comments.length > 0) ?? items[0])?.id ?? null;
}

export default function TemplateEditor({ tree: initial, focusCommentId }: { tree: TemplateTree; focusCommentId?: string }) {
  const [tree, setTree] = useState(initial);
  const [itemId, setItemId] = useState<string | null>(() => firstItemId(initial, focusCommentId));

  let selected: { section: TreeSection; item: TreeItem } | null = null;
  for (const s of tree.sections) for (const i of s.items) if (i.id === itemId) selected = { section: s, item: i };

  const mapSection = (id: string, fn: (s: TreeSection) => TreeSection) =>
    setTree((t) => ({ ...t, sections: t.sections.map((s) => (s.id === id ? fn(s) : s)) }));
  const mapItem = (id: string, fn: (i: TreeItem) => TreeItem) =>
    setTree((t) => ({ ...t, sections: t.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? fn(i) : i)) })) }));
  const mapComment = (id: string, fn: (c: TreeComment) => TreeComment) =>
    setTree((t) => ({ ...t, sections: t.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, comments: i.comments.map((c) => (c.id === id ? fn(c) : c)) })) })) }));

  const renameTemplate = async (name: string) => {
    const r = await api(`/api/templates/${tree.id}`, { method: 'PATCH', json: { name } });
    if (!r.ok) return r.error.message;
    setTree((t) => ({ ...t, name }));
    return null;
  };
  const renameSection = async (id: string, name: string) => {
    const r = await api(`/api/sections/${id}`, { method: 'PATCH', json: { name } });
    if (!r.ok) return r.error.message;
    mapSection(id, (s) => ({ ...s, name }));
    return null;
  };
  const renameItem = async (id: string, name: string) => {
    const r = await api(`/api/items/${id}`, { method: 'PATCH', json: { name } });
    if (!r.ok) return r.error.message;
    mapItem(id, (i) => ({ ...i, name }));
    return null;
  };
  const renameComment = async (id: string, name: string) => {
    const r = await api(`/api/comments/${id}`, { method: 'PATCH', json: { name } });
    if (!r.ok) return r.error.message;
    mapComment(id, (c) => ({ ...c, name }));
    return null;
  };
  const saveBody = async (id: string, bodyHtml: string) => {
    const r = await api<{ comment: { bodyHtml: string | null; bodyEdited: boolean } }>(`/api/comments/${id}`, { method: 'PATCH', json: { bodyHtml } });
    if (!r.ok) return r.error.message;
    mapComment(id, (c) => ({ ...c, bodyHtml: r.data.comment.bodyHtml, bodyEdited: r.data.comment.bodyEdited }));
    return null;
  };
  const resetBody = async (id: string) => {
    const r = await api<{ comment: { bodyHtml: string | null; bodyEdited: boolean } }>(`/api/comments/${id}/reset`, { method: 'POST' });
    if (!r.ok) return r.error.message;
    mapComment(id, (c) => ({ ...c, bodyHtml: r.data.comment.bodyHtml, bodyEdited: r.data.comment.bodyEdited }));
    return null;
  };

  const reportId = tree.copiedFrom ?? tree.id;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-6 py-3">
        <Link href="/" className="text-sm font-medium text-stone-600 hover:text-stone-900">All templates</Link>
        <span aria-hidden className="text-stone-300">/</span>
        <h1 className="min-w-0 text-lg font-semibold"><InlineEdit value={tree.name} label="template" onSave={renameTemplate} /></h1>
        {tree.isProtected && <Badge tone="amber">Example</Badge>}
        {tree.copiedFromName && (
          <Badge tone="blue">Copy of {tree.copiedFromName}</Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href={`/templates/${reportId}/report`} className={buttonClass}>{tree.copiedFrom ? 'Original import report' : 'Import report'}</Link>
          <TemplateActions id={tree.id} name={tree.name} isProtected={tree.isProtected} />
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="Sections and items" className="border-b border-stone-200 bg-white md:sticky md:top-[57px] md:h-[calc(100vh-57px)] md:w-80 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
          <ul className="py-2">
            {tree.sections.map((s) => (
              <li key={s.id} className="mb-1">
                <div className="px-4 pb-1 pt-2 text-sm font-semibold text-stone-900">
                  <InlineEdit value={s.name} label="section" onSave={(n) => renameSection(s.id, n)} />
                </div>
                <ul>
                  {s.items.map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => setItemId(i.id)} aria-current={i.id === itemId ? 'true' : undefined}
                        className={cn('flex w-full items-baseline justify-between gap-2 border-l-2 py-1.5 pl-6 pr-4 text-left text-sm',
                          i.id === itemId ? 'border-amber-600 bg-amber-50 font-medium text-stone-900' : 'border-transparent text-stone-700 hover:bg-stone-50')}>
                        <span className="min-w-0 break-words">{i.name}</span>
                        <span className="shrink-0 text-xs text-stone-400">{i.comments.length}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 px-6 py-6 md:px-10">
          {!selected ? (
            <p className="text-stone-600">This template has no items.</p>
          ) : (
            <div className="mx-auto max-w-3xl">
              <p className="text-sm text-stone-500">
                <InlineEdit value={selected.section.name} label="section" onSave={(n) => renameSection(selected.section.id, n)} />
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                <InlineEdit value={selected.item.name} label="item" onSave={(n) => renameItem(selected.item.id, n)} />
              </h2>

              {selected.item.comments.length === 0 && <p className="mt-6 text-stone-600">This item has no comments.</p>}
              {GROUPS.map((g) => {
                const list = selected.item.comments.filter((c) => c.type === g.type);
                if (list.length === 0) return null;
                return (
                  <section key={g.type} className="mt-8" aria-labelledby={`g-${g.type}`}>
                    <h3 id={`g-${g.type}`} className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                      {g.title} <Badge tone={g.tone}>{list.length}</Badge>
                    </h3>
                    <ul className="space-y-4">
                      {list.map((c) => (
                        <CommentCard key={c.id} c={c} focus={c.id === focusCommentId}
                          onName={(n) => renameComment(c.id, n)} onBody={(h) => saveBody(c.id, h)} onReset={() => resetBody(c.id)} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function CommentCard({ c, focus, onName, onBody, onReset }: {
  c: TreeComment;
  focus: boolean;
  onName: (n: string) => Promise<string | null>;
  onBody: (h: string) => Promise<string | null>;
  onReset: () => Promise<string | null>;
}) {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (focus) document.getElementById(`comment-${c.id}`)?.scrollIntoView({ block: 'center' });
  }, [focus, c.id]);

  const reset = async () => {
    if (!window.confirm('Put this comment back to the text that was in the Spectora export? Your edits to its text will be lost.')) return;
    const err = await onReset();
    setNote(err ? `Could not reset: ${err}` : 'Put back to the exported text.');
  };

  return (
    <li id={`comment-${c.id}`} className={cn('rounded-xl border bg-white p-4 shadow-sm', focus ? 'border-amber-500 ring-2 ring-amber-200' : 'border-stone-200')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2 font-medium">
          <InlineEdit value={c.name} label="comment" onSave={onName} />
          {c.bodyEdited && <Badge tone="amber">Text edited</Badge>}
        </div>
        {c.sourceRow !== null && <span className="text-xs text-stone-400">Spreadsheet row {c.sourceRow}</span>}
      </div>

      {(c.answerType || c.options.length > 0 || c.unitOptions.length > 0 || c.recommendation) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-stone-600">
          {c.answerType && <Badge>{c.answerType}</Badge>}
          {c.options.map((o) => <Badge key={o}>{o}</Badge>)}
          {c.unitOptions.length > 0 && <Badge tone="blue">units: {c.unitOptions.join(', ')}</Badge>}
          {c.recommendation && <Badge tone="amber">recommend: {c.recommendation}</Badge>}
        </div>
      )}

      <div className="mt-3">
        <RichTextField html={c.bodyHtml} label={`Text of ${c.name}`} placeholder="No text. Click to add some." onSave={onBody} />
      </div>

      {c.bodyEdited && (
        <div className="mt-2 flex items-center gap-3 text-xs">
          <button type="button" onClick={reset} className={cn(buttonClass, 'px-2 py-1 text-xs')}>Put back the exported text</button>
          {note && <span aria-live="polite" className="text-stone-600">{note}</span>}
        </div>
      )}
    </li>
  );
}
