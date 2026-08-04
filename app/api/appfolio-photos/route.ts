import { NextRequest, NextResponse } from 'next/server';

const APPFOLIO_V0_BASE = 'https://api.appfolio.com/api/v0';

export interface UnitPhoto {
  id: string;
  url: string;
  thumbnail_url: string;
  caption: string;
  is_primary: boolean;
}

interface V0Photo {
  Id: string;
  Url: string;
  Position?: number;
  ContentType?: string;
  PropertyId?: string;
  UnitId?: string;
}

interface V0PhotoResponse {
  data: V0Photo[];
  next_page_path?: string | null;
}

function getAuth() {
  const clientId = process.env.APPFOLIO_CLIENT_ID;
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET;
  const developerId = process.env.APPFOLIO_DEVELOPER_ID;

  if (!clientId || !clientSecret || !developerId) {
    throw new Error('AppFolio API credentials not configured');
  }

  return {
    auth: Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    developerId,
  };
}

async function v0PhotoFetch(path: string, params: Record<string, string>): Promise<V0PhotoResponse> {
  const { auth, developerId } = getAuth();
  const url = new URL(`${APPFOLIO_V0_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
      'X-AppFolio-Developer-ID': developerId,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`AppFolio photo API error: ${response.status}`);
  }

  return response.json() as Promise<V0PhotoResponse>;
}

// Craigslist's image uploader accepts at most 24 photos per post.
const MAX_PHOTOS = 24;

function v0PhotosToUnitPhotos(v0Photos: V0Photo[]): UnitPhoto[] {
  const seen = new Set<string>();
  return v0Photos
    .filter((p) => {
      if (!p.Url || seen.has(p.Id)) return false;
      seen.add(p.Id);
      return true;
    })
    // AppFolio gallery order first (Position, unpositioned last) so the cap
    // keeps the photos the office arranged, not arbitrary API order.
    .sort((a, b) => (a.Position ?? Number.MAX_SAFE_INTEGER) - (b.Position ?? Number.MAX_SAFE_INTEGER))
    .slice(0, MAX_PHOTOS)
    .map((p, i) => ({
      id: p.Id,
      url: p.Url,
      thumbnail_url: p.Url, // S3 URLs — no separate thumbnail
      caption: '',
      is_primary: (p.Position ?? i) === 1 || i === 0,
    }));
}

/**
 * Fetches photos for an AppFolio unit using the v0 Database API.
 *
 * Decision tree (per AppFolio docs):
 * 1. Property photos — works for all property types
 * 2. Marketing photos — multi-family only (404 for single-family)
 * 3. Unit photos — fallback if property-level returns nothing
 *    (returns 422 for single-family — catch and skip)
 */
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get('property_id');
  const unitId = req.nextUrl.searchParams.get('unit_id');

  if (!propertyId && !unitId) {
    return NextResponse.json(
      { error: 'property_id or unit_id query parameter required' },
      { status: 400 }
    );
  }

  try {
    const photos: V0Photo[] = [];

    // Step 1: Property photos (always works)
    if (propertyId) {
      try {
        const res = await v0PhotoFetch('/properties/photos', {
          'filters[PropertyId]': propertyId,
          'page[number]': '1',
          'page[size]': '1000',
        });
        photos.push(...(res.data || []));
      } catch (err) {
        console.warn('[appfolio-photos] Property photos error:', err);
      }
    }

    // Step 2: Marketing photos (multi-family only)
    if (propertyId) {
      try {
        const res = await v0PhotoFetch('/properties/marketing-photos', {
          'filters[PropertyId]': propertyId,
          'page[number]': '1',
          'page[size]': '1000',
        });
        photos.push(...(res.data || []));
      } catch {
        // 404 for single-family — expected, ignore
      }
    }

    // Step 3: Unit photos fallback if nothing found at property level
    if (photos.length === 0 && unitId) {
      try {
        const res = await v0PhotoFetch('/units/photos', {
          'filters[UnitId]': unitId,
          'page[number]': '1',
          'page[size]': '1000',
        });
        photos.push(...(res.data || []));
      } catch {
        // 422 for single-family — expected, ignore
      }
    }

    const result = v0PhotosToUnitPhotos(photos);
    console.log(`[appfolio-photos] Found ${result.length} photos (property=${propertyId}, unit=${unitId})`);

    return NextResponse.json({ photos: result });
  } catch (err) {
    console.error('[appfolio-photos] Error:', err);
    return NextResponse.json({ photos: [] });
  }
}
