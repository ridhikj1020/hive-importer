'use client';

import { useRef, useState } from 'react';
import { cn } from './ui';

interface Props {
  value: string;
  /** Save the new value. Return an error message, or null when it worked. */
  onSave: (next: string) => Promise<string | null>;
  label: string;
  className?: string;
}

/** Click a name to change it. Enter or clicking away saves, Escape cancels. */
export default function InlineEdit({ value, onSave, label, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const done = useRef(false); // stops Enter and blur from both saving

  const start = () => { done.current = false; setDraft(value); setError(null); setEditing(true); };
  const cancel = () => { done.current = true; setEditing(false); setError(null); };

  const commit = async () => {
    if (done.current) return;
    const next = draft.trim();
    if (next === value) return cancel();
    if (next === '') { setError('A name cannot be empty.'); return; }
    done.current = true;
    setSaving(true);
    const err = await onSave(next);
    setSaving(false);
    if (err) { done.current = false; setError(err); return; }
    setEditing(false);
  };

  if (!editing) {
    return (
      <button type="button" onClick={start} title="Click to rename" aria-label={`Rename ${label}: ${value}`}
        className={cn('group inline-flex max-w-full items-baseline gap-1.5 rounded text-left hover:bg-amber-50', className)}>
        <span className="min-w-0 break-words">{value}</span>
        <span aria-hidden className="text-xs text-stone-400 opacity-0 group-hover:opacity-100">edit</span>
      </button>
    );
  }
  return (
    <span className="inline-flex max-w-full flex-col">
      <input
        autoFocus
        value={draft}
        disabled={saving}
        aria-label={`New name for ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') cancel();
        }}
        onBlur={() => void commit()}
        maxLength={300}
        className={cn('w-full min-w-48 rounded border border-amber-400 bg-white px-1.5 py-0.5 outline-none ring-2 ring-amber-200', className)}
      />
      {error && <span role="alert" className="mt-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}
