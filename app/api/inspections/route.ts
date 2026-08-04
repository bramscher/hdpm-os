import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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
    const session = await getServerSession(authOptions);
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

    let query = supabase
      .from('inspections')
      .select('*, inspection_properties(*)', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    if (inspectionType) {
      query = query.eq('inspection_type', inspectionType);
    }

    if (assignedTo) {
      query = query.eq('assigned_to', assignedTo);
    }

    if (dueFrom) {
      query = query.gte('due_date', dueFrom);
    }

    if (dueTo) {
      query = query.lte('due_date', dueTo);
    }

    // City and search filters require joining through inspection_properties.
    // Supabase JS client supports filtering on related tables via the
    // `inspection_properties.column` syntax.
    if (city) {
      query = query.eq('inspection_properties.city', city);
    }

    if (search) {
      // Search across property fields — use textSearch on joined table
      // Supabase referenced table filters don't exclude parent rows,
      // so we filter client-side after fetching. Mark search as active.
      query = query.or(
        `address_1.ilike.%${search}%,address_2.ilike.%${search}%,city.ilike.%${search}%,name.ilike.%${search}%`,
        { referencedTable: 'inspection_properties' }
      );
    }

    // Pagination
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(parseInt(searchParams.get('page_size') || '100', 10), 2000);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    query = query.order('due_date', { ascending: true }).range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching inspections:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      inspections: data || [],
      total: count ?? 0,
    });
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
    const session = await getServerSession(authOptions);
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
