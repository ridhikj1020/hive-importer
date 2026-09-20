import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/client';
import { getTemplateTree } from '@/lib/db/queries';
import { UUID_RE } from '@/lib/api';
import TemplateEditor from '@/components/TemplateEditor';

export const dynamic = 'force-dynamic';

export default async function TemplatePage(props: PageProps<'/templates/[id]'>) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  if (!UUID_RE.test(id)) notFound();
  const tree = await getTemplateTree(getDb(), id);
  if (!tree) notFound();
  const focus = typeof sp.comment === 'string' && UUID_RE.test(sp.comment) ? sp.comment : undefined;
  return <TemplateEditor tree={tree} focusCommentId={focus} />;
}
