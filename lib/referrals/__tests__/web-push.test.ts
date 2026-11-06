import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- fakes: Supabase query builder + website fetch ----
type Row = Record<string, unknown>;
const db: { referral_lead: Row[]; referral_partner: Row[]; referral_lead_event: Row[] } = { referral_lead: [], referral_partner: [], referral_lead_event: [] };
const webCalls: { path: string; actor: string; init: RequestInit }[] = [];
let webReply: () => Response = () => Response.json({});

function query(table: keyof typeof db) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null;
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    not: () => q,
    order: () => q,
    limit: () => q,
    update: (p: Row) => ((patch = p), q),
    insert: async (r: Row) => (db[table].push(r), { error: null }),
    maybeSingle: async () => ({ data: db[table].find((r) => filters.every((f) => f(r))) ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      const rows = db[table].filter((r) => filters.every((f) => f(r)));
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      resolve({ data: rows, error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: (t: keyof typeof db) => query(t) }) }));
vi.mock('@/lib/hdpm-web-admin', () => ({
  webAdminFetch: async (path: string, actor: string, init: RequestInit) => (webCalls.push({ path, actor, init }), webReply()),
}));

import { PORTAL_ACTOR, pushReferralToWebsite, pushSkipReason, pushUnlinkedReferrals, toWebReferral, toWebUtm, webReferralPath, type ReferralRow } from '../web-push';

function referral(over: Partial<ReferralRow> = {}): ReferralRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    partner_id: 'p1',
    prospect_name: ' Test Prospect ',
    prospect_email: 'prospect@example.com',
    prospect_phone: null,
    property_addresses: ['100 Example St', '200 Sample Ave'],
    unit_count: 4,
    notes: 'Two duplexes',
    ref_code: 'ABC123',
    landing_page: null,
    utm: null,
    hdpm_web_lead_id: null,
    dup_status: null,
    created_at: '2026-11-06T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  db.referral_lead = [{ ...referral(), org_id: 'hdpm' }];
  db.referral_partner = [{ id: 'p1', display_name: 'Sample Agent', company: 'Sample Realty', org_id: 'hdpm' }];
  db.referral_lead_event = [];
  webCalls.length = 0;
});

describe('pure helpers', () => {
  it('skips linked referrals and ones with no email', () => {
    expect(pushSkipReason({ hdpm_web_lead_id: '5', prospect_email: 'a@b.co' })).toBe('already_linked');
    expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: null })).toBe('needs_email');
    expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: '  ' })).toBe('needs_email');
    expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: 'a@b.co' })).toBeNull();
  });
  it('builds the website body: first address, extra addresses in notes, partner, units', () => {
    const body = toWebReferral(referral(), { id: 'p1', display_name: 'Sample Agent', company: 'Sample Realty' });
    expect(body).toMatchObject({
      prospectName: 'Test Prospect',
      prospectEmail: 'prospect@example.com',
      propertyAddress: '100 Example St',
      unitCount: 4,
      town: null,
      partner: { id: 'p1', name: 'Sample Agent', company: 'Sample Realty' },
      refCode: 'ABC123',
    });
    expect(body.notes).toBe('Two duplexes\n\nOther properties: 200 Sample Ave');
    expect(toWebReferral(referral({ unit_count: -1 }), null)).toMatchObject({ unitCount: null, partner: null });
    expect(webReferralPath('abc')).toBe('/leads/referrals/abc');
  });
  it('maps stored utm keys to the website shape', () => {
    expect(toWebUtm({ utm_source: 'google', utm_campaign: ' fall ' })).toEqual({ source: 'google', medium: null, campaign: 'fall', term: null, content: null });
    expect(toWebUtm({ source: 'fb' })?.source).toBe('fb');
    expect(toWebUtm({ other: 'x' })).toBeNull();
    expect(toWebUtm(null)).toBeNull();
  });
});

describe('pushReferralToWebsite', () => {
  it('PUTs the referral, stores the website lead id and logs the event', async () => {
    webReply = () => Response.json({ outcome: 'created', leadId: 77, created: true, lead: { id: 77 } });
    const r = await pushReferralToWebsite(referral().id, PORTAL_ACTOR);
    expect(r).toEqual({ ok: true, websiteLeadId: '77', outcome: 'created' });
    expect(webCalls[0]).toMatchObject({ path: `/leads/referrals/${referral().id}`, actor: PORTAL_ACTOR, init: { method: 'PUT' } });
    expect(db.referral_lead[0].hdpm_web_lead_id).toBe('77');
    expect(db.referral_lead[0].dup_status).toBeNull();
    expect(db.referral_lead_event[0]).toMatchObject({ event_type: 'web_pushed', payload: { website_lead_id: '77', outcome: 'created' } });
  });
  it('flags a linked referral as a suspected duplicate', async () => {
    webReply = () => Response.json({ outcome: 'linked', leadId: 12, created: false });
    await pushReferralToWebsite(referral().id, PORTAL_ACTOR);
    expect(db.referral_lead[0]).toMatchObject({ hdpm_web_lead_id: '12', dup_status: 'suspected' });
  });
  it('does not call the website for a referral with no email', async () => {
    db.referral_lead[0].prospect_email = null;
    expect(await pushReferralToWebsite(referral().id, PORTAL_ACTOR)).toEqual({ ok: false, skipped: 'needs_email' });
    expect(webCalls).toHaveLength(0);
  });
  it('treats the website 422 email_required as needs email, not a failure', async () => {
    webReply = () => Response.json({ error: 'Email required', code: 'email_required' }, { status: 422 });
    expect(await pushReferralToWebsite(referral().id, PORTAL_ACTOR)).toEqual({ ok: false, skipped: 'needs_email' });
    expect(db.referral_lead_event).toHaveLength(0);
  });
  it('never throws on a website error; records web_push_failed and leaves the link empty', async () => {
    webReply = () => Response.json({ error: 'Down for maintenance' }, { status: 503 });
    expect(await pushReferralToWebsite(referral().id, PORTAL_ACTOR)).toEqual({ ok: false, error: 'Down for maintenance' });
    expect(db.referral_lead[0].hdpm_web_lead_id).toBeNull();
    expect(db.referral_lead_event[0]).toMatchObject({ event_type: 'web_push_failed' });
  });
  it('skips a referral that already has a website lead', async () => {
    db.referral_lead[0].hdpm_web_lead_id = '9';
    expect(await pushReferralToWebsite(referral().id, PORTAL_ACTOR)).toEqual({ ok: false, skipped: 'already_linked' });
    expect(webCalls).toHaveLength(0);
  });
});

describe('pushUnlinkedReferrals (backfill / retry)', () => {
  beforeEach(() => {
    db.referral_lead.push({ ...referral({ id: 'no-email', prospect_email: null }), org_id: 'hdpm' });
  });
  it('dry run counts without calling the website', async () => {
    const r = await pushUnlinkedReferrals('admin@highdesertpm.com', { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, candidates: 1, pushed: 0, skipped: { needs_email: 1 } });
    expect(webCalls).toHaveLength(0);
  });
  it('confirmed run pushes the candidates', async () => {
    webReply = () => Response.json({ outcome: 'created', leadId: 5 });
    const r = await pushUnlinkedReferrals('admin@highdesertpm.com', { dryRun: false });
    expect(r).toMatchObject({ dryRun: false, candidates: 1, pushed: 1, failed: [], skipped: { needs_email: 1 } });
    expect(webCalls[0].actor).toBe('admin@highdesertpm.com');
  });
});
