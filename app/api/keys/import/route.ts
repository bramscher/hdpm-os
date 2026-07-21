import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import {
  fetchAppFolioPropertiesWithCustomFields,
  fetchAppFolioUnits,
} from '@/lib/appfolio';
import {
  buildUnitMatchTargets,
  commitKeysImport,
  parseKeysWorkbook,
  validateKeyRows,
} from '@/lib/keys-import';

export const maxDuration = 300;

/**
 * POST /api/keys/import — one-time seed of the master key spreadsheet.
 *
 * Multipart form: file (xlsx), mode ('validate' | 'commit'), force ('1' to
 * override the already-seeded guard). Validate returns a full per-row
 * preview; commit re-validates server-side and writes slots, assignments,
 * default copy templates, and 'imported' events.
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
    const force = String(form.get('force') ?? '') === '1';

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 422 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseKeysWorkbook(buffer);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No rows found in the first sheet' }, { status: 422 });
    }

    const [units, properties] = await Promise.all([
      fetchAppFolioUnits(),
      fetchAppFolioPropertiesWithCustomFields(),
    ]);
    const targets = buildUnitMatchTargets(units, properties);
    const preview = validateKeyRows(rows, targets);

    if (mode === 'validate') {
      return NextResponse.json(preview);
    }

    const result = await commitKeysImport(preview, targets, session.actor, file.name, force);
    return NextResponse.json({ ...result, preview_totals: {
      total_rows: preview.total_rows,
      open: preview.open,
      matched: preview.matched,
      unmatched: preview.unmatched,
      errors: preview.errors,
    } });
  } catch (error) {
    console.error('[api/keys/import] error:', error);
    const message = error instanceof Error ? error.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
