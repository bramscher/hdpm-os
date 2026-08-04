import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseInspectionFile } from '@/lib/inspection-import';

/**
 * POST /api/inspections/import
 *
 * Accepts a FormData file upload (CSV or XLSX), parses it, creates an
 * import_batches record, and returns the parsed headers/rows for column
 * mapping on the client.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const allowedTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    const ext = file.name.toLowerCase().split('.').pop();
    if (!allowedTypes.includes(file.type) && !['csv', 'xlsx', 'xls'].includes(ext || '')) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload a CSV or XLSX file.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const parsed = parseInspectionFile(buffer, file.name);

    if (parsed.totalRows === 0) {
      return NextResponse.json(
        { error: 'File contains no data rows.' },
        { status: 400 }
      );
    }

    // Create import_batches record
    const supabase = getSupabaseAdmin();
    const { data: batch, error: batchErr } = await supabase
      .from('import_batches')
      .insert({
        filename: file.name,
        uploaded_by: session.user.email,
        status: 'pending',
        total_rows: parsed.totalRows,
        column_mapping: { raw_headers: parsed.headers },
      })
      .select('id')
      .single();

    if (batchErr) {
      console.error('Error creating import batch:', batchErr);
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }

    // Build columns array with index + header for the mapping UI
    const columns = parsed.headers.map((h, i) => ({ index: i, header: h }));

    // Build preview rows (first 5) with row_number + data
    const preview = parsed.rows.slice(0, 5).map((row, i) => ({
      row_number: i + 1,
      data: row,
    }));

    return NextResponse.json({
      import_id: batch.id,
      columns,
      preview,
      row_count: parsed.totalRows,
      // Also send raw data for validation step
      headers: parsed.headers,
      rows: parsed.rows,
    });
  } catch (error) {
    console.error('Inspection import error:', error);
    const message = error instanceof Error ? error.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
