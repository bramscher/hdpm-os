import { NextRequest, NextResponse } from 'next/server';

const AI_LEASING_PHONE = '(541) 406-6409';

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
function formatListing(unit: UnitInput, rentlyEnabled: boolean, rentlyUrl: string): string {
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
<p><b><a href="https://www.rentzap.com/apply/${unit.appfolio_unit_id}">Apply Online Now</a></b></p>
<p>https://www.rentzap.com/apply/${unit.appfolio_unit_id}</p>

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

  const title = generateTitle(unit);
  const listingBody = formatListing(unit, rently_enabled, rently_url);

  return NextResponse.json({ title, body: listingBody });
}
