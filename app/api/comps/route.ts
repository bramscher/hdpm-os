import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createComp, getComps } from '@/lib/comps';
import type { CompsFilter, Town, PropertyType, DataSource } from '@/types/comps';

/**
 * GET /api/comps
 *
 * Fetch filtered list of rental comps.
 * Query params: towns, bedrooms, property_types, data_sources, date_from, date_to, rent_min, rent_max, amenities
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
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

    const comps = await getComps(filter);
    return NextResponse.json({ comps });
  } catch (error) {
    console.error('Get comps error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch comps';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/comps
 *
 * Create a manual comp entry.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in with your company Microsoft account.' },
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate required fields
    const { town, bedrooms, monthly_rent, property_type } = body;
    if (!town || bedrooms === undefined || !monthly_rent || !property_type) {
      return NextResponse.json(
        { error: 'town, bedrooms, monthly_rent, and property_type are required' },
        { status: 400 }
      );
    }

    const sqft = body.sqft ? Number(body.sqft) : undefined;
    const rent = Number(monthly_rent);

    const comp = await createComp({
      town: town as Town,
      address: body.address?.trim() || undefined,
      zip_code: body.zip_code?.trim() || undefined,
      bedrooms: Number(bedrooms),
      bathrooms: body.bathrooms ? Number(body.bathrooms) : undefined,
      sqft,
      property_type: property_type as PropertyType,
      amenities: body.amenities || [],
      monthly_rent: rent,
      rent_per_sqft: sqft && sqft > 0 ? Math.round((rent / sqft) * 10000) / 10000 : undefined,
      data_source: 'manual',
      comp_date: body.comp_date || new Date().toISOString().split('T')[0],
      notes: body.notes?.trim() || undefined,
      created_by: session.user.email!,
    });

    return NextResponse.json({ comp }, { status: 201 });
  } catch (error) {
    console.error('Create comp error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create comp';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
