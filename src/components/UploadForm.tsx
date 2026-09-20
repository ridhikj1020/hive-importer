'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api, type ApiError } from '@/lib/client';
import { ErrorNote, cn, primaryButtonClass } from './ui';

export default function UploadForm() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const pick = (f: File | null | undefined) => { setFile(f ?? null); setError(null); };

  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!file) { setError({ code: 'NO_FILE', message: 'Choose the spreadsheet you exported from Spectora.', hint: null }); return; }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    if (name.trim()) form.set('name', name.trim());
    const res = await api<{ templateId: string }>('/api/import', { method: 'POST', body: form });
    if (!res.ok) { setBusy(false); setError(res.error); return; }
    router.push(`/templates/${res.data.templateId}/report`);
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Import a Spectora template</h2>
      <p className="mt-1 text-sm text-stone-600">
        In Spectora, open the template, choose <b>Export to spreadsheet</b>, then <b>Export HTML Text</b>. Upload that spreadsheet here.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
        className={cn('mt-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center', over ? 'border-amber-500 bg-amber-50' : 'border-stone-300 bg-stone-50')}
      >
        <input ref={input} id="file" type="file" accept=".xls,.xlsx" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <p className="text-sm"><span className="font-medium">{file.name}</span> <span className="text-stone-500">({(file.size / 1024).toFixed(0)} KB)</span></p>
        ) : (
          <p className="text-sm text-stone-600">Drop the file here, or</p>
        )}
        <label htmlFor="file" className="mt-2 cursor-pointer rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-stone-50">
          {file ? 'Choose a different file' : 'Choose a file'}
        </label>
      </div>

      <div className="mt-4">
        <label htmlFor="name" className="block text-sm font-medium">Template name <span className="font-normal text-stone-500">(optional, taken from the file name if empty)</span></label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200" />
      </div>

      {error && <div className="mt-4"><ErrorNote error={error} /></div>}

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={busy} className={primaryButtonClass}>{busy ? 'Importing...' : 'Import'}</button>
        {busy && <span className="text-sm text-stone-500">Reading the file and checking every row.</span>}
      </div>
    </form>
  );
}
