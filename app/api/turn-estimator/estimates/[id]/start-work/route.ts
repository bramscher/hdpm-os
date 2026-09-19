import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireRole('maintenance', 'pm', 'manager');
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const db = getSupabaseAdmin();
    const { data: estimate, error } = await db.from('estimate').select('status,work_order_id').eq('id', id).single();
    if (error) throw error;
    if (estimate.status !== 'approved' || !estimate.work_order_id) throw new Error('An approved estimate linked to a work order is required');
    const job = await db.rpc('maintenance_workspace_apply', { actor: guard.email, request: { op: 'job', work_order_id: estimate.work_order_id } });
    if (job.error) throw job.error;
    async function alreadyImported() {
      const scope = await db.from('maintenance_task').select('source_estimate_id').eq('job_id', job.data.id);
      if (scope.error) throw scope.error;
      return scope.data.length > 0 && scope.data.every(t => t.source_estimate_id === id);
    }
    if (!await alreadyImported()) {
      const imported = await db.rpc('maintenance_workspace_apply', { actor: guard.email, request: { op: 'import_estimate', job_id: job.data.id, estimate_id: id } });
      // A simultaneous click may have imported the same scope while this request waited.
      if (imported.error && !await alreadyImported()) throw imported.error;
    }
    return NextResponse.json({ job_id: job.data.id });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Could not prepare work' }, { status: 400 });
  }
}
