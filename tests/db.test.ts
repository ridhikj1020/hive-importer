import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { parseSpectoraExport, toDbPayload } from '../src/lib/importer';
import type { ParsedTemplate } from '../src/lib/importer';

// Real Postgres (PGlite = Postgres compiled to WASM), real migration, real functions.
const MIGRATION = readFileSync('supabase/migrations/0001_init.sql', 'utf8');
const FILE = 'InterNACHI_Residential_-2026-09-19.xls';

async function freshDb(dir?: string) {
  const db = new PGlite(dir);
  await db.exec('create role anon; create role authenticated; create role service_role;'); // exist on Supabase
  await db.exec(MIGRATION);
  return db;
}

/** Whole template as plain data, in display order, with ids stripped, so two trees can be compared. */
async function tree(db: PGlite, templateId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select s.name as section, s.position as sp, i.name as item, i.position as ip,
            c.name, c.type::text, c.position as cp, c.body_html, c.body_raw, c.answer_type, c.options, c.unit_options,
            c.category, c.recommendation, c.default_value, c.source_row, c.source_order, c.extra
       from sections s
       join items i on i.section_id = s.id
       left join comments c on c.item_id = i.id
      where s.template_id = $1
      order by s.position, i.position, c.position`,
    [templateId],
  );
  return rows;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const count = async (db: PGlite, sql: string, params: unknown[] = []) => Number((await db.query<{ n: string }>(sql, params)).rows[0].n);

let parsed: Awaited<ReturnType<typeof parseSpectoraExport>>;
beforeAll(async () => { parsed = await parseSpectoraExport(readFileSync(`fixtures/${FILE}`), FILE); });

const importInto = async (db: PGlite, payload = toDbPayload(parsed)) =>
  (await db.query<{ id: string }>('select import_template($1::jsonb) as id', [JSON.stringify(payload)])).rows[0].id;

describe('import: stored structure equals parsed structure', () => {
  it('writes every section, item and comment, in order, with nothing lost', async () => {
    const db = await freshDb();
    const id = await importInto(db);
    expect(await count(db, 'select count(*) n from sections where template_id=$1', [id])).toBe(13);
    expect(await count(db, 'select count(*) n from items i join sections s on s.id=i.section_id where s.template_id=$1', [id])).toBe(69);
    expect(await count(db, 'select count(*) n from comments c join items i on i.id=c.item_id join sections s on s.id=i.section_id where s.template_id=$1', [id])).toBe(392);

    // round trip: read it back and compare against what the parser produced
    const stored = await tree(db, id);
    const expected = (parsed.template as ParsedTemplate).sections.flatMap((s) =>
      s.items.flatMap((i) => i.comments.map((c) => [s.name, s.position, i.name, i.position, c.name, c.type, c.position, c.bodyHtml, c.bodyRaw, c.answerType, c.options, c.unitOptions, c.category, c.recommendation, c.defaultValue, c.sourceRow, c.sourceOrder, c.extra])),
    );
    const got = stored.map((r) => [r.section, r.sp, r.item, r.ip, r.name, r.type, r.cp, r.body_html, r.body_raw, r.answer_type, r.options, r.unit_options, r.category, r.recommendation, r.default_value, r.source_row, r.source_order, r.extra]);
    expect(got).toEqual(expected);
    await db.close();
  });

  it('keeps the import report and every issue with the template', async () => {
    const db = await freshDb();
    const id = await importInto(db);
    const run = (await db.query<{ counts: { comments: number }; reconciliation: { ok: boolean } }>('select counts, reconciliation from import_runs where template_id=$1', [id])).rows[0];
    expect(run.counts.comments).toBe(392);
    expect(run.reconciliation.ok).toBe(true);
    expect(await count(db, 'select count(*) n from import_issues')).toBe(parsed.report.issues.length);
    const embed = (await db.query<{ source_row: number; origin: string }>("select source_row, origin from import_issues where code='EMBED_PLACEHOLDER_NO_SOURCE'")).rows[0];
    expect(embed).toEqual({ source_row: 311, origin: 'missing_from_export' });
    await db.close();
  });

  it('is atomic: a bad payload leaves nothing behind', async () => {
    const db = await freshDb();
    const bad = toDbPayload(parsed);
    const broken = JSON.parse(JSON.stringify(bad));
    const lastItem = broken.sections.at(-1).items.at(-1);
    lastItem.comments.at(-1).type = 'bogus'; // fails on the very last row, after everything else was written
    await expect(importInto(db, broken)).rejects.toThrow();
    for (const t of ['templates', 'sections', 'items', 'comments', 'import_runs', 'import_issues']) {
      expect(await count(db, `select count(*) n from ${t}`)).toBe(0);
    }
    // and the database is still perfectly usable afterwards
    await importInto(db);
    expect(await count(db, 'select count(*) n from templates')).toBe(1);
    await db.close();
  });
});

describe('edit: changes are saved and survive closing and reopening the database', () => {
  it('persists edits to a section, an item and a comment on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    try {
      let db = await freshDb(dir);
      const id = await importInto(db);
      const sec = (await db.query<{ id: string }>("select id from sections where template_id=$1 and name='Roof'", [id])).rows[0].id;
      await db.query("update sections set name='Roof (edited)' where id=$1", [sec]);
      await db.query("update items set name='Coverings & Flashing' where section_id=$1 and name='Coverings'", [sec]);
      await db.query(
        `update comments set name='Damaged (custom)', body_html='<p>My own wording.</p>'
          where item_id=(select id from items where section_id=$1 and name='Coverings & Flashing') and name='Damaged (General)'`,
        [sec],
      );
      await db.close();

      db = new PGlite(dir); // "close and reopen the app"
      const rows = await tree(db, id);
      const edited = rows.find((r) => r.name === 'Damaged (custom)')!;
      expect(edited).toMatchObject({ section: 'Roof (edited)', item: 'Coverings & Flashing', body_html: '<p>My own wording.</p>' });
      expect(edited.body_raw).not.toBe('<p>My own wording.</p>'); // the as-imported text is still there
      expect(rows).toHaveLength(392);
      await db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bumps updated_at when a comment changes', async () => {
    const db = await freshDb();
    const id = await importInto(db);
    const before = (await db.query<{ t: string }>('select max(c.updated_at)::text t from comments c')).rows[0].t;
    await new Promise((r) => setTimeout(r, 15));
    await db.query("update comments set body_html='<p>x</p>' where id=(select id from comments limit 1)");
    const after = (await db.query<{ t: string }>('select max(c.updated_at)::text t from comments c')).rows[0].t;
    expect(after > before).toBe(true);
    void id;
    await db.close();
  });
});

describe('copy: independent from the original in both directions', () => {
  it('deep-copies the whole template with new ids and a link back to the source', async () => {
    const db = await freshDb();
    const orig = await importInto(db);
    const copy = (await db.query<{ id: string }>('select duplicate_template($1) as id', [orig])).rows[0].id;
    expect(copy).not.toBe(orig);
    const t = (await db.query<{ name: string; copied_from: string }>('select name, copied_from from templates where id=$1', [copy])).rows[0];
    expect(t).toEqual({ name: 'Copy of InterNACHI Residential -2026-09-19', copied_from: orig });

    expect(await tree(db, copy)).toEqual(await tree(db, orig)); // identical content and order
    // ...but shares no rows
    const shared = await count(
      db,
      `select count(*) n from (
         select id from sections where template_id=$1 intersect select id from sections where template_id=$2
       ) x`,
      [orig, copy],
    );
    expect(shared).toBe(0);
    expect(await count(db, 'select count(*) n from comments')).toBe(784);
    await db.close();
  });

  it('editing the copy leaves the original byte-identical', async () => {
    const db = await freshDb();
    const orig = await importInto(db);
    const before = hash(await tree(db, orig));
    const copy = (await db.query<{ id: string }>("select duplicate_template($1, 'My tuned copy') as id", [orig])).rows[0].id;

    await db.query("update sections set name='CHANGED' where template_id=$1 and name='Exterior'", [copy]);
    await db.query("update items set name='CHANGED ITEM' where section_id in (select id from sections where template_id=$1) and name='Siding, Flashing & Trim'", [copy]);
    await db.query("update comments set body_html='<p>CHANGED</p>', name='CHANGED COMMENT' where item_id in (select i.id from items i join sections s on s.id=i.section_id where s.template_id=$1) and name='Cracking - Major'", [copy]);
    await db.query('delete from sections where template_id=$1 and name=$2', [copy, 'Garage']);

    expect(hash(await tree(db, orig))).toBe(before);
    expect(await tree(db, copy)).not.toEqual(await tree(db, orig));
    expect(await count(db, 'select count(*) n from sections where template_id=$1', [copy])).toBe(12);
    await db.close();
  });

  it('editing the original leaves the copy untouched', async () => {
    const db = await freshDb();
    const orig = await importInto(db);
    const copy = (await db.query<{ id: string }>('select duplicate_template($1) as id', [orig])).rows[0].id;
    const before = hash(await tree(db, copy));
    await db.query("update comments set body_html='<p>CHANGED</p>' where item_id in (select i.id from items i join sections s on s.id=i.section_id where s.template_id=$1)", [orig]);
    await db.query("update templates set name='Renamed original' where id=$1", [orig]);
    expect(hash(await tree(db, copy))).toBe(before);
    expect((await db.query<{ name: string }>('select name from templates where id=$1', [copy])).rows[0].name).toMatch(/^Copy of /);
    await db.close();
  });

  it('deleting the original does not damage the copy', async () => {
    const db = await freshDb();
    const orig = await importInto(db);
    const copy = (await db.query<{ id: string }>('select duplicate_template($1) as id', [orig])).rows[0].id;
    const before = hash(await tree(db, copy));
    await db.query('delete from templates where id=$1', [orig]);
    expect(hash(await tree(db, copy))).toBe(before);
    expect((await db.query<{ copied_from: string | null }>('select copied_from from templates where id=$1', [copy])).rows[0].copied_from).toBeNull();
    await db.close();
  });

  it('copying a template that does not exist fails cleanly', async () => {
    const db = await freshDb();
    await expect(db.query("select duplicate_template('00000000-0000-0000-0000-000000000000')")).rejects.toThrow(/not found/);
    await db.close();
  });
});

describe('access: the public (anon) role gets no way in', () => {
  it('has row-level security on every table and cannot call the import or copy functions', async () => {
    const db = await freshDb();
    await importInto(db);
    const rls = (await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('templates','sections','items','comments','import_runs','import_issues')",
    )).rows;
    expect(rls).toHaveLength(6);
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    await db.exec('set role anon');
    await expect(db.query("select import_template('{}'::jsonb)")).rejects.toThrow(/permission denied/);
    await expect(db.query("select duplicate_template('00000000-0000-0000-0000-000000000000')")).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await db.close();
  });
});
