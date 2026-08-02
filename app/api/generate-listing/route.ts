import { NextRequest, NextResponse } from 'next/server';

const AI_LEASING_PHONE = '(541) 406-6409';

// Rentzap apply pages live at /apply/<integer listing id> — Rentzap's own id,
// NOT our AppFolio unit UUID (those render an empty criteria page with no
// Apply button). The public feed below is the same unauthenticated Xano API
// Rentzap's site uses; we match our unit to their listing by street address
// and, for multi-unit buildings, by unit number from the detail endpoint.
const RENTZAP_FEED_URL = 'https://xdw0-sipj-awhp.n7.xano.io/api:bnW68mc9/public-listings';
const RENTZAP_DETAIL_URL = 'https://xdw0-sipj-awhp.n7.xano.io/api:9leauqIl/listings';
const RENTZAP_COMPANY_SLUG = 'highdesert';
// Public AppFolio listings page — applicants can still find the unit and apply
// there when we can't resolve a Rentzap listing id.
const APPLY_FALLBACK_URL = 'https://highdesertpm.appfolio.com/listings';

interface UnitInput {
  appfolio_unit_id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  bedrooms: number;
  bathrooms: number;
  rent: number;
  sqft: number;
  available_date: string;
  unit_type: string;
  amenities: string[];
  marketing_description: string;
}

interface GenerateRequest {
  unit: UnitInput;
  rently_enabled: boolean;
  rently_url: string;
}

interface RentzapListing {
  id: number;
  formatted_address: string | null;
  listing_rent_price: number | null;
  listing_is_on_market: boolean;
  is_draft: boolean;
  listing_is_demo: boolean;
  status: string;
  _providers?: { _provider_companies?: { slug?: string } };
}

/** Lowercase, strip punctuation, collapse whitespace. */
function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Match keys for an AppFolio unit address, most-specific first. AppFolio unit
 * addresses often carry a property nickname after the street ("2853 SW
 * Umatilla Ave Garabedian 2853 - 474") and abbreviate suffixes differently
 * than Rentzap ("Lp" vs "Loop"), so suffix-aware prefix matching is fragile.
 * The house number plus the next word (usually the directional) is selective
 * enough within one company's listings; house number alone is the fallback.
 */
function streetMatchKeys(addr: string): string[] {
  const words = normalizeAddress(addr.split('#')[0]).split(' ');
  const keys: string[] = [];
  if (words.length >= 2) keys.push(`${words[0]} ${words[1]}`);
  if (words[0]) keys.push(words[0]);
  return keys;
}

/** "171 SW C St. #7" → "7"; also handles "Unit 7" / "Apt 7". */
function extractUnitNumber(addr: string): string | null {
  const m = addr.match(/#\s*([\w-]+)/) || addr.match(/\b(?:unit|apt)\.?\s+([\w-]+)/i);
  return m ? m[1] : null;
}

/**
 * Resolve the Rentzap apply URL for a unit, or fall back to our public
 * AppFolio listings page with a warning the UI can surface.
 */
async function resolveApplyUrl(
  unit: UnitInput
): Promise<{ url: string; warning?: string }> {
  const fallback = (why: string) => ({
    url: APPLY_FALLBACK_URL,
    warning: `Couldn't find this unit's Rentzap apply link (${why}) — the listing links to the general AppFolio listings page instead. If the unit has a Rentzap listing, paste its apply link in manually.`,
  });

  try {
    const res = await fetch(RENTZAP_FEED_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fallback(`Rentzap feed returned ${res.status}`);
    const feed: RentzapListing[] = await res.json();

    const company = feed.filter(
      (l) =>
        l._providers?._provider_companies?.slug === RENTZAP_COMPANY_SLUG &&
        l.listing_is_on_market &&
        !l.is_draft &&
        !l.listing_is_demo &&
        l.status !== 'leased' &&
        l.formatted_address
    );

    let candidates: RentzapListing[] = [];
    for (const key of streetMatchKeys(unit.address)) {
      candidates = company.filter((l) =>
        normalizeAddress(l.formatted_address!).startsWith(`${key} `)
      );
      // House-number-only key is loose — require the city to agree too.
      if (candidates.length > 0 && unit.city) {
        const byCity = candidates.filter((l) =>
          normalizeAddress(l.formatted_address!).includes(normalizeAddress(unit.city))
        );
        if (byCity.length > 0) candidates = byCity;
      }
      if (candidates.length > 0) break;
    }

    if (candidates.length === 1) {
      return { url: `https://www.rentzap.com/apply/${candidates[0].id}` };
    }
    if (candidates.length === 0) return fallback('no listing matches this address');

    // Multi-unit building: disambiguate via the detail endpoint's unit number.
    const unitNumber = extractUnitNumber(unit.address);
    if (unitNumber) {
      const details = await Promise.all(
        candidates.slice(0, 6).map(async (c) => {
          try {
            const r = await fetch(`${RENTZAP_DETAIL_URL}/${c.id}`, {
              signal: AbortSignal.timeout(8000),
            });
            if (!r.ok) return null;
            const d = await r.json();
            return { id: c.id, unitNumber: d?._unit?.unit_number as string | undefined };
          } catch {
            return null;
          }
        })
      );
      const hit = details.find(
        (d) => d?.unitNumber?.toLowerCase() === unitNumber.toLowerCase()
      );
      if (hit) return { url: `https://www.rentzap.com/apply/${hit.id}` };
    }

    // Last resort: unique rent match among the candidates.
    const byRent = candidates.filter((c) => c.listing_rent_price === unit.rent);
    if (byRent.length === 1) {
      return { url: `https://www.rentzap.com/apply/${byRent[0].id}` };
    }

    return fallback('several Rentzap listings share this address');
  } catch {
    return fallback('Rentzap feed unreachable');
  }
}

function generateTitle(unit: UnitInput): string {
  const city = unit.city || 'Central Oregon';
  const type = unit.unit_type || 'Rental';
  const bed = unit.bedrooms;
  const bath = unit.bathrooms;

  const hasGarage = unit.amenities.some(
    (a) => a.toLowerCase().includes('garage')
  );

  const garageSuffix = hasGarage ? ', Garage' : '';
  const address = unit.address;

  return `${city} ${type} – ${bed}BR/${bath}BA${garageSuffix} - ${address}`;
}

/**
 * Parse the AppFolio marketing description into structured sections.
 * Typical format:
 *   Optional intro paragraph(s)
 *   APPLY NOW:
 *   * bullet point features
 *   *** Rental Agreement Type ***
 *   Boilerplate disclaimers...
 */
function parseDescription(raw: string): { intro: string; bullets: string[]; agreementType: string } {
  const text = raw.replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');

  const intro: string[] = [];
  const bullets: string[] = [];
  let agreementType = 'Month-to-Month Rental Agreement';
  let inBullets = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip "APPLY NOW:" / "APPLY ONLINE:" lines and bare apply URLs
    if (/^APPLY\s+(NOW|ONLINE)\s*:/i.test(trimmed)) {
      inBullets = true;
      continue;
    }
    if (/^https?:\/\/(www\.)?rentzap\.com/i.test(trimmed)) {
      continue;
    }

    // Capture rental agreement type from *** ... *** line
    const agreementMatch = trimmed.match(/^\*{2,}\s*(.+?)\s*\*{2,}$/);
    if (agreementMatch) {
      agreementType = agreementMatch[1].trim();
      break; // Everything after this is boilerplate disclaimers we handle ourselves
    }

    // Bullet line (starts with *)
    if (/^\*\s+/.test(trimmed)) {
      inBullets = true;
      bullets.push(trimmed.replace(/^\*\s+/, '').trim());
      continue;
    }

    // Before bullets started — part of intro
    if (!inBullets && trimmed) {
      intro.push(trimmed);
    }
  }

  return { intro: intro.join('\n'), bullets, agreementType };
}

/**
 * Format the human-written marketing description from AppFolio into
 * Craigslist-compatible HTML with HDPM branding and standard blocks.
 *
 * Craigslist's posting sanitizer strips tables, divs, spans, hr, img, and
 * every style= / class= attribute — anything outside the allowlist is gone.
 * Allowlist we actually use: h2, p, b, i, u, br, ul, ol, li, a, small,
 * blockquote. h2 renders as visually distinct bold, blockquote gives an
 * indented stats block, and ul bullets render cleanly.
 */
function formatListing(unit: UnitInput, rentlyEnabled: boolean, rentlyUrl: string, applyUrl: string): string {
  const rentlyBlock = rentlyEnabled
    ? `
<h2>Tour On Your Schedule</h2>
<p>No office visit or key pickup required. Self-guided tours available <b>7 days a week</b> including evenings and weekends.</p>
<p><b><a href="${rentlyUrl}">Schedule Your Haven Codebox Tour</a></b></p>
<p>${rentlyUrl}</p>
`
    : '';

  const { intro, bullets, agreementType } = parseDescription(unit.marketing_description);

  const introHtml = intro
    ? `<h2>About This Home</h2>
<p>${intro.replace(/\n/g, '<br>')}</p>`
    : '';

  const bulletsHtml = bullets.length > 0
    ? `<h2>Features &amp; Amenities</h2>
<ul>
${bullets.map((b) => `<li>${b}</li>`).join('\n')}
</ul>`
    : '';

  // Stats block as an indented blockquote — survives the sanitizer and gives
  // a clean visual offset since we can't use tables.
  const statsLines = [
    `<b>Rent:</b> $${unit.rent.toLocaleString()}/mo`,
    `<b>Bedrooms:</b> ${unit.bedrooms}`,
    `<b>Bathrooms:</b> ${unit.bathrooms}`,
    unit.sqft ? `<b>Square Feet:</b> ${unit.sqft.toLocaleString()}` : null,
    `<b>Available:</b> ${unit.available_date || 'Contact us'}`,
  ].filter(Boolean);

  return `<h2>Quick Facts</h2>
<blockquote>
${statsLines.join('<br>\n')}
</blockquote>

${introHtml}

${bulletsHtml}

<h2>Ready to Make This Home Yours?</h2>
<p><b><a href="${applyUrl}">Apply Online Now</a></b></p>
<p>${applyUrl}</p>

<h2>Questions? We're Available 24/7</h2>
<p>Our AI leasing agent Leesa is ready to help any time — no office hours, no waiting.</p>
<p><b>Call or text Leesa:</b> ${AI_LEASING_PHONE}</p>
<p><b>Visit Website:</b> <a href="https://www.highdesertpm.com">www.highdesertpm.com</a></p>
<p>https://www.highdesertpm.com</p>
${rentlyBlock}
<p><small>${agreementType}<br>
Availability date is approximate, in case of unforeseen circumstances.<br>
Security deposit listed is the base amount. Deposits are adjusted, if necessary, depending on your application screening.<br>
All information is deemed accurate and reliable but should be independently verified.</small></p>

<p><small><b>High Desert Property Management</b><br>
1515 SW Reindeer Ave &middot; Redmond, Oregon 97756<br>
<a href="https://www.highdesertpm.com">www.highdesertpm.com</a></small></p>`;
}

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { unit, rently_enabled, rently_url } = body;

  if (!unit || !unit.appfolio_unit_id) {
    return NextResponse.json({ error: 'Unit data required' }, { status: 400 });
  }

  if (!unit.marketing_description?.trim()) {
    return NextResponse.json(
      { error: 'No marketing description found in AppFolio for this unit. Please add one in AppFolio first.' },
      { status: 400 }
    );
  }

  const apply = await resolveApplyUrl(unit);
  const title = generateTitle(unit);
  const listingBody = formatListing(unit, rently_enabled, rently_url, apply.url);

  return NextResponse.json({
    title,
    body: listingBody,
    warnings: apply.warning ? [apply.warning] : [],
  });
}
