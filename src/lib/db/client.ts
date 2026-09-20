import postgres from 'postgres';

/**
 * The only thing the app needs from a database: run SQL with parameters, get rows back.
 * Production uses postgres.js against Supabase. Tests and local dev use PGlite (real Postgres)
 * behind the same interface, so the exact same SQL is exercised everywhere.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not set');
    this.name = 'DatabaseNotConfiguredError';
  }
}

let override: Db | undefined;

// Pages and API routes are bundled separately, so a module-level variable would give each its own
// connection. globalThis keeps it to one connection per server process.
const globalForDb = globalThis as unknown as { __templateImporterDb?: Db };

/** Tests only: point the app at a different database. */
export function setDbForTests(db: Db | undefined) {
  override = db;
}

export function getDb(): Db {
  if (override) return override;
  if (globalForDb.__templateImporterDb) return globalForDb.__templateImporterDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();

  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  // max: 1 keeps each serverless instance to a single pooled connection.
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
  });
  globalForDb.__templateImporterDb = {
    query: async <T,>(text: string, params: unknown[] = []) =>
      (await sql.unsafe(text, params as never[])) as unknown as T[],
  };
  return globalForDb.__templateImporterDb;
}
