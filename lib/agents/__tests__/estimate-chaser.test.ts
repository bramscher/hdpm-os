import { describe, it, expect } from 'vitest';
import type { TripwireException } from '@/lib/maintenance/types';
import {
  VENDOR_CHASE_ACTION,
  OWNER_APPROVAL_ACTION,
  classifyPool,
  decideChase,
  buildVendorChaseDraft,
  buildOwnerApprovalDraft,
  buildVendorChaseSms,
  buildSmsQueueCard,
  buildEscalationSlack,
  encodeEcActionId,
  parseEcActionId,
  type ChaseCandidate,
  type ChaseHistory,
  type SmsQueueItem,
  type WorkOrderLite,
} from '../estimate-chaser';

// 2026-07-20 is a Monday.
const MON = new Date('2026-07-20T14:00:00Z');

function ex(overrides: Partial<TripwireException> = {}): TripwireException {
  return {
    tripwire: 11,
    label: '#11 Owner approval pending > 3 business days',
    item: '[Estimate Requested 12d] Roof leak — Brosterhous #4 (vendor bid outstanding)',
    fixRequired: 'Chase the vendor for the bid today; no response → next vendor',
    owner: 'Cheryl',
    workOrderId: 'wo-1',
    ageDays: 12,
    ...overrides,
  };
}

function wo(overrides: Partial<WorkOrderLite> = {}): WorkOrderLite {
  return {
    id: 'wo-1',
    wo_number: '412',
    property_name: 'Brosterhous Commons',
    property_address: '123 Brosterhous Rd',
    unit_name: '4',
    description: 'Roof leak above kitchen',
    vendor_id: 'v-77',
    vendor_name: 'Firkus Roofing',
    appfolio_status: 'Estimate Requested',
    appfolio_link: 'https://hdpm.appfolio.com/wo/412',
    ...overrides,
  };
}

function candidate(overrides: Partial<ChaseCandidate> = {}): ChaseCandidate {
  return {
    workOrderId: 'wo-1',
    kind: VENDOR_CHASE_ACTION,
    woNumber: '412',
    propertyName: 'Brosterhous Commons',
    propertyAddress: '123 Brosterhous Rd',
    unitName: '4',
    description: 'Roof leak above kitchen',
    vendorId: 'v-77',
    vendorName: 'Firkus Roofing',
    appfolioLink: 'https://hdpm.appfolio.com/wo/412',
    ageBusinessDays: 12,
    ageCalendarDays: 16,
    ...overrides,
  };
}

function history(overrides: Partial<ChaseHistory> = {}): ChaseHistory {
  return { chaseCount: 0, lastChaseAt: null, lastEscalateAt: null, ...overrides };
}

// ── classifyPool ──

describe('classifyPool', () => {
  it('maps estimate statuses to chase kinds', () => {
    const wos = new Map([
      ['wo-1', wo()],
      ['wo-2', wo({ id: 'wo-2', appfolio_status: 'Estimated' })],
    ]);
    const { candidates } = classifyPool(
      [ex(), ex({ workOrderId: 'wo-2' })],
      wos,
      [],
      new Map()
    );
    expect(candidates.map((c) => c.kind)).toEqual([VENDOR_CHASE_ACTION, OWNER_APPROVAL_ACTION]);
  });

  it('routes source-(a) approval WOs in non-estimate statuses to owner_approval', () => {
    const wos = new Map([['wo-1', wo({ appfolio_status: 'Assigned' })]]);
    const { candidates } = classifyPool([ex()], wos, [], new Map());
    expect(candidates[0].kind).toBe(OWNER_APPROVAL_ACTION);
  });

  it('dedupes to one candidate per WO and drops missing WO rows', () => {
    const wos = new Map([['wo-1', wo()]]);
    const { candidates } = classifyPool(
      [ex(), ex(), ex({ workOrderId: 'wo-gone' })],
      wos,
      [],
      new Map()
    );
    expect(candidates).toHaveLength(1);
  });

  it('excludes HDMS vendor-bid chases by id and by name', () => {
    const wos = new Map([
      ['wo-1', wo({ vendor_id: 'internal-1' })],
      ['wo-2', wo({ id: 'wo-2', vendor_id: 'v-9', vendor_name: 'High Desert Maintenance Services - Division of HDPM' })],
    ]);
    const { candidates, skippedInternal } = classifyPool(
      [ex(), ex({ workOrderId: 'wo-2' })],
      wos,
      ['internal-1'],
      new Map()
    );
    expect(candidates).toHaveLength(0);
    expect(skippedInternal).toHaveLength(2);
  });

  it('does NOT exclude owner-approval drafts on HDMS work orders', () => {
    // The owner still needs to approve; the vendor identity is irrelevant.
    const wos = new Map([
      ['wo-1', wo({ appfolio_status: 'Estimated', vendor_id: 'internal-1' })],
    ]);
    const { candidates } = classifyPool([ex()], wos, ['internal-1'], new Map());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe(OWNER_APPROVAL_ACTION);
  });

  it('carries calendar age from the map, falling back to business days', () => {
    const wos = new Map([['wo-1', wo()], ['wo-2', wo({ id: 'wo-2' })]]);
    const { candidates } = classifyPool(
      [ex(), ex({ workOrderId: 'wo-2' })],
      wos,
      [],
      new Map([['wo-1', 20]])
    );
    expect(candidates[0].ageCalendarDays).toBe(20);
    expect(candidates[1].ageCalendarDays).toBe(12);
  });
});

// ── decideChase ──

describe('decideChase', () => {
  it('chases a fresh candidate', () => {
    expect(decideChase(candidate(), history(), MON)).toEqual({ action: 'chase' });
  });

  it('skips inside the 3-business-day cooldown', () => {
    const fri = new Date('2026-07-17T14:00:00Z');
    // Fri → Mon is 1 business day — still cooling down.
    expect(decideChase(candidate(), history({ lastChaseAt: fri }), MON)).toEqual({
      action: 'skip',
      reason: 'cooldown',
    });
  });

  it('chases again once 3 business days have elapsed', () => {
    const prevTue = new Date('2026-07-14T14:00:00Z'); // Tue → Mon = 4 business days
    expect(decideChase(candidate(), history({ lastChaseAt: prevTue }), MON)).toEqual({
      action: 'chase',
    });
  });

  it('escalates at 3 chases even when cooled down', () => {
    expect(decideChase(candidate(), history({ chaseCount: 3 }), MON)).toEqual({
      action: 'escalate',
      reason: 'chased_3x',
    });
  });

  it('escalates past 45 calendar days with zero chases', () => {
    expect(decideChase(candidate({ ageCalendarDays: 46 }), history(), MON)).toEqual({
      action: 'escalate',
      reason: 'aged_45d',
    });
  });

  it('does not escalate at exactly 45 calendar days', () => {
    expect(decideChase(candidate({ ageCalendarDays: 45 }), history(), MON)).toEqual({
      action: 'chase',
    });
  });

  it('holds re-escalation inside the 5-business-day escalation cooldown', () => {
    const lastThu = new Date('2026-07-16T14:00:00Z'); // Thu → Mon = 2 business days
    expect(
      decideChase(candidate(), history({ chaseCount: 3, lastEscalateAt: lastThu }), MON)
    ).toEqual({ action: 'skip', reason: 'escalation_cooldown' });
  });

  it('escalation outranks the chase cooldown', () => {
    const fri = new Date('2026-07-17T14:00:00Z');
    expect(
      decideChase(candidate({ ageCalendarDays: 60 }), history({ lastChaseAt: fri }), MON)
    ).toEqual({ action: 'escalate', reason: 'aged_45d' });
  });
});

// ── draft templates ──

describe('draft templates', () => {
  const vendor = buildVendorChaseDraft(candidate(), 'bids@firkus.com', 1);
  const vendorBlankTo = buildVendorChaseDraft(candidate(), null, 2);
  const owner = buildOwnerApprovalDraft(candidate({ kind: OWNER_APPROVAL_ACTION }), 1);

  it('never mentions dollar amounts', () => {
    for (const d of [vendor, vendorBlankTo, owner]) {
      expect(d.html + d.text + d.subject).not.toMatch(/\$/);
      expect(d.html + d.text).not.toMatch(/amount|price|cost/i);
    }
  });

  it('never leaks the internal AppFolio link into draft bodies', () => {
    for (const d of [vendor, vendorBlankTo, owner]) {
      expect(d.html + d.text).not.toMatch(/appfolio/i);
    }
  });

  it('addresses the vendor when the email is known, blank otherwise', () => {
    expect(vendor.toRecipients).toEqual(['bids@firkus.com']);
    expect(vendorBlankTo.toRecipients).toEqual([]);
  });

  it('owner drafts always leave To: blank with a visible placeholder', () => {
    expect(owner.toRecipients).toEqual([]);
    expect(owner.text).toContain('[owner name]');
  });

  it('references the WO and property in the subject', () => {
    expect(vendor.subject).toBe('Bid follow-up — WO #412 — 123 Brosterhous Rd, Unit 4');
    expect(owner.subject).toBe('Approval needed — WO #412 — 123 Brosterhous Rd, Unit 4');
  });

  it('acknowledges repeat follow-ups on round ≥ 2 only', () => {
    expect(vendorBlankTo.text).toContain('second follow-up');
    expect(vendor.text).not.toContain('checking in again');
  });

  it('signs as the given sender, defaulting to Cheryl', () => {
    expect(vendor.text).toContain('Cheryl');
    expect(vendor.text).not.toContain('Brody');
    const brody = buildVendorChaseDraft(candidate(), 'bids@firkus.com', 1, 'Brody');
    expect(brody.text).toContain('Brody');
    expect(brody.html).toContain('Brody');
    expect(brody.text).not.toMatch(/Thank you,\nCheryl/);
    const ownerBrody = buildOwnerApprovalDraft(candidate({ kind: OWNER_APPROVAL_ACTION }), 1, 'Brody');
    expect(ownerBrody.text).toContain('Brody');
  });

  it('escapes HTML in the description', () => {
    const d = buildVendorChaseDraft(
      candidate({ description: 'Replace <broken> & "leaky" valve' }),
      null,
      1
    );
    expect(d.html).toContain('&lt;broken&gt; &amp; &quot;leaky&quot;');
    expect(d.html).not.toContain('<broken>');
  });
});

// ── SMS chase (Brief D.5) ──

describe('buildVendorChaseSms', () => {
  const round1 = buildVendorChaseSms(candidate(), 1);
  const round2 = buildVendorChaseSms(candidate(), 2);

  it('stays within two SMS segments and never mentions money or links', () => {
    for (const sms of [round1, round2]) {
      expect(sms.length).toBeLessThanOrEqual(320);
      expect(sms).not.toMatch(/\$/);
      expect(sms).not.toMatch(/https?:\/\/|appfolio/i);
    }
  });

  it('identifies Cheryl/HDPM, the WO, and the property', () => {
    expect(round1).toContain('Cheryl');
    expect(round1).toContain('High Desert Property Mgmt');
    expect(round1).toContain('WO #412');
    expect(round1).toContain('123 Brosterhous Rd');
  });

  it('round ≥ 2 acknowledges the earlier chase', () => {
    expect(round2).toContain('again');
    expect(round1).not.toContain('again');
  });

  it('truncates long descriptions', () => {
    const sms = buildVendorChaseSms(candidate({ description: 'x'.repeat(500) }), 1);
    expect(sms.length).toBeLessThanOrEqual(320);
  });
});

describe('ec action ids', () => {
  it('round-trips', () => {
    expect(parseEcActionId(encodeEcActionId('sendsms', 'p-123'))).toEqual({
      kind: 'sendsms',
      proposalId: 'p-123',
    });
    expect(parseEcActionId(encodeEcActionId('skip', 'p-9'))).toEqual({
      kind: 'skip',
      proposalId: 'p-9',
    });
  });

  it('rejects foreign namespaces and unknown kinds', () => {
    expect(parseEcActionId('mc:done:p-1')).toBeNull();
    expect(parseEcActionId('ec:explode:p-1')).toBeNull();
    expect(parseEcActionId('ec:sendsms:')).toBeNull();
  });
});

describe('buildSmsQueueCard', () => {
  const items: SmsQueueItem[] = [
    {
      proposalId: 'p-1',
      status: 'proposed',
      vendorName: 'Cascade Plumbing',
      vendorPhone: '+15415550100',
      woRef: 'WO #412 — 123 Brosterhous Rd, Unit 4',
      smsText: 'Hi Cascade Plumbing, ...',
    },
    {
      proposalId: 'p-2',
      status: 'approved',
      vendorName: 'Firkus Roofing',
      vendorPhone: '+15415550101',
      woRef: 'WO #500 — 9 Main St',
      smsText: 'Hi Firkus Roofing, ...',
      resolution: 'Text sent by Cheryl 7:02 AM',
    },
  ];
  const { text, blocks } = buildSmsQueueCard(items, '2026-07-21');
  const s = JSON.stringify(blocks);

  it('counts only pending items in the header', () => {
    expect(text).toContain('1 of 2 to send');
  });

  it('renders buttons only for proposed items, with a confirm dialog on send', () => {
    expect(s).toContain(`ec:sendsms:p-1`);
    expect(s).toContain(`ec:skip:p-1`);
    expect(s).not.toContain(`ec:sendsms:p-2`);
    expect(s).toContain('Send this text?');
  });

  it('shows the resolution on decided items', () => {
    expect(s).toContain('Text sent by Cheryl 7:02 AM');
  });
});

// ── escalation Slack ──

describe('buildEscalationSlack', () => {
  it('includes the AppFolio link and the reason on the internal surface', () => {
    const { text, blocks } = buildEscalationSlack(
      [
        { candidate: candidate(), reason: 'chased_3x', chaseCount: 3 },
        { candidate: candidate({ workOrderId: 'wo-2', ageCalendarDays: 60 }), reason: 'aged_45d', chaseCount: 0 },
      ],
      '2026-07-20'
    );
    const s = JSON.stringify(blocks);
    expect(text).toContain('2 stuck estimates');
    expect(s).toContain('appfolio.com');
    expect(s).toContain('chased 3×');
    expect(s).toContain('60 days stuck');
  });
});
