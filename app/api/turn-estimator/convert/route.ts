import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { convertEstimateVersionToInvoice } from '@/lib/turn-estimator/convert';

/** POST /api/turn-estimator/convert — convert an approved version to a draft invoice. finance/admin. */
export async function POST(request: NextRequest) {
  const guard = await requireRole('finance', 'admin');
  if (!guard.ok) return guard.response;
  let body: { version_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.version_id) {
    return NextResponse.json({ error: 'version_id required' }, { status: 400 });
  }
  try {
    const res = await convertEstimateVersionToInvoice(body.version_id, guard.email);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
