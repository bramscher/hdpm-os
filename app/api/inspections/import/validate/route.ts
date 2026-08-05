import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { validateInspectionRows } from '@/lib/inspection-import';

/**
 * POST /api/inspections/import/validate
 *
 * Validates rows against a column mapping and returns categorized results
 * (valid, warnings, errors, duplicates).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { batch_id, column_mapping, rows } = body;

    if (!batch_id || !column_mapping || !rows) {
      return NextResponse.json(
        { error: 'Missing required fields: batch_id, column_mapping, rows' },
        { status: 400 }
      );
    }

    if (!column_mapping.address_1 || !column_mapping.city) {
      return NextResponse.json(
        { error: 'Column mapping must include at least address_1 and city' },
        { status: 400 }
      );
    }

    const result = validateInspectionRows(rows, column_mapping);

    return NextResponse.json({
      batch_id,
      valid: result.valid,
      warnings: result.warnings,
      errors: result.errors,
      duplicates: result.duplicates,
      summary: {
        total: rows.length,
        valid: result.valid.length,
        warnings: result.warnings.length,
        errors: result.errors.length,
        duplicates: result.duplicates.length,
      },
    });
  } catch (error) {
    console.error('Inspection validation error:', error);
    const message = error instanceof Error ? error.message : 'Validation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
