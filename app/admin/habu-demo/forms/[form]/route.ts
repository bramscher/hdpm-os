import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { auth } from '@/lib/auth';
import { canViewHabuDemo } from '@/lib/habu-demo-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const files: Record<string, string> = {
  'tenant-setup': 'tenant-setup.pdf',
  'vacancy-tracking': 'vacancy-tracking.pdf',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ form: string }> },
) {
  const session = await auth();
  if (!canViewHabuDemo(session?.user)) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const { form } = await context.params;
  const filename = Object.hasOwn(files, form) ? files[form] : undefined;
  if (!filename) return new Response('Not found', { status: 404 });
  const data = await readFile(path.join(process.cwd(), 'app/admin/habu-demo/reference-forms', filename));
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
