import sanitizeHtml from 'sanitize-html';
import { Parser } from 'htmlparser2';
import type { ImportIssue } from './types';

/**
 * Comment Text in a Spectora export is an HTML fragment. Some cells are bare text
 * ("Flashing &amp; trim pieces..."), some are <p> blocks with links.
 *
 * Rules:
 *  1. The raw cell is always kept by the caller (bodyRaw). This module only produces the
 *     editable, safe copy (bodyHtml).
 *  2. Anything we drop is reported. Nothing is dropped silently.
 *  3. We prove preservation instead of assuming it: visible text and link count are compared
 *     before and after sanitizing.
 */

export const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote',
] as const;
const ALLOWED = new Set<string>(ALLOWED_TAGS);

// sanitize-html drops the contents of these entirely, so visible-text comparison must too
const NON_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'option']);
const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

type IssueDraft = Omit<ImportIssue, 'row' | 'section' | 'item' | 'comment'>;

interface Scan {
  elements: { name: string; attribs: Record<string, string> }[];
  text: string;
}

function scan(html: string): Scan {
  const elements: Scan['elements'] = [];
  let text = '';
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        elements.push({ name, attribs });
        if (NON_TEXT_TAGS.has(name)) skip++;
      },
      onclosetag(name) {
        if (NON_TEXT_TAGS.has(name) && skip > 0) skip--;
      },
      ontext(t) {
        if (!skip) text += t;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { elements, text };
}

export function normalizeVisibleText(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function schemeOf(href: string): string | null {
  const m = /^\s*([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  return m ? m[1].toLowerCase() : null; // null = relative or scheme-less
}

function isBlockedHref(href: string): boolean {
  const s = schemeOf(href);
  if (s === null) return href.trim().startsWith('//'); // protocol-relative: not allowed
  return !SAFE_SCHEMES.includes(s);
}

function looksLikeEmbedPlaceholder(attribs: Record<string, string>): boolean {
  const cls = (attribs.class ?? '').toLowerCase();
  const style = (attribs.style ?? '').toLowerCase().replace(/\s+/g, '');
  return cls.includes('embed') || cls.includes('video') || style.includes('padding-bottom:56.25%');
}

export interface NormalizedRichText {
  html: string | null;
  hasMarkup: boolean;
  linksIn: number;
  linksOut: number;
  textPreserved: boolean;
  linksPreserved: boolean;
  issues: IssueDraft[];
}

export function normalizeCommentHtml(raw: string | null): NormalizedRichText {
  const empty: NormalizedRichText = {
    html: null, hasMarkup: false, linksIn: 0, linksOut: 0,
    textPreserved: true, linksPreserved: true, issues: [],
  };
  if (raw === null || raw.trim() === '') return empty;

  const before = scan(raw);
  const issues: IssueDraft[] = [];
  const seen = new Set<string>();
  const once = (key: string, draft: IssueDraft) => {
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(draft);
  };

  let linksIn = 0;
  let blockedLinks = 0;
  const droppedAttrs = new Set<string>();

  for (const el of before.elements) {
    if (el.name === 'a' && el.attribs.href !== undefined) {
      linksIn++;
      if (isBlockedHref(el.attribs.href)) {
        blockedLinks++;
        once(`blocked:${el.attribs.href}`, {
          severity: 'warning', origin: 'unsupported_by_importer', code: 'LINK_PROTOCOL_BLOCKED',
          message: `Link with an unsafe or unsupported protocol was removed (kept as plain text). Original stays in the raw source.`,
          detail: { href: el.attribs.href },
        });
      }
    }

    if (!ALLOWED.has(el.name)) {
      if (el.name === 'div' && looksLikeEmbedPlaceholder(el.attribs)) {
        once('embed', {
          severity: 'warning', origin: 'missing_from_export', code: 'EMBED_PLACEHOLDER_NO_SOURCE',
          message:
            'This comment has an empty video-embed container, but the export contains no video address. ' +
            'The video is missing from the export itself, not lost by the importer. Re-add the link by hand.',
          detail: { class: el.attribs.class ?? null },
        });
      } else if (el.name === 'script' || el.name === 'style' || el.name === 'iframe' || el.name === 'object' || el.name === 'embed') {
        once(`unsafe:${el.name}`, {
          severity: 'warning', origin: 'unsupported_by_importer', code: 'ACTIVE_CONTENT_REMOVED',
          message: `<${el.name}> content was removed. The original stays in the raw source.`,
          detail: { tag: el.name, src: el.attribs.src ?? null },
        });
      } else {
        once(`tag:${el.name}`, {
          severity: 'warning', origin: 'unsupported_by_importer', code: 'UNSUPPORTED_ELEMENT',
          message: `<${el.name}> is not supported by the editor. The tag was removed and its text kept. The original stays in the raw source.`,
          detail: { tag: el.name },
        });
      }
      continue;
    }

    for (const [attr, value] of Object.entries(el.attribs)) {
      const keep = el.name === 'a' && (attr === 'href' || (attr === 'target' && value === '_blank'));
      if (!keep) droppedAttrs.add(`${el.name}[${attr}]`);
      if (attr.startsWith('on')) {
        once(`handler:${attr}`, {
          severity: 'warning', origin: 'unsupported_by_importer', code: 'ACTIVE_CONTENT_REMOVED',
          message: `Event-handler attribute "${attr}" was removed.`,
          detail: { tag: el.name, attribute: attr },
        });
      }
    }
  }

  if (droppedAttrs.size > 0) {
    issues.push({
      severity: 'info', origin: 'unsupported_by_importer', code: 'ATTRIBUTES_DROPPED',
      message: `Formatting attributes were dropped: ${[...droppedAttrs].join(', ')}.`,
      detail: { attributes: [...droppedAttrs] },
    });
  }

  const html =
    sanitizeHtml(raw, {
      allowedTags: [...ALLOWED_TAGS],
      allowedAttributes: { a: ['href', { name: 'target', values: ['_blank'] }, 'rel'] },
      allowedSchemes: SAFE_SCHEMES,
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
      transformTags: {
        a: (tagName, attribs) => ({
          tagName,
          attribs: attribs.target === '_blank' ? { ...attribs, rel: 'noopener noreferrer' } : attribs,
        }),
      },
    })
      // edge whitespace only (including non-breaking spaces left behind by removed wrappers)
      .replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');

  const after = scan(html);
  const linksOut = after.elements.filter((e) => e.name === 'a' && e.attribs.href !== undefined).length;

  return {
    html: html === '' ? null : html,
    hasMarkup: before.elements.length > 0,
    linksIn,
    linksOut,
    textPreserved: normalizeVisibleText(before.text) === normalizeVisibleText(after.text),
    linksPreserved: linksOut === linksIn - blockedLinks,
    issues,
  };
}
