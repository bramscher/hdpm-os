/**
 * Referral lead dedupe (Batch 3). First-touch-wins: a newly submitted prospect
 * is checked against existing OPEN referral leads and (best-effort) current
 * AppFolio owners. A match flags the new lead as suspected-duplicate and points
 * dup_of at the earlier lead — it never auto-rejects; an admin confirms/clears.
 *
 * The matcher is pure (no DB/network) so it's unit-testable; runDedupe() wires
 * it to live data. Matching mirrors lib/haven-af-match: normalized email first,
 * then last-10-digit phone, then a conservative exact-normalized-name match.
 */

export interface DedupeCandidate {
  kind: 'lead' | 'owner';
  id: string; // referral_lead.id, or appfolio owner id
  name: string | null;
  email: string | null;
  phone: string | null;
  firstTouchAt?: string | null; // leads only — earliest wins
}

export interface Prospect {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export type DedupeReason = 'email' | 'phone' | 'name';

export interface DedupeHit {
  candidate: DedupeCandidate;
  reason: DedupeReason;
}

export function normEmail(e: string | null | undefined): string | null {
  const v = (e || '').trim().toLowerCase();
  return v.includes('@') ? v : null;
}

export function normPhone(p: string | null | undefined): string | null {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Lowercase, drop the "O - "/"T - " AppFolio prefix + punctuation, collapse spaces. */
export function normName(n: string | null | undefined): string | null {
  const v = (n || '')
    .toLowerCase()
    .replace(/^[a-z]\s*-\s*/i, '') // "O - Jane Smith" → "jane smith"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v.length >= 3 ? v : null;
}

const earlier = (a: DedupeCandidate, b: DedupeCandidate) =>
  (a.firstTouchAt || '') <= (b.firstTouchAt || '') ? a : b;

/**
 * Strongest match wins across all candidates: email, else phone, else exact
 * normalized name. Within a reason, the earliest first-touch candidate wins
 * (leads carry firstTouchAt; owners sort last, treated as pre-existing).
 */
export function findDuplicate(prospect: Prospect, candidates: DedupeCandidate[]): DedupeHit | null {
  const pe = normEmail(prospect.email);
  const pp = normPhone(prospect.phone);
  const pn = normName(prospect.name);

  const pick = (reason: DedupeReason, match: (c: DedupeCandidate) => boolean): DedupeHit | null => {
    const hits = candidates.filter(match);
    if (hits.length === 0) return null;
    // Owners have no firstTouchAt; treat them as earliest (pre-existing).
    const best = hits.reduce((acc, c) =>
      c.kind === 'owner' && acc.kind !== 'owner' ? c : acc.kind === 'owner' ? acc : earlier(acc, c)
    );
    return { candidate: best, reason };
  };

  return (
    (pe && pick('email', (c) => normEmail(c.email) === pe)) ||
    (pp && pick('phone', (c) => normPhone(c.phone) === pp)) ||
    (pn && pick('name', (c) => normName(c.name) === pn)) ||
    null
  );
}
