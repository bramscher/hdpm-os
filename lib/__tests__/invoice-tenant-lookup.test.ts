import { describe, expect, it } from 'vitest';
import { matchTenantUnits, normalizeUnit, streetNumber, type TenantUnitRow } from '../invoice-tenant-lookup';

const row = (over: Partial<TenantUnitRow>): TenantUnitRow => ({
  address_1: '2800 SW 23rd St', address_2: '#7', city: 'Redmond', resident_name: 'Lorenzo Perez',
  financially_responsible_occupants: ['Lorenzo Perez', 'Kristin MacEwan'], last_appfolio_sync_at: '2026-10-07T09:30:00Z', active: true, ...over,
});

describe('invoice tenant lookup', () => {
  it('normalizes units and finds the street number', () => {
    expect(normalizeUnit('Unit 7')).toBe('7');
    expect(normalizeUnit('#7')).toBe('7');
    expect(normalizeUnit('Apt. B')).toBe('b');
    expect(streetNumber('23rd St Complex - 2800 SW 23rd St Redmond, OR 97756')).toBe('2800');
  });
  it('fills the lease names for the matching unit', () => {
    const rows = [row({}), row({ address_2: '#8', financially_responsible_occupants: ['Someone Else'] })];
    const m = matchTenantUnits('2800 SW 23rd St, Redmond, OR 97756', 'Unit 7', rows);
    expect(m).toEqual([expect.objectContaining({ tenantName: 'Lorenzo Perez, Kristin MacEwan', unit: '#7' })]);
  });
  it('matches the legacy "Name - address" format and offers every household when the unit is unknown', () => {
    const rows = [row({}), row({ address_2: '#8', financially_responsible_occupants: ['Someone Else'] })];
    expect(matchTenantUnits('23rd St Complex - 2800 SW 23rd St Redmond, OR 97756', '', rows)).toHaveLength(2);
  });
  it('falls back to the primary contact, and ignores other streets and inactive units', () => {
    const rows = [
      row({ financially_responsible_occupants: null }),
      row({ address_1: '2800 NE 23rd St', resident_name: 'Wrong Street' }),
      row({ address_2: '#9', active: false }),
    ];
    expect(matchTenantUnits('2800 SW 23rd St, Redmond', '#7', rows).map((m) => m.tenantName)).toEqual(['Lorenzo Perez']);
  });
});
