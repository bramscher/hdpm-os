import { describe, it, expect, afterEach } from 'vitest';
import {
  buildReviewBatchCard,
  buildReviewEmail,
  daysBetween,
  finalizeCandidates,
  pacificDate,
  parseRrActionId,
  parseRrBatchValue,
  pickOwnerCandidates,
  pickTenantCandidates,
  redrawReviewBatchCard,
  reviewUrl,
  rowBlockId,
  type CompletedWorkOrder,
  type ReviewCandidate,
  type TenantFact,
} from '../review-requests';

const TODAY = '2026-11-02';

function tenant(over: Partial<TenantFact> = {}): TenantFact {
  return {
    id: 't1',
    firstName: 'Ana',
    lastName: 'Ruiz',
    email: 'ana@example.com',
    propertyId: 'p1',
    unitId: 'u1',
    status: 'Current',
    primary: true,
    moveInOn: '2024-05-01',
    leaseStartDate: '2025-05-01',
    leaseSignedDate: '2025-04-10',
    address: '123 Elm St',
    ...over,
  };
}

function wo(over: Partial<CompletedWorkOrder> = {}): CompletedWorkOrder {
  return {
    id: 'w1',
    wo_number: '4410-1',
    property_id: 'p1',
    unit_id: 'u1',
    property_name: 'Elm House',
    property_address: '123 Elm St, Bend',
    description: 'Kitchen faucet leaking',
    completed_date: '2026-10-30',
    canceled_date: null,
    is_turn: false,
    appfolio_recurring: false,
    ...over,
  };
}

describe('dates', () => {
  it('counts whole days and uses the Pacific calendar day', () => {
    expect(daysBetween('2026-10-30', TODAY)).toBe(3);
    expect(daysBetween('2026-10-30T22:00:00Z', TODAY)).toBe(3);
    // 06:00 UTC on Nov 2 is still Nov 1 in Pacific.
    expect(pacificDate(new Date('2026-11-02T06:00:00Z'))).toBe('2026-11-01');
  });
});

describe('pickTenantCandidates', () => {
  it('asks the household after a repair completed 2–9 days ago', () => {
    const out = pickTenantCandidates({ tenants: [tenant()], workOrders: [wo()], today: TODAY });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ reason: 'repair', subjectRef: 'wo:4410-1', email: 'ana@example.com', detail: 'Kitchen faucet leaking' });
  });

  it('skips repairs that are too fresh, too old, canceled, turn or recurring work', () => {
    const wos = [
      wo({ id: 'a', completed_date: '2026-11-01' }),
      wo({ id: 'b', completed_date: '2026-10-20' }),
      wo({ id: 'c', canceled_date: '2026-10-30' }),
      wo({ id: 'd', is_turn: true }),
      wo({ id: 'e', appfolio_recurring: true }),
    ];
    expect(pickTenantCandidates({ tenants: [tenant()], workOrders: wos, today: TODAY })).toEqual([]);
  });

  it('asks one person per household, preferring the primary tenant', () => {
    const tenants = [tenant({ id: 'room', primary: false, email: 'room@example.com' }), tenant()];
    const out = pickTenantCandidates({ tenants, workOrders: [wo(), wo({ id: 'w2', wo_number: '4411-1' })], today: TODAY });
    expect(out.map((c) => c.contactId)).toEqual(['t1']);
  });

  it('skips tenants on notice and tenants without email', () => {
    expect(pickTenantCandidates({ tenants: [tenant({ status: 'Notice' })], workOrders: [wo()], today: TODAY })).toEqual([]);
    expect(pickTenantCandidates({ tenants: [tenant({ email: null })], workOrders: [wo()], today: TODAY })).toEqual([]);
  });

  it('falls back to the property’s only unit when the WO has no unit', () => {
    const out = pickTenantCandidates({ tenants: [tenant()], workOrders: [wo({ unit_id: null })], today: TODAY });
    expect(out).toHaveLength(1);
  });

  it('asks 30–37 days after move-in', () => {
    const t = tenant({ moveInOn: '2026-09-30', leaseStartDate: '2026-09-30', leaseSignedDate: '2026-09-20' });
    const out = pickTenantCandidates({ tenants: [t], workOrders: [], today: TODAY });
    expect(out.map((c) => c.reason)).toEqual(['move_in']);
    expect(pickTenantCandidates({ tenants: [tenant({ moveInOn: '2026-10-10' })], workOrders: [], today: TODAY })).toEqual([]);
  });

  it('asks within 14 days of a renewal, but not for the first lease', () => {
    const renewal = tenant({ leaseStartDate: '2026-12-01', leaseSignedDate: '2026-10-28' });
    expect(pickTenantCandidates({ tenants: [renewal], workOrders: [], today: TODAY }).map((c) => c.subjectRef)).toEqual(['renewal:2026-12-01']);
    const firstLease = tenant({ moveInOn: '2026-11-15', leaseStartDate: '2026-11-15', leaseSignedDate: '2026-10-28' });
    expect(pickTenantCandidates({ tenants: [firstLease], workOrders: [], today: TODAY })).toEqual([]);
  });
});

describe('pickOwnerCandidates', () => {
  const owners = [
    { id: 'o1', name: 'Sam Lee', firstName: 'Sam', email: 'sam@example.com' },
    { id: 'o2', name: 'No Email LLC', firstName: null, email: null },
  ];

  it('asks owners with email 90–104 days after management starts', () => {
    const out = pickOwnerCandidates({ properties: [{ id: 'p9', address: '9 Pine, Redmond', managementStartDate: '2026-07-28', owners }], today: TODAY });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ audience: 'owner', reason: 'owner_90d', subjectRef: 'owner_90d:p9' });
  });

  it('does not ask outside the window', () => {
    expect(pickOwnerCandidates({ properties: [{ id: 'p9', address: null, managementStartDate: '2026-09-01', owners }], today: TODAY })).toEqual([]);
  });
});

describe('finalizeCandidates', () => {
  const c = (over: Partial<ReviewCandidate>): ReviewCandidate => ({
    audience: 'tenant', reason: 'move_in', contactId: 'x', name: 'X', firstName: null,
    email: 'x@example.com', property: null, detail: null, subjectRef: 's', ...over,
  });

  it('keeps one ask per email, preferring a repair', () => {
    const out = finalizeCandidates([c({ reason: 'move_in' }), c({ reason: 'repair', email: 'X@Example.com' })], new Set());
    expect(out.map((x) => x.reason)).toEqual(['repair']);
  });

  it('drops anyone asked within the cooldown and invalid emails', () => {
    expect(finalizeCandidates([c({}), c({ email: 'not-an-email' })], new Set(['x@example.com']))).toEqual([]);
  });
});

describe('reviewUrl', () => {
  const saved = { id: process.env.GOOGLE_PLACE_ID, url: process.env.GOOGLE_REVIEW_URL };
  afterEach(() => {
    for (const [key, val] of [['GOOGLE_PLACE_ID', saved.id], ['GOOGLE_REVIEW_URL', saved.url]] as const) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('builds the write-review link from the place id, or uses an explicit url', () => {
    delete process.env.GOOGLE_REVIEW_URL;
    process.env.GOOGLE_PLACE_ID = 'ChIJabc';
    expect(reviewUrl()).toBe('https://search.google.com/local/writereview?placeid=ChIJabc');
    process.env.GOOGLE_REVIEW_URL = 'https://g.page/r/xyz/review';
    expect(reviewUrl()).toBe('https://g.page/r/xyz/review');
    delete process.env.GOOGLE_REVIEW_URL;
    delete process.env.GOOGLE_PLACE_ID;
    expect(reviewUrl()).toBeNull();
  });
});

describe('buildReviewEmail', () => {
  it('always includes the review link, and escapes HTML', () => {
    for (const reason of ['repair', 'move_in', 'renewal', 'owner_90d'] as const) {
      const e = buildReviewEmail({ reason, firstName: 'Ana', property: '1 <b>Elm</b>', detail: null }, 'https://example.com/r');
      expect(e.text).toContain('https://example.com/r');
      expect(e.html).toContain('href="https://example.com/r"');
      expect(e.html).not.toContain('<b>Elm</b>');
      expect(e.text.startsWith('Hi Ana,')).toBe(true);
    }
  });
});

describe('batch card', () => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const rows = ids.map((id, i) => ({
    id, audience: 'tenant' as const, reason: 'repair' as const, name: `T${i}`, email: `t${i}@example.com`, property: 'Elm', detail: null,
  }));

  it('parses row and send-all actions', () => {
    expect(parseRrActionId(`rr:${ids[0]}:send`)).toEqual({ kind: 'one', id: ids[0], op: 'send' });
    expect(parseRrActionId('rr:batch:2026-11-02')).toEqual({ kind: 'batch', batchDate: '2026-11-02' });
    expect(parseRrActionId('rr:nope:send')).toBeNull();
    expect(parseRrBatchValue(`${ids[0]},junk,${ids[1]}`)).toEqual(ids);
  });

  it('send-all carries only this card’s rows', () => {
    const card = buildReviewBatchCard(rows, '2026-11-02');
    const all = card.blocks.find((b) => b.block_id === 'rr-all') as { elements: Array<{ value: string }> };
    expect(parseRrBatchValue(all.elements[0].value)).toEqual(ids);
  });

  it('replaces decided rows with notes and drops Send all when none remain', () => {
    const { blocks } = buildReviewBatchCard(rows, '2026-11-02');
    const one = redrawReviewBatchCard(blocks, new Map([[ids[0], 'Sent']]));
    expect(one.find((b) => b.block_id === rowBlockId(ids[0]))?.type).toBe('context');
    expect(one.some((b) => b.block_id === 'rr-all')).toBe(true);
    const both = redrawReviewBatchCard(one, new Map([[ids[1], 'Skipped']]));
    expect(both.some((b) => b.block_id === 'rr-all')).toBe(false);
  });
});
