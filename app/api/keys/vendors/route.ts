import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';

/**
 * GET /api/keys/vendors — the curated vendor list for key loaners: every
 * distinct name a vendor copy has ever been checked out to. Self-curating:
 * type a vendor once and it becomes a one-tap chip everywhere.
 */
export async function GET() {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('key_copy')
      .select('holder_name')
      .eq('holder_type', 'vendor')
      .not('holder_name', 'is', null);
    if (error) throw new Error(error.message);

    const names = [...new Set(
      (data || [])
        .map((r) => (r.holder_name as string).trim())
        .filter((n) => n.length > 0)
    )].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ vendors: names });
  } catch (error) {
    console.error('[api/keys/vendors] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load vendors';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
