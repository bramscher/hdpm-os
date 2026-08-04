import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { scrapeZillowListings, getZillowSearchUrl } from '@/lib/zillow';
import type { Town } from '@/types/comps';

const VALID_TOWNS: Town[] = ['Bend', 'Redmond', 'Sisters', 'Prineville', 'Culver'];

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

    const town = request.nextUrl.searchParams.get('town') as Town | null;
    const bedroomsStr = request.nextUrl.searchParams.get('bedrooms');
    const bedrooms = bedroomsStr ? parseInt(bedroomsStr, 10) : undefined;

    if (!town || !VALID_TOWNS.includes(town)) {
      return NextResponse.json(
        { error: 'Valid town required (Bend, Redmond, Sisters, Prineville, Culver)' },
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
    const town = (new URL(request.url)).searchParams.get('town') as Town || 'Bend';
    return NextResponse.json({
      listings: [],
      zillow_url: getZillowSearchUrl(town),
      scraped: false,
      error: 'Scraping failed. Use the Zillow URL to search manually.',
    });
  }
}
