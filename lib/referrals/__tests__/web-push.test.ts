import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- fakes: Supabase query builder + website fetch ----
type Row = Record<string, unknown>;
const db: { referral_lead: Row[]; referral_partner: Row[]; referral_lead_event: Row[] } = { referral_lead: [], referral_partner: [], referral_lead_event: [] };
const webCalls: { path: string; actor: string; init: RequestInit }[] = [];
let webReply: () => Response = () => Response.json({});

function query(table: keyof typeof db) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null;
  let orderBy: string | null = null;
  let max = Infinity;
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    not: (k: string, op: string, v: unknown) => (filters.push((r) => (op === 'is' ? (r[k] ?? null) !== v : true)), q),
    in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
    gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), q),
    order: (k: string) => ((orderBy = k), q),
    limit: (n: number) => ((max = n), q),
    update: (p: Row) => ((patch = p), q),
    insert: async (r: Row) => (db[table].push(r), { error: null }),
    maybeSingle: async () => ({ data: db[table].find((r) => filters.every((f) => f(r))) ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      let rows = db[table].filter((r) => filters.every((f) => f(r)));
      if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      rows = rows.slice(0, max);
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
    stage: 'submitted',
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
    expect(pushSkipReason({ hdpm_web_lead_id: '5', prospect_email: 'a@b.co', stage: 'submitted' })).toBe('already_linked');
    expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: null, stage: 'submitted' })).toBe('needs_email');
    expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: '  ', stage: 'qualified' })).toBe('needs_email');
    expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: 'a@b.co', stage: 'contacted' })).toBeNull();
    // Signed or finished referrals would show up on the website as "new": not pushed.
    for (const stage of ['agreement_signed', 'onboarding', 'active', 'closed', 'lost']) {
      expect(pushSkipReason({ hdpm_web_lead_id: null, prospect_email: 'a@b.co', stage })).toBe('stage');
    }
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
  const row = (id: string, over: Partial<ReferralRow> = {}) => ({ ...referral({ id, ...over }), org_id: 'hdpm' });
  beforeEach(() => {
    db.referral_lead = [
      row('a1', { prospect_email: null }), // needs email: never selected, counted
      row('a2', { prospect_email: 'fail@example.com' }), // website error
      row('a3', { stage: 'active' }), // signed owner: never imported
      row('a4'),
      row('a5'),
    ];
  });

  it('dry run reports the batch, the cursor and the needs-email count without calling the website', async () => {
    const r = await pushUnlinkedReferrals('admin@highdesertpm.com', { dryRun: true, limit: 2 });
    expect(r).toMatchObject({ dryRun: true, processed: 2, pushed: 0, nextCursor: 'a4', needsEmail: 1 });
    expect(webCalls).toHaveLength(0);
  });

  it('pages past skipped and failed rows: limit=1 batches reach every pushable referral', async () => {
    webReply = () => {
      const id = webCalls[webCalls.length - 1].path.split('/').pop();
      return id === 'a2' ? Response.json({ error: 'Website error' }, { status: 500 }) : Response.json({ outcome: 'created', leadId: 100 });
    };
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await pushUnlinkedReferrals('admin@highdesertpm.com', { dryRun: false, limit: 1, after });
      seen.push(...r.failed.map((f) => `fail:${f.id}`));
      if (r.pushed) seen.push('pushed');
      after = r.nextCursor;
      if (!after) break;
    }
    expect(seen).toEqual(['fail:a2', 'pushed', 'pushed']);
    expect(webCalls.map((c) => c.path.split('/').pop())).toEqual(['a2', 'a4', 'a5']);
    expect(db.referral_lead.find((r) => r.id === 'a2')?.hdpm_web_lead_id).toBeNull();
    expect(db.referral_lead.find((r) => r.id === 'a3')?.hdpm_web_lead_id).toBeNull();
  });

  it('a rerun from the start retries only what is still unlinked', async () => {
    webReply = () => Response.json({ outcome: 'created', leadId: 100 });
    await pushUnlinkedReferrals('admin@highdesertpm.com', { dryRun: false });
    webCalls.length = 0;
    const r = await pushUnlinkedReferrals('admin@highdesertpm.com', { dryRun: false });
    expect(r).toMatchObject({ processed: 0, pushed: 0, nextCursor: null, needsEmail: 1 });
    expect(webCalls).toHaveLength(0);
  });
});
