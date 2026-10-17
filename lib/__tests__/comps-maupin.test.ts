import { describe, expect, it } from 'vitest';
import { ALL_TOWNS, detectCompTown } from '@/types/comps';
import { getZillowSearchUrl } from '../zillow';
import { rentalListingsToComps } from '../rentcast-comps';
import type { RentCastListing } from '../rentcast';

describe('Maupin rent comps', () => {
  it.each(['Maupin', ' maupin ', 'MAUPIN'])('recognizes %s as Maupin', (city) => {
    expect(detectCompTown(city)).toBe('Maupin');
  });

  it('is offered alongside the existing towns', () => {
    expect(ALL_TOWNS).toContain('Maupin');
    expect(detectCompTown('The Dalles')).toBeNull();
  });

  it('links competing rentals to Maupin', () => {
    expect(getZillowSearchUrl('Maupin', 2)).toBe('https://www.zillow.com/maupin-or/rentals/2-_beds/');
  });

  it('files RentCast listings in Maupin under Maupin', () => {
    const listing = {
      id: 'abc', lastSeenDate: '2026-10-10', formattedAddress: '401 Deschutes Ave, Maupin, OR 97037',
      city: 'Maupin', state: 'OR', zipCode: '97037', status: 'Active', price: 1500,
      bedrooms: 2, bathrooms: 1, squareFootage: 900, propertyType: 'Single Family',
    } as RentCastListing;
    const [row] = rentalListingsToComps([listing], 'Maupin', 'test@highdesertpm.com');
    expect(row).toMatchObject({ town: 'Maupin', zip_code: '97037', monthly_rent: 1500 });
  });
});
