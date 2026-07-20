import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { auditVendorContactFields } from '@/lib/appfolio';

export const maxDuration = 300;

/**
 * POST /api/agents/vendor-contact-audit — Brief D.5 Workstream A diagnostic.
 *
 * Body: {vendorIds: string[]} (AppFolio vendor ids, e.g. work_orders.vendor_id
 * values from the chaser's missingVendorEmail output). Fetches those raw
 * /vendors records live and reports each record's field names plus any
 * email-looking values (redacted) — so we can see where AppFolio actually
 * puts vendor emails and fix extractEmail() to match.
 *
 * Run from the browser console on hdpmchat (uses your staff session):
 *   fetch('/api/agents/vendor-contact-audit', {method:'POST',
 *     headers:{'Content-Type':'application/json'},
 *     body: JSON.stringify({vendorIds:['...','...']})
 *   }).then(r=>r.json()).then(console.log)
 */
export async function POST(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const vendorIds = Array.isArray(body.vendorIds)
      ? (body.vendorIds as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    if (vendorIds.length === 0 || vendorIds.length > 25) {
      return NextResponse.json(
        { error: 'Body must be {vendorIds: string[]} with 1-25 ids' },
        { status: 400 }
      );
    }
    const audit = await auditVendorContactFields(vendorIds);
    return NextResponse.json({
      requested: vendorIds.length,
      found: audit.length,
      records: audit,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] vendor contact audit failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
