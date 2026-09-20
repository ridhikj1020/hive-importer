import type { Db } from './client';
import type { ImportPayload } from '@/lib/importer';

export type CommentType = 'info' | 'limit' | 'defect';

export interface TemplateSummary {
  id: string;
  name: string;
  copiedFrom: string | null;
  copiedFromName: string | null;
  isProtected: boolean;
  sourceFilename: string | null;
  createdAt: string;
  updatedAt: string;
  sections: number;
  items: number;
  comments: number;
}

export interface TreeComment {
  id: string;
  name: string;
  type: CommentType;
  position: number;
  bodyHtml: string | null;
  bodyRaw: string | null;
  bodyEdited: boolean;
  answerType: string | null;
  options: string[];
  unitOptions: string[];
  category: number | null;
  recommendation: string | null;
  defaultValue: string | null;
  sourceRow: number | null;
}
export interface TreeItem { id: string; name: string; position: number; comments: TreeComment[] }
export interface TreeSection { id: string; name: string; position: number; items: TreeItem[] }
export interface TemplateTree {
  id: string;
  name: string;
  copiedFrom: string | null;
  copiedFromName: string | null;
  isProtected: boolean;
  sourceFilename: string | null;
  createdAt: string;
  updatedAt: string;
  sections: TreeSection[];
}

export interface ReportIssue {
  severity: 'info' | 'warning' | 'error';
  origin: 'missing_from_export' | 'unsupported_by_importer' | 'normalized' | 'invalid_input';
  code: string;
  message: string;
  sourceRow: number | null;
  section: string | null;
  item: string | null;
  comment: string | null;
  detail: Record<string, unknown> | null;
  /** id of the comment this issue is about, when it can be found by sheet row */
  commentId: string | null;
}
export interface ImportReportView {
  runId: string;
  sourceFilename: string | null;
  createdAt: string;
  counts: {
    dataRows: number; rowsImported: number; rowsSkipped: number; rowsBlank: number;
    sections: number; items: number; comments: number;
    byType: Record<CommentType, number>;
    commentsWithHtml: number; commentsWithEmptyText: number;
    linksInSource: number; linksImported: number;
  };
  reconciliation: {
    rowsBalanced: boolean; structureBalanced: boolean; textPreserved: boolean; linksPreserved: boolean;
    checkedComments: number; ok: boolean;
  };
  exportLimitations: string[];
  issues: ReportIssue[];
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------------------- templates

export async function listTemplates(db: Db): Promise<TemplateSummary[]> {
  const rows = await db.query<Row>(
    `select t.id, t.name, t.copied_from, o.name as copied_from_name, t.is_protected, t.source_filename,
            t.created_at::text as created_at, t.updated_at::text as updated_at,
            (select count(*) from sections x where x.template_id = t.id)::int as sections,
            (select count(*) from items i join sections x on x.id = i.section_id where x.template_id = t.id)::int as items,
            (select count(*) from comments c join items i on i.id = c.item_id join sections x on x.id = i.section_id where x.template_id = t.id)::int as comments
       from templates t
       left join templates o on o.id = t.copied_from
      order by t.is_protected desc, t.created_at desc`,
  );
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), copiedFrom: s(r.copied_from), copiedFromName: s(r.copied_from_name),
    isProtected: Boolean(r.is_protected), sourceFilename: s(r.source_filename),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    sections: Number(r.sections), items: Number(r.items), comments: Number(r.comments),
  }));
}

export async function getTemplateTree(db: Db, id: string): Promise<TemplateTree | null> {
  const head = await db.query<Row>(
    `select t.id, t.name, t.copied_from, o.name as copied_from_name, t.is_protected, t.source_filename,
            t.created_at::text as created_at, t.updated_at::text as updated_at
       from templates t left join templates o on o.id = t.copied_from
      where t.id = $1`,
    [id],
  );
  if (head.length === 0) return null;
  const rows = await db.query<Row>(
    `select x.id as sid, x.name as sname, x.position as sp,
            i.id as iid, i.name as iname, i.position as ip,
            c.id as cid, c.name as cname, c.type::text as ctype, c.position as cp,
            c.body_html, c.body_raw, c.body_edited, c.answer_type, c.options, c.unit_options, c.category,
            c.recommendation, c.default_value, c.source_row
       from sections x
       left join items i on i.section_id = x.id
       left join comments c on c.item_id = i.id
      where x.template_id = $1
      order by x.position, i.position, c.position`,
    [id],
  );
  const sections: TreeSection[] = [];
  let sec: TreeSection | undefined;
  let item: TreeItem | undefined;
  for (const r of rows) {
    if (!sec || sec.id !== r.sid) {
      sec = { id: String(r.sid), name: String(r.sname), position: Number(r.sp), items: [] };
      sections.push(sec);
      item = undefined;
    }
    if (r.iid && (!item || item.id !== r.iid)) {
      item = { id: String(r.iid), name: String(r.iname), position: Number(r.ip), comments: [] };
      sec.items.push(item);
    }
    if (r.cid && item) {
      item.comments.push({
        id: String(r.cid), name: String(r.cname), type: r.ctype as CommentType, position: Number(r.cp),
        bodyHtml: s(r.body_html), bodyRaw: s(r.body_raw), bodyEdited: Boolean(r.body_edited), answerType: s(r.answer_type),
        options: (r.options as string[] | null) ?? [], unitOptions: (r.unit_options as string[] | null) ?? [],
        category: r.category === null || r.category === undefined ? null : Number(r.category),
        recommendation: s(r.recommendation), defaultValue: s(r.default_value),
        sourceRow: r.source_row === null || r.source_row === undefined ? null : Number(r.source_row),
      });
    }
  }
  const h = head[0];
  return {
    id: String(h.id), name: String(h.name), copiedFrom: s(h.copied_from), copiedFromName: s(h.copied_from_name),
    isProtected: Boolean(h.is_protected), sourceFilename: s(h.source_filename),
    createdAt: String(h.created_at), updatedAt: String(h.updated_at), sections,
  };
}

export async function importTemplate(db: Db, payload: ImportPayload): Promise<string> {
  const rows = await db.query<{ id: string }>('select import_template(($1::text)::jsonb) as id', [JSON.stringify(payload)]);
  return String(rows[0].id);
}

export async function copyTemplate(db: Db, id: string, name: string | null): Promise<string | null> {
  const exists = await db.query('select 1 as x from templates where id = $1', [id]);
  if (exists.length === 0) return null;
  const rows = await db.query<{ id: string }>('select duplicate_template($1::uuid, $2::text) as id', [id, name]);
  return String(rows[0].id);
}

export async function renameTemplate(db: Db, id: string, name: string): Promise<boolean> {
  return (await db.query('update templates set name = $2 where id = $1 returning id', [id, name])).length > 0;
}

export type DeleteResult = 'deleted' | 'protected' | 'not_found';
export async function deleteTemplate(db: Db, id: string): Promise<DeleteResult> {
  const gone = await db.query('delete from templates where id = $1 and not is_protected returning id', [id]);
  if (gone.length > 0) return 'deleted';
  const still = await db.query('select 1 as x from templates where id = $1', [id]);
  return still.length > 0 ? 'protected' : 'not_found';
}

export async function setProtected(db: Db, id: string, value: boolean) {
  await db.query('update templates set is_protected = $2 where id = $1', [id, value]);
}

export async function findProtectedBySha(db: Db, sha: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>('select id from templates where source_sha256 = $1 and is_protected limit 1', [sha]);
  return rows[0] ? String(rows[0].id) : null;
}

// ------------------------------------------------------------------------ sections, items, comments

export async function renameSection(db: Db, id: string, name: string): Promise<boolean> {
  return (await db.query('update sections set name = $2 where id = $1 returning id', [id, name])).length > 0;
}
export async function renameItem(db: Db, id: string, name: string): Promise<boolean> {
  return (await db.query('update items set name = $2 where id = $1 returning id', [id, name])).length > 0;
}

export interface CommentUpdate { name?: string; bodyHtml?: string | null }
/**
 * Changing comment text marks it edited. Putting the exported text back clears the mark
 * (pass { edited: false }). body_raw is never written here.
 */
export async function updateComment(db: Db, id: string, patch: CommentUpdate, opts: { edited?: boolean } = {}) {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
  if (patch.bodyHtml !== undefined) {
    params.push(patch.bodyHtml); sets.push(`body_html = $${params.length}`);
    params.push(opts.edited ?? true); sets.push(`body_edited = $${params.length}`);
  }
  if (sets.length === 0) return null;
  const rows = await db.query<Row>(`update comments set ${sets.join(', ')} where id = $1 returning id, name, body_html, body_edited`, params);
  return rows[0]
    ? { id: String(rows[0].id), name: String(rows[0].name), bodyHtml: s(rows[0].body_html), bodyEdited: Boolean(rows[0].body_edited) }
    : null;
}

export async function getCommentRaw(db: Db, id: string): Promise<{ bodyRaw: string | null } | null> {
  const rows = await db.query<Row>('select body_raw from comments where id = $1', [id]);
  return rows[0] ? { bodyRaw: s(rows[0].body_raw) } : null;
}

// ----------------------------------------------------------------------------------------- report

export async function getImportReport(db: Db, templateId: string): Promise<ImportReportView | null> {
  const runs = await db.query<Row>(
    `select id, source_filename, created_at::text as created_at, counts, reconciliation, export_limitations
       from import_runs where template_id = $1 order by created_at desc limit 1`,
    [templateId],
  );
  if (runs.length === 0) return null;
  const run = runs[0];
  const [issues, comments] = await Promise.all([
    db.query<Row>(
      `select severity, origin, code, message, source_row, section, item, comment, detail
         from import_issues where import_run_id = $1
        order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, source_row nulls last, code`,
      [run.id],
    ),
    db.query<Row>(
      `select c.id, c.source_row from comments c
         join items i on i.id = c.item_id join sections x on x.id = i.section_id
        where x.template_id = $1 and c.source_row is not null`,
      [templateId],
    ),
  ]);
  const byRow = new Map<number, string>(comments.map((c) => [Number(c.source_row), String(c.id)]));
  return {
    runId: String(run.id),
    sourceFilename: s(run.source_filename),
    createdAt: String(run.created_at),
    counts: run.counts as ImportReportView['counts'],
    reconciliation: run.reconciliation as ImportReportView['reconciliation'],
    exportLimitations: (run.export_limitations as string[] | null) ?? [],
    issues: issues.map((i) => ({
      severity: i.severity as ReportIssue['severity'],
      origin: i.origin as ReportIssue['origin'],
      code: String(i.code),
      message: String(i.message),
      sourceRow: i.source_row === null || i.source_row === undefined ? null : Number(i.source_row),
      section: s(i.section), item: s(i.item), comment: s(i.comment),
      detail: (i.detail as Record<string, unknown> | null) ?? null,
      commentId: i.source_row === null || i.source_row === undefined ? null : byRow.get(Number(i.source_row)) ?? null,
    })),
  };
}
