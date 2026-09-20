import { getDb } from '@/lib/db/client';
import { renameItem } from '@/lib/db/queries';
import { UUID_RE, cleanName, fail, guard, readObject, type IdContext } from '@/lib/api';

export const runtime = 'nodejs';

export async function PATCH(req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid id.');
    const body = await readObject(req);
    const name = cleanName(body?.name);
    if (!name) return fail(400, 'BAD_NAME', 'A name needs 1 to 300 characters.');
    const ok = await renameItem(getDb(), id, name);
    return ok ? Response.json({ id, name }) : fail(404, 'NOT_FOUND', 'That item does not exist.');
  });
}
