export interface ApiError { code: string; message: string; hint: string | null }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** fetch wrapper for our own API. Never throws: network trouble becomes a readable error. */
export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  const { json, ...rest } = init ?? {};
  try {
    const res = await fetch(url, {
      ...rest,
      headers: json === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    if (res.ok) return { ok: true, data: body as T };
    const err = (body as { error?: ApiError } | null)?.error;
    return { ok: false, error: err ?? { code: 'HTTP_' + res.status, message: 'The server could not do that.', hint: 'Try again.' } };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'Could not reach the server.', hint: 'Check your connection and try again.' } };
  }
}
