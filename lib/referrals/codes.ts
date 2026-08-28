/**
 * Referral code generation (Batch 1).
 *
 * A code is the referrer's public handle — it rides in `?ref=CODE` links and is
 * resolved back to a partner at lead intake (Batch 3). Requirements: unique,
 * short, unambiguous when read aloud or typed. We build `<SLUG>-<SUFFIX>`:
 *   SLUG   = up to 6 letters from the display name (A-Z), or 'REF' if none.
 *   SUFFIX = 4 chars from a Crockford-ish alphabet (no I/O/0/1 — avoids
 *            look-alikes).
 *
 * Pure/deterministic given the random source, so it's unit-testable:
 * makeReferralCode() takes an injectable RNG; the DB-collision retry loop lives
 * in lib/referrals/admin.ts.
 */

// Crockford base32 minus vowels-ish confusables: no I, L, O, U, and no 0/1.
const SUFFIX_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const SUFFIX_LEN = 4;

export function slugFromName(name: string): string {
  const letters = (name || '').toUpperCase().replace(/[^A-Z]/g, '');
  return letters.slice(0, 6) || 'REF';
}

/** rng: () => [0,1). Defaults to Math.random. */
export function randomSuffix(rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < SUFFIX_LEN; i++) {
    out += SUFFIX_ALPHABET[Math.floor(rng() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

export function makeReferralCode(name: string, rng: () => number = Math.random): string {
  return `${slugFromName(name)}-${randomSuffix(rng)}`;
}

const CODE_RE = /^[A-Z]{1,6}-[2-9A-HJKMNP-TV-Z]{4}$/;
export function isValidReferralCode(code: string): boolean {
  return CODE_RE.test(code);
}
