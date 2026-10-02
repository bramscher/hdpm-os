import { describe, it, expect } from 'vitest';
import {
  form1099Threshold, formatTin, maskTin, newBatchId, paymentBatches, quickbooksCsv, readyToPay, taxReadiness, taxYearTotals, type PayeePartner,
} from '../payouts';

const partner = (over: Partial<PayeePartner> = {}): PayeePartner => ({
  id: 'p1', display_name: 'Pat Agent', company: null, email: 'pat@x.com', legal_name: 'Patricia Agent', tax_id_last4: '6789',
  tax_address: { line1: '1 Main St', city: 'Bend', state: 'OR', zip: '97701' }, w9_status: 'on_file', ...over,
});
type Row = { id: number; lead_id: string; partner_id: string; entry_type: 'earned' | 'approved' | 'paid' | 'voided' | 'adjusted'; amount: number; created_at: string; batch_id: string | null; qbo_reference: string | null; actor: string };
let n = 0;
const row = (lead_id: string, entry_type: Row['entry_type'], amount: number, created_at = '2026-10-05T18:00:00Z', extra: Partial<Row> = {}): Row =>
  ({ id: ++n, lead_id, partner_id: 'p1', entry_type, amount, created_at, batch_id: null, qbo_reference: null, actor: 'craig', ...extra });

describe('readyToPay', () => {
  it('lists only approved, unpaid bounties with payee and readiness', () => {
    const entries = [
      row('a', 'earned', 500), row('a', 'approved', 500, '2026-10-02T00:00:00Z'),
      row('b', 'earned', 300),
      row('c', 'earned', 200), row('c', 'approved', 200), row('c', 'paid', 200),
      row('d', 'earned', 100), row('d', 'voided', -100),
    ];
    const rows = readyToPay(entries, new Map([['a', { prospect_name: 'Ann' }]]), new Map([['p1', partner()]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ leadId: 'a', payee: 'Patricia Agent', amount: 500, prospectName: 'Ann' });
    expect(rows[0].readiness.ready).toBe(true);
  });
});

describe('taxReadiness', () => {
  it('names what a 1099 is missing', () => {
    const r = taxReadiness(partner({ legal_name: null, tax_id_last4: null, tax_address: { line1: '1 Main' }, w9_status: 'missing' }));
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(['legal name', 'tax ID', 'mailing address', 'W-9']);
    expect(taxReadiness(partner({ w9_status: 'verified' })).ready).toBe(true);
  });
});

describe('quickbooksCsv', () => {
  it('writes QBO columns, US dates, quotes commas, and never includes a TIN', () => {
    const csv = quickbooksCsv([{ payee: 'Smith, Jones & Co "LLC"', amount: 1250, prospectName: 'Ann', leadId: 'a' }], '2026-10-05', 'PAY-20261005-abcd');
    const [head, line] = csv.trim().split('\r\n');
    expect(head).toBe('Payee,Date,Amount,Account,Memo,Ref no');
    expect(line).toBe('"Smith, Jones & Co ""LLC""",10/05/2026,1250.00,Referral Fees,Referral bounty — Ann,PAY-20261005-abcd');
    expect(csv).not.toMatch(/6789|\*\*\*/);
  });
});

describe('tax year', () => {
  it('uses $600 through 2025 and $2,000 from 2026', () => {
    expect(form1099Threshold(2025)).toBe(600);
    expect(form1099Threshold(2026)).toBe(2000);
    expect(form1099Threshold(2027)).toBe(2000);
  });

  it('totals paid rows by Pacific calendar year', () => {
    const entries = [
      row('a', 'paid', 500, '2026-12-31T23:30:00-08:00'), // still 2026 in Pacific
      row('b', 'paid', 300, '2027-01-01T07:30:00Z'), // 2026-12-31 23:30 Pacific → 2026
      row('c', 'paid', 200, '2027-01-01T09:00:00Z'), // 2027 in Pacific
      row('d', 'approved', 999, '2026-06-01T00:00:00Z'), // not paid
    ];
    expect(taxYearTotals(entries, 2026)).toEqual([{ partnerId: 'p1', paid: 800, payments: 2 }]);
    expect(taxYearTotals(entries, 2027)).toEqual([{ partnerId: 'p1', paid: 200, payments: 1 }]);
  });
});

describe('formatting helpers', () => {
  it('masks and formats TINs', () => {
    expect(maskTin('6789')).toBe('***-**-6789');
    expect(maskTin(null)).toBe('');
    expect(formatTin('123456789')).toBe('123-45-6789');
    expect(formatTin('12-3456789')).toBe('123-45-6789');
    expect(formatTin('ABC')).toBe('ABC');
  });

  it('batch ids carry the Pacific date and 4 random chars', () => {
    expect(newBatchId(new Date('2026-10-06T05:00:00Z'), () => 0)).toBe('PAY-20261005-aaaa');
    expect(newBatchId(new Date())).toMatch(/^PAY-\d{8}-[a-z0-9]{4}$/);
  });

  it('groups past payments by batch', () => {
    const entries = [
      row('a', 'paid', 500, '2026-10-05T18:00:00Z', { batch_id: 'PAY-1', qbo_reference: 'CHK-9' }),
      row('b', 'paid', 300, '2026-10-05T18:00:01Z', { batch_id: 'PAY-1', qbo_reference: 'CHK-9' }),
      row('c', 'paid', 100, '2026-09-01T00:00:00Z'),
    ];
    const batches = paymentBatches(entries);
    expect(batches[0]).toMatchObject({ batchId: 'PAY-1', count: 2, total: 800, reference: 'CHK-9' });
    expect(batches[1]).toMatchObject({ batchId: '(single payment)', count: 1, total: 100 });
  });
});
