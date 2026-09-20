import { ImportError } from '@/lib/importer';
import { DatabaseNotConfiguredError } from '@/lib/db/client';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type IdContext = { params: Promise<{ id: string }> };

export function fail(status: number, code: string, message: string, hint?: string): Response {
  return Response.json({ error: { code, message, hint: hint ?? null } }, { status });
}

/** Turns thrown errors into honest JSON. Unknown errors are logged, never leaked to the browser. */
export async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ImportError) return fail(422, e.code, e.message, e.hint);
    if (e instanceof DatabaseNotConfiguredError) {
      return fail(503, 'DATABASE_NOT_CONFIGURED', 'The database is not set up yet.', 'Set DATABASE_URL and restart. See the README.');
    }
    console.error(e);
    return fail(500, 'SERVER_ERROR', 'Something went wrong. Nothing was changed.', 'Try again. If it keeps happening, tell whoever runs this app.');
  }
}

export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A name typed by a person: plain text, 1 to 300 characters. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length >= 1 && v.length <= 300 ? v : null;
}

export const MAX_BODY_CHARS = 100_000;
