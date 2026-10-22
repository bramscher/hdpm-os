/**
 * Door, gate and lockbox codes from AppFolio's free-text Maintenance Notes
 * (unit and property), for the inspection route event. The notes also hold
 * paint codes, filter sizes and builder "Property code"s, so only phrases that
 * read like an access code are kept, e.g. "Door Code: 1234", "Fence Combo Lock #5678".
 */

// Up to three words before the keyword ("Door & Garage Code"), then the code: quoted, or containing a digit.
const CODE_PHRASE = /\b((?:[A-Za-z&]+ ){0,3})(code|combo(?: lock)?|keypad)\b([^\w"#]{0,3}(?:for [A-Za-z]+ )?)("[^"]{2,20}"|#?[A-Za-z0-9-]*\d[A-Za-z0-9-]*)/gi;
// "#1234 Entry Gate"
const GATE_FIRST = /#(\d{3,8}) ((?:[A-Za-z]+ )?gate)\b/gi;
const NOT_ACCESS = /\b(paint|property|customer|color|colour|filter|warranty|zip)\b/i;

export function accessCodes(...notes: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of notes) {
    const text = raw?.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const m of text.matchAll(CODE_PHRASE)) {
      if (NOT_ACCESS.test(m[1])) continue;
      out.push(`${m[1]}${m[2]}${m[3]}${m[4]}`.trim());
    }
    for (const m of text.matchAll(GATE_FIRST)) out.push(`${m[2]} #${m[1]}`);
  }
  return [...new Set(out)];
}
