import { getDb } from '@/lib/db/client';
import { listTemplates } from '@/lib/db/queries';
import { guard } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return guard(async () => Response.json({ templates: await listTemplates(getDb()) }));
}
