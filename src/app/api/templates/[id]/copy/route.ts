import { getDb } from '@/lib/db/client';
import { copyTemplate } from '@/lib/db/queries';
import { UUID_RE, cleanName, fail, guard, readObject, type IdContext } from '@/lib/api';

export const runtime = 'nodejs';

/** POST /api/templates/:id/copy  { name? }  -> a deep copy that shares nothing with the original */
export async function POST(req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid template id.');
    const body = await readObject(req); // body is optional
    const name = body?.name === undefined ? null : cleanName(body.name);
    if (body?.name !== undefined && !name) return fail(400, 'BAD_NAME', 'A name needs 1 to 300 characters.');
    const newId = await copyTemplate(getDb(), id, name);
    return newId ? Response.json({ templateId: newId }, { status: 201 }) : fail(404, 'NOT_FOUND', 'That template does not exist.');
  });
}
