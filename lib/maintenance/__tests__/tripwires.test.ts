import { describe, it, expect } from 'vitest';
import type {
  Approval,
  MaintWorkOrder,
  Recommendation,
  TripwireSnapshot,
  Turn,
  Vendor,
  VendorAssignment,
  WoDocs,
} from '../types';
import {
  tripwire1,
  tripwire2,
  tripwire3,
  tripwire4,
  tripwire5,
  tripwire6,
  tripwire7,
  tripwire8,
  tripwire9,
  tripwire10,
  tripwire11,
  tripwire12,
} from '../tripwires';
import { runTripwires } from '../tripwire-engine';

// NOW = Thursday 2026-07-02 (so "1 business day ago" = Wednesday 7/1)
const NOW = new Date('2026-07-02T15:00:00Z');

let woSeq = 0;
function wo(overrides: Partial<MaintWorkOrder> = {}): MaintWorkOrder {
  woSeq++;
  return {
    id: `wo-${woSeq}`,
    appfolio_id: `af-${woSeq}`,
    property_id: 'p1',
    property_name: 'Brosterhous',
    property_address: null,
    unit_id: 'u1',
    unit_name: '4',
    wo_number: `WO-${woSeq}`,
    description: 'Fridge not cooling',
    category: null,
    priority: null,
    status: 'open',
    appfolio_status: 'Open',
    assigned_to: null,
    vendor_id: null,
    vendor_name: null,
    scheduled_start: null,
    scheduled_end: null,
    completed_date: null,
    canceled_date: null,
    permission_to_enter: false,
    synced_at: NOW.toISOString(),
    created_at: '2026-07-02T08:00:00Z',
    updated_at: NOW.toISOString(),
    stage: 'TRIAGED',
    waiting_reason: null,
    owner_name: 'Cheryl',
    next_action_date: '2026-07-03',
    priority_class: 'P3',
    assigned_tech: null,
    origin: 'appfolio',
    is_turn: false,
    verified_by: null,
    verified_at: null,
    tenant_ping_sent: false,
    tenant_ping_sent_at: null,
    preventive_scheduled: null,
    closed_at: null,
    aging_reason: null,
    ...overrides,
  } as MaintWorkOrder;
}

function snapshot(overrides: Partial<TripwireSnapshot> = {}): TripwireSnapshot {
  return {
    now: NOW,
    openWorkOrders: [],
    assignments: [],
    vendors: [],
    approvals: [],
    recommendations: [],
    turns: [],
    invoicedWorkOrderIds: new Set(),
    docsByWorkOrder: new Map(),
    recentFailedAccessWoIds: new Set(),
    ...overrides,
  };
}

const fullDocs: WoDocs = {
  photoCount: 2,
  hasTime: true,
  hasMaterials: true,
  scopeChanges: 0,
  approvedDecisions: 0,
};

describe('tripwire 1 + 9 (Haven stubs)', () => {
  it('return no exceptions until Haven integration exists', () => {
    const s = snapshot({ openWorkOrders: [wo()] });
    expect(tripwire1(s)).toEqual([]);
    expect(tripwire9(s)).toEqual([]);
  });
});

describe('tripwire 2 — unassigned > 1 business day', () => {
  it('fires for a NEW WO created 2 business days ago', () => {
    const s = snapshot({
      openWorkOrders: [wo({ stage: 'NEW', created_at: '2026-06-30T08:00:00Z' })],
    });
    const ex = tripwire2(s);
    expect(ex).toHaveLength(1);
    expect(ex[0].tripwire).toBe(2);
  });

  it('does not fire for a NEW WO created today', () => {
    const s = snapshot({ openWorkOrders: [wo({ stage: 'NEW', created_at: '2026-07-02T08:00:00Z' })] });
    expect(tripwire2(s)).toHaveLength(0);
  });

  it('weekend does not count: NEW from Friday not flagged on Monday morning', () => {
    // created Friday 6/26, checked Monday 6/29 → 1 business day, not > 1
    const monday = new Date('2026-06-29T15:00:00Z');
    const s = snapshot({
      now: monday,
      openWorkOrders: [wo({ stage: 'NEW', created_at: '2026-06-26T08:00:00Z' })],
    });
    expect(tripwire2(s)).toHaveLength(0);
  });

  it('fires for any open WO with no owner', () => {
    const s = snapshot({
      openWorkOrders: [wo({ stage: 'SCHEDULED', owner_name: '' as unknown as string })],
    });
    const ex = tripwire2(s);
    expect(ex).toHaveLength(1);
    expect(ex[0].owner).toBe('Cheryl');
  });
});

describe('tripwire 3 — past-due / missing next action', () => {
  it('fires on past date and on null date', () => {
    const s = snapshot({
      openWorkOrders: [
        wo({ next_action_date: '2026-06-26' }),
        wo({ next_action_date: null }),
        wo({ next_action_date: '2026-07-03' }), // future — fine
      ],
    });
    const ex = tripwire3(s);
    expect(ex).toHaveLength(2);
    expect(ex[0].owner).toBe('Cheryl');
  });

  it('today is not past due', () => {
    const s = snapshot({ openWorkOrders: [wo({ next_action_date: '2026-07-02' })] });
    expect(tripwire3(s)).toHaveLength(0);
  });

  it('names the WO owner, not always Cheryl', () => {
    const s = snapshot({
      openWorkOrders: [wo({ next_action_date: '2026-06-26', owner_name: 'Jen' })],
    });
    expect(tripwire3(s)[0].owner).toBe('Jen');
  });
});

describe('tripwire 4 — vendor unaccepted > 24h', () => {
  const vendor: Vendor = {
    id: 'v1',
    appfolio_vendor_id: 'afv1',
    name: 'Cascade Roofing',
  } as Vendor;

  function assignment(overrides: Partial<VendorAssignment> = {}): VendorAssignment {
    return {
      id: 'a1',
      work_order_id: 'wo-x',
      vendor_id: 'v1',
      sent_at: '2026-06-26T10:00:00Z',
      accepted_at: null,
      declined_at: null,
      scheduled_at: null,
      completed_at: null,
      callback: false,
      created_by: null,
      created_at: '2026-06-26T10:00:00Z',
      ...overrides,
    };
  }

  it('fires for a 6-day-old unaccepted assignment', () => {
    const theWo = wo();
    const s = snapshot({
      openWorkOrders: [theWo],
      vendors: [vendor],
      assignments: [assignment({ work_order_id: theWo.id })],
    });
    const ex = tripwire4(s);
    expect(ex).toHaveLength(1);
    expect(ex[0].item).toContain('Cascade Roofing');
    expect(ex[0].owner).toBe('Cheryl');
    expect(ex[0].ageDays).toBe(6);
  });

  it('does not fire within 24h, when accepted, declined, or WO closed', () => {
    const theWo = wo();
    const fresh = assignment({ work_order_id: theWo.id, sent_at: '2026-07-02T10:00:00Z' });
    const accepted = assignment({ work_order_id: theWo.id, accepted_at: '2026-06-27T00:00:00Z' });
    const declined = assignment({ work_order_id: theWo.id, declined_at: '2026-06-27T00:00:00Z' });
    const orphan = assignment({ work_order_id: 'not-open' });
    const s = snapshot({
      openWorkOrders: [theWo],
      vendors: [vendor],
      assignments: [fresh, accepted, declined, orphan],
    });
    expect(tripwire4(s)).toHaveLength(0);
  });
});

describe('tripwire 5 — failed access needs same-day new date', () => {
  it('fires when a recent failed-access WO still has no future date', () => {
    const theWo = wo({ next_action_date: '2026-07-02' }); // today, not future
    const s = snapshot({
      openWorkOrders: [theWo],
      recentFailedAccessWoIds: new Set([theWo.id]),
    });
    expect(tripwire5(s)).toHaveLength(1);
  });

  it('does not fire once a future date is set', () => {
    const theWo = wo({ next_action_date: '2026-07-06' });
    const s = snapshot({
      openWorkOrders: [theWo],
      recentFailedAccessWoIds: new Set([theWo.id]),
    });
    expect(tripwire5(s)).toHaveLength(0);
  });
});

describe('tripwire 6 — scope change without approval', () => {
  it('fires when scope changes outnumber approved decisions', () => {
    const theWo = wo();
    const s = snapshot({
      openWorkOrders: [theWo],
      docsByWorkOrder: new Map([
        [theWo.id, { ...fullDocs, scopeChanges: 2, approvedDecisions: 1 }],
      ]),
    });
    const ex = tripwire6(s);
    expect(ex).toHaveLength(1);
    expect(ex[0].owner).toBe('Alberto');
    expect(ex[0].item).toContain('1 unapproved');
  });

  it('does not fire when matched', () => {
    const theWo = wo();
    const s = snapshot({
      openWorkOrders: [theWo],
      docsByWorkOrder: new Map([
        [theWo.id, { ...fullDocs, scopeChanges: 1, approvedDecisions: 1 }],
      ]),
    });
    expect(tripwire6(s)).toHaveLength(0);
  });
});

describe('tripwire 7 — VERIFY docs missing', () => {
  it('fires listing exactly what is missing', () => {
    const theWo = wo({ stage: 'VERIFY' });
    const s = snapshot({
      openWorkOrders: [theWo],
      docsByWorkOrder: new Map([
        [theWo.id, { ...fullDocs, photoCount: 0, hasMaterials: false }],
      ]),
    });
    const ex = tripwire7(s);
    expect(ex).toHaveLength(1);
    expect(ex[0].item).toContain('photos');
    expect(ex[0].item).toContain('materials');
    expect(ex[0].item).not.toContain('time');
  });

  it('fires when there are no docs at all', () => {
    const theWo = wo({ stage: 'VERIFY' });
    expect(tripwire7(snapshot({ openWorkOrders: [theWo] }))).toHaveLength(1);
  });

  it('does not fire outside VERIFY or with full docs', () => {
    const inProgress = wo({ stage: 'IN_PROGRESS' });
    const documented = wo({ stage: 'VERIFY' });
    const s = snapshot({
      openWorkOrders: [inProgress, documented],
      docsByWorkOrder: new Map([[documented.id, fullDocs]]),
    });
    expect(tripwire7(s)).toHaveLength(0);
  });
});

describe('tripwire 8 — verified > 5 days, unbilled', () => {
  it('fires at day 6+, names the tech', () => {
    const theWo = wo({
      stage: 'BILL',
      verified_at: '2026-06-25T10:00:00Z',
      assigned_tech: 'Brody',
    });
    const ex = tripwire8(snapshot({ openWorkOrders: [theWo] }));
    expect(ex).toHaveLength(1);
    expect(ex[0].owner).toBe('Brody');
    expect(ex[0].ageDays).toBeGreaterThan(5);
  });

  it('does not fire when invoiced or within 5 days', () => {
    const invoiced = wo({ stage: 'BILL', verified_at: '2026-06-20T10:00:00Z' });
    const recent = wo({ stage: 'BILL', verified_at: '2026-06-29T10:00:00Z' });
    const s = snapshot({
      openWorkOrders: [invoiced, recent],
      invoicedWorkOrderIds: new Set([invoiced.id]),
    });
    expect(tripwire8(s)).toHaveLength(0);
  });
});

describe('tripwire 10 — stale recommendations', () => {
  function rec(overrides: Partial<Recommendation> = {}): Recommendation {
    return {
      id: 'r1',
      work_order_id: null,
      tech: 'Alberto',
      body: 'Water heater anode rod near end of life',
      created_at: '2026-06-27T10:00:00Z',
      resolved_wo_id: null,
      dismissed_reason: null,
      ...overrides,
    };
  }

  it('fires after 3 days unresolved', () => {
    const ex = tripwire10(snapshot({ recommendations: [rec()] }));
    expect(ex).toHaveLength(1);
    expect(ex[0].owner).toBe('Alberto');
  });

  it('does not fire when resolved, dismissed, or fresh', () => {
    const s = snapshot({
      recommendations: [
        rec({ resolved_wo_id: 'wo-9' }),
        rec({ dismissed_reason: 'covered under warranty' }),
        rec({ created_at: '2026-07-01T10:00:00Z' }),
      ],
    });
    expect(tripwire10(s)).toHaveLength(0);
  });
});

describe('tripwire 11 — approval pending > 3 business days', () => {
  function approval(overrides: Partial<Approval> = {}): Approval {
    return {
      id: 'ap1',
      work_order_id: 'wo-x',
      kind: 'OWNER',
      requested_of: 'R. Simmons',
      estimate: 1200,
      photos: null,
      requested_at: '2026-06-25T10:00:00Z', // Thursday → 5 business days by 7/2
      decided_at: null,
      decision: null,
      approved_amount: null,
      conditions: null,
      created_at: '2026-06-25T10:00:00Z',
      ...overrides,
    };
  }

  it('fires after 3 business days, owner Jen', () => {
    const ex = tripwire11(snapshot({ approvals: [approval()] }));
    expect(ex).toHaveLength(1);
    expect(ex[0].owner).toBe('Jen');
    expect(ex[0].item).toContain('R. Simmons');
  });

  it('does not fire when decided or within 3 business days', () => {
    const s = snapshot({
      approvals: [
        approval({ decided_at: '2026-06-29T00:00:00Z', decision: 'APPROVED' }),
        approval({ requested_at: '2026-06-30T10:00:00Z' }), // 2 business days
      ],
    });
    expect(tripwire11(s)).toHaveLength(0);
  });
});

describe('tripwire 12 — turn without next action', () => {
  function turn(workOrderId: string): Turn {
    return {
      work_order_id: workOrderId,
      vacated_at: '2026-06-23',
      target_ready: '2026-07-08',
      current_blocker: 'Paint in progress',
      budget: 2400,
      actual: 1910,
      created_at: '2026-06-23T00:00:00Z',
      updated_at: '2026-06-23T00:00:00Z',
    };
  }

  it('fires for an open turn WO with no next_action_date', () => {
    const theWo = wo({ is_turn: true, next_action_date: null });
    const ex = tripwire12(snapshot({ openWorkOrders: [theWo], turns: [turn(theWo.id)] }));
    expect(ex).toHaveLength(1);
    expect(ex[0].item).toContain('vacant');
  });

  it('does not fire with a date set or for closed WOs', () => {
    const dated = wo({ is_turn: true, next_action_date: '2026-07-03' });
    const s = snapshot({
      openWorkOrders: [dated],
      turns: [turn(dated.id), turn('closed-wo-not-in-open-list')],
    });
    expect(tripwire12(s)).toHaveLength(0);
  });
});

describe('runTripwires engine', () => {
  it('aggregates exceptions across rules with no rule errors', () => {
    const pastDue = wo({ next_action_date: '2026-06-26' });
    const unverified = wo({ stage: 'VERIFY' });
    const result = runTripwires(snapshot({ openWorkOrders: [pastDue, unverified] }));
    expect(result.ruleErrors).toHaveLength(0);
    const nums = result.exceptions.map((e) => e.tripwire);
    expect(nums).toContain(3);
    expect(nums).toContain(7);
  });

  it('a clean board yields zero exceptions (the sweep goal)', () => {
    const healthy = wo();
    const result = runTripwires(snapshot({ openWorkOrders: [healthy] }));
    // stage TRIAGED created today, future date, owner set → nothing fires
    expect(result.exceptions).toHaveLength(0);
  });
});
