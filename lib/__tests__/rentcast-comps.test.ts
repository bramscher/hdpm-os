import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rentalListingsToComps, refreshRentCastComps } from '../rentcast-comps';
import { getRentalListings, type RentCastListing } from '../rentcast';
import { getSupabaseAdmin } from '../supabase';

vi.mock('../rentcast', () => ({ getRentalListings: vi.fn() }));
vi.mock('../supabase', () => ({ getSupabaseAdmin: vi.fn() }));

const listing: RentCastListing = {
  id: '123-example', formattedAddress: '123 Example St, La Pine, OR 97739',
  city: 'La Pine', state: 'OR', zipCode: '97739', bedrooms: 3, bathrooms: 2,
  squareFootage: 1500, propertyType: 'Single Family', price: 2100,
  status: 'Active', daysOnMarket: 5, lastSeenDate: '2026-09-15T12:00:00Z',
};
const query = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), limit: vi.fn(), upsert: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.gte.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null });
  query.upsert.mockResolvedValue({ error: null });
  vi.mocked(getSupabaseAdmin).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getSupabaseAdmin>);
  vi.mocked(getRentalListings).mockResolvedValue([listing]);
});

describe('rental listing imports', () => {
  it('preserves observed dates and asking-rent provenance, maps type, and deduplicates stable IDs', () => {
    const rows = rentalListingsToComps([listing, { ...listing, price: 2200 }], 'La Pine', 'test@highdesertpm.com');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ town: 'La Pine', monthly_rent: 2200, property_type: 'SFR',
      comp_date: '2026-09-15', data_source: 'rentcast', external_id: 'rentcast-rental-123-example' });
    expect(rows[0].notes).toContain('not a verified signed lease');
  });
  it('rejects wrong cities/states, inactive listings, unknown dates, and unusable rents or bedrooms', () => {
    const invalid = [{ city: 'Bend' }, { state: 'CA' }, { status: 'Inactive' }, { price: 0 },
      { price: NaN }, { bedrooms: -1 }, { bedrooms: 1.5 }, { lastSeenDate: undefined }, { id: undefined }];
    expect(rentalListingsToComps(invalid.map(x => ({ ...listing, ...x })), 'La Pine', 'test')).toEqual([]);
  });
  it('imports a missing town with an atomic upsert', async () => {
    expect(await refreshRentCastComps('La Pine', 'test')).toBe(1);
    expect(getRentalListings).toHaveBeenCalledWith({ city: 'La Pine', state: 'OR', status: 'Active', limit: 500 }, true);
    expect(query.upsert).toHaveBeenCalledWith(expect.any(Array), { onConflict: 'external_id' });
  });
  it('reuses recently fetched listings without another paid lookup', async () => {
    query.limit.mockResolvedValue({ data: [{ id: 'existing' }], error: null });
    expect(await refreshRentCastComps('La Pine', 'test')).toBe(0);
    expect(getRentalListings).not.toHaveBeenCalled();
  });
  it('leaves existing data alone when the provider fails', async () => {
    vi.mocked(getRentalListings).mockRejectedValue(new Error('Provider unavailable'));
    await expect(refreshRentCastComps('La Pine', 'test')).rejects.toThrow('Provider unavailable');
    expect(query.upsert).not.toHaveBeenCalled();
  });
  it('reports a database failure instead of claiming the import succeeded', async () => {
    query.upsert.mockResolvedValue({ error: { message: 'write failed' } });
    await expect(refreshRentCastComps('La Pine', 'test')).rejects.toThrow('write failed');
  });
});
