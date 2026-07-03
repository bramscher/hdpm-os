import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { createVendor, listVendors } from '@/lib/maintenance/vendors';

/** GET /api/maintenance/vendors — full roster (?active=1 to filter). */
export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const activeOnly = new URL(request.url).searchParams.get('active') === '1';
  const vendors = await listVendors(activeOnly);
  return NextResponse.json({ vendors });
}

/** POST /api/maintenance/vendors — create a manual (non-AppFolio) vendor. */
export async function POST(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const vendor = await createVendor(body);
    return NextResponse.json({ vendor });
  } catch (error) {
    console.error('[Maintenance] Vendor create error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create vendor';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
