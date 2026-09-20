import { getDb } from '@/lib/db/client';
import { deleteTemplate, getTemplateTree, renameTemplate } from '@/lib/db/queries';
import { UUID_RE, cleanName, fail, guard, readObject, type IdContext } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid template id.');
    const tree = await getTemplateTree(getDb(), id);
    return tree ? Response.json({ template: tree }) : fail(404, 'NOT_FOUND', 'That template does not exist.');
  });
}

export async function PATCH(req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid template id.');
    const body = await readObject(req);
    const name = cleanName(body?.name);
    if (!name) return fail(400, 'BAD_NAME', 'A name needs 1 to 300 characters.');
    const ok = await renameTemplate(getDb(), id, name);
    return ok ? Response.json({ id, name }) : fail(404, 'NOT_FOUND', 'That template does not exist.');
  });
}

export async function DELETE(_req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid template id.');
    const result = await deleteTemplate(getDb(), id);
    if (result === 'protected') return fail(403, 'PROTECTED', 'The example template cannot be deleted.', 'Copy it and delete the copy instead.');
    if (result === 'not_found') return fail(404, 'NOT_FOUND', 'That template does not exist.');
    return Response.json({ deleted: id });
  });
}
