import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { ImportError } from './errors';

/**
 * Minimal .xlsx reader. It exists because the first library tried (ExcelJS) silently changed
 * 282 cells of the real Spectora export: text stored as "&amp;" came back as "&". For a tool
 * whose whole job is preserving the customer's text, "the library probably does the right
 * thing" is not good enough, so cell text is read straight from the XML and cross-checked
 * against an independent reader (openpyxl) in tests/oracle.test.ts.
 *
 * Supports the cell encodings Excel and Spectora write: shared strings (s), inline strings
 * (inlineStr), formula strings (str), numbers, booleans, dates (d) and errors (e).
 */

const MAX_ENTRY_BYTES = 40 * 1024 * 1024; // zip-bomb guard, per entry
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

export interface SheetGrid {
  sheetName: string;
  maxRow: number;
  maxCol: number;
  /** Cell text by 1-based row and column. Empty string when the cell is empty. */
  get(row: number, col: number): string;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false, // "Temperature " must keep its trailing space
  processEntities: false, // we decode entities ourselves, in one pass (see xmlDecode)
  isArray: (name) => ['row', 'c', 'si', 'r', 't', 'sheet', 'Relationship'].includes(name),
});

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode XML entities in ONE pass, so "&amp;amp;" becomes "&amp;" and never "&".
 * Numeric references matter here: Excel-style writers store a carriage return as "&#13;".
 */
export function xmlDecode(s: string): string {
  return s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g, (m, named, dec, hex) => {
    if (named) return NAMED[named];
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** XML parsers must normalise literal line endings to \n before parsing; "&#13;" survives as a real CR. */
const readXml = (u8: Uint8Array): string => strFromU8(u8).replace(/\r\n?/g, '\n');

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Text of a <si> or <is> node: plain <t>, or rich-text runs <r><t>. Phonetic runs are ignored. */
function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return xmlDecode(node);
  if (typeof node !== 'object') return String(node);
  const o = node as Record<string, unknown>;
  let out = '';
  const ts = o.t as unknown[] | undefined;
  if (ts) for (const t of ts) out += xmlDecode(typeof t === 'string' ? t : ((t as Record<string, unknown>)?.['#text'] as string | undefined) ?? '');
  const rs = o.r as Record<string, unknown>[] | undefined;
  if (rs) for (const r of rs) out += textOf(r);
  return out;
}

function unzip(buf: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(buf, {
      filter: (f) => {
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw new Error('zip entry too large');
        return wanted(f.name);
      },
    });
  } catch (e) {
    throw new ImportError(
      'CORRUPT_SPREADSHEET',
      'The file could not be opened as a spreadsheet.',
      'Re-export from Spectora. If it opens in Excel, save it as .xlsx and try again.',
      { cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

export function readFirstSheet(buf: Uint8Array): SheetGrid {
  const meta = unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels');
  const wbXml = meta['xl/workbook.xml'];
  if (!wbXml) {
    throw new ImportError('NOT_A_SPREADSHEET', 'This zip file is not an Excel workbook.', 'Upload the spreadsheet exported from Spectora.');
  }
  const wb = xml.parse(readXml(wbXml));
  const sheets = wb?.workbook?.sheets?.sheet as Record<string, string>[] | undefined;
  const first = sheets?.[0];
  if (!first) throw new ImportError('NO_WORKSHEET', 'The workbook has no sheets.', 'Re-export from Spectora.');

  const rels = meta['xl/_rels/workbook.xml.rels']
    ? (xml.parse(readXml(meta['xl/_rels/workbook.xml.rels']))?.Relationships?.Relationship as Record<string, string>[] | undefined)
    : undefined;
  const targetRaw = rels?.find((r) => r['@_Id'] === first['@_r:id'])?.['@_Target'];
  const target = targetRaw === undefined ? undefined : xmlDecode(targetRaw);
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';

  const files = unzip(buf, (n) => n === sheetPath || n === 'xl/sharedStrings.xml');
  const sheetXml = files[sheetPath];
  if (!sheetXml) throw new ImportError('NO_WORKSHEET', 'The first sheet could not be found in the workbook.', 'Re-export from Spectora.');

  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const sst = xml.parse(readXml(files['xl/sharedStrings.xml']));
    for (const si of (sst?.sst?.si as unknown[] | undefined) ?? []) shared.push(textOf(si));
  }

  const parsed = xml.parse(readXml(sheetXml));
  const rows = (parsed?.worksheet?.sheetData?.row as Record<string, unknown>[] | undefined) ?? [];
  const cells = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let maxCol = 0;
  let implicitRow = 0;

  for (const row of rows) {
    implicitRow = row['@_r'] ? Number(row['@_r']) : implicitRow + 1;
    let implicitCol = 0;
    for (const c of (row.c as Record<string, unknown>[] | undefined) ?? []) {
      const col = c['@_r'] ? colIndex(String(c['@_r'])) : implicitCol + 1;
      implicitCol = col;
      const t = (c['@_t'] as string | undefined) ?? 'n';
      const v = c.v;
      const vText = xmlDecode(typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : '');
      let text = '';
      switch (t) {
        case 's': text = shared[Number(vText)] ?? ''; break;
        case 'inlineStr': text = textOf(c.is); break;
        case 'b': text = vText === '1' ? 'TRUE' : vText === '0' ? 'FALSE' : ''; break;
        case 'e': text = ''; break;
        default: text = vText; // n, str, d
      }
      if (text === '') continue;
      let rowMap = cells.get(implicitRow);
      if (!rowMap) cells.set(implicitRow, (rowMap = new Map()));
      rowMap.set(col, text);
      if (implicitRow > maxRow) maxRow = implicitRow;
      if (col > maxCol) maxCol = col;
    }
  }

  return { sheetName: xmlDecode(first['@_name'] ?? 'Sheet1'), maxRow, maxCol, get: (r, c) => cells.get(r)?.get(c) ?? '' };
}
