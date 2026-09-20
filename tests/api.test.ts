import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { setDbForTests, type Db } from '@/lib/db/client';
import { getImportReport, setProtected, type TemplateTree } from '@/lib/db/queries';
import { POST as importPOST } from '@/app/api/import/route';
import { GET as listGET } from '@/app/api/templates/route';
import { GET as treeGET, PATCH as templatePATCH, DELETE as templateDELETE } from '@/app/api/templates/[id]/route';
import { POST as copyPOST } from '@/app/api/templates/[id]/copy/route';
import { PATCH as sectionPATCH } from '@/app/api/sections/[id]/route';
import { PATCH as itemPATCH } from '@/app/api/items/[id]/route';
import { PATCH as commentPATCH } from '@/app/api/comments/[id]/route';
import { POST as resetPOST } from '@/app/api/comments/[id]/reset/route';
import { makeTestDb } from './helpers/testDb';

const FILE = 'InterNACHI_Residential_-2026-09-19.xls';
const fixture = () => readFileSync(`fixtures/${FILE}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body?: unknown) =>
  new Request('http://test/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const bodyOf = async (r: Response) => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function upload(bytes: Uint8Array, name: string, fields: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set('file', new File([bytes as BlobPart], name));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return importPOST(new Request('http://test/api/import', { method: 'POST', body: fd }));
}

let pg: PGlite;
let db: Db;
beforeEach(async () => {
  ({ pg, db } = await makeTestDb());
  setDbForTests(db);
});
afterEach(async () => {
  setDbForTests(undefined);
  await pg.close();
});

async function importFixture(fields: Record<string, string> = {}) {
  const res = await upload(fixture(), FILE, fields);
  expect(res.status).toBe(201);
  return (await bodyOf(res)).templateId as string;
}
const tree = async (id: string) => ((await bodyOf(await treeGET(json('GET'), ctx(id)))).template as TemplateTree);
/** The content of a template with every id and timestamp removed, for comparing two templates. */
const shape = (t: TemplateTree) =>
  t.sections.map((s) => [s.name, s.items.map((i) => [i.name, i.comments.map((c) => [c.name, c.type, c.bodyHtml, c.bodyRaw, c.options, c.sourceRow])])]);
const findComment = (t: TemplateTree, name: string) => t.sections.flatMap((s) => s.items.flatMap((i) => i.comments)).find((c) => c.name === name)!;

describe('import over HTTP', () => {
  it('imports the real export and serves it back', async () => {
    const id = await importFixture();
    const list = (await bodyOf(await listGET())).templates;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: 'InterNACHI Residential -2026-09-19', sections: 13, items: 69, comments: 392, isProtected: false, copiedFrom: null });
    const t = await tree(id);
    expect(t.sections).toHaveLength(13);
    expect(t.sections[0]).toMatchObject({ name: 'Inspection Details', position: 0 });
    expect(findComment(t, 'Temperature')).toMatchObject({ type: 'info', answerType: 'number', unitOptions: ['Fahrenheit (F)', 'Celsius (C)'] });
  });

  it('lets the user choose the template name', async () => {
    const id = await importFixture({ name: '  Ridhi tuned template ' });
    expect((await tree(id)).name).toBe('Ridhi tuned template');
  });

  it('shows the import report with issues linked to the comments they are about', async () => {
    const id = await importFixture();
    const report = (await getImportReport(db, id))!;
    expect(report.reconciliation.ok).toBe(true);
    expect(report.counts.comments).toBe(392);
    const embed = report.issues.find((i) => i.code === 'EMBED_PLACEHOLDER_NO_SOURCE')!;
    expect(embed).toMatchObject({ sourceRow: 311, origin: 'missing_from_export', comment: 'Doorknob Hole' });
    const t = await tree(id);
    expect(embed.commentId).toBe(findComment(t, 'Doorknob Hole').id);
    expect(report.issues.map((i) => i.severity)).toEqual([...report.issues.map((i) => i.severity)].sort((a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)));
  });

  it('refuses a bad file with a plain message and writes nothing', async () => {
    const res = await upload(new TextEncoder().encode('Section Name,Item Name\nRoof,Coverings\n'), 'template.csv');
    expect(res.status).toBe(422);
    const { error } = await bodyOf(res);
    expect(error.code).toBe('NOT_A_SPREADSHEET');
    expect(error.hint).toContain('Export HTML Text');
    expect((await bodyOf(await listGET())).templates).toEqual([]);
    expect(Number((await db.query<{ n: string }>('select count(*) n from import_runs'))[0].n)).toBe(0);
  });

  it('handles a missing file and an oversized file', async () => {
    const none = await importPOST(new Request('http://test/api/import', { method: 'POST', body: new FormData() }));
    expect(none.status).toBe(400);
    expect((await bodyOf(none)).error.code).toBe('NO_FILE');
    const big = await upload(new Uint8Array(4 * 1024 * 1024 + 1), 'big.xls');
    expect(big.status).toBe(413);
    expect((await bodyOf(big)).error.code).toBe('FILE_TOO_LARGE');
  });

  it('says so, instead of crashing, when the database is not configured', async () => {
    setDbForTests(undefined);
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const res = await listGET();
      expect(res.status).toBe(503);
      expect((await bodyOf(res)).error.code).toBe('DATABASE_NOT_CONFIGURED');
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});

describe('edit over HTTP', () => {
  it('saves section, item, comment and template names', async () => {
    const id = await importFixture();
    const t = await tree(id);
    const roof = t.sections.find((s) => s.name === 'Roof')!;
    const coverings = roof.items[0];
    const damaged = coverings.comments[0];

    expect((await sectionPATCH(json('PATCH', { name: '  Roof & Gutters ' }), ctx(roof.id))).status).toBe(200);
    expect((await itemPATCH(json('PATCH', { name: 'Roof coverings' }), ctx(coverings.id))).status).toBe(200);
    expect((await commentPATCH(json('PATCH', { name: 'Damaged (mine)', bodyHtml: '<p>My own <strong>wording</strong>.</p>' }), ctx(damaged.id))).status).toBe(200);
    expect((await templatePATCH(json('PATCH', { name: 'Renamed' }), ctx(id))).status).toBe(200);

    const after = await tree(id); // fresh read = what a reopened app would see
    expect(after.name).toBe('Renamed');
    const roof2 = after.sections.find((s) => s.id === roof.id)!;
    expect(roof2.name).toBe('Roof & Gutters');
    expect(roof2.items[0].name).toBe('Roof coverings');
    expect(roof2.items[0].comments[0]).toMatchObject({ name: 'Damaged (mine)', bodyHtml: '<p>My own <strong>wording</strong>.</p>' });
    expect(roof2.items[0].comments[0].bodyRaw).toBe(damaged.bodyRaw); // as-exported text is untouched
    expect(roof2.items[0].comments[0].bodyEdited).toBe(true);
    expect(damaged.bodyEdited).toBe(false); // freshly imported comments are not marked edited
    expect(roof2.items[0].comments[0].position).toBe(damaged.position); // still in the same place
  });

  it('sanitizes what the browser sends, and can clear a comment', async () => {
    const id = await importFixture();
    const c = findComment(await tree(id), 'Damaged (General)');
    const res = await commentPATCH(json('PATCH', { bodyHtml: '<p onclick="steal()">hi<script>alert(1)</script></p><a href="javascript:alert(1)">x</a>' }), ctx(c.id));
    expect((await bodyOf(res)).comment.bodyHtml).toBe('<p>hi</p><a>x</a>'); // link with a blocked address stays as plain text
    const cleared = await commentPATCH(json('PATCH', { bodyHtml: '' }), ctx(c.id));
    expect((await bodyOf(cleared)).comment.bodyHtml).toBeNull();
  });

  it('rejects bad input without changing anything', async () => {
    const id = await importFixture();
    const before = shape(await tree(id));
    const c = findComment(await tree(id), 'Damaged (General)');
    expect((await commentPATCH(json('PATCH', { name: '   ' }), ctx(c.id))).status).toBe(400);
    expect((await commentPATCH(json('PATCH', { name: 'x'.repeat(301) }), ctx(c.id))).status).toBe(400);
    expect((await commentPATCH(json('PATCH', { bodyHtml: 42 }), ctx(c.id))).status).toBe(400);
    expect((await commentPATCH(json('PATCH', {}), ctx(c.id))).status).toBe(400);
    expect((await commentPATCH(json('PATCH', { bodyHtml: 'x'.repeat(100_001) }), ctx(c.id))).status).toBe(413);
    expect((await commentPATCH(new Request('http://t/x', { method: 'PATCH', body: 'not json' }), ctx(c.id))).status).toBe(400);
    expect((await commentPATCH(json('PATCH', { name: 'x' }), ctx('not-a-uuid'))).status).toBe(400);
    expect((await commentPATCH(json('PATCH', { name: 'x' }), ctx('00000000-0000-0000-0000-000000000000'))).status).toBe(404);
    expect((await sectionPATCH(json('PATCH', { name: '' }), ctx(id))).status).toBe(400);
    expect(shape(await tree(id))).toEqual(before);
  });

  it('resets a comment to the text that was exported', async () => {
    const id = await importFixture();
    const t = await tree(id);
    const c = findComment(t, 'Doorknob Hole');
    await commentPATCH(json('PATCH', { bodyHtml: '<p>changed</p>' }), ctx(c.id));
    expect(findComment(await tree(id), 'Doorknob Hole').bodyEdited).toBe(true);
    const res = await resetPOST(json('POST'), ctx(c.id));
    expect((await bodyOf(res)).comment.bodyHtml).toBe(c.bodyHtml);
    const after = findComment(await tree(id), 'Doorknob Hole');
    expect(after.bodyHtml).toBe(c.bodyHtml);
    expect(after.bodyEdited).toBe(false);
  });

  it('bumps the template updated time when a comment changes', async () => {
    const id = await importFixture();
    const before = (await tree(id)).updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    await commentPATCH(json('PATCH', { name: 'Touched' }), ctx(findComment(await tree(id), 'Damaged (General)').id));
    expect((await tree(id)).updatedAt > before).toBe(true);
  });
});

describe('copy and delete over HTTP', () => {
  it('a copy is an independent template: edits go one way only', async () => {
    const id = await importFixture();
    const res = await copyPOST(json('POST', { name: 'Ridhi copy' }), ctx(id));
    expect(res.status).toBe(201);
    const copyId = (await bodyOf(res)).templateId as string;
    const original = await tree(id);
    const copy = await tree(copyId);
    expect(copy).toMatchObject({ name: 'Ridhi copy', copiedFrom: id, copiedFromName: original.name, isProtected: false });
    expect(shape(copy)).toEqual(shape(original));
    const edited = findComment(original, 'Damaged (General)');
    await commentPATCH(json('PATCH', { bodyHtml: '<p>edited before copying</p>' }), ctx(edited.id));
    const copy2 = (await bodyOf(await copyPOST(json('POST'), ctx(id)))).templateId as string;
    expect(findComment(await tree(copy2), 'Damaged (General)')).toMatchObject({ bodyHtml: '<p>edited before copying</p>', bodyEdited: true }); // the copy remembers what was edited
    await templateDELETE(json('DELETE'), ctx(copy2));

    const before = shape(await tree(id));
    const c = findComment(copy, 'Damaged (General)');
    await commentPATCH(json('PATCH', { name: 'CHANGED', bodyHtml: '<p>CHANGED</p>' }), ctx(c.id));
    await sectionPATCH(json('PATCH', { name: 'CHANGED SECTION' }), ctx(copy.sections[0].id));
    expect(shape(await tree(id))).toEqual(before); // original untouched
    expect(shape(await tree(copyId))).not.toEqual(before);

    // and the other direction
    const copyBefore = shape(await tree(copyId));
    await commentPATCH(json('PATCH', { name: 'ORIGINAL CHANGED' }), ctx(findComment(original, 'Damaged (General)').id));
    expect(shape(await tree(copyId))).toEqual(copyBefore);
  });

  it('copy gets a default name, and unknown ids are 404', async () => {
    const id = await importFixture();
    const copyId = (await bodyOf(await copyPOST(json('POST'), ctx(id)))).templateId as string;
    expect((await tree(copyId)).name).toBe('Copy of InterNACHI Residential -2026-09-19');
    expect((await copyPOST(json('POST'), ctx('00000000-0000-0000-0000-000000000000'))).status).toBe(404);
    expect((await copyPOST(json('POST', { name: '  ' }), ctx(id))).status).toBe(400);
  });

  it('the protected example cannot be deleted, copies can', async () => {
    const id = await importFixture();
    await setProtected(db, id, true);
    const del = await templateDELETE(json('DELETE'), ctx(id));
    expect(del.status).toBe(403);
    expect((await bodyOf(del)).error.code).toBe('PROTECTED');

    const copyId = (await bodyOf(await copyPOST(json('POST'), ctx(id)))).templateId as string;
    expect((await tree(copyId)).isProtected).toBe(false);
    expect((await templateDELETE(json('DELETE'), ctx(copyId))).status).toBe(200);
    expect((await treeGET(json('GET'), ctx(copyId))).status).toBe(404);
    expect((await tree(id)).sections).toHaveLength(13);
    expect((await templateDELETE(json('DELETE'), ctx(copyId))).status).toBe(404);
  });
});
