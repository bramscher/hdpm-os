import { describe, expect, it } from 'vitest';
import { invoiceLaborHours, weeklyBillableHours } from '../invoices';
import type { HdmsInvoice, LineItem } from '../invoices';

// Wed 2026-08-05 noon Pacific → week starts Mon 2026-08-03.
const NOW = new Date('2026-08-05T19:00:00Z');

type Inv = Pick<HdmsInvoice, 'status' | 'line_items' | 'completed_date' | 'created_at'>;

function inv(day: string | null, lines: LineItem[], status: Inv['status'] = 'generated'): Inv {
  return { status, line_items: lines, completed_date: day, created_at: '2026-07-01T00:00:00Z' };
}

const labor = (qty: number, technician?: string): LineItem => ({
  description: 'labor',
  type: 'labor',
  qty,
  amount: qty * 95,
  technician,
});

describe('invoiceLaborHours', () => {
  it('sums labor qty and ignores materials and zero-qty lines', () => {
    expect(
      invoiceLaborHours({
        line_items: [
          labor(2.5),
          { description: 'parts', type: 'materials', qty: 3, amount: 60 },
          { description: 'flat', type: 'labor', amount: 100 }, // no qty
        ],
      })
    ).toBe(2.5);
  });

  it('treats untyped lines as labor (legacy invoices)', () => {
    expect(invoiceLaborHours({ line_items: [{ description: 'x', qty: 1.5, amount: 150 }] })).toBe(1.5);
  });
});

describe('weeklyBillableHours', () => {
  it('attributes whole invoices to the week of completed_date', () => {
    const r = weeklyBillableHours(
      [
        inv('2026-08-03', [labor(4, 'Brody')]), // Monday, this week
        inv('2026-08-05', [labor(3.5, 'Alberto')]), // today
        inv('2026-07-30', [labor(6, 'Brody')]), // last week (Thu)
        inv('2026-07-25', [labor(8)]), // two weeks back — ignored
      ],
      NOW
    );
    expect(r.weekStart).toBe('2026-08-03');
    expect(r.weekHours).toBe(7.5);
    expect(r.lastWeekHours).toBe(6);
    expect(r.byTech).toEqual({ Brody: 4, Alberto: 3.5 });
  });

  it('excludes void invoices, counts drafts, falls back to created_at', () => {
    const r = weeklyBillableHours(
      [
        inv('2026-08-04', [labor(5)], 'void'),
        inv('2026-08-04', [labor(2)], 'draft'),
        { status: 'generated', line_items: [labor(1)], completed_date: null, created_at: '2026-08-05T02:00:00Z' },
      ],
      NOW
    );
    expect(r.weekHours).toBe(3);
  });
});
