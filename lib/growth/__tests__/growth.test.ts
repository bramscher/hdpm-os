import { describe, it, expect } from 'vitest';
import { computeDoorMovement } from '../../door-movement';
import { STAGE_WEIGHTS, GROWTH_SETTINGS } from '../config';
import { buildColumns, canMove, daysInStage, detailProperty, filterLeads, filterOptions, replaceLead, sourceLabel } from '../board';
import {
  addMonths,
  firstOnOrAfter,
  funnel,
  latestPerDay,
  leadsBySourceByMonth,
  monthlyMovement,
  monthlyPace,
  netDoorsSeries,
  openWeightedDoors,
  ownerChurnSeries,
  paceAt,
  partnerLeaderboard,
  pipelineByStage,
} from '../metrics';
import type { BoardLead, LeadDetailResponse } from '../lead-api';

let nextId = 1;
function lead(over: Partial<BoardLead> = {}): BoardLead {
  return {
    id: nextId++,
    name: 'Test Owner',
    email: null,
    phone: null,
    status: 'new',
    leadType: 'owner',
    source: 'website',
    assignedTo: null,
    nextFollowUpAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    isDuplicateOfLeadId: null,
    expectedDoors: null,
    sourceDetail: null,
    town: null,
    propertyAddress: null,
    statusEnteredAt: '2026-11-01T12:00:00.000Z',
    allowedStatuses: [],
    ...over,
  };
}

describe('settings', () => {
  it('holds the Phase 0 goal', () => {
    expect(GROWTH_SETTINGS.targetNetDoors).toBe(150);
    expect(GROWTH_SETTINGS.startDate).toBe('2026-11-06');
  });
});

describe('pace math', () => {
  it('is 12.5 doors a month for 150 over 12', () => {
    expect(monthlyPace(150, 12)).toBe(12.5);
  });
  it('adds months and clamps to month end', () => {
    expect(addMonths('2026-11-06', 12)).toBe('2027-11-06');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  });
  it('runs linearly from 0 at start to the target at the end, clamped', () => {
    expect(paceAt('2026-11-06', '2026-11-06', 150, 12)).toBe(0);
    expect(paceAt('2027-11-06', '2026-11-06', 150, 12)).toBe(150);
    expect(paceAt('2028-01-01', '2026-11-06', 150, 12)).toBe(150);
    expect(paceAt('2026-10-01', '2026-11-06', 150, 12)).toBe(0);
    const mid = paceAt('2027-05-06', '2026-11-06', 150, 12);
    expect(mid).toBeGreaterThan(73);
    expect(mid).toBeLessThan(77);
  });
  it('builds the goal series: month points plus snapshot days, actual vs baseline', () => {
    const series = netDoorsSeries({ '2026-11-06': 850, '2026-11-20': 856, '2026-10-01': 800 }, 850, '2026-11-06', 12, 150);
    expect(series[0]).toEqual({ date: '2026-11-06', actual: 0, pace: 0 });
    expect(series.find((p) => p.date === '2026-11-20')?.actual).toBe(6);
    expect(series.find((p) => p.date === '2026-10-01')).toBeUndefined();
    expect(series[series.length - 1]).toEqual({ date: '2027-11-06', actual: null, pace: 150 });
    expect(series.filter((p) => p.actual == null).length).toBe(12);
  });
  it('shows no actual line without a baseline', () => {
    expect(netDoorsSeries({ '2026-11-06': 850 }, null).every((p) => p.actual == null)).toBe(true);
  });
  it('picks the latest snapshot per day and the first on/after the start', () => {
    const rows = [
      { captured_at: '2026-11-05T23:00:00Z', value: 1 },
      { captured_at: '2026-11-06T08:00:00Z', value: 2 },
      { captured_at: '2026-11-06T20:00:00Z', value: 3 },
    ];
    expect(latestPerDay(rows)).toEqual({ '2026-11-05': 1, '2026-11-06': 3 });
    expect(firstOnOrAfter(rows, '2026-11-06')?.value).toBe(2);
    expect(firstOnOrAfter(rows, '2026-11-07')).toBeNull();
  });
});

describe('stage-weight math', () => {
  const leads = [
    lead({ status: 'engaged', expectedDoors: 4 }),
    lead({ status: 'engaged', expectedDoors: null }),
    lead({ status: 'proposal_sent', expectedDoors: 10 }),
    lead({ status: 'signed', expectedDoors: 3 }),
    lead({ status: 'lost', expectedDoors: 20 }),
  ];
  it('sums raw and weighted doors per stage', () => {
    const stages = pipelineByStage(leads);
    const engaged = stages.find((s) => s.key === 'engaged')!;
    expect(engaged).toMatchObject({ leads: 2, doors: 4, weight: STAGE_WEIGHTS.engaged, weightedDoors: 4 * STAGE_WEIGHTS.engaged });
    expect(stages.find((s) => s.key === 'lost')!.weightedDoors).toBe(0);
    expect(stages.map((s) => s.key)).toEqual(['new', 'attempted_contact', 'engaged', 'consult_booked', 'proposal_sent', 'signed', 'lost']);
  });
  it('open weighted doors leaves out signed and lost', () => {
    const w = { new: 0, attempted_contact: 0, engaged: 0.5, consult_booked: 0, proposal_sent: 0.5, signed: 1, lost: 0 };
    expect(openWeightedDoors(pipelineByStage(leads, w))).toBe(7);
  });
});

describe('board data shaping', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  it('counts whole days in stage, never negative', () => {
    expect(daysInStage({ statusEnteredAt: '2026-11-01T12:00:00Z' }, now)).toBe(5);
    expect(daysInStage({ statusEnteredAt: '2026-11-07T12:00:00Z' }, now)).toBe(0);
    expect(daysInStage({ statusEnteredAt: 'not a date' }, now)).toBe(0);
  });
  it('builds every column in order with counts and door totals, oldest first', () => {
    const a = lead({ status: 'engaged', expectedDoors: 2, statusEnteredAt: '2026-11-03T00:00:00Z' });
    const b = lead({ status: 'engaged', expectedDoors: 5, statusEnteredAt: '2026-11-01T00:00:00Z' });
    const c = lead({ status: 'archived', expectedDoors: 9 });
    const cols = buildColumns([a, b, c]);
    expect(cols).toHaveLength(7);
    const engaged = cols.find((col) => col.key === 'engaged')!;
    expect(engaged.count).toBe(2);
    expect(engaged.doors).toBe(7);
    expect(engaged.leads.map((l) => l.id)).toEqual([b.id, a.id]);
    expect(cols.reduce((s, col) => s + col.count, 0)).toBe(2);
  });
  it('filters by source, assignee (incl. unassigned) and town', () => {
    const x = lead({ source: 'referral', town: 'Bend', assignedTo: { id: 7, name: 'Pat' } });
    const y = lead({ source: 'website', town: 'Redmond' });
    expect(filterLeads([x, y], { source: 'referral' })).toEqual([x]);
    expect(filterLeads([x, y], { assignee: '7' })).toEqual([x]);
    expect(filterLeads([x, y], { assignee: 'unassigned' })).toEqual([y]);
    expect(filterLeads([x, y], { town: 'Redmond' })).toEqual([y]);
    expect(filterLeads([x, y], {})).toEqual([x, y]);
    expect(filterOptions([x, y])).toEqual({ sources: ['referral', 'website'], towns: ['Bend', 'Redmond'], assignees: [{ id: 7, name: 'Pat' }] });
  });
  it('allows a drop only to a status the website listed', () => {
    const l = lead({ status: 'engaged', allowedStatuses: ['consult_booked', 'lost'] });
    expect(canMove(l, 'consult_booked')).toBe(true);
    expect(canMove(l, 'signed')).toBe(false);
    expect(canMove(l, 'engaged')).toBe(false);
  });
  it('replaces a card in place and labels the source', () => {
    const l = lead({ status: 'new' });
    expect(replaceLead([l], { ...l, status: 'engaged' })[0].status).toBe('engaged');
    expect(sourceLabel({ source: 'referral', sourceDetail: 'Partner firm' })).toBe('Referral · Partner firm');
    expect(sourceLabel({ source: null, sourceDetail: null })).toBe('Unknown');
  });
});

describe('dashboard metrics', () => {
  const now = new Date('2026-11-06T00:00:00Z');
  it('builds a funnel from current stages; lost counts toward New only', () => {
    const steps = funnel(
      [
        lead({ status: 'new', statusEnteredAt: '2026-11-04T00:00:00Z' }),
        lead({ status: 'engaged', statusEnteredAt: '2026-11-01T00:00:00Z' }),
        lead({ status: 'signed' }),
        lead({ status: 'lost' }),
      ],
      now
    );
    expect(steps.map((s) => s.reached)).toEqual([4, 2, 2, 1, 1, 1]);
    expect(steps[1].conversionPct).toBe(50);
    expect(steps[3].conversionPct).toBe(50);
    expect(steps[0].medianDaysInStage).toBe(2);
    expect(steps[2].medianDaysInStage).toBe(5);
    expect(steps[4].medianDaysInStage).toBeNull();
  });
  it('counts leads by source per month', () => {
    const r = leadsBySourceByMonth([
      { createdAt: '2026-10-02T00:00:00Z', source: 'website' },
      { createdAt: '2026-10-09T00:00:00Z', source: 'referral' },
      { createdAt: '2026-11-01T00:00:00Z', source: 'website' },
      { createdAt: '2026-11-02T00:00:00Z', source: null },
    ]);
    expect(r.months).toEqual(['2026-10', '2026-11']);
    expect(r.rows[1]).toEqual({ month: '2026-11', other: 1, referral: 0, website: 1 });
  });
  it('gets doors gained and lost per month from rosters', () => {
    const m = monthlyMovement(
      {
        '2026-10-01': { a: 10, b: 5 },
        '2026-10-15': { a: 10, b: 5, c: 2 },
        '2026-11-01': { a: 12, c: 2 },
        '2026-11-06': { a: 12, c: 2, d: 4 },
      },
      computeDoorMovement
    );
    expect(m).toEqual([
      { month: '2026-10', gained: 4, lost: 5, net: -1 },
      { month: '2026-11', gained: 4, lost: 0, net: 4 },
    ]);
    expect(monthlyMovement({ '2026-11-06': { a: 1 } }, computeDoorMovement)).toEqual([]);
  });
  it('annualizes owner churn against the target', () => {
    const s = ownerChurnSeries({ '2026-11-06': { cancellationsLast30Days: 2, totalOwners: 300 }, '2026-11-05': { totalOwners: 0 } }, 10);
    expect(s).toEqual([
      { date: '2026-11-05', annualizedPct: null, target: 10 },
      { date: '2026-11-06', annualizedPct: 8, target: 10 },
    ]);
  });
  it('ranks partners by signed doors', () => {
    const rows = partnerLeaderboard(
      [
        { partner_id: 'p1', stage: 'submitted', doors_under_mgmt: null, unit_count: 4 },
        { partner_id: 'p2', stage: 'active', doors_under_mgmt: 6, unit_count: 2 },
        { partner_id: 'p1', stage: 'agreement_signed', doors_under_mgmt: null, unit_count: 3 },
        { partner_id: null, stage: 'active', doors_under_mgmt: 9, unit_count: 9 },
      ],
      [
        { id: 'p1', display_name: 'Partner One', company: 'Firm A' },
        { id: 'p2', display_name: 'Partner Two', company: null },
      ]
    );
    expect(rows).toEqual([
      { partnerId: 'p2', name: 'Partner Two', leads: 1, signedLeads: 1, doors: 6 },
      { partnerId: 'p1', name: 'Partner One (Firm A)', leads: 2, signedLeads: 1, doors: 3 },
    ]);
  });
});

describe('lead detail contract (GET /api/os/leads/[id])', () => {
  // Shaped like hdpm-web PR 75's detail route: the property stays nested in
  // subjectProperty; there is no flat propertyAddress / town.
  const response = {
    lead: {
      id: 1, name: 'Test Owner', email: null, phone: null, status: 'engaged', leadType: 'owner', source: 'website',
      assignedTo: null, nextFollowUpAt: null, createdAt: '2026-10-01T00:00:00Z', isDuplicateOfLeadId: null,
      preferredLanguage: null, doNotContact: false, sourceDetail: null, expectedDoors: 3, statusEnteredAt: '2026-11-01T00:00:00Z',
      stageReason: null, notesSummary: null, message: null, desiredMoveInDate: null, monthlyBudgetMin: null, monthlyBudgetMax: null,
      subjectProperty: { address: '100 Example St', town: 'Bend', bedrooms: 3 },
      rentAnalysisStatus: null, rentAnalysisShortUrl: null, lastContactedAt: null, attribution: null, allowedStatuses: ['consult_booked'],
    },
    activities: [],
  };
  // Extra website fields (bedrooms, attribution, ...) are fine; the required ones must line up.
  const typed: LeadDetailResponse = response;

  it('shows the nested property address and town', () => {
    expect(detailProperty(typed.lead)).toBe('100 Example St, Bend');
    expect('propertyAddress' in response.lead).toBe(false);
  });
  it('handles a missing or partial property', () => {
    expect(detailProperty({ subjectProperty: null })).toBe('');
    expect(detailProperty({ subjectProperty: { town: 'Redmond' } })).toBe('Redmond');
    expect(detailProperty({ subjectProperty: { address: ' ', town: null } })).toBe('');
  });
});
