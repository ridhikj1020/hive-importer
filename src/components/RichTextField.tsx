'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from './ui';

interface Props {
  html: string | null;
  placeholder: string;
  label: string;
  /** Save the HTML. Return an error message, or null when it worked. */
  onSave: (html: string) => Promise<string | null>;
}

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i;
const TOOLS = [
  { cmd: 'bold', label: 'B', title: 'Bold', cls: 'font-bold' },
  { cmd: 'italic', label: 'I', title: 'Italic', cls: 'italic' },
  { cmd: 'underline', label: 'U', title: 'Underline', cls: 'underline' },
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bullet list', cls: '' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list', cls: '' },
  { cmd: 'link', label: 'Link', title: 'Add link', cls: '' },
  { cmd: 'unlink', label: 'Unlink', title: 'Remove link', cls: '' },
];
const isEmpty = (h: string) => h.replace(/<br\s*\/?>|<\/?p>|&nbsp;|\s/gi, '') === '';

/**
 * A small rich-text box for comment text. It edits HTML directly, saves when you click away,
 * and the server sanitizes whatever it receives, so nothing here is trusted.
 */
export default function RichTextField({ html, placeholder, label, onSave }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [initial] = useState(html ?? '');
  const saved = useRef(html ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // When the text changes from outside (reset to exported text), show it, unless the user is typing.
  useEffect(() => {
    const el = ref.current;
    const next = html ?? '';
    if (el && document.activeElement !== el && next !== saved.current) {
      el.innerHTML = next;
      saved.current = next;
    }
  }, [html]);

  const commit = async () => {
    const el = ref.current;
    if (!el) return;
    const current = isEmpty(el.innerHTML) ? '' : el.innerHTML;
    if (current === saved.current) return;
    setStatus('saving');
    setError(null);
    const err = await onSave(current);
    if (err) { setStatus('error'); setError(err); return; }
    saved.current = current;
    setStatus('saved');
  };

  const exec = (cmd: string) => {
    if (cmd === 'link') {
      const url = window.prompt('Link address (starting with https://)');
      if (!url) return;
      if (!SAFE_LINK.test(url.trim())) { window.alert('Links must start with https://, http://, mailto: or tel:'); return; }
      ref.current?.focus();
      document.execCommand('createLink', false, url.trim());
      return;
    }
    ref.current?.focus();
    document.execCommand(cmd, false);
  };

  const tool = 'rounded px-2 py-1 text-sm text-stone-700 hover:bg-stone-100';
  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-b-0 border-stone-300 bg-stone-50 px-1 py-0.5" role="toolbar" aria-label={`Formatting for ${label}`}>
        {TOOLS.map((t) => (
          <button key={t.cmd} type="button" title={t.title} aria-label={t.title}
            onMouseDown={(e) => e.preventDefault()} onClick={() => exec(t.cmd)} className={cn(tool, t.cls)}>
            {t.label}
          </button>
        ))}
        <span aria-live="polite" className="ml-auto pr-2 text-xs text-stone-500">
          {status === 'saving' && 'Saving...'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && <span className="text-red-700">Not saved: {error}</span>}
        </span>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        className="rich min-h-16 rounded-b-md border border-stone-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        onBlur={() => void commit()}
        onInput={() => { if (status !== 'idle') setStatus('idle'); }}
        onPaste={(e) => {
          e.preventDefault(); // paste as plain text: no styles or markup from Word, web pages, etc.
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        dangerouslySetInnerHTML={{ __html: initial }}
      />
    </div>
  );
}
