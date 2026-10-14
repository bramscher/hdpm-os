import { describe, expect, it } from 'vitest';
import {
  buildSections,
  businessDaysBetween,
  depositSlipDue,
  effectiveStatus,
  needsAction,
  rollupSection,
  sectionFor,
  statusFromAppFolio,
  viewOf,
  type TrackerWo,
} from '../model';

const wo = (over: Partial<TrackerWo> = {}): TrackerWo => ({
  id: 'w1',
  unit_turn_category: 'Paint',
  description: 'Paint living room',
  appfolio_status: 'Assigned',
  status: 'open',
  canceled_date: null,
  turn_status: null,
  turn_status_af_basis: null,
  ...over,
});

describe('sectionFor', () => {
  it.each([
    ['Keys / Locks', 'Re-key', 1],
    ['Housekeeping', 'Cleaning', 2],
    ['Other', 'Maintenance Follow Up - 4B', 4],
    ['Other', 'Haul trash', 3],
    ['Remotes', 'Garage remote', 3],
    [null, 'Manually linked', 3],
  ])('%s / %s → %i', (cat, desc, no) => {
    expect(sectionFor({ unit_turn_category: cat, description: desc })).toBe(no);
  });
});

describe('statusFromAppFolio', () => {
  it.each([
    ['New', 'open', 'unassigned'],
    ['Assigned', 'open', 'assigned'],
    ['Estimate Requested', 'open', 'estimate_requested'],
    ['Estimated', 'open', 'estimated'],
    ['Scheduled', 'open', 'scheduled'],
    ['Work Completed', 'done', 'completed_awaiting_invoice'],
    ['Canceled', 'closed', 'cancelled'],
  ])('%s → %s', (af, status, expected) => {
    expect(statusFromAppFolio(wo({ appfolio_status: af, status }))).toBe(expected);
  });

  it('a linked invoice makes a completed WO invoice-received', () => {
    expect(statusFromAppFolio(wo({ appfolio_status: 'Completed', status: 'done', has_linked_invoice: true }))).toBe('complete_invoice_received');
  });

  it('treats an invoice uploaded or a bill entered in AppFolio as received', () => {
    expect(statusFromAppFolio(wo({ appfolio_status: 'Completed', status: 'done', af_invoice_received: true }))).toBe('complete_invoice_received');
    expect(statusFromAppFolio(wo({ appfolio_status: 'Completed', status: 'done', af_invoice_received: false }))).toBe('completed_awaiting_invoice');
  });

  it('does not mark an open work order received just because a bill exists', () => {
    expect(statusFromAppFolio(wo({ appfolio_status: 'Scheduled', status: 'open', af_invoice_received: true }))).toBe('scheduled');
  });

  it('a completed follow-up inspection defaults to no bill needed', () => {
    expect(
      statusFromAppFolio(wo({ unit_turn_category: 'Other', description: 'Maintenance Follow Up', appfolio_status: 'Completed', status: 'done' }))
    ).toBe('complete_no_bill');
  });
});

describe('effectiveStatus — the most recent update wins', () => {
  it('a hand-set status holds while AppFolio is unchanged', () => {
    const w = wo({ appfolio_status: 'Estimated', turn_status: 'awaiting_owner_approval', turn_status_af_basis: 'Estimated' });
    expect(effectiveStatus(w)).toEqual({ status: 'awaiting_owner_approval', source: 'manual' });
  });
  it('AppFolio moving on (e.g. to Scheduled) clears it', () => {
    const w = wo({ appfolio_status: 'Scheduled', turn_status: 'awaiting_owner_approval', turn_status_af_basis: 'Estimated' });
    expect(effectiveStatus(w)).toEqual({ status: 'scheduled', source: 'appfolio' });
  });
});

describe('rollupSection', () => {
  it('an empty section is complete', () => {
    expect(rollupSection({ required: [], anyTicked: false, woStatuses: [] })).toBe('complete');
  });
  it('estimate requested outranks everything (Brody 2026-10-12)', () => {
    expect(rollupSection({ required: [], anyTicked: false, woStatuses: ['awaiting_owner_funds', 'estimate_requested'] })).toBe('estimate_requested');
  });
  it('waiting on funds outranks owner approval', () => {
    expect(rollupSection({ required: [], anyTicked: false, woStatuses: ['awaiting_owner_approval', 'awaiting_owner_funds'] })).toBe('awaiting_funds');
  });
  it('awaiting invoice keeps a section in progress', () => {
    expect(rollupSection({ required: [], anyTicked: false, woStatuses: ['completed_awaiting_invoice'] })).toBe('in_progress');
  });
  it('untouched checks and unassigned WOs are not started', () => {
    expect(rollupSection({ required: [false, false], anyTicked: false, woStatuses: ['unassigned'] })).toBe('not_started');
  });
  it('all required ticked and all WOs final is complete', () => {
    expect(rollupSection({ required: [true, true], anyTicked: true, woStatuses: ['complete_no_bill', 'cancelled'] })).toBe('complete');
  });
});

describe('buildSections', () => {
  const base = { vacated_at: '2026-10-02', movein_date: null as string | null, status: 'active', checks: {} };

  it('section 6 invoices are calculated across every work order', () => {
    const s = buildSections({ ...base, wos: [wo({ appfolio_status: 'Completed', status: 'done' })] });
    expect(s[5].checks.find((c) => c.def.key === 'invoices_received')!.checked).toBe(false);
    expect(s[5].detail).toBe('Deposit slip due Nov 1');
  });

  it('the optional walkthrough video never blocks section 4', () => {
    const checks = {
      listing_photos: { checked: true, value: null, checked_at: null, checked_by: null },
      listing_details: { checked: true, value: null, checked_at: null, checked_by: null },
    };
    expect(buildSections({ ...base, wos: [], checks })[3].status).toBe('complete');
  });

  it('section 7 move-in is computed from the move-in date', () => {
    const s = buildSections({ ...base, movein_date: '2026-10-20', wos: [] });
    expect(s[6].checks.find((c) => c.def.key === 'movein_entered')!.checked).toBe(true);
    expect(s[6].status).toBe('in_progress');
  });
});

describe('dates and views', () => {
  it('deposit slip is due 30 days after move-out', () => {
    expect(depositSlipDue('2026-10-02')).toBe('2026-11-01');
  });
  it('counts business days', () => {
    expect(businessDaysBetween('2026-10-09', '2026-10-16')).toBe(5); // Fri → next Fri
  });
  it('views follow the move-out date', () => {
    expect(viewOf({ status: 'active', vacated_at: '2026-10-20' }, '2026-10-12')).toBe('not_yet_ready');
    expect(viewOf({ status: 'active', vacated_at: '2026-10-12' }, '2026-10-12')).toBe('active');
    expect(viewOf({ status: 'closed', vacated_at: '2026-09-01' }, '2026-10-12')).toBe('completed');
  });
  it('flags an overdue slip and an invoice past 5 business days', () => {
    const turn = { vacated_at: '2026-09-01', movein_date: null, status: 'active', checks: {}, wos: [wo({ appfolio_status: 'Completed', status: 'done' })] };
    const out = needsAction(turn, buildSections(turn), { w1: '2026-10-01' }, '2026-10-12');
    expect(out).toEqual(['Deposit slip overdue', 'Invoice overdue']);
  });
});
