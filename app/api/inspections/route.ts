import { actionableInspections, inspectionWorkflow, inspectionToday, loadInspectionQueue } from '@/lib/inspection-queue';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/inspections
 *
 * Fetches the inspection queue with property details. Supports filtering
 * by status, city, inspection_type, assigned_to, due date range, and
 * free-text search. Ordered by due_date ascending (overdue first).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const city = searchParams.get('city');
    const inspectionType = searchParams.get('inspection_type');
    const assignedTo = searchParams.get('assigned_to');
    const dueFrom = searchParams.get('due_from');
    const dueTo = searchParams.get('due_to');
    const search = searchParams.get('search');

    const { rows, properties } = await loadInspectionQueue(supabase);
    let inspections = searchParams.get('view') === 'all'
      ? rows.map(row => inspectionWorkflow(row, inspectionToday()))
      : actionableInspections(rows, properties, inspectionToday(), searchParams.get('view') === 'outlook' ? 366 : 45);
    if (status) inspections = inspections.filter(row => row.status === status);
    if (inspectionType) inspections = inspections.filter(row => row.inspection_type === inspectionType);
    if (assignedTo) inspections = inspections.filter(row => row.assigned_to === assignedTo);
    if (dueFrom) inspections = inspections.filter(row => row.due_date && row.due_date >= dueFrom);
    if (dueTo) inspections = inspections.filter(row => row.due_date && row.due_date <= dueTo);
    if (city) inspections = inspections.filter(row => row.inspection_properties?.city === city);
    if (search) {
      const needle = search.toLowerCase();
      inspections = inspections.filter(row => [row.resident_name, ...Object.values(row.inspection_properties || {})]
        .some(value => typeof value === 'string' && value.toLowerCase().includes(needle)));
    }
    inspections.sort((a, b) => (a.target_date || a.due_date || '9999').localeCompare(b.target_date || b.due_date || '9999') || a.id.localeCompare(b.id));
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.max(1, Math.min(Number.parseInt(searchParams.get('page_size') || '100', 10) || 100, 2000));
    return NextResponse.json({ inspections: inspections.slice((page - 1) * pageSize, page * pageSize), total: inspections.length });

  } catch (error) {
    console.error('Inspections GET error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch inspections';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/inspections
 *
 * Bulk update inspection records. Accepts an array of IDs and a partial
 * update object with status, assigned_to, and/or priority.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { ids, updates } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: 'ids must be a non-empty array of inspection IDs' },
        { status: 400 }
      );
    }

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json(
        { error: 'updates must be an object with fields to update' },
        { status: 400 }
      );
    }

    // Whitelist allowed update fields
    const allowedFields = ['status', 'assigned_to', 'priority'];
    const sanitized: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in updates) {
        sanitized[field] = updates[field];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json(
        { error: 'No valid update fields provided. Allowed: status, assigned_to, priority' },
        { status: 400 }
      );
    }

    sanitized.updated_at = new Date().toISOString();

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('inspections')
      .update(sanitized)
      .in('id', ids)
      .select('id');

    if (error) {
      console.error('Error updating inspections:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      updated: data?.length ?? 0,
      ids: data?.map((r: { id: string }) => r.id) ?? [],
    });
  } catch (error) {
    console.error('Inspections PATCH error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update inspections';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
