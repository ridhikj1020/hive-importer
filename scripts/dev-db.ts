// Local Postgres for trying the app without Supabase. Real Postgres (PGlite), with the same migrations.
//   npm run dev:db      (leave running in its own terminal)
// Then in .env.local:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/postgres
//   DATABASE_SSL=disable
// Data is kept in .pglite/ (git-ignored). Delete that folder to start fresh.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readdirSync, readFileSync } from 'node:fs';

async function main() {
  const port = Number(process.env.DEV_DB_PORT ?? 5433);
  const db = await PGlite.create('.pglite');

  // Apply any migration this database has not seen yet (so pulling a new drop just works).
  await db.exec('create table if not exists _applied_migrations (name text primary key)');
  const seen = new Set((await db.query<{ name: string }>('select name from _applied_migrations')).rows.map((r) => r.name));
  const roles = await db.query<{ n: string }>("select count(*) as n from pg_roles where rolname = 'anon'");
  if (Number(roles.rows[0].n) === 0) await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
    if (seen.has(f)) continue;
    // A database made before migrations were tracked already has the first tables.
    const legacy = f === '0001_init.sql' && (await db.query<{ ok: boolean }>("select to_regclass('public.templates') is not null as ok")).rows[0].ok;
    if (!legacy) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    await db.query('insert into _applied_migrations (name) values ($1)', [f]);
    console.log(`applied ${f}`);
  }

  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  console.log(`Local database ready on postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  console.log('Set DATABASE_SSL=disable in .env.local. Ctrl+C to stop.');

  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
