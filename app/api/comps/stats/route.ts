import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCompsStats, getCompsByTown, getBaselines } from '@/lib/comps';
import type { CompsFilter, Town, PropertyType, DataSource } from '@/types/comps';

/**
 * GET /api/comps/stats
 *
 * Returns aggregated statistics + per-town breakdown + baselines.
 * Accepts the same filter query params as GET /api/comps.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);

    const filter: CompsFilter = {};

    const towns = searchParams.get('towns');
    if (towns) filter.towns = towns.split(',') as Town[];

    const bedrooms = searchParams.get('bedrooms');
    if (bedrooms) filter.bedrooms = bedrooms.split(',').map(Number);

    const propertyTypes = searchParams.get('property_types');
    if (propertyTypes) filter.property_types = propertyTypes.split(',') as PropertyType[];

    const dataSources = searchParams.get('data_sources');
    if (dataSources) filter.data_sources = dataSources.split(',') as DataSource[];

    const amenities = searchParams.get('amenities');
    if (amenities) filter.amenities = amenities.split(',');

    const dateFrom = searchParams.get('date_from');
    if (dateFrom) filter.date_from = dateFrom;

    const dateTo = searchParams.get('date_to');
    if (dateTo) filter.date_to = dateTo;

    const rentMin = searchParams.get('rent_min');
    if (rentMin) filter.rent_min = Number(rentMin);

    const rentMax = searchParams.get('rent_max');
    if (rentMax) filter.rent_max = Number(rentMax);

    // Fetch stats, town breakdown, and baselines in parallel
    const [stats, townStats, baselines] = await Promise.all([
      getCompsStats(filter),
      getCompsByTown(filter),
      getBaselines(),
    ]);

    return NextResponse.json({ stats, townStats, baselines });
  } catch (error) {
    console.error('Get comps stats error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
