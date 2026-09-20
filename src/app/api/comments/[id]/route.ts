import { getDb } from '@/lib/db/client';
import { updateComment } from '@/lib/db/queries';
import { MAX_BODY_CHARS, UUID_RE, cleanName, fail, guard, readObject, type IdContext } from '@/lib/api';
import { normalizeCommentHtml } from '@/lib/importer';

export const runtime = 'nodejs';

/**
 * PATCH /api/comments/:id  { name?, bodyHtml? }
 * Text from the editor is sanitized on the server too, whatever the browser sent.
 * body_raw (the text as exported) is never touched.
 */
export async function PATCH(req: Request, ctx: IdContext) {
  return guard(async () => {
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return fail(400, 'BAD_ID', 'That is not a valid id.');
    const body = await readObject(req);
    if (!body) return fail(400, 'BAD_REQUEST', 'Send a JSON object.');

    const patch: { name?: string; bodyHtml?: string | null } = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) return fail(400, 'BAD_NAME', 'A name needs 1 to 300 characters.');
      patch.name = name;
    }
    if (body.bodyHtml !== undefined) {
      if (body.bodyHtml !== null && typeof body.bodyHtml !== 'string') return fail(400, 'BAD_BODY', 'Comment text must be text.');
      const raw = (body.bodyHtml as string | null) ?? '';
      if (raw.length > MAX_BODY_CHARS) return fail(413, 'BODY_TOO_LARGE', 'That comment is too long.');
      patch.bodyHtml = normalizeCommentHtml(raw).html;
    }
    if (patch.name === undefined && patch.bodyHtml === undefined) return fail(400, 'NOTHING_TO_UPDATE', 'Send a name or bodyHtml.');

    const updated = await updateComment(getDb(), id, patch);
    return updated ? Response.json({ comment: updated }) : fail(404, 'NOT_FOUND', 'That comment does not exist.');
  });
}
