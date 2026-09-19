import { zipSync, strToU8 } from 'fflate';

export type Cell = string | number | boolean | null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const preserve = (s: string) => (s !== s.trim() || /\n/.test(s) ? ' xml:space="preserve"' : '');

/**
 * Builds a tiny but valid .xlsx by hand so tests can produce "another export" without a spreadsheet
 * library in the loop. `encoding` mirrors the three ways real writers store text:
 *   inline = <is><t>, shared = sharedStrings.xml, str = formula-string cells (what Spectora writes)
 */
export function makeXlsx(rows: Cell[][], encoding: 'inline' | 'shared' | 'str' = 'inline'): Uint8Array {
  const shared: string[] = [];
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      if (v === null || v === '') return '';
      const ref = `${colName(c)}${r + 1}`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if (encoding === 'shared') {
        let idx = shared.indexOf(v);
        if (idx < 0) idx = shared.push(v) - 1;
        return `<c r="${ref}" t="s"><v>${idx}</v></c>`;
      }
      if (encoding === 'str') return `<c r="${ref}" t="str"><v>${esc(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t${preserve(v)}>${esc(v)}</t></is></c>`;
    });
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.join('')}</sheetData></worksheet>`),
  };
  if (encoding === 'shared') {
    files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t${preserve(s)}>${esc(s)}</t></si>`).join('')}</sst>`);
  }
  return zipSync(files);
}

export const HEADER: string[] = [
  'Section Name', 'Item Name', 'Comment Name', 'Comment Text', 'Comment Type (info, limit, defect)',
  'Category (-1: Low, 0: Med, 1: High)', 'Multiple Choice Options (comma-separated)',
  'Unit Type Options (numeric answers only, comma-separated)', 'Recommendation (from list)', 'Order (w/i item)',
  'Answer Type (boolean, checkbox, date, number, range, text)',
];
