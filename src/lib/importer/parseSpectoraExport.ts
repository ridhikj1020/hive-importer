import { createHash } from 'node:crypto';
import { decodeHTMLStrict } from 'entities';
import { ImportError } from './errors';
import { normalizeCommentHtml } from './richText';
import { readFirstSheet } from './readXlsx';
import type {
  CommentType,
  ImportCounts,
  ImportIssue,
  ParsedComment,
  ParsedItem,
  ParsedSection,
  ParseResult,
  Reconciliation,
} from './types';

const MAX_BYTES = 4 * 1024 * 1024; // Vercel functions reject request bodies above ~4.5 MB
const MAX_ROWS = 20_000;
const KNOWN_ANSWER_TYPES = new Set(['boolean', 'checkbox', 'date', 'number', 'range', 'text']);
const COMMENT_TYPES = new Set<CommentType>(['info', 'limit', 'defect']);

/** Header text before the first "(" lowercased -> internal field name */
const FIELD_BY_HEADER: Record<string, string> = {
  'section name': 'section',
  'item name': 'item',
  'comment name': 'name',
  'comment text': 'text',
  'comment type': 'type',
  category: 'category',
  'multiple choice options': 'options',
  'unit type options': 'unitOptions',
  recommendation: 'recommendation',
  order: 'order',
  'answer type': 'answerType',
  'default value': 'defaultValue',
  'default value 2': 'defaultValue2',
  'default unit type': 'defaultUnit',
  'default location': 'defaultLocation',
  'default estimate min': 'estimateMin',
  'default estimate max': 'estimateMax',
  locked: 'locked',
  'simple format': 'simpleFormat',
  'disable photos': 'disablePhotos',
  uses: 'uses',
  'last modified': 'lastModified',
};
const REQUIRED = ['section', 'item', 'name', 'type'] as const;
const EXPECTED = ['text', 'answerType', 'order'] as const;

export const EXPORT_LIMITATIONS = [
  'The template name is not in the export. It is taken from the file name and can be edited.',
  'Template-level settings are not in the export: report introduction, summary text, rating labels, attached documents.',
  'Section icons, section descriptions and item descriptions are not in the export.',
  'The export has one row per comment. A section or item with no comments has no row, so an empty section or item cannot be detected and will not appear after import.',
  'Section and item order is not stored as a number. It is inferred from the row order of first appearance.',
  'Choice lists are comma-separated, so a choice that itself contains a comma cannot be told apart from two choices.',
];

function toBuffer(input: ArrayBuffer | Uint8Array): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input as ArrayBuffer);
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  return sample.length > 0 && printable / sample.length > 0.95;
}

/** Sniff the real container. Spectora names OOXML files ".xls", so the extension proves nothing. */
function assertSpreadsheetContainer(buf: Buffer, filename: string) {
  if (buf.length === 0) throw new ImportError('EMPTY_FILE', 'The file is empty.', 'Choose the spreadsheet you exported from Spectora.');
  if (buf.length > MAX_BYTES) {
    throw new ImportError('FILE_TOO_LARGE', `The file is ${(buf.length / 1048576).toFixed(1)} MB. The limit is 4 MB.`, 'Export a smaller template, or split it into two.');
  }
  const zip = buf[0] === 0x50 && buf[1] === 0x4b;
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  if (ole) {
    throw new ImportError(
      'LEGACY_XLS_UNSUPPORTED',
      'This is an Excel 97-2003 binary file, which this importer does not read.',
      'Open it in Excel or LibreOffice, choose Save As .xlsx, and upload that. A fresh Spectora export works directly.',
    );
  }
  if (!zip) {
    const text = looksLikeText(buf);
    throw new ImportError(
      'NOT_A_SPREADSHEET',
      text ? `"${filename}" looks like a plain-text or CSV file, not a spreadsheet export.` : `"${filename}" is not a spreadsheet.`,
      'In Spectora use Export to spreadsheet, then Export HTML Text, and upload the spreadsheet file (not the plain-text export).',
    );
  }
}

function classifyHeader(header: string): { field: string } | { photo: number; caption: boolean } | null {
  const key = header.split('(')[0].trim().toLowerCase();
  if (FIELD_BY_HEADER[key]) return { field: FIELD_BY_HEADER[key] };
  const p = /^default photo (\d+)( caption)?$/.exec(key);
  if (p) return { photo: Number(p[1]), caption: Boolean(p[2]) };
  return null;
}

function templateNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const name = base.replace(/\.[a-z0-9]+$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  return name || 'Imported template';
}

/** Split a comma-separated cell. Returns the cleaned list and whether any entity was decoded. */
function splitList(s: string): { list: string[]; decoded: boolean } {
  let decoded = false;
  const list = s
    .split(',')
    .map((x) => {
      const d = decodeHTMLStrict(x);
      if (d !== x) decoded = true;
      return d.trim();
    })
    .filter((x) => x !== '');
  return { list, decoded };
}

interface RawRow {
  row: number;
  section: string;
  item: string;
  comment: ParsedComment;
  fileIndex: number;
}

export async function parseSpectoraExport(
  input: ArrayBuffer | Uint8Array,
  filename: string,
): Promise<ParseResult> {
  const buf = toBuffer(input);
  assertSpreadsheetContainer(buf, filename);

  const sheet = readFirstSheet(buf);
  if (sheet.maxRow - 1 > MAX_ROWS) {
    throw new ImportError('TOO_MANY_ROWS', `The sheet has ${sheet.maxRow - 1} rows. The limit is ${MAX_ROWS}.`, 'Export a smaller template.');
  }

  // ---- header ---------------------------------------------------------------------------
  const colOf: Record<string, number> = {};
  const photoCols: { col: number; n: number; caption: boolean; header: string }[] = [];
  const unknownCols: { col: number; header: string }[] = [];
  for (let c = 1; c <= sheet.maxCol; c++) {
    const header = sheet.get(1, c).trim();
    if (!header) continue;
    const kind = classifyHeader(header);
    if (kind === null) unknownCols.push({ col: c, header });
    else if ('field' in kind) colOf[kind.field] ??= c;
    else photoCols.push({ col: c, n: kind.photo, caption: kind.caption, header });
  }
  const missing = REQUIRED.filter((f) => !colOf[f]);
  if (missing.length > 0) {
    const label: Record<string, string> = { section: 'Section Name', item: 'Item Name', name: 'Comment Name', type: 'Comment Type' };
    throw new ImportError(
      'MISSING_REQUIRED_COLUMNS',
      `Required columns are missing: ${missing.map((m) => label[m]).join(', ')}.`,
      'This does not look like a Spectora HTML-text template export. Use Export to spreadsheet, then Export HTML Text.',
      { missing: missing.map((m) => label[m]) },
    );
  }

  const issues: ImportIssue[] = [];
  for (const f of EXPECTED) {
    if (!colOf[f]) {
      issues.push({
        severity: 'warning', origin: 'missing_from_export', code: 'EXPECTED_COLUMN_MISSING',
        message: `The export has no "${f}" column, so that information is empty for every comment.`,
      });
    }
  }

  const get = (r: number, field: string): string => (colOf[field] ? sheet.get(r, colOf[field]) : '');

  // ---- rows -----------------------------------------------------------------------------
  const dataRows = Math.max(0, sheet.maxRow - 1);
  if (dataRows === 0) throw new ImportError('NO_DATA_ROWS', 'The spreadsheet has a header but no comments.', 'Export a template that contains at least one comment.');

  const rows: RawRow[] = [];
  let blank = 0;
  let skipped = 0;
  const entitiesDecoded: Record<string, number[]> = {};
  const whitespaceTrimmed: { column: string; row: number; raw: string }[] = [];
  const noteDecode = (column: string, row: number) => (entitiesDecoded[column] ??= []).push(row);
  const emptyTextRows: number[] = [];
  const emptyChoiceRows: number[] = [];
  let links = 0;
  let linksOut = 0;
  let withHtml = 0;
  let textFailures = 0;
  let linkFailures = 0;
  let checked = 0;
  const skip = (row: number, code: string, message: string, detail?: Record<string, unknown>) => {
    skipped++;
    issues.push({ severity: 'error', origin: 'invalid_input', code, message, row, detail });
  };

  const cleanName = (raw: string, column: string, rowNo: number): string => {
    const decoded = decodeHTMLStrict(raw);
    if (decoded !== raw) noteDecode(column, rowNo);
    const trimmed = decoded.trim();
    if (trimmed !== decoded) whitespaceTrimmed.push({ column, row: rowNo, raw });
    return trimmed;
  };

  for (let r = 2; r <= sheet.maxRow; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.maxCol; c++) cells.push(sheet.get(r, c));
    if (cells.every((x) => x.trim() === '')) { blank++; continue; }

    const sectionRaw = get(r, 'section');
    const itemRaw = get(r, 'item');
    const nameRaw = get(r, 'name');
    const missingKeys = [
      sectionRaw.trim() === '' && 'Section Name',
      itemRaw.trim() === '' && 'Item Name',
      nameRaw.trim() === '' && 'Comment Name',
    ].filter(Boolean) as string[];
    if (missingKeys.length > 0) {
      skip(r, 'ROW_SKIPPED_MISSING_KEY', `Row ${r} was skipped: ${missingKeys.join(', ')} is empty, so it cannot be placed in the template.`, {
        values: cells.map((v, i) => [i + 1, v] as const).filter(([, v]) => v.trim() !== '').slice(0, 12),
      });
      continue;
    }
    const typeRaw = get(r, 'type').trim().toLowerCase();
    if (!COMMENT_TYPES.has(typeRaw as CommentType)) {
      skip(r, 'ROW_SKIPPED_BAD_TYPE', `Row ${r} was skipped: Comment Type "${get(r, 'type')}" is not one of info, limit, defect.`, { value: get(r, 'type') });
      continue;
    }

    const section = cleanName(sectionRaw, 'Section Name', r);
    const item = cleanName(itemRaw, 'Item Name', r);
    const name = cleanName(nameRaw, 'Comment Name', r);

    // rich text
    const textCell = get(r, 'text');
    const bodyRaw = textCell.trim() === '' ? null : textCell;
    const rich = normalizeCommentHtml(bodyRaw);
    checked++;
    if (bodyRaw === null && typeRaw !== 'info') emptyTextRows.push(r);
    if (rich.hasMarkup) withHtml++;
    links += rich.linksIn;
    linksOut += rich.linksOut;
    for (const d of rich.issues) issues.push({ ...d, row: r, section, item, comment: name });
    if (!rich.textPreserved) {
      textFailures++;
      issues.push({ severity: 'error', origin: 'normalized', code: 'TEXT_CONTENT_CHANGED', message: 'The visible text of this comment changed while importing. Compare it with the raw source before trusting it.', row: r, section, item, comment: name });
    }
    if (!rich.linksPreserved) {
      linkFailures++;
      issues.push({ severity: 'error', origin: 'normalized', code: 'LINK_COUNT_CHANGED', message: 'A link was lost while importing this comment.', row: r, section, item, comment: name });
    }

    // choices, units, scalar fields
    const optionsRaw = get(r, 'options');
    const opt = optionsRaw.trim() === '' ? { list: [] as string[], decoded: false } : splitList(optionsRaw);
    if (opt.decoded) noteDecode('Multiple Choice Options', r);
    const options = opt.list;
    const unitRaw = get(r, 'unitOptions');
    const unit = unitRaw.trim() === '' ? { list: [] as string[], decoded: false } : splitList(unitRaw);
    if (unit.decoded) noteDecode('Unit Type Options', r);
    const unitOptions = unit.list;

    const answerTypeRaw = get(r, 'answerType').trim().toLowerCase();
    const answerType = answerTypeRaw === '' ? null : answerTypeRaw;
    if (answerType && !KNOWN_ANSWER_TYPES.has(answerType)) {
      issues.push({ severity: 'warning', origin: 'unsupported_by_importer', code: 'UNKNOWN_ANSWER_TYPE', message: `Answer type "${answerType}" is not one this importer knows. It was stored as-is.`, row: r, section, item, comment: name });
    }
    if (answerType === 'checkbox' && options.length === 0) emptyChoiceRows.push(r);

    const extra: Record<string, unknown> = {};
    const categoryRaw = get(r, 'category').trim();
    let category: ParsedComment['category'] = null;
    if (categoryRaw !== '') {
      const n = Number(categoryRaw);
      if (n === -1 || n === 0 || n === 1) category = n;
      else {
        extra.categoryRaw = categoryRaw;
        issues.push({ severity: 'warning', origin: 'invalid_input', code: 'INVALID_CATEGORY', message: `Category "${categoryRaw}" is not -1, 0 or 1. Left empty; original kept in extra data.`, row: r, section, item, comment: name });
      }
    }
    const orderRaw = get(r, 'order').trim();
    const orderNum = orderRaw === '' ? null : Number(orderRaw);
    const sourceOrder = orderNum !== null && Number.isInteger(orderNum) ? orderNum : null;
    if (orderRaw !== '' && sourceOrder === null) {
      extra.orderRaw = orderRaw;
      issues.push({ severity: 'warning', origin: 'invalid_input', code: 'INVALID_ORDER', message: `Order "${orderRaw}" is not a whole number. File order is used instead.`, row: r, section, item, comment: name });
    }

    for (const f of ['defaultValue2', 'defaultUnit', 'defaultLocation', 'estimateMin', 'estimateMax', 'locked', 'simpleFormat', 'disablePhotos', 'uses', 'lastModified']) {
      const v = get(r, f).trim();
      if (v !== '') extra[f] = v;
    }
    const photos: { n: number; url?: string; caption?: string }[] = [];
    for (const p of photoCols) {
      const v = sheet.get(r, p.col).trim();
      if (v === '') continue;
      let entry = photos.find((x) => x.n === p.n);
      if (!entry) photos.push((entry = { n: p.n }));
      if (p.caption) entry.caption = v; else entry.url = v;
    }
    if (photos.length > 0) {
      extra.photos = photos;
      issues.push({ severity: 'warning', origin: 'unsupported_by_importer', code: 'DEFAULT_PHOTOS_NOT_IMPORTED', message: 'This comment has default photos. The references are kept in extra data, but photos are not downloaded or stored.', row: r, section, item, comment: name });
    }
    const unknown: Record<string, string> = {};
    for (const u of unknownCols) {
      const v = sheet.get(r, u.col).trim();
      if (v !== '') unknown[u.header] = v;
    }
    if (Object.keys(unknown).length > 0) {
      extra.unknownColumns = unknown;
      issues.push({ severity: 'warning', origin: 'unsupported_by_importer', code: 'UNKNOWN_COLUMN_DATA', message: `Data in columns this importer does not know was kept in extra data: ${Object.keys(unknown).join(', ')}.`, row: r, section, item, comment: name });
    }

    const recommendation = get(r, 'recommendation').trim();
    const defaultValue = get(r, 'defaultValue').trim();

    rows.push({
      row: r, section, item, fileIndex: rows.length,
      comment: {
        name, type: typeRaw as CommentType, position: 0, sourceRow: r, sourceOrder,
        bodyRaw, bodyHtml: rich.html, answerType, options, unitOptions, category,
        recommendation: recommendation === '' ? null : recommendation,
        defaultValue: defaultValue === '' ? null : defaultValue,
        extra,
      },
    });
  }

  // ---- build the tree: first appearance decides section and item order --------------------
  const sections = new Map<string, Map<string, RawRow[]>>();
  let lastKey = '';
  const seenKeys = new Set<string>();
  let nonContiguous = 0;
  for (const rr of rows) {
    const key = `${rr.section}\u0000${rr.item}`;
    if (key !== lastKey) {
      if (seenKeys.has(key)) nonContiguous++;
      seenKeys.add(key);
      lastKey = key;
    }
    let items = sections.get(rr.section);
    if (!items) sections.set(rr.section, (items = new Map()));
    const list = items.get(rr.item);
    if (list) list.push(rr); else items.set(rr.item, [rr]);
  }
  if (nonContiguous > 0) {
    issues.push({ severity: 'info', origin: 'normalized', code: 'ROWS_NOT_CONTIGUOUS', message: `${nonContiguous} time(s) rows for one item were separated by other rows (was the sheet sorted?). They were regrouped under the item's first appearance.` });
  }

  const outSections: ParsedSection[] = [];
  for (const [sName, items] of sections) {
    const outItems: ParsedItem[] = [];
    for (const [iName, list] of items) {
      const allOrdered = list.every((x) => x.comment.sourceOrder !== null);
      const sorted = allOrdered
        ? [...list].sort((a, b) => a.comment.sourceOrder! - b.comment.sourceOrder! || a.fileIndex - b.fileIndex)
        : list;
      if (!allOrdered && list.some((x) => x.comment.sourceOrder !== null)) {
        issues.push({ severity: 'info', origin: 'normalized', code: 'ORDER_PARTIAL', message: 'Some comments in this item have no usable Order. File order was used for the whole item.', section: sName, item: iName });
      }
      // same Order twice inside one comment type = ties resolved by file order
      const byType = new Map<string, number[]>();
      for (const x of sorted) {
        if (x.comment.sourceOrder === null) continue;
        const list = byType.get(x.comment.type) ?? [];
        list.push(x.comment.sourceOrder);
        byType.set(x.comment.type, list);
      }
      for (const [t, os] of byType) {
        if (new Set(os).size !== os.length) {
          issues.push({ severity: 'info', origin: 'normalized', code: 'ORDER_TIES', message: `Two ${t} comments in this item share the same Order value. File order broke the tie.`, section: sName, item: iName });
        }
      }
      // identical name + type twice in an item: keep both, say so
      const names = new Map<string, number>();
      for (const x of sorted) {
        const k = `${x.comment.type}\u0000${x.comment.name.toLowerCase()}`;
        names.set(k, (names.get(k) ?? 0) + 1);
      }
      for (const [k, n] of names) {
        if (n > 1) issues.push({ severity: 'info', origin: 'normalized', code: 'DUPLICATE_COMMENT_NAME', message: `${n} ${k.split('\u0000')[0]} comments are named "${k.split('\u0000')[1]}" in this item. All were kept.`, section: sName, item: iName });
      }
      outItems.push({ name: iName, position: outItems.length, comments: sorted.map((x, i) => ({ ...x.comment, position: i })) });
    }
    outSections.push({ name: sName, position: outSections.length, items: outItems });
  }

  // ---- aggregate, template-level, and reconciliation --------------------------------------
  issues.unshift({
    severity: 'info', origin: 'missing_from_export', code: 'TEMPLATE_NAME_FROM_FILENAME',
    message: 'The template name is not in the export. It was taken from the file name.',
  });
  const decodedCols = Object.entries(entitiesDecoded);
  if (decodedCols.length > 0) {
    issues.push({
      severity: 'info', origin: 'normalized', code: 'ENTITIES_DECODED',
      message: `Escaped characters like &amp; were turned into real characters in: ${decodedCols.map(([c, r]) => `${c} (${r.length})`).join(', ')}.`,
      detail: Object.fromEntries(decodedCols.map(([c, r]) => [c, r.slice(0, 50)])),
    });
  }
  if (whitespaceTrimmed.length > 0) {
    issues.push({
      severity: 'info', origin: 'normalized', code: 'WHITESPACE_TRIMMED',
      message: `Leading or trailing spaces were trimmed from ${whitespaceTrimmed.length} name(s).`,
      detail: { examples: whitespaceTrimmed.slice(0, 20) },
    });
  }
  if (emptyTextRows.length > 0) {
    issues.push({
      severity: 'info', origin: 'missing_from_export', code: 'EMPTY_COMMENT_TEXT',
      message: `${emptyTextRows.length} limitation or defect comment(s) have no text in the export. They were imported with empty text.`,
      detail: { rows: emptyTextRows },
    });
  }
  if (emptyChoiceRows.length > 0) {
    issues.push({
      severity: 'warning', origin: 'missing_from_export', code: 'CHOICES_MISSING',
      message: `${emptyChoiceRows.length} checkbox comment(s) have no choices listed in the export.`,
      detail: { rows: emptyChoiceRows },
    });
  }
  const ignored = unknownCols.filter((u) => !rows.some((rr) => (rr.comment.extra.unknownColumns as Record<string, string> | undefined)?.[u.header] !== undefined));
  if (ignored.length > 0) {
    issues.push({ severity: 'info', origin: 'unsupported_by_importer', code: 'UNKNOWN_COLUMN_EMPTY', message: `Columns this importer does not know were present but empty: ${ignored.map((x) => x.header).join(', ')}.` });
  }

  let treeComments = 0;
  const byType: Record<CommentType, number> = { info: 0, limit: 0, defect: 0 };
  let itemCount = 0;
  for (const s of outSections) for (const i of s.items) { itemCount++; for (const c of i.comments) { treeComments++; byType[c.type]++; } }
  const counts: ImportCounts = {
    dataRows, rowsImported: rows.length, rowsSkipped: skipped, rowsBlank: blank,
    sections: outSections.length, items: itemCount, comments: treeComments, byType,
    commentsWithHtml: withHtml,
    commentsWithEmptyText: rows.filter((x) => x.comment.bodyRaw === null).length,
    linksInSource: links, linksImported: linksOut,
  };
  const reconciliation: Reconciliation = {
    rowsBalanced: rows.length + skipped + blank === dataRows,
    structureBalanced: treeComments === rows.length,
    textPreserved: textFailures === 0,
    linksPreserved: linkFailures === 0,
    checkedComments: checked,
    ok: false,
  };
  reconciliation.ok = reconciliation.rowsBalanced && reconciliation.structureBalanced && reconciliation.textPreserved && reconciliation.linksPreserved && skipped === 0;

  if (rows.length === 0) {
    throw new ImportError('NO_DATA_ROWS', 'No row in the spreadsheet could be imported.', 'Check that the sheet has Section Name, Item Name, Comment Name and Comment Type filled in.', { skipped });
  }

  return {
    template: {
      name: templateNameFromFilename(filename),
      sourceFormat: 'spectora_html_text_spreadsheet',
      sourceFilename: filename,
      sourceSha256: createHash('sha256').update(buf).digest('hex'),
      sections: outSections,
    },
    report: { counts, reconciliation, issues, exportLimitations: EXPORT_LIMITATIONS },
  };
}
