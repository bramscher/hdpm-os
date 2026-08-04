/**
 * Bulk operations on inspections
 *
 * POST /api/inspections/bulk
 *
 * Supports two modes:
 * 1. By IDs: { ids: [...], action: "status"|"assign", value: "..." }
 * 2. By filter: { filter: { status: "...", before_date: "..." }, action: "status", value: "..." }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { completeInspectionCascade } from '@/lib/inspection-complete';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { ids, filter, action, value } = body;

    if (!action || !value) {
      return NextResponse.json({ error: 'action and value are required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Determine which field to update
    const updates: Record<string, string> = {};
    if (action === 'status') {
      updates.status = value;
      if (value === 'completed') {
        // Match the route-stop completion path — record who/when.
        updates.completed_at = new Date().toISOString();
        updates.completed_by = session.user.email;
      }
    } else if (action === 'assign') {
      updates.assigned_to = value;
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    let updatedCount = 0;
    let updatedIds: string[] = [];

    if (ids && Array.isArray(ids) && ids.length > 0) {
      // Mode 1: Update by specific IDs
      const { data, error } = await supabase
        .from('inspections')
        .update(updates)
        .in('id', ids)
        .select('id');

      if (error) {
        console.error('Bulk update by IDs error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      updatedCount = data?.length || 0;
      updatedIds = data?.map((r: { id: string }) => r.id) || [];
    } else if (filter && typeof filter === 'object') {
      // Mode 2: Update by filter criteria
      let query = supabase.from('inspections').update(updates);

      if (filter.status) {
        query = query.eq('status', filter.status);
      }

      if (filter.before_date) {
        query = query.lte('due_date', filter.before_date);
      }

      if (filter.after_date) {
        query = query.gte('due_date', filter.after_date);
      }

      if (filter.city) {
        // Need to filter through the join — do a two-step approach
        // First get property IDs for the city, then filter inspections
        const { data: props } = await supabase
          .from('inspection_properties')
          .select('id')
          .eq('city', filter.city);

        if (props && props.length > 0) {
          query = query.in('property_id', props.map(p => p.id));
        } else {
          return NextResponse.json({ updated: 0, message: 'No properties found in that city' });
        }
      }

      const { data, error } = await query.select('id');

      if (error) {
        console.error('Bulk update by filter error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      updatedCount = data?.length || 0;
      updatedIds = data?.map((r: { id: string }) => r.id) || [];
    } else {
      return NextResponse.json({ error: 'Either ids or filter is required' }, { status: 400 });
    }

    // Completion cascade over EXACTLY the rows this request updated (the old
    // filter path re-queried all completed inspections and could cascade for
    // unrelated history): property cadence write-back + next inspection +6mo.
    let nextCreated = 0;
    if (action === 'status' && value === 'completed' && updatedIds.length > 0) {
      const cascade = await completeInspectionCascade(
        supabase,
        updatedIds,
        new Date().toISOString().slice(0, 10)
      );
      nextCreated = cascade.next_created;
    }

    return NextResponse.json({
      updated: updatedCount,
      next_inspections_created: nextCreated,
      message: `${updatedCount} inspections updated${nextCreated > 0 ? `, ${nextCreated} next inspections created` : ''}`,
    });
  } catch (error) {
    console.error('Bulk inspections error:', error);
    const message = error instanceof Error ? error.message : 'Bulk operation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
