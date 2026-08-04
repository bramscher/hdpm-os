import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

const VALID_STATUSES = ['active', 'offboarding', 'lost'] as const;

/**
 * POST /api/properties/status
 *
 * Set the management status for a property (green/yellow/red on the map).
 * Body: { appfolio_property_id: string, status: 'active'|'offboarding'|'lost', note?: string }
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { appfolio_property_id?: string; status?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { appfolio_property_id, status, note } = body;
  if (!appfolio_property_id) {
    return NextResponse.json({ error: 'appfolio_property_id is required' }, { status: 400 });
  }
  if (!status || !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('property_mgmt_status').upsert(
    {
      appfolio_property_id,
      status,
      note: note?.trim() || null,
      updated_by: session.user.email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'appfolio_property_id' }
  );

  if (error) {
    // 42P01 = relation does not exist — migration not applied yet
    const migrationPending = error.code === '42P01';
    console.error('[properties/status] upsert failed:', error);
    return NextResponse.json(
      {
        error: migrationPending
          ? 'Status table missing — apply migration 20260727_property_mgmt_status first'
          : error.message,
      },
      { status: migrationPending ? 503 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
