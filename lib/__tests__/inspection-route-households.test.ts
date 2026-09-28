import { describe, expect, it } from 'vitest';
import { findHouseholdSource, householdAddressKey, hydrateRouteHouseholds, type HouseholdProperty } from '../inspection-route-households';
import type { SupabaseClient } from '@supabase/supabase-js';

const synced: HouseholdProperty = { name: 'Example 276', address_1: '4518 SW 37th St', city: 'Redmond', zip: '97756', appfolio_unit_id: 'uuid', financially_responsible_occupants: ['Resident A'], pets: [] };
describe('legacy route household resolution', () => {
  it('matches imported property labels and full-address CSV cells to the same unit', () => {
    expect(findHouseholdSource({ ...synced, appfolio_unit_id: null, address_1: '4518 SW 37th St.', address_2: 'Example 276' }, [synced])).toBe(synced);
    expect(findHouseholdSource({ address_1: 'Example 276 - 4518 SW 37th Street Redmond, OR 97756', city: 'Redmond', zip: '97756' }, [synced])).toBe(synced);
  });
  it('does not discard real unit numbers or match ambiguous multi-unit addresses', () => {
    expect(findHouseholdSource({ ...synced, appfolio_unit_id: null, address_2: 'Unit B' }, [synced])).toBeNull();
    expect(findHouseholdSource({ ...synced, appfolio_unit_id: null }, [synced, { ...synced, appfolio_unit_id: 'other' }])).toBeNull();
    expect(householdAddressKey({address_1: '4518 SW 37th St'})).toBeNull();
  });
  it('treats a known AppFolio unit ID as authoritative instead of matching an address to another unit', () => {
    expect(findHouseholdSource({ ...synced, appfolio_unit_id: 'wrong' }, [synced])).toBeNull();
    expect(findHouseholdSource({ appfolio_unit_id: 'uuid' }, [synced])).toBe(synced);
  });
  it('resolves a building-level CSV row only when its current resident uniquely identifies a unit in that building', () => {
    const building = { address_1: 'Example Duplex - 2318-2320 SW 29th Street Redmond, OR 97756', city: 'Redmond', zip: '97756' };
    const sources = [
      { ...synced, name: 'Example Duplex', address_1: '2320 SW 29th Street', resident_name: 'Alexx Elder' },
      { ...synced, name: 'Example Duplex', address_1: '2318 SW 29th Street', appfolio_unit_id: 'second', resident_name: 'Someone Else' },
    ];
    expect(findHouseholdSource(building, sources, 'Elder, Alexx M.')).toBe(sources[0]);
    expect(findHouseholdSource(building, sources, 'Former Resident')).toBeNull();
    expect(findHouseholdSource(building, [...sources, { ...sources[0], appfolio_unit_id: 'third' }], 'Elder, Alexx M.')).toBeNull();
  });
  it('hydrates legacy route stops without changing their property IDs or saved inspection history', async () => {
    const property = { ...synced, id: 'legacy', appfolio_unit_id: null, financially_responsible_occupants: null, pets: null };
    const query = { select: () => query, not: () => query, order: () => query, range: async () => ({ data: [synced] }) };
    await hydrateRouteHouseholds({ from: () => query } as unknown as SupabaseClient, [{ inspections: { inspection_properties: property } }]);
    expect(property).toMatchObject({id: 'legacy', appfolio_unit_id: null, financially_responsible_occupants: ['Resident A'], pets: []});
  });
});
