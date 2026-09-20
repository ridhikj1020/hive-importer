'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';
import { buttonClass } from './ui';

interface Props { id: string; name: string; isProtected: boolean; allowDelete?: boolean }

export default function TemplateActions({ id, name, isProtected, allowDelete = true }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'copy' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    setBusy('copy'); setError(null);
    const res = await api<{ templateId: string }>(`/api/templates/${id}/copy`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) { setError(res.error.message); return; }
    router.push(`/templates/${res.data.templateId}`);
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy('delete'); setError(null);
    const res = await api(`/api/templates/${id}`, { method: 'DELETE' });
    setBusy(null);
    if (!res.ok) { setError(res.error.message); return; }
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} disabled={busy !== null} onClick={copy}>{busy === 'copy' ? 'Copying...' : 'Make a copy'}</button>
      {allowDelete && !isProtected && (
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={remove}>{busy === 'delete' ? 'Deleting...' : 'Delete'}</button>
      )}
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
    </div>
  );
}
