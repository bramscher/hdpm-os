import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { quickView, getCacheExpiration, isSupportedCity } from '@/lib/rentometer';
import { createComp } from '@/lib/comps';

/**
 * POST /api/comps/rentometer
 *
 * On-demand Rentometer lookup for Bend & Redmond.
 * Caches the result as a rental comp with 30-day expiration.
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
    const { address, city, bedrooms } = body;

    if (!address || !city || bedrooms === undefined) {
      return NextResponse.json(
        { error: 'address, city, and bedrooms are required' },
        { status: 400 }
      );
    }

    if (!isSupportedCity(city)) {
      return NextResponse.json(
        { error: `Rentometer data is only available for Bend and Redmond` },
        { status: 400 }
      );
    }

    const result = await quickView(address, city, Number(bedrooms));
    if (!result) {
      return NextResponse.json(
        { error: 'Rentometer API is not configured or returned no data' },
        { status: 503 }
      );
    }

    // Cache median as a comp entry
    const comp = await createComp({
      town: city,
      address,
      bedrooms: Number(bedrooms),
      property_type: 'Other',
      monthly_rent: result.median,
      data_source: 'rentometer',
      comp_date: new Date().toISOString().split('T')[0],
      external_id: `rentometer-${city}-${bedrooms}bd-${Date.now()}`,
      rentometer_percentile: 50,
      rentometer_cached_until: getCacheExpiration(),
      notes: `Rentometer: mean=$${result.mean}, 25th=$${result.percentile_25}, 75th=$${result.percentile_75}, samples=${result.sample_size}`,
      created_by: session.user.email!,
    });

    return NextResponse.json({
      result,
      comp,
    });
  } catch (error) {
    console.error('Rentometer lookup error:', error);
    const message = error instanceof Error ? error.message : 'Rentometer lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
