import { requireEstimateAuthor } from '@/lib/require-estimate-author';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { estimateStage, type EstimateQueueItem } from '@/lib/turn-estimator/estimate-queue';

export async function GET() {
  const guard = await requireEstimateAuthor(true);
  if (!guard.ok) return guard.response;
  try {
    const db = getSupabaseAdmin();
    async function all(table: string, columns: string, order = 'id') {
      const rows: Record<string, any>[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.from(table).select(columns).order(order).range(offset, offset + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) return rows;
      }
    }
    const [headers, drafts, versions, tasks, allocations, invoices] = await Promise.all([
      all('estimate', 'id,status,property_name,unit_name,wo_number,work_order_id,current_version_id,source_saved_draft_id,created_at,updated_at'),
      all('estimate_saved_draft', 'id,payload,updated_at'),
      all('estimate_version', 'id,estimate_id,owner_total,created_at'),
      all('maintenance_task', 'id,source_estimate_id'),
      all('maintenance_billing_allocation', 'task_id', 'task_id'),
      all('hdms_invoices', 'id,source_estimate_version_id,status'),
    ]);
    const issuedDrafts = new Set(headers.filter(h => h.current_version_id).map(h => h.source_saved_draft_id));
    const savedIds = new Set(drafts.map(d => d.id));
    const billedVersions = new Set(invoices.filter(i => i.status !== 'void').map(i => i.source_estimate_version_id));
    const billedEstimates = new Set(versions.filter(v => billedVersions.has(v.id)).map(v => v.estimate_id));
    const reserved = new Set(allocations.map(a => a.task_id));
    const rows: EstimateQueueItem[] = drafts.filter(d => !issuedDrafts.has(d.id)).map(d => ({
      id: d.id, draftKind: 'saved', property: d.payload.propertyName || 'Untitled estimate', unit: d.payload.unitName || '',
      workOrder: d.payload.seed?.wo_number || '', workOrderId: d.payload.seed?.work_order_id || null,
      stage: 'draft', status: 'draft', total: null, updatedAt: d.updated_at,
      href: `/turn-estimator/estimates/new?resume=${d.id}`, taskCount: 0, undraftedTasks: 0,
    }));
    for (const h of headers) {
      if (!h.current_version_id && savedIds.has(h.source_saved_draft_id)) continue;
      const version = versions.find(v => v.id === h.current_version_id);
      const scope = tasks.filter(t => t.source_estimate_id === h.id);
      const allocated = scope.filter(t => reserved.has(t.id)).length;
      rows.push({
        id: h.id, draftKind: 'header', property: h.property_name || 'Untitled estimate', unit: h.unit_name || '', workOrder: h.wo_number || '',
        workOrderId: h.work_order_id, stage: estimateStage(h.status, !!version, billedEstimates.has(h.id), scope.length, allocated),
        status: h.status, total: version ? Number(version.owner_total) : null,
        updatedAt: h.updated_at || version?.created_at || h.created_at,
        href: `/turn-estimator/estimates/${h.id}`, taskCount: scope.length, undraftedTasks: scope.length - allocated,
      });
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return NextResponse.json({ estimates: rows, canCreate: guard.role !== 'finance', canDelete: ['admin','maintenance','pm','manager'].includes(guard.role) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Could not load estimates' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireRole('maintenance', 'pm', 'manager');
  if (!guard.ok) return guard.response;
  const id = request.nextUrl.searchParams.get('id');
  const kind = request.nextUrl.searchParams.get('kind');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !['saved', 'header'].includes(kind || '')) {
    return NextResponse.json({ error: 'Invalid draft estimate' }, { status: 400 });
  }
  try {
    const { error } = await getSupabaseAdmin().rpc('maintenance_delete_estimate_draft', {
      actor: guard.email, request: { id, kind },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: 'Could not delete draft estimate' }, { status: 500 });
  }
}
