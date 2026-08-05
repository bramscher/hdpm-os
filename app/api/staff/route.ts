import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/staff
 *
 * Active staff members for assignee pickers (inspection routes, etc.).
 * Only rows with an email are returned — assignment is keyed on email.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('staff')
      .select('person, name, email, role')
      .eq('active', true)
      .not('email', 'is', null)
      .order('person');

    if (error) {
      console.error('[staff] load failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ staff: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load staff';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
