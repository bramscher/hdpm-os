import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';

/** GET /api/turn-estimator/estimates/[id] — estimate header + current version + lines. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireCompanySession();
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

  return NextResponse.json({ estimate, version, lines });
}
