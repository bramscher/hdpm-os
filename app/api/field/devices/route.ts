import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };

// Admin: the phones signed in to HDPM Field, and revoking one (lost phone, departed tech).
// A revoked phone's next request gets 401 and the app signs out.
export async function GET() {
  const guard = await requireRole();
  if (!guard.ok) return guard.response;
  const { data, error } = await getSupabaseAdmin().from('field_device')
    .select('id,person,email,label,created_at,last_seen_at,revoked_at,revoked_by').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ devices: data }, { headers: noStore });
}

export async function POST(request: Request) {
  const guard = await requireRole();
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => null);
  if (body?.op !== 'revoke' || typeof body.id !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().from('field_device')
    .update({ revoked_at: new Date().toISOString(), revoked_by: guard.email })
    .eq('id', body.id).is('revoked_at', null).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  return NextResponse.json({ revoked: data.id }, { headers: noStore });
}
