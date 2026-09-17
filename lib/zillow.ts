/**
 * Zillow Rental Listings Scraper
 *
 * Fetches competing rental listings from Zillow for a given town and bedroom count.
 * Strategy: fetch Zillow search page, parse embedded __NEXT_DATA__ JSON.
 * Falls back to generating a search URL if scraping fails.
 *
 * Zillow actively blocks server-side scraping, so this degrades gracefully.
 */

import type { CompetingListing, Town } from '@/types/comps';

// ============================================
// Zillow Search URL Generation
// ============================================

const ZILLOW_SLUGS: Record<Town, string> = {
  Bend: 'bend-or',
  Redmond: 'redmond-or',
  Sisters: 'sisters-or',
  Prineville: 'prineville-or',
  Culver: 'culver-or',
  'La Pine': 'la-pine-or',
};

/**
 * Generate a Zillow rental search URL for manual browsing.
 */
export function getZillowSearchUrl(town: Town, bedrooms?: number): string {
  const slug = ZILLOW_SLUGS[town] || `${town.toLowerCase()}-or`;
  const bedsParam = bedrooms ? `${bedrooms}-_beds/` : '';
  return `https://www.zillow.com/${slug}/rentals/${bedsParam}`;
}

// ============================================
// Zillow Scraping
// ============================================

interface ZillowListingRaw {
  address?: string;
  streetAddress?: string;
  addressStreet?: string;
  addressCity?: string;
  addressState?: string;
  addressZipcode?: string;
  price?: string | number;
  unformattedPrice?: number;
  rentZestimate?: number;
  beds?: number;
  bedrooms?: number;
  baths?: number;
  bathrooms?: number;
  area?: number;
  livingArea?: number;
  sqft?: number;
  detailUrl?: string;
  url?: string;
  statusText?: string;
  timeOnZillow?: string;
  hdpUrl?: string;
}

/**
 * Attempt to scrape Zillow rental listings for a town + bedroom count.
 * Returns listings if successful, empty array if blocked/failed.
 */
export async function scrapeZillowListings(
  town: Town,
  bedrooms?: number
): Promise<{ listings: CompetingListing[]; zillow_url: string; scraped: boolean }> {
  const zillowUrl = getZillowSearchUrl(town, bedrooms);

  try {
    // Fetch Zillow search page with browser-like headers
    const res = await fetch(zillowUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
    });

    if (!res.ok) {
      console.warn(`[Zillow] HTTP ${res.status} fetching ${zillowUrl}`);
      return { listings: [], zillow_url: zillowUrl, scraped: false };
    }

    const html = await res.text();

    // Try to extract __NEXT_DATA__ JSON from the page
    const listings = parseZillowHtml(html, town);

    if (listings.length > 0) {
      console.log(`[Zillow] Scraped ${listings.length} listings for ${town}`);
      return { listings, zillow_url: zillowUrl, scraped: true };
    }

    console.warn('[Zillow] No listings extracted from HTML');
    return { listings: [], zillow_url: zillowUrl, scraped: false };
  } catch (err) {
    console.error('[Zillow] Scrape error:', err);
    return { listings: [], zillow_url: zillowUrl, scraped: false };
  }
}

/**
 * Parse Zillow HTML for listing data from embedded JSON.
 */
function parseZillowHtml(html: string, town: Town): CompetingListing[] {
  const listings: CompetingListing[] = [];
  const now = new Date().toISOString();

  try {
    // Strategy 1: Extract __NEXT_DATA__ script tag
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );

    if (nextDataMatch) {
      const json = JSON.parse(nextDataMatch[1]);
      const searchResults =
        json?.props?.pageProps?.searchPageState?.cat1?.searchResults
          ?.listResults || [];

      for (const result of searchResults.slice(0, 20)) {
        const price = parsePrice(result.unformattedPrice || result.price);
        if (!price || price <= 0) continue;

        listings.push({
          address: result.address || result.addressStreet || 'Unknown',
          price,
          bedrooms: result.beds || 0,
          bathrooms: result.baths || undefined,
          sqft: result.area || undefined,
          listing_url: result.detailUrl
            ? `https://www.zillow.com${result.detailUrl}`
            : result.hdpUrl || undefined,
          source: 'zillow',
          days_on_market: parseDaysOnMarket(result.timeOnZillow),
          fetched_at: now,
        });
      }
    }

    // Strategy 2: Look for JSON-LD or other embedded data
    if (listings.length === 0) {
      const scriptTags = html.match(
        /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g
      );

      if (scriptTags) {
        for (const tag of scriptTags) {
          try {
            const content = tag.replace(/<\/?script[^>]*>/g, '');
            const data = JSON.parse(content);

            // Look for array of listing-like objects
            const items = findListingArray(data);
            if (items && items.length > 0) {
              for (const item of items.slice(0, 20)) {
                const price = parsePrice(
                  item.price || item.unformattedPrice || item.rentZestimate
                );
                if (!price || price <= 0) continue;

                listings.push({
                  address: item.address || item.streetAddress || 'Unknown',
                  price,
                  bedrooms: item.beds || item.bedrooms || 0,
                  bathrooms: item.baths || item.bathrooms || undefined,
                  sqft: item.area || item.livingArea || item.sqft || undefined,
                  listing_url: item.detailUrl || item.url || item.hdpUrl || undefined,
                  source: 'zillow',
                  fetched_at: now,
                });
              }
              break;
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      }
    }
  } catch (err) {
    console.error('[Zillow] HTML parse error:', err);
  }

  return listings;
}

// ============================================
// Parse Helpers
// ============================================

function parsePrice(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return Number.isNaN(num) ? 0 : num;
  }
  return 0;
}

function parseDaysOnMarket(val: unknown): number | undefined {
  if (!val) return undefined;
  const str = String(val);
  const match = str.match(/(\d+)\s*day/i);
  if (match) return parseInt(match[1], 10);
  if (str.toLowerCase().includes('today') || str.includes('< 1')) return 0;
  return undefined;
}

/**
 * Recursively search a JSON object for an array that looks like listings.
 */
function findListingArray(obj: unknown, depth = 0): ZillowListingRaw[] | null {
  if (depth > 5) return null;
  if (Array.isArray(obj)) {
    // Check if items look like listings (have price or beds fields)
    if (
      obj.length > 0 &&
      typeof obj[0] === 'object' &&
      obj[0] !== null &&
      ('price' in obj[0] || 'unformattedPrice' in obj[0] || 'beds' in obj[0])
    ) {
      return obj as ZillowListingRaw[];
    }
  }
  if (typeof obj === 'object' && obj !== null) {
    for (const value of Object.values(obj)) {
      const result = findListingArray(value, depth + 1);
      if (result) return result;
    }
  }
  return null;
}
