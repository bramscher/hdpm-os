import { describe, it, expect } from 'vitest';
import { generateEstimatePdf, type EstimatePdfInput } from '@/lib/turn-estimator/estimate-pdf';

function input(over: Partial<EstimatePdfInput> = {}): EstimatePdfInput {
  return {
    estimate_code: 'EST-1a2b3c4d-v1',
    property_name: 'Maple House',
    property_address: '1 Maple St, Bend, OR',
    unit_name: 'B',
    priced_asof: '2026-09-03',
    owner_total: 462.5,
    status: 'approval_pending',
    lines: [
      { category: 'handyman', description: 'Service call', room: null, qty: 1, uom: 'visit', owner_unit_price: 125, owner_extended: 125 },
      { category: 'cleaning', description: 'Full clean', room: 'Kitchen', qty: 1, uom: 'each', owner_unit_price: 250, owner_extended: 250 },
      { category: 'painting', description: 'Touch-up paint', room: 'LR', qty: 0.5, uom: 'room', owner_unit_price: 175, owner_extended: 87.5 },
    ],
    ...over,
  };
}

describe('generateEstimatePdf', () => {
  it('returns a non-empty PDF buffer', () => {
    const pdf = generateEstimatePdf(input());
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles an empty line list without throwing', () => {
    const pdf = generateEstimatePdf(input({ lines: [], owner_total: 0 }));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles many lines / page break without throwing', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      category: ['handyman', 'cleaning', 'painting', 'other'][i % 4],
      description: `Task ${i} with a fairly long description that should wrap across the column width nicely`,
      room: i % 2 ? `Room ${i}` : null,
      qty: 1,
      uom: 'each',
      owner_unit_price: 50,
      owner_extended: 50,
    }));
    const pdf = generateEstimatePdf(input({ lines: many, owner_total: 3000 }));
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
