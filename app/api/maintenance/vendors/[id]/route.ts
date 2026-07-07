import { NextRequest, NextResponse } from 'next/server';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import { updateVendor } from '@/lib/maintenance/vendors';
import type { Vendor } from '@/lib/maintenance/types';

/**
 * Profile fields Cheryl can edit (sync owns appfolio_vendor_id; name is sync-refreshed too).
 * Insurance / license / W-9 are intentionally NOT here: AppFolio is the system of
 * record for those and we don't store a divergent copy — the scoreboard links out
 * to the AppFolio vendor record to view/edit them instead.
 */
const PATCHABLE = [
  'name',
  'trades',
  'service_area',
  'hourly_rate',
  'minimum_charge',
  'emergency_available',
  'preferred',
  'demoted',
  'property_restrictions',
  'active',
  'notes',
] as const;

/** PATCH /api/maintenance/vendors/:id — edit profile / demote flag. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const patch: Partial<Vendor> = {};
    for (const field of PATCHABLE) {
      if (field in body) {
        (patch as Record<string, unknown>)[field] = body[field];
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No patchable fields in request' }, { status: 400 });
    }

    const vendor = await updateVendor(id, patch);
    return NextResponse.json({ vendor });
  } catch (error) {
    console.error('[Maintenance] Vendor update error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update vendor';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
