import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { parseSpectoraExport, ImportError } from '../src/lib/importer';
import { makeXlsx, HEADER, type Cell } from './helpers/makeXlsx';

const parse = (data: Uint8Array, name = 'export.xls') => parseSpectoraExport(data, name);
const row = (section: string, item: string, name: string, text: string | null, type = 'defect', extra: Partial<Record<number, Cell>> = {}): Cell[] => {
  const r: Cell[] = [section, item, name, text, type, type === 'defect' ? 0 : null, null, null, null, 0, type === 'defect' ? 'boolean' : 'checkbox'];
  for (const [k, v] of Object.entries(extra)) r[Number(k)] = v as Cell;
  return r;
};
const rejects = async (data: Uint8Array, code: string) => {
  const err = await parse(data).then(() => null, (e) => e);
  expect(err).toBeInstanceOf(ImportError);
  expect((err as ImportError).code).toBe(code);
  expect((err as ImportError).hint).toBeTruthy(); // every failure tells the inspector what to do next
  return err as ImportError;
};

describe('whole-file failures: nothing is imported, the message says what to do', () => {
  it('empty file', async () => { await rejects(new Uint8Array(0), 'EMPTY_FILE'); });

  it('the plain-text export (wrong export chosen in Spectora)', async () => {
    const err = await rejects(strToU8('Roof\n  Coverings\n    Damaged (General)\n'), 'NOT_A_SPREADSHEET');
    expect(err.hint).toContain('Export HTML Text');
  });

  it('a CSV', async () => { await rejects(strToU8('Section Name,Item Name\nRoof,Coverings\n'), 'NOT_A_SPREADSHEET'); });

  it('a legacy binary .xls', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)]);
    const err = await rejects(ole, 'LEGACY_XLS_UNSUPPORTED');
    expect(err.hint).toContain('.xlsx');
  });

  it('a zip that is not a workbook (e.g. a Word file renamed)', async () => {
    await rejects(zipSync({ 'word/document.xml': strToU8('<w:document/>'), '[Content_Types].xml': strToU8('<Types/>') }), 'NOT_A_SPREADSHEET');
  });

  it('a truncated download', async () => {
    const real = readFileSync('fixtures/InterNACHI_Residential_-2026-09-19.xls');
    await rejects(new Uint8Array(real.subarray(0, 4000)), 'CORRUPT_SPREADSHEET');
  });

  it('a file over the size limit', async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1); big[0] = 0x50; big[1] = 0x4b;
    await rejects(big, 'FILE_TOO_LARGE');
  });

  it('a spreadsheet without the Spectora columns', async () => {
    const err = await rejects(makeXlsx([['Name', 'Price'], ['Roof', 10]]), 'MISSING_REQUIRED_COLUMNS');
    expect(err.detail!.missing).toEqual(['Section Name', 'Item Name', 'Comment Name', 'Comment Type']);
  });

  it('names only the columns that are actually missing', async () => {
    const header = HEADER.filter((h) => !h.startsWith('Item Name'));
    const err = await rejects(makeXlsx([header, ['Roof', 'x', 'y', 'z', 'defect']]), 'MISSING_REQUIRED_COLUMNS');
    expect(err.detail!.missing).toEqual(['Item Name']);
  });

  it('a header with no data rows', async () => { await rejects(makeXlsx([HEADER]), 'NO_DATA_ROWS'); });

  it('rows that are all unusable', async () => {
    await rejects(makeXlsx([HEADER, ['', '', '', 'text', 'defect']]), 'NO_DATA_ROWS');
  });
});

describe('row-level problems: bad rows are skipped loudly, good rows still import', () => {
  it('reports the exact row and keeps the accounting balanced', async () => {
    const data = makeXlsx([
      HEADER,
      row('Roof', 'Coverings', 'Damaged', 'ok'),
      row('Roof', '', 'No item', 'lost?'),          // row 3: missing item
      row('Roof', 'Coverings', 'Weird', 'x', 'nonsense'), // row 4: bad type
      null as unknown as Cell[],                      // row 5 stays blank
      row('Roof', 'Coverings', 'Second', 'ok too'),
    ].map((r) => r ?? []));
    const { report, template } = await parse(data);
    expect(report.counts).toMatchObject({ rowsImported: 2, rowsSkipped: 2, rowsBlank: 1, dataRows: 5 });
    expect(report.reconciliation.rowsBalanced).toBe(true);
    expect(report.reconciliation.ok).toBe(false); // a clean import is not claimed
    const skipped = report.issues.filter((i) => i.severity === 'error');
    expect(skipped.map((i) => [i.code, i.row])).toEqual([['ROW_SKIPPED_MISSING_KEY', 3], ['ROW_SKIPPED_BAD_TYPE', 4]]);
    expect(skipped[0].detail).toBeTruthy(); // the skipped row's values are kept in the report
    expect(template.sections[0].items[0].comments.map((c) => c.name)).toEqual(['Damaged', 'Second']);
  });
});

describe('rich text is sanitized, flagged, and never silently rewritten', () => {
  const one = async (text: string) => {
    const { template, report } = await parse(makeXlsx([HEADER, row('S', 'I', 'C', text)]));
    return { c: template.sections[0].items[0].comments[0], report };
  };

  it('hostile HTML: scripts, handlers and javascript: links are removed and reported; raw is kept', async () => {
    const raw = '<p onclick="steal()">hi<script>alert(1)</script><a href="javascript:alert(1)">bad</a></p><img src=x onerror=alert(1)>';
    const { c, report } = await one(raw);
    expect(c.bodyRaw).toBe(raw);
    expect(c.bodyHtml).not.toMatch(/script|onclick|onerror|javascript:|<img/i);
    expect(c.bodyHtml).toContain('hi');
    const codes = report.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['ACTIVE_CONTENT_REMOVED', 'LINK_PROTOCOL_BLOCKED', 'UNSUPPORTED_ELEMENT']));
    expect(report.reconciliation.textPreserved).toBe(true); // "hibad": the visible text survived
  });

  it('unclosed and malformed tags are repaired without losing text', async () => {
    const { c, report } = await one('<p>unclosed <b>bold <i>and italic');
    expect(c.bodyHtml).toBe('<p>unclosed <b>bold <i>and italic</i></b></p>');
    expect(report.reconciliation.textPreserved).toBe(true);
  });

  it('a table is not supported: tag removed, text kept, and it says so', async () => {
    const { c, report } = await one('<table><tr><td>A</td><td>B</td></tr></table>');
    expect(c.bodyHtml).toContain('A');
    expect(c.bodyHtml).not.toContain('<table');
    expect(report.issues.some((i) => i.code === 'UNSUPPORTED_ELEMENT' && i.origin === 'unsupported_by_importer')).toBe(true);
  });

  it('a whitespace-only cell counts as empty', async () => {
    const { c } = await one('   ');
    expect(c.bodyRaw).toBeNull();
    expect(c.bodyHtml).toBeNull();
  });

  it('literal less-than signs in plain text are not mistaken for tags', async () => {
    const { c, report } = await one('Clearance < 6 in. and > 2 ft.');
    expect(c.bodyHtml).toBe('Clearance &lt; 6 in. and &gt; 2 ft.');
    expect(report.reconciliation.textPreserved).toBe(true);
  });
});

describe('another export in the same format (generalization)', () => {
  const HEADER_SHUFFLED = ['Comment Type (info, limit, defect)', 'Comment Name', 'Item Name', 'Section Name', 'Comment Text', 'Order (w/i item)', 'Default Photo 1', 'Default Photo 1 Caption', 'Vendor Note'];
  const rows: Cell[][] = [
    HEADER_SHUFFLED,
    ['defect', 'Cracked &amp; broken', 'Panel', 'Électricité & Éclairage', '<p>Réparer &amp; vérifier</p>', 1, 'https://example.com/a.jpg', 'Photo A', null],
    ['info', 'Voltage', 'Panel', 'Électricité & Éclairage', null, 0, null, null, 'from vendor'],
    ['defect', 'Rusty', 'Gutters', 'Roof', 'Rust', 0, null, null, null],
    ['defect', 'Loose', 'Panel', 'Électricité & Éclairage', 'Loose panel', 2, null, null, null], // Panel rows split by another item
  ];

  it('handles reordered columns, unicode, split groups, unknown columns and photos', async () => {
    const { template, report } = await parse(makeXlsx(rows), 'My_Tuned_Template.xls');
    expect(template.name).toBe('My Tuned Template');
    expect(template.sections.map((s) => s.name)).toEqual(['Électricité & Éclairage', 'Roof']);
    const panel = template.sections[0].items[0];
    expect(panel.comments.map((c) => c.name)).toEqual(['Voltage', 'Cracked & broken', 'Loose']); // sorted by Order
    expect(panel.comments[1].bodyHtml).toBe('<p>Réparer &amp; vérifier</p>');
    expect(panel.comments[1].extra).toMatchObject({ photos: [{ n: 1, url: 'https://example.com/a.jpg', caption: 'Photo A' }] });
    expect(panel.comments[0].extra).toMatchObject({ unknownColumns: { 'Vendor Note': 'from vendor' } });
    const codes = report.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['ROWS_NOT_CONTIGUOUS', 'DEFAULT_PHOTOS_NOT_IMPORTED', 'UNKNOWN_COLUMN_DATA']));
    expect(report.counts.comments).toBe(4);
    expect(report.reconciliation.ok).toBe(true);
  });

  it('gives identical results whichever way the spreadsheet stores its text', async () => {
    const results = await Promise.all((['inline', 'shared', 'str'] as const).map((enc) => parse(makeXlsx(rows, enc), 'x.xls')));
    expect(results[1].template.sections).toEqual(results[0].template.sections);
    expect(results[2].template.sections).toEqual(results[0].template.sections);
  });

  it('numbers stored as numbers and as text both work for Order', async () => {
    const asText = rows.map((r, i) => (i === 0 ? r : r.map((v, c) => (c === 5 ? String(v) : v))));
    const a = await parse(makeXlsx(rows));
    const b = await parse(makeXlsx(asText));
    expect(b.template.sections).toEqual(a.template.sections);
  });
});
