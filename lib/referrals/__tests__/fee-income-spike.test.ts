import { describe, it, expect } from 'vitest';
import { describeColumns, matchFeeAccount, monthRange, propertyLines, summarizeByProperty, toNumber } from '../fee-income-spike';

describe('matchFeeAccount', () => {
  it('matches management fee accounts only', () => {
    for (const n of ['Management Fees', 'Mgmt Fee - Residential', 'Mgmt. Fees', 'Property Management']) expect(matchFeeAccount(n), n).toBe(true);
    for (const n of ['Late Fee', 'Leasing Fee', 'Application Fees', 'Repairs', null, 42]) expect(matchFeeAccount(n), String(n)).toBe(false);
  });
});

describe('describeColumns', () => {
  it('finds account, amount, property and date columns across report shapes', () => {
    const bill = describeColumns([{ account_name: 'x', account_number: '6100', paid: '1', property_name: 'P', property_id: 7, payment_date: 'd' }]);
    expect(bill).toMatchObject({ account: 'account_name', accountNumber: 'account_number', amount: 'paid', propertyName: 'property_name', propertyId: 'property_id', date: 'payment_date' });
    const gl = describeColumns([{ gl_account_name: 'x', amount: 1, property: 'P', property_integration_id: 'uuid', date: 'd', description: 'm' }]);
    expect(gl).toMatchObject({ account: 'gl_account_name', amount: 'amount', propertyName: 'property', propertyIntegrationId: 'property_integration_id', date: 'date', description: 'description' });
  });
});

describe('summarizeByProperty', () => {
  const rows = [
    { account_name: 'Management Fees', account_number: '6900', paid: '120.00', property_name: 'Pine Ridge', property_id: 1 },
    { account_name: 'Management Fees', account_number: '6900', paid: '80.50', property_name: 'Pine Ridge', property_id: 1 },
    { account_name: 'Management Fees', account_number: '6900', paid: '(10.00)', property_name: 'Elm Court', property_id: 2 },
    { account_name: 'Repairs', account_number: '6100', paid: '999', property_name: 'Pine Ridge', property_id: 1 },
  ];
  it('totals fee lines by property, ignoring other accounts', () => {
    const s = summarizeByProperty(rows, describeColumns(rows));
    expect(s).toMatchObject({ rows: 4, feeRows: 3, properties: 2, total: 190.5, joinable: true });
    expect(s.matchedAccounts).toEqual([{ name: 'Management Fees', number: '6900', rows: 3, total: 190.5 }]);
    expect(s.topProperties[0]).toMatchObject({ property: 'Pine Ridge', total: 200.5, lines: 2 });
  });
  it('lists one property\'s fee lines for reconciling', () => {
    expect(propertyLines(rows, describeColumns(rows), 'pine')).toHaveLength(2);
  });
});

describe('helpers', () => {
  it('parses money strings', () => {
    expect(toNumber('$1,234.50')).toBe(1234.5);
    expect(toNumber('(10.00)')).toBe(-10);
    expect(toNumber(null)).toBe(0);
  });
  it('builds month ranges', () => {
    expect(monthRange('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-13')).toBeNull();
    expect(monthRange('sept')).toBeNull();
  });
});

describe('general_ledger debit/credit', () => {
  it('nets credits (reversals) against debits', () => {
    const rows = [
      { account_name: '5010 - Mgmt: Management Fee', debit: '500.00', credit: '0', property_name: 'A', property_integration_id: 'u1' },
      { account_name: '5010 - Mgmt: Management Fee', debit: '0', credit: '120.00', property_name: 'A', property_integration_id: 'u1' },
    ];
    const cols = describeColumns(rows);
    expect(cols).toMatchObject({ amount: 'debit', credit: 'credit' });
    expect(summarizeByProperty(rows, cols)).toMatchObject({ total: 380, feeRows: 2, properties: 1 });
  });
  it('leaves bill_detail (no credit column) alone', () => {
    expect(describeColumns([{ account_name: 'x', paid: '1' }]).credit).toBeNull();
  });
});
