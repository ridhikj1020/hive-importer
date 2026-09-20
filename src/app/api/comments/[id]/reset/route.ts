import { getDb } from '@/lib/db/client';
import { getCommentRaw, updateComment } from '@/lib/db/queries';
import { UUID_RE, fail, guard, type IdContext } from '@/lib/api';
import { normalizeCommentHtml } from '@/lib/importer';

export const runtime = 'nodejs';

/** POST /api/comments/:id/reset: put the comment text back to what the Spectora export had. */
export async function POST(_req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid id.');
    const db = getDb();
    const raw = await getCommentRaw(db, id);
    if (!raw) return fail(404, 'NOT_FOUND', 'That comment does not exist.');
    const updated = await updateComment(db, id, { bodyHtml: normalizeCommentHtml(raw.bodyRaw).html }, { edited: false });
    return updated ? Response.json({ comment: updated }) : fail(404, 'NOT_FOUND', 'That comment does not exist.');
  });
}
