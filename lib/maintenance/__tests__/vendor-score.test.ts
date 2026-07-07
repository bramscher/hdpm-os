import { describe, it, expect } from 'vitest';
import type { Vendor, VendorAssignment } from '../types';
import {
  computeVendorHistory,
  computeVendorScores,
  medianOf,
  p90Of,
} from '../vendors';

const NOW = new Date('2026-07-02T12:00:00Z');

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: 'v1',
    appfolio_vendor_id: 'afv1',
    name: 'Fine Line Maintenance',
    trades: ['general'],
    service_area: 'Bend',
    license_number: null,
    license_expiry: null,
    license_required_trades: null,
    insurance_carrier: 'SAIF',
    insurance_expiry: '2027-02-01',
    w9_on_file: true,
    hourly_rate: 85,
    minimum_charge: 85,
    emergency_available: false,
    preferred: true,
    demoted: false,
    property_restrictions: null,
    active: true,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function assignment(overrides: Partial<VendorAssignment> = {}): VendorAssignment {
  return {
    id: 'a1',
    work_order_id: 'wo1',
    vendor_id: 'v1',
    sent_at: '2026-06-20T10:00:00Z',
    accepted_at: '2026-06-20T12:00:00Z', // 2h accept
    declined_at: null,
    scheduled_at: null,
    completed_at: '2026-06-22T12:00:00Z', // 2d after acceptance
    callback: false,
    created_by: null,
    created_at: '2026-06-20T10:00:00Z',
    ...overrides,
  };
}

describe('computeVendorScores', () => {
  it('fast accept + fast completion + no callbacks ≈ 1.0', () => {
    const [perf] = computeVendorScores([vendor()], [assignment()], NOW);
    expect(perf.score).toBeCloseTo(1.0, 2);
    expect(perf.avgAcceptHours).toBeCloseTo(2);
    expect(perf.avgCompletionDays).toBeCloseTo(2);
  });

  it('slow accept (3 days) zeroes the accept component', () => {
    const slow = assignment({ accepted_at: '2026-06-23T10:00:00Z' }); // 72h
    const [perf] = computeVendorScores([vendor()], [slow], NOW);
    expect(perf.score).toBeCloseTo(0.6, 2); // lost the 0.4 accept weight
  });

  it('callbacks reduce the score', () => {
    const cb = assignment({ callback: true });
    const [perf] = computeVendorScores([vendor()], [cb], NOW);
    expect(perf.callbackRate).toBe(1);
    expect(perf.score).toBeCloseTo(0.7, 2); // lost the 0.3 callback weight
  });

  it('assignments older than 90 days are ignored → null score', () => {
    const old = assignment({ sent_at: '2026-01-01T10:00:00Z' });
    const [perf] = computeVendorScores([vendor()], [old], NOW);
    expect(perf.assignments90d).toBe(0);
    expect(perf.avgAcceptHours).toBeNull();
    expect(perf.score).toBeNull();
  });

  it('no assignment data yields a null score (nothing to measure yet)', () => {
    const [perf] = computeVendorScores([vendor()], [], NOW);
    expect(perf.score).toBeNull();
  });

  it('demoted forces score 0 even with no data, and sorts below scored vendors', () => {
    const good = vendor();
    const demoted = vendor({ id: 'v2', name: 'Cascade Roofing', demoted: true });
    const scores = computeVendorScores([demoted, good], [assignment()], NOW);
    expect(scores[0].name).toBe('Fine Line Maintenance');
    expect(scores[1].score).toBe(0);
  });

  it('null-score vendors (no data) sort to the bottom, below a real score', () => {
    const scored = vendor();
    const noData = vendor({ id: 'v2', name: 'Slowpoke Plumbing' });
    const scores = computeVendorScores([noData, scored], [assignment()], NOW);
    expect(scores[0].vendorId).toBe('v1'); // has assignment → real score
    expect(scores[1].score).toBeNull(); // no assignment → null, sinks last
  });
});

describe('medianOf / p90Of', () => {
  it('median: odd, even, empty', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
  it('p90 nearest-rank', () => {
    expect(p90Of([...Array(10).keys()].map((i) => i + 1))).toBe(9); // 1..10 → 9
    expect(p90Of([5])).toBe(5);
    expect(p90Of([])).toBeNull();
  });
});

describe('computeVendorHistory (Session C)', () => {
  const row = (vendor_id: string | null, created: string | null, completed: string | null) => ({
    vendor_id,
    appfolio_created_at: created,
    completed_date: completed,
  });

  it('computes per-vendor median/p90/pctOver30', () => {
    const rows = [
      // slow vendor: 90, 100, 110 days
      row('slow', '2026-01-01', '2026-04-01'),
      row('slow', '2026-01-01', '2026-04-11'),
      row('slow', '2026-01-01', '2026-04-21'),
      // fast vendor: 5, 10 days
      row('fast', '2026-06-01', '2026-06-06'),
      row('fast', '2026-06-01', '2026-06-11'),
    ];
    const h = computeVendorHistory(rows);
    expect(h.get('slow')!.n).toBe(3);
    expect(h.get('slow')!.medianDays).toBe(100);
    expect(h.get('slow')!.pctOver30).toBe(100);
    expect(h.get('fast')!.medianDays).toBe(8); // (5+10)/2 rounded
    expect(h.get('fast')!.pctOver30).toBe(0);
  });

  it('excludes null vendor, null dates, and negative durations', () => {
    const rows = [
      row(null, '2026-01-01', '2026-02-01'),
      row('v', null, '2026-02-01'),
      row('v', '2026-01-01', null),
      row('v', '2026-03-01', '2026-02-01'), // negative — data noise
      row('v', '2026-01-01', '2026-01-11'), // the one valid row
    ];
    const h = computeVendorHistory(rows);
    expect(h.get('v')!.n).toBe(1);
    expect(h.get('v')!.medianDays).toBe(10);
  });
});
