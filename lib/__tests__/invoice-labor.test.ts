import { describe, expect, it } from 'vitest';
import { offStandardLaborRate, recordedLaborHours } from '@/lib/invoice-labor';

describe('offStandardLaborRate', () => {
  it('accepts the standard and after-hours rates', () => {
    expect(offStandardLaborRate({ type: 'labor', unit_price: 95 })).toBe(false);
    expect(offStandardLaborRate({ type: 'labor', unit_price: 142.5 })).toBe(false);
  });
  it('flags other hourly labor rates', () => {
    expect(offStandardLaborRate({ type: 'labor', unit_price: 85 })).toBe(true);
    expect(offStandardLaborRate({ unit_price: 139.5 })).toBe(true);
  });
  it('ignores flat-priced, task-linked, non-labor and unpriced lines', () => {
    expect(offStandardLaborRate({ type: 'labor', pricing_method: 'flat', unit_price: 87 })).toBe(false);
    expect(offStandardLaborRate({ type: 'labor', workspace_task_id: 't1', unit_price: 300 })).toBe(false);
    expect(offStandardLaborRate({ type: 'materials', unit_price: 12 })).toBe(false);
    expect(offStandardLaborRate({ type: 'labor' })).toBe(false);
  });
});

describe('re-key lines', () => {
  it('count no measured hours', () => {
    expect(recordedLaborHours({ type: 'labor', pricing_method: 'flat', qty: 1 })).toBe(0);
    expect(recordedLaborHours({ type: 'labor', pricing_method: 'per_qty', qty: 4 })).toBe(0);
  });
});
