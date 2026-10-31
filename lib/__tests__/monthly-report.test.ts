import { describe, it, expect } from 'vitest';
import {
  buildMonthlyReport,
  previousMonthWindow,
  summarizeLeasing,
  summarizeMainLine,
  type MonthlyReportData,
} from '../monthly-report';

describe('previousMonthWindow', () => {
  it('covers the previous Pacific month, DST-aware at both ends', () => {
    // Nov 1 2026 08:00 PT → October 2026 (PDT start, PST end)
    const w = previousMonthWindow(new Date('2026-11-01T15:00:00Z'));
    expect(w.label).toBe('October 2026');
    expect(w.startDate).toBe('2026-10-01');
    expect(w.endDate).toBe('2026-11-01');
    expect(w.startIso).toBe('2026-10-01T07:00:00.000Z');
    expect(w.endIso).toBe('2026-11-01T07:00:00.000Z');
  });

  it('rolls back across a year boundary', () => {
    const w = previousMonthWindow(new Date('2027-01-01T15:00:00Z'));
    expect(w.label).toBe('December 2026');
    expect(w.startIso).toBe('2026-12-01T08:00:00.000Z');
    expect(w.endIso).toBe('2027-01-01T08:00:00.000Z');
  });
});

describe('summaries', () => {
  it('counts leasing outcomes, website-tagged leads, and median reply', () => {
    const s = summarizeLeasing([
      { lead_source: 'Website', property_path: null, tour_scheduled: true, af_lead_status: 'active:converted_to_tenant', response_seconds: 60, first_inbound_at: 'x' },
      { lead_source: 'Zillow', property_path: 'https://www.highdesertpm.com/listings/1', tour_scheduled: false, af_lead_status: null, response_seconds: 180, first_inbound_at: 'x' },
      { lead_source: 'Zillow', property_path: null, tour_scheduled: false, af_lead_status: null, response_seconds: null, first_inbound_at: 'x' },
    ]);
    expect(s).toMatchObject({ conversations: 3, fromWebsite: 2, tours: 1, converted: 1, medianReplyMinutes: 2, neverAnswered: 1 });
    expect(s.topSources[0]).toEqual({ source: 'Zillow', count: 2 });
  });

  it('separates main-line calls from Haven hand-off legs', () => {
    const m = summarizeMainLine([
      { kind: 'inbound', answered_by: 'ashley', haven_intent: null },
      { kind: 'inbound', answered_by: 'haven', haven_intent: null },
      { kind: 'haven_transfer', answered_by: 'staff', haven_intent: 'maintenance' },
    ]);
    expect(m).toEqual({ inbound: 2, answeredBy: { ashley: 1, haven: 1 }, handoffs: { maintenance: 1 } });
  });
});

describe('buildMonthlyReport', () => {
  const base: MonthlyReportData = {
    window: previousMonthWindow(new Date('2026-11-01T15:00:00Z')),
    website: null,
    doors: null,
    leasing: null,
    mainLine: null,
    attention: null,
  };

  it('still renders every section when sources are unavailable', () => {
    const r = buildMonthlyReport(base);
    expect(r.text).toContain('HDPM growth report — October 2026');
    for (const h of ['Owner growth', 'Website leads', 'Leasing (Haven)', 'Main line', 'Needs a person now']) {
      expect(r.text).toContain(h);
    }
    expect(r.blocks).toHaveLength(6);
  });

  it('leads with owners signed and net doors', () => {
    const r = buildMonthlyReport({
      ...base,
      website: {
        created: { total: 90, byType: { tenant: 60, owner: 22 }, bySource: { website: 90 } },
        owner: { created: 22, stillNew: 5, unassigned: 3, consultsBooked: 6, proposalsSent: 4, signed: 2, signedNames: ['A Owner', 'B Owner'] },
      },
      doors: { gained: 9, lost: 3, net: 6, baselineDoors: 800, currentDoors: 806, churnPct: 0.4 },
    });
    expect(r.text).toContain('*signed 2* — A Owner, B Owner');
    expect(r.text).toContain('*+6 net* (gained 9, lost 3) → 806 total');
  });
});
