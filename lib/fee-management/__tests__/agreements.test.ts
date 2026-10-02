import { describe, expect, it } from 'vitest';
import {
  agreementError,
  agreementRows,
  monthDay,
  monthDayKey,
  parseAgreement,
  sortAgreementRows,
  type Agreement,
  type FeeFacts,
  type PropertyFact,
} from '../model';

const TODAY = '2026-10-02';

const prop = (over: Partial<PropertyFact> & { id: string }): PropertyFact => ({
  name: over.id,
  address: '1 Main St, Bend',
  feeType: 'percent',
  feePct: 8,
  flatMonthly: null,
  feeStartDate: null,
  mgmtStartDate: null,
  doors: 1,
  occupiedDoors: 1,
  occupiedRentMonthly: 1500,
  ownerSetKey: 'o1',
  ...over,
});

const facts: FeeFacts = {
  properties: [
    prop({ id: 'p-entered', name: 'Cedar Creek', appfolioWebId: '123' }),
    prop({ id: 'p-projected', name: 'Aspen Court', mgmtStartDate: '2022-03-14', ownerSetKey: 'o2' }),
    prop({ id: 'p-none', name: 'Birch House', ownerSetKey: 'unlinked:p-none' }),
  ],
  ownerSets: [
    { key: 'o1', name: 'Smith', owners: [{ id: 'a', name: 'Ann Smith', email: null, phone: null, percentOwned: 50 }, { id: 'b', name: 'Bob Smith', email: null, phone: null, percentOwned: 50 }] },
    { key: 'o2', name: 'Jones LLC', owners: [] },
  ],
};

const agreements: Agreement[] = [
  { propertyId: 'p-entered', startDate: '2023-01-01', endDate: '2023-12-31', autoRenew: true, noticeDays: 60, notes: null, agreementUrl: 'https://highdesertpm.appfolio.com/attachments/9', lastRenewedOn: '2025-12-31' },
];

describe('day and month without the year', () => {
  it('formats and sorts renewal days in calendar order', () => {
    expect(monthDay('2026-03-14')).toBe('Mar 14');
    expect(monthDay('2028-02-29')).toBe('Feb 29');
    expect(monthDay(null)).toBe('');
    expect(monthDayKey('2031-12-01')).toBe('12-01');
    expect(['2027-12-01', '2026-01-15', '2026-07-04'].map(monthDayKey).sort()).toEqual(['01-15', '07-04', '12-01']);
  });
});

describe('agreement edits', () => {
  const base = { propertyId: 'p', startDate: null, endDate: null, autoRenew: true, noticeDays: null, notes: null };

  it('accepts a link into AppFolio and a past renewed date', () => {
    expect(parseAgreement({ ...base, agreementUrl: 'https://highdesertpm.appfolio.com/attachments/9', lastRenewedOn: '2025-06-01' }, TODAY)).toMatchObject({
      agreementUrl: 'https://highdesertpm.appfolio.com/attachments/9',
      lastRenewedOn: '2025-06-01',
    });
  });

  it('rejects links outside AppFolio and future renewed dates, with a useful message', () => {
    for (const url of ['https://evil.example.com/x', 'http://highdesertpm.appfolio.com/x', 'javascript:alert(1)', 'https://highdesertpm.appfolio.com.evil.com/']) {
      expect(parseAgreement({ ...base, agreementUrl: url }, TODAY)).toBeNull();
    }
    expect(agreementError({ ...base, agreementUrl: 'https://example.com' }, TODAY)).toContain('link into AppFolio');
    expect(parseAgreement({ ...base, lastRenewedOn: '2027-01-01' }, TODAY)).toBeNull();
    expect(agreementError({ ...base, lastRenewedOn: '2027-01-01' }, TODAY)).toContain('future');
  });

  it('leaves document fields untouched when the edit omits them', () => {
    const parsed = parseAgreement(base, TODAY)!;
    expect('agreementUrl' in parsed).toBe(false);
    expect('lastRenewedOn' in parsed).toBe(false);
    expect(parseAgreement({ ...base, agreementUrl: '', lastRenewedOn: '' }, TODAY)).toMatchObject({ agreementUrl: null, lastRenewedOn: null });
  });
});

describe('agreement rows', () => {
  const rows = agreementRows(facts, agreements, TODAY);
  const byId = Object.fromEntries(rows.map((r) => [r.propertyId, r]));

  it('rolls an auto-renewing entered end date forward and links the agreement and property', () => {
    expect(byId['p-entered']).toMatchObject({
      ownerNames: 'Ann Smith, Bob Smith',
      expiresMonthDay: 'Dec 31',
      projected: false,
      missingLink: false,
      missingRenewedDate: false,
      appfolioPropertyUrl: 'https://highdesertpm.appfolio.com/properties/123',
    });
    expect(byId['p-entered'].renewal).toMatchObject({ date: '2026-12-31', noticeBy: '2026-11-01' });
  });

  it('projects from the AppFolio start date when no end date is entered, and flags what is missing', () => {
    expect(byId['p-projected']).toMatchObject({ ownerNames: 'Jones LLC', expiresMonthDay: 'Mar 14', projected: true, missingLink: true, missingRenewedDate: true, appfolioPropertyUrl: null });
    expect(byId['p-projected'].renewal?.date).toBe('2027-03-14');
    expect(byId['p-none']).toMatchObject({ renewal: null, expiresMonthDay: '', projected: true });
  });

  it('sorts by next expiration or calendar day, with unknown dates last', () => {
    expect(sortAgreementRows(rows, 'expiration').map((r) => r.propertyId)).toEqual(['p-entered', 'p-projected', 'p-none']);
    expect(sortAgreementRows(rows, 'monthDay').map((r) => r.propertyId)).toEqual(['p-projected', 'p-entered', 'p-none']);
    expect(sortAgreementRows(rows, 'expiration', 'desc').map((r) => r.propertyId)).toEqual(['p-projected', 'p-entered', 'p-none']);
  });
});
