import { NextRequest, NextResponse } from 'next/server';
import { requireReferrer, getReferrerPartner } from '@/lib/referrals/referrer-context';
import { finalizeNewLead } from '@/lib/referrals/leads';

/**
 * Referrer lead endpoints (Batch 3). The referrer path: the lead is INSERTED
 * through the JWT-bound RLS client (so the DB itself enforces partner_id = self,
 * source = referral — the guardrail keeps getSupabaseAdmin out of here). Dedupe
 * + the append-only 'created' event are then written by finalizeNewLead (a lib
 * service-role step) — cross-tenant work a referrer can't and shouldn't do.
 */

/** GET /api/partners/leads — the referrer's own leads (RLS-scoped). */
export async function GET() {
  const ctx = await requireReferrer();
  const { data, error } = await ctx.supabase
    .from('referral_lead')
    .select('id, prospect_name, stage, source, dup_status, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}

/** POST /api/partners/leads — submit a lead as this referrer. */
export async function POST(request: NextRequest) {
  const ctx = await requireReferrer();
  const partner = await getReferrerPartner(ctx);
  if (!partner) return NextResponse.json({ error: 'No linked referrer record' }, { status: 403 });
  if (partner.status !== 'active') {
    return NextResponse.json({ error: 'Your account is not active — contact HDPM.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const prospect_name = typeof body.prospect_name === 'string' ? body.prospect_name.trim() : '';
  if (!prospect_name) return NextResponse.json({ error: 'prospect_name is required' }, { status: 400 });

  const addresses = Array.isArray(body.property_addresses)
    ? body.property_addresses.filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    : null;

  // RLS insert AS the referrer — the WITH CHECK pins partner_id + source.
  const { data, error } = await ctx.supabase
    .from('referral_lead')
    .insert({
      partner_id: partner.id,
      source: 'referral',
      stage: 'submitted',
      prospect_name,
      prospect_email: typeof body.prospect_email === 'string' ? body.prospect_email : null,
      prospect_phone: typeof body.prospect_phone === 'string' ? body.prospect_phone : null,
      property_addresses: addresses,
      unit_count: typeof body.unit_count === 'number' ? body.unit_count : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      ref_code: partner.referral_code,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Service-role follow-up: 'created' event + cross-tenant dedupe.
  try {
    await finalizeNewLead(data.id, `referrer:${ctx.email ?? partner.id}`);
  } catch (err) {
    console.error('[referrals] finalizeNewLead failed (lead still created):', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true, leadId: data.id }, { status: 201 });
}
