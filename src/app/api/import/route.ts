import { getDb } from '@/lib/db/client';
import { importTemplate } from '@/lib/db/queries';
import { fail, guard } from '@/lib/api';
import { parseSpectoraExport, toDbPayload } from '@/lib/importer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel rejects larger request bodies anyway

/**
 * POST /api/import  (multipart form: file, optional name)
 * Parse first, write second. A file that fails validation never touches the database,
 * and the write itself is one transaction (import_template), so there is no half-imported template.
 */
export async function POST(req: Request) {
  return guard(async () => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, 'BAD_REQUEST', 'Send the spreadsheet as a form upload.');
    }
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'NO_FILE', 'Choose the spreadsheet you exported from Spectora.');
    if (file.size > MAX_BYTES) {
      return fail(413, 'FILE_TOO_LARGE', `The file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 4 MB.`, 'Export a smaller template, or split it into two.');
    }
    const nameField = form.get('name');
    const name = typeof nameField === 'string' && nameField.trim() ? nameField.trim().slice(0, 200) : undefined;

    const parsed = await parseSpectoraExport(new Uint8Array(await file.arrayBuffer()), file.name);
    const templateId = await importTemplate(getDb(), toDbPayload(parsed, { name }));
    return Response.json({ templateId, report: parsed.report }, { status: 201 });
  });
}
