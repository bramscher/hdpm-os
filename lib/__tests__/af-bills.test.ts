import { describe, it, expect } from 'vitest';
import { matchBill, type MatchTarget } from '../af-bills';

const invoice: MatchTarget = { id: 'inv-41', invoice_number: 41, wo_reference: null };
const credit: MatchTarget = { id: 'cr-42', invoice_number: 42, wo_reference: null };
const woInvoice: MatchTarget = { id: 'inv-7', invoice_number: 7, wo_reference: '41548-1' };

const byNumber = new Map<number, MatchTarget>([
  [41, invoice],
  [42, credit],
  [7, woInvoice],
]);
const byWoRef = new Map<string, MatchTarget[]>([['41548-1', [woInvoice]]]);

const match = (reference: string, description = '') =>
  matchBill({ reference, description }, byNumber, byWoRef);

describe('matchBill — reference by document number', () => {
  it('matches a normal invoice by HDMS-INV- code', () => {
    expect(match('HDMS-INV-000041')).toEqual({ invoiceId: 'inv-41', method: 'reference' });
  });

  it('matches a credit memo by its HDMS-CR- code (the v2 negative-bill path)', () => {
    expect(match('HDMS-CR-000042')).toEqual({ invoiceId: 'cr-42', method: 'reference' });
  });

  it('matches a bare number to whichever document holds it (shared sequence)', () => {
    expect(match('000042')).toEqual({ invoiceId: 'cr-42', method: 'reference' });
    expect(match('41')).toEqual({ invoiceId: 'inv-41', method: 'reference' });
  });

  it('is case-insensitive on the prefix', () => {
    expect(match('hdms-cr-000042')).toEqual({ invoiceId: 'cr-42', method: 'reference' });
  });

  it('falls through to WO matching for a 5+-digit reference (not a doc number)', () => {
    expect(match('41548-1')).toEqual({ invoiceId: 'inv-7', method: 'wo_reference' });
  });

  it('returns null for an unknown number', () => {
    expect(match('HDMS-CR-000099')).toBeNull();
  });
});
