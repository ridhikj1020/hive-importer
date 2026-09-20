import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import type { Db } from '../../src/lib/db/client';

/** A real Postgres (PGlite = Postgres in WASM) with every migration applied, behind the app's Db interface. */
export async function makeTestDb(dataDir?: string) {
  const pg = new PGlite(dataDir);
  await pg.exec('create role anon; create role authenticated; create role service_role;'); // exist on Supabase
  for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }
  const db: Db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as T[],
  };
  return { pg, db };
}
