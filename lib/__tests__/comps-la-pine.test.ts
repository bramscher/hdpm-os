import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_TOWNS, detectCompTown } from '@/types/comps';
import { lookupAddress } from '../address-lookup';
import { getZillowSearchUrl } from '../zillow';

vi.mock('../rentcast', () => ({ getPropertyRecords: vi.fn().mockResolvedValue(null) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('La Pine rent comps', () => {
  it.each(['La Pine', 'Lapine', ' la PINE ', 'La  Pine'])('recognizes %s as La Pine', (city) => {
    expect(detectCompTown(city)).toBe('La Pine');
  });

  it('preserves existing towns and rejects places outside the service area', () => {
    for (const town of ALL_TOWNS) expect(detectCompTown(town)).toBe(town);
    expect(detectCompTown('Portland')).toBeNull();
    expect(detectCompTown('')).toBeNull();
  });

  it('returns a recognized service-area town from a geocoded La Pine address', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({
      status: 'OK', results: [{
        formatted_address: '123 Example St, La Pine, OR 97739, USA',
        address_components: [
          { long_name: 'La Pine', short_name: 'La Pine', types: ['locality'] },
          { long_name: 'Oregon', short_name: 'OR', types: ['administrative_area_level_1'] },
          { long_name: '97739', short_name: '97739', types: ['postal_code'] },
        ],
        geometry: { location: { lat: 43.67, lng: -121.50 }, location_type: 'ROOFTOP' },
      }],
    }) }));
    const result = await lookupAddress('123 Example St, Lapine, OR');
    expect(result?.town).toBe('La Pine');
    expect(result?.zip).toBe('97739');
  });

  it('links competing rentals to La Pine rather than Bend', () => {
    expect(getZillowSearchUrl('La Pine', 3)).toBe('https://www.zillow.com/la-pine-or/rentals/3-_beds/');
  });
});
