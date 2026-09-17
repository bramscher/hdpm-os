import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { scrapeZillowListings, getZillowSearchUrl } from '@/lib/zillow';
import { ALL_TOWNS, detectCompTown } from '@/types/comps';

/**
 * GET /api/comps/zillow?town=Bend&bedrooms=3
 *
 * Scrape Zillow rental listings for a given town.
 * Returns listings + fallback URL if scraping fails.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const town = detectCompTown(request.nextUrl.searchParams.get('town') ?? '');
    const bedroomsStr = request.nextUrl.searchParams.get('bedrooms');
    const bedrooms = bedroomsStr ? parseInt(bedroomsStr, 10) : undefined;

    if (!town) {
      return NextResponse.json(
        { error: `Valid town required (${ALL_TOWNS.join(', ')})` },
        { status: 400 }
      );
    }

    const result = await scrapeZillowListings(town, bedrooms);

    return NextResponse.json({
      listings: result.listings,
      zillow_url: result.zillow_url,
      scraped: result.scraped,
      count: result.listings.length,
    });
  } catch (error) {
    console.error('[API] Zillow search error:', error);
    const town = detectCompTown((new URL(request.url)).searchParams.get('town') ?? '') || 'Bend';
    return NextResponse.json({
      listings: [],
      zillow_url: getZillowSearchUrl(town),
      scraped: false,
      error: 'Scraping failed. Use the Zillow URL to search manually.',
    });
  }
}
