import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import {
  commitKeysReconcile,
  getReconcileMeta,
  parseKeysDetailCsv,
  previewKeysReconcile,
} from '@/lib/keys-reconcile';

export const maxDuration = 120;

/** GET /api/keys/reconcile — when the AppFolio snapshot was last imported. */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await getReconcileMeta());
}

/**
 * POST /api/keys/reconcile — reconcile the AppFolio "Keys Detail" CSV export.
 *
 * Multipart form: file (csv), mode ('validate' | 'commit'). Validate returns a
 * per-row preview; commit replaces the key_af_checkout snapshot wholesale.
 * The export must include the "Unit ID" column (Customize → Columns) — rows
 * without it can't be joined to a key and are skipped.
 */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    const mode = String(form.get('mode') ?? 'validate');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 422 });
    }

    const rows = parseKeysDetailCsv(await file.text());
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No checkout rows found in the CSV' }, { status: 422 });
    }

    if (mode === 'validate') {
      return NextResponse.json(await previewKeysReconcile(rows));
    }

    const result = await commitKeysReconcile(rows, session.actor);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/keys/reconcile] error:', error);
    const message = error instanceof Error ? error.message : 'Reconcile failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
