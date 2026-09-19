import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSpectoraExport, toDbPayload } from '../src/lib/importer';
import type { ParseResult } from '../src/lib/importer';

const FILE = 'InterNACHI_Residential_-2026-09-19.xls';
const oracle = JSON.parse(readFileSync(`fixtures/oracle/${FILE}.cells.json`, 'utf8')).cells as Record<string, string>;
const cell = (col: string, row: number) => oracle[`${col}${row}`] ?? '';

let result: ParseResult;
const load = async () => (result ??= await parseSpectoraExport(readFileSync(`fixtures/${FILE}`), FILE));
const allComments = (r: ParseResult) => r.template.sections.flatMap((s) => s.items.flatMap((i) => i.comments.map((c) => ({ s, i, c }))));
const find = (r: ParseResult, section: string, item: string, name: string) =>
  allComments(r).find((x) => x.s.name === section && x.i.name === item && x.c.name === name)!.c;

describe('real Spectora export: InterNACHI Residential', () => {
  it('imports the same structure counts Hive Inspect shows for this file', async () => {
    const { template, report } = await load();
    expect(template.sections).toHaveLength(13);
    expect(template.sections.flatMap((s) => s.items)).toHaveLength(69);
    expect(report.counts.comments).toBe(392);
    expect(report.counts.byType).toEqual({ info: 78, limit: 12, defect: 302 });
    expect(report.reconciliation).toMatchObject({ rowsBalanced: true, structureBalanced: true, textPreserved: true, linksPreserved: true, ok: true });
    expect(report.counts.rowsSkipped).toBe(0);
  });

  it('keeps section order as it first appears in the sheet', async () => {
    const { template } = await load();
    expect(template.sections.map((s) => s.name)).toEqual([
      'Inspection Details', 'Exterior', 'Roof', 'Basement, Foundation, Crawlspace & Structure', 'Heating', 'Cooling',
      'Plumbing', 'Electrical', 'Fireplace', 'Attic, Insulation & Ventilation', 'Doors, Windows & Interior',
      'Built-in Appliances', 'Garage',
    ]);
    expect(template.sections.map((s) => s.position)).toEqual([...Array(13).keys()]);
  });

  it('checks every comment against the sheet, row by row, using the independent oracle', async () => {
    const r = await load();
    const wrong: string[] = [];
    let n = 0;
    for (const { s, i, c } of allComments(r)) {
      n++;
      const row = c.sourceRow;
      const expectSection = cell('A', row).replace(/&amp;/g, '&').trim();
      const expectItem = cell('B', row).replace(/&amp;/g, '&').trim();
      if (s.name !== expectSection) wrong.push(`row ${row} section`);
      if (i.name !== expectItem) wrong.push(`row ${row} item`);
      if (c.name !== cell('C', row).trim()) wrong.push(`row ${row} name`);
      if (c.type !== cell('E', row)) wrong.push(`row ${row} type`);
      if (c.bodyRaw !== (cell('D', row) === '' ? null : cell('D', row))) wrong.push(`row ${row} raw text`);
      if (c.options.join('|') !== cell('G', row).split(',').map((x) => x.trim()).filter(Boolean).join('|')) wrong.push(`row ${row} options`);
      if (c.unitOptions.join('|') !== cell('H', row).split(',').map((x) => x.trim()).filter(Boolean).join('|')) wrong.push(`row ${row} units`);
      if ((c.recommendation ?? '') !== cell('I', row)) wrong.push(`row ${row} recommendation`);
      if (String(c.sourceOrder) !== cell('J', row)) wrong.push(`row ${row} order`);
      if ((c.answerType ?? '') !== cell('K', row)) wrong.push(`row ${row} answer type`);
      if ((c.category === null ? '' : String(c.category)) !== cell('F', row)) wrong.push(`row ${row} category`);
      if ((c.defaultValue ?? '') !== cell('L', row)) wrong.push(`row ${row} default`);
    }
    expect(n).toBe(392);
    expect(wrong).toEqual([]);
  });

  it('preserves comment order inside every item', async () => {
    const r = await load();
    for (const { i } of allComments(r)) {
      const rows = i.comments.map((c) => c.sourceRow);
      expect(rows).toEqual([...rows].sort((a, b) => a - b));
      expect(i.comments.map((c) => c.position)).toEqual(rows.map((_, k) => k));
    }
  });

  it('decodes escaped ampersands in names but leaves HTML text escaped', async () => {
    const r = await load();
    expect(r.template.sections.map((s) => s.name).join('|')).not.toContain('&amp;');
    const item = r.template.sections[1].items.find((i) => i.name === 'Siding, Flashing & Trim')!;
    expect(item).toBeTruthy();
    const c = item.comments.find((x) => x.bodyRaw?.startsWith('Flashing &amp; trim'))!;
    expect(c.bodyRaw).toContain('Flashing &amp; trim pieces');
    expect(c.bodyHtml).toContain('Flashing &amp; trim pieces'); // valid HTML, renders as "&"
  });

  it('carries choice lists, units, recommendation and default value across', async () => {
    const r = await load();
    const temp = find(r, 'Inspection Details', 'General', 'Temperature');
    expect(temp).toMatchObject({ type: 'info', answerType: 'number', unitOptions: ['Fahrenheit (F)', 'Celsius (C)'], recommendation: 'pro' });
    expect(find(r, 'Inspection Details', 'General', 'In Attendance').options).toEqual(['Home Owner', 'Client', "Client's Agent", 'Listing Agent']);
    expect(find(r, 'Cooling', 'Cooling Equipment', 'SEER Rating').unitOptions).toEqual(['SEER']);
    const homeowner = find(r, 'Heating', 'General', "Homeowner's Responsibility");
    expect(homeowner.defaultValue).toBe('true');
    expect(homeowner.bodyHtml).toContain("<strong>It's your job</strong>");
    expect(find(r, 'Exterior', 'Vegetation, Grading, Drainage & Retaining Walls', 'Negative Grading').recommendation).toBe('monitor');
  });

  it('keeps all 43 links, with safe attributes', async () => {
    const r = await load();
    expect(r.report.counts.linksInSource).toBe(43);
    expect(r.report.counts.linksImported).toBe(43);
    const withLinks = allComments(r).filter((x) => x.c.bodyHtml?.includes('<a '));
    expect(withLinks.length).toBeGreaterThan(30);
    for (const { c } of withLinks) {
      for (const tag of c.bodyHtml!.match(/<a\b[^>]*>/g)!) {
        expect(tag).toMatch(/href="https?:\/\//);
        if (tag.includes('target=')) expect(tag).toContain('rel="noopener noreferrer"');
      }
    }
  });

  it('tells the truth about the video placeholder: missing from the export, not lost by us', async () => {
    const r = await load();
    const issue = r.report.issues.find((i) => i.code === 'EMBED_PLACEHOLDER_NO_SOURCE')!;
    expect(issue).toMatchObject({ row: 311, origin: 'missing_from_export', severity: 'warning', comment: 'Doorknob Hole' });
    const c = find(r, 'Doors, Windows & Interior', 'Walls', 'Doorknob Hole');
    expect(c.bodyRaw).toContain('youtube-embed-wrapper'); // raw is never rewritten
    expect(c.bodyHtml).not.toContain('<div');
    expect(c.bodyHtml).not.toContain('style=');
  });

  it('reports every kind of change instead of making it silently', async () => {
    const { report } = await load();
    const codes = new Set(report.issues.map((i) => i.code));
    for (const code of ['TEMPLATE_NAME_FROM_FILENAME', 'ENTITIES_DECODED', 'WHITESPACE_TRIMMED', 'EMPTY_COMMENT_TEXT', 'ORDER_TIES', 'EMBED_PLACEHOLDER_NO_SOURCE']) {
      expect(codes.has(code)).toBe(true);
    }
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const empty = report.issues.find((i) => i.code === 'EMPTY_COMMENT_TEXT')!;
    expect((empty.detail!.rows as number[]).length).toBe(9);
    expect(report.exportLimitations.length).toBeGreaterThan(3);
  });

  it('derives the template name from the file name, like Hive does', async () => {
    const { template } = await load();
    expect(template.name).toBe('InterNACHI Residential -2026-09-19');
    expect(template.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a JSON-safe database payload', async () => {
    const payload = toDbPayload(await load());
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(payload.template.name).toBe('InterNACHI Residential -2026-09-19');
    expect(toDbPayload(await load(), { name: '  My tuned template ' }).template.name).toBe('My tuned template');
  });
});

