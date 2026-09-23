import { requireEstimateAuthor } from '@/lib/require-estimate-author';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

/** GET /api/turn-estimator/estimates/[id] — estimate header + current version + lines. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireEstimateAuthor(true);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const supabase = getSupabaseAdmin();

  const { data: estimate, error } = await supabase.from('estimate').select('*').eq('id', id).single();
  if (error || !estimate) return NextResponse.json({ error: 'estimate not found' }, { status: 404 });

  let version = null;
  let lines: unknown[] = [];
  if (estimate.current_version_id) {
    const { data: v } = await supabase
      .from('estimate_version')
      .select('*')
      .eq('id', estimate.current_version_id)
      .maybeSingle();
    version = v;
    const { data: l } = await supabase
      .from('estimate_line')
      .select('*')
      .eq('estimate_version_id', estimate.current_version_id)
      .order('line_no');
    lines = l ?? [];
  }

  const [scope, versions] = await Promise.all([
    supabase.from('maintenance_task').select('job_id').eq('source_estimate_id', id).limit(1),
    supabase.from('estimate_version').select('id').eq('estimate_id', id),
  ]);
  if (scope.error || versions.error) return NextResponse.json({error: 'Could not load billing links'}, {status: 500});
  const versionIds = (versions.data || []).map(v => v.id);
  const billed = versionIds.length ? await supabase.from('hdms_invoices').select('id,invoice_code,status').in('source_estimate_version_id', versionIds).neq('status', 'void').limit(1) : {data: [], error: null};
  if (billed.error) return NextResponse.json({error: billed.error.message}, {status: 500});
  return NextResponse.json({ estimate, version, lines, job_id: scope.data?.[0]?.job_id || null, invoice: billed.data?.[0] || null,
    canApprove: ['admin','pm','manager'].includes(guard.role),
    canSchedule: ['admin','pm','manager','maintenance'].includes(guard.role),
    canConvert: ['admin','finance'].includes(guard.role),
  });
}
