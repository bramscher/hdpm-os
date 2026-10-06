import { describe, expect, it, vi } from 'vitest';

// A PM with the Partners section switched on: role guard says no, section guard says yes.
vi.mock('@/lib/require-role', () => ({
  requireRole: async () => ({ ok: false, response: Response.json({ error: 'Insufficient permissions' }, { status: 403 }) }),
  requireSection: async () => ({ ok: true, email: 'lisa@highdesertpm.com', role: 'pm', name: 'Lisa' }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => { throw new Error('must not reach the database'); } }));

import { requireReferralAdmin, requireReferralTaxAdmin } from '@/lib/referrals/admin';
import { GET as w9 } from '@/app/api/partners/admin/referrers/[id]/w9/route';
import { GET as form1099 } from '@/app/api/partners/admin/payouts/1099/route';
import { NextRequest } from 'next/server';

describe('Partners for a delegated (non-admin) user', () => {
  it('opens the pipeline but not tax documents', async () => {
    expect((await requireReferralAdmin()).ok).toBe(true);
    expect((await requireReferralTaxAdmin()).ok).toBe(false);
    const w9Res = await w9(new NextRequest('https://os.example.com/api/partners/admin/referrers/r1/w9'), { params: Promise.resolve({ id: 'r1' }) });
    expect(w9Res.status).toBe(403);
    const taxRes = await form1099(new NextRequest('https://os.example.com/api/partners/admin/payouts/1099?year=2026'));
    expect(taxRes.status).toBe(403);
  });
});
