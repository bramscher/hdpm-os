import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAppFolioTenants } from '../appfolio';
import type { AppFolioPropertyWithCustomFields, AppFolioUnit } from '../appfolio';
import { joinPropertiesUnitsTenants } from '../inspection-candidates';
import { formatInspectionOccupants, formatInspectionPets } from '../inspection-household';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('inspection household sync', () => {
  it('maps AppFolio fields and joins only current occupants and their pets to the correct unit', async () => {
    vi.stubEnv('APPFOLIO_CLIENT_ID', 'test');
    vi.stubEnv('APPFOLIO_CLIENT_SECRET', 'test');
    vi.stubEnv('APPFOLIO_DEVELOPER_ID', 'test');
    const dog = { Name: 'Rex', Type: 'Dog', Age: 3, Weight: 40 };
    const cat = { Name: 'Milo', Type: 'Cat', Age: null, Weight: null };
    const tenant = { UnitId: 'u1', PropertyId: 'p1', Status: 'Current', MoveInOn: '2025-01-01', TenantType: 'Financially Responsible', LastName: 'Example', Pets: [dog] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { ...tenant, Id: 'a', FirstName: 'Alex', PrimaryTenant: true },
      { ...tenant, Id: 'b', FirstName: 'Sam', PrimaryTenant: false },
      { ...tenant, Id: 'c', FirstName: 'Child', TenantType: 'Other Occupant', Pets: [cat] },
      { ...tenant, Id: 'd', FirstName: 'Former', Status: 'Past', Pets: [{ Name: 'Old pet' }] },
      { ...tenant, Id: 'e', FirstName: 'Hidden', HiddenAt: '2026-01-01' },
      { ...tenant, Id: 'f', FirstName: 'Neighbor', UnitId: 'u2' },
    ] }))));
    const tenants = await fetchAppFolioTenants();
    const joined = joinPropertiesUnitsTenants(
      [{ appfolioPropertyId: 'p1', address1: '1 Test St', city: 'Bend', zip: '97701' } as AppFolioPropertyWithCustomFields],
      [{ id: 'u1', propertyId: 'p1', lastInspectedDate: null } as AppFolioUnit],
      tenants, new Date('2026-09-28'),
    );
    expect(joined[0].financiallyResponsibleOccupants).toEqual(['Alex Example', 'Sam Example']);
    expect(joined[0].pets).toEqual([
      { name: 'Rex', type: 'Dog', age: 3, weight: 40 },
      { name: 'Milo', type: 'Cat', age: null, weight: null },
    ]);
    expect(joined[0].classification).toBe('eligible');
  });

  it('distinguishes missing data from a confirmed empty list', () => {
    expect(formatInspectionPets(null)).toBe('Not available');
    expect(formatInspectionPets([])).toBe('None recorded');
    expect(formatInspectionOccupants(null)).toBe('Not available');
    expect(formatInspectionOccupants([])).toBe('None recorded');
  });
});
