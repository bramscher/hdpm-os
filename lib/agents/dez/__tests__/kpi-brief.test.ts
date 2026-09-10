import { describe, it, expect } from 'vitest';
import { matchKpiIntent, partitionByAccess } from '@/lib/agents/dez/kpi-brief';

describe('matchKpiIntent', () => {
  it('matches strong metric terms directly', () => {
    expect(matchKpiIntent("what's our occupancy?")).toEqual(['occupancy']);
    expect(matchKpiIntent('how are we on vacancy this week')).toEqual(['vacancy']);
    expect(matchKpiIntent('how many work orders are open')).toContain('work_orders');
  });

  it('does NOT hijack SOP questions that merely contain an ambiguous word', () => {
    // "notice" is a KPI synonym but this is an SOP question — no metric signal.
    expect(matchKpiIntent('what notice do I give for a rent increase?')).toEqual([]);
    expect(matchKpiIntent('do we need renter insurance in the lease?')).toEqual([]);
    expect(matchKpiIntent('how do I process a lease renewal?')).toEqual([]);
  });

  it('matches ambiguous terms only with a metric signal', () => {
    expect(matchKpiIntent('how many notices this week?')).toEqual(['notices']);
    expect(matchKpiIntent('what is our current renter insurance rate?')).toContain('insurance');
  });

  it('returns empty for a non-KPI question', () => {
    expect(matchKpiIntent('what is the security deposit return timeline?')).toEqual([]);
  });

  it('detects financial KPIs by name (gating happens later)', () => {
    expect(matchKpiIntent('what are our management fees?')).toEqual(['management_fees']);
    expect(matchKpiIntent("what's our delinquency right now?")).toEqual(['delinquency']);
  });
});

describe('partitionByAccess', () => {
  it('non-admin sees operational, financial is restricted', () => {
    const r = partitionByAccess(['occupancy', 'management_fees', 'delinquency'], false);
    expect(r.allowed).toEqual(['occupancy']);
    expect(r.restricted).toEqual(['management_fees', 'delinquency']);
  });

  it('admin sees everything', () => {
    const r = partitionByAccess(['occupancy', 'management_fees'], true);
    expect(r.allowed).toEqual(['occupancy', 'management_fees']);
    expect(r.restricted).toEqual([]);
  });
});
