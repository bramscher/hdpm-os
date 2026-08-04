import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  validateInspectionRows,
  commitInspectionImport,
} from '@/lib/inspection-import';

/**
 * POST /api/inspections/import/commit
 *
 * Commits selected validated rows to the database, creating inspection_properties
 * and inspections records.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { batch_id, selected_rows, column_mapping, rows } = body;

    if (!batch_id || !selected_rows || !column_mapping || !rows) {
      return NextResponse.json(
        { error: 'Missing required fields: batch_id, selected_rows, column_mapping, rows' },
        { status: 400 }
      );
    }

    if (!Array.isArray(selected_rows) || selected_rows.length === 0) {
      return NextResponse.json(
        { error: 'selected_rows must be a non-empty array of row numbers' },
        { status: 400 }
      );
    }

    // Re-validate to ensure data integrity before commit
    const validation = validateInspectionRows(rows, column_mapping);

    // Collect all validated rows (valid + warnings are committable)
    const committable = [...validation.valid, ...validation.warnings];

    // Filter to only the selected rows
    const selectedSet = new Set(selected_rows as number[]);
    const toCommit = committable.filter((r) => selectedSet.has(r.rowNumber));

    if (toCommit.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found in the selection. Rows with errors cannot be committed.' },
        { status: 400 }
      );
    }

    const result = await commitInspectionImport(
      batch_id,
      toCommit,
      session.user.email!
    );

    return NextResponse.json({
      batch_id,
      ...result,
      selected: toCommit.length,
    });
  } catch (error) {
    console.error('Inspection commit error:', error);
    const message = error instanceof Error ? error.message : 'Commit failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
