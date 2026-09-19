import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFirstSheet } from '../src/lib/importer/readXlsx';
import { makeXlsx } from './helpers/makeXlsx';

const FIXTURE = 'fixtures/InterNACHI_Residential_-2026-09-19.xls';
const oracle = JSON.parse(readFileSync(`fixtures/oracle/${FIXTURE.split('/').pop()}.cells.json`, 'utf8')) as {
  reader: string;
  cells: Record<string, string>;
};

const colLetters = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

describe('spreadsheet reader vs independent oracle', () => {
  const sheet = readFirstSheet(readFileSync(FIXTURE));

  it('agrees with openpyxl on every non-empty cell, and on which cells are empty', () => {
    const mismatches: string[] = [];
    let seen = 0;
    for (let r = 1; r <= sheet.maxRow; r++) {
      for (let c = 1; c <= sheet.maxCol; c++) {
        const ref = `${colLetters(c)}${r}`;
        const mine = sheet.get(r, c);
        const theirs = oracle.cells[ref] ?? '';
        if (theirs !== '') seen++;
        if (mine !== theirs) mismatches.push(`${ref}: mine=${JSON.stringify(mine).slice(0, 60)} oracle=${JSON.stringify(theirs).slice(0, 60)}`);
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(seen).toBe(Object.keys(oracle.cells).length);
    expect(sheet.maxRow).toBe(393);
  });

  it('does not double-decode entities (regression: ExcelJS turned "&amp;" into "&")', () => {
    for (const enc of ['inline', 'shared', 'str'] as const) {
      const s = readFirstSheet(makeXlsx([['a'], ['AT&amp;T &lt;b&gt; & Co']], enc));
      expect(s.get(2, 1)).toBe('AT&amp;T &lt;b&gt; & Co');
    }
  });

  it('keeps leading and trailing spaces', () => {
    for (const enc of ['inline', 'shared', 'str'] as const) {
      expect(readFirstSheet(makeXlsx([['Temperature '], [' x']], enc)).get(1, 1)).toBe('Temperature ');
    }
  });
});
