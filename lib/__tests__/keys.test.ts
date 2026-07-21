import { describe, expect, it } from 'vitest';
import { canTransition, nextStatus, DEFAULT_KEY_TEMPLATE } from '@/lib/keys';
import { buildUnitSnapshotMap, computeSyncFlag } from '@/lib/keys-sync';
import type { AppFolioPropertyWithCustomFields, AppFolioTenant, AppFolioUnit } from '@/lib/appfolio';
import type { KeySlotStatus, KeyTransitionAction } from '@/types/keys';

// ---------------------------------------------------------------------------
// State machine — the guard behind "never overwrite a key assignment"
// ---------------------------------------------------------------------------

describe('key state machine', () => {
  const LEGAL: Array<[KeySlotStatus, KeyTransitionAction, KeySlotStatus]> = [
    ['open', 'assign', 'assigned'],
    ['open', 'retire', 'retired'],
    ['assigned', 'mark_vacant', 'vacant'],
    ['assigned', 'release', 'open'],
    ['assigned', 'retire', 'retired'],
    ['vacant', 'reissue', 'assigned'],
    ['vacant', 'release', 'open'],
    ['vacant', 'retire', 'retired'],
    ['retired', 'reinstate', 'open'],
  ];

  it.each(LEGAL)('%s --%s--> %s', (from, action, to) => {
    expect(canTransition(from, action)).toBe(true);
    expect(nextStatus(from, action)).toBe(to);
  });

  const ILLEGAL: Array<[KeySlotStatus, KeyTransitionAction]> = [
    // Assigning an already-assigned or vacant key would overwrite the record.
    ['assigned', 'assign'],
    ['vacant', 'assign'],
    ['retired', 'assign'],
    // Reissue only makes sense from vacant.
    ['open', 'reissue'],
    ['assigned', 'reissue'],
    ['retired', 'reissue'],
    ['open', 'mark_vacant'],
    ['vacant', 'mark_vacant'],
    ['retired', 'mark_vacant'],
    ['open', 'release'],
    ['retired', 'release'],
    ['open', 'reinstate'],
    ['assigned', 'reinstate'],
    ['vacant', 'reinstate'],
    ['retired', 'retire'],
  ];

  it.each(ILLEGAL)('rejects %s --%s-->', (from, action) => {
    expect(canTransition(from, action)).toBe(false);
    expect(() => nextStatus(from, action)).toThrow(/Illegal key transition/);
  });
});

describe('default key template', () => {
  it('is 4 main copies: 2 tenant out, office copy + vendor loaner in office custody', () => {
    expect(DEFAULT_KEY_TEMPLATE).toHaveLength(1);
    expect(DEFAULT_KEY_TEMPLATE[0].label).toBe('Main');
    const holders = DEFAULT_KEY_TEMPLATE[0].copies.map((c) => c.holder_type);
    expect(holders).toEqual(['tenant', 'tenant', 'office', 'office']);
    const names = DEFAULT_KEY_TEMPLATE[0].copies.map((c) => c.holder_name ?? null);
    expect(names).toEqual([null, null, 'Office', 'Vendor loaner']);
  });
});

// ---------------------------------------------------------------------------
// Sync flags
// ---------------------------------------------------------------------------

function makeUnit(overrides: Partial<AppFolioUnit> = {}): AppFolioUnit {
  return {
    id: 'u1',
    propertyId: 'p1',
    address1: '123 Test St',
    address2: null,
    city: 'Bend',
    state: 'OR',
    zip: '97701',
    name: null,
    status: null,
    lastInspectedDate: null,
    ...overrides,
  };
}

function makeProperty(
  overrides: Partial<AppFolioPropertyWithCustomFields> = {}
): AppFolioPropertyWithCustomFields {
  return {
    appfolioPropertyId: 'p1',
    name: 'Test Property',
    address1: '123 Test St',
    address2: null,
    city: 'Bend',
    state: 'OR',
    zip: '97701',
    ownerName: 'Bramscher',
    useCustomInspectionDate: false,
    hidden: false,
    customValueNames: [],
    ...overrides,
  };
}

function makeTenant(overrides: Partial<AppFolioTenant> = {}): AppFolioTenant {
  return {
    id: 't1',
    firstName: 'Jane',
    lastName: 'Smith',
    propertyId: 'p1',
    unitId: 'u1',
    status: 'Current',
    moveInOn: '2025-01-01',
    moveOutOn: null,
    leaseStartDate: null,
    leaseEndDate: null,
    email: null,
    phone: null,
    address1: null,
    address2: null,
    city: null,
    currentRent: null,
    isPrimary: true,
  ...overrides,
  };
}

describe('buildUnitSnapshotMap', () => {
  it('joins unit + property + active tenants', () => {
    const map = buildUnitSnapshotMap([makeProperty()], [makeUnit()], [makeTenant()]);
    const snap = map.get('u1')!;
    expect(snap.ownerName).toBe('Bramscher');
    expect(snap.propertyName).toBe('Test Property');
    expect(snap.tenantNames).toEqual(['Jane Smith']);
    expect(snap.occupied).toBe(true);
  });

  it('excludes moved-out and non-current tenants', () => {
    const map = buildUnitSnapshotMap(
      [makeProperty()],
      [makeUnit()],
      [
        makeTenant({ id: 't1', moveOutOn: '2026-01-01' }),
        makeTenant({ id: 't2', firstName: 'Old', status: 'Past' }),
      ]
    );
    const snap = map.get('u1')!;
    expect(snap.tenantNames).toEqual([]);
    expect(snap.occupied).toBe(false);
  });

  it('skips hidden properties', () => {
    const map = buildUnitSnapshotMap([makeProperty({ hidden: true })], [makeUnit()], []);
    expect(map.has('u1')).toBe(false);
  });
});

describe('computeSyncFlag', () => {
  const occupied = { occupied: true } as ReturnType<typeof buildUnitSnapshotMap> extends Map<string, infer V> ? V : never;
  const vacant = { occupied: false } as typeof occupied;

  it('flags occupied unit with vacant key', () => {
    expect(computeSyncFlag('vacant', occupied)).toBe('appfolio_occupied_but_key_vacant');
  });

  it('flags vacant unit with assigned key', () => {
    expect(computeSyncFlag('assigned', vacant)).toBe('appfolio_vacant_but_key_assigned');
  });

  it('flags missing unit', () => {
    expect(computeSyncFlag('assigned', undefined)).toBe('unit_missing');
  });

  it('no flag when they agree', () => {
    expect(computeSyncFlag('assigned', occupied)).toBeNull();
    expect(computeSyncFlag('vacant', vacant)).toBeNull();
  });
});
