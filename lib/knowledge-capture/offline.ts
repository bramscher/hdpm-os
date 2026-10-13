/**
 * Rules for takes recorded offline and uploaded later (the on-device outbox,
 * lib/knowledge-capture/outbox.ts, and POST /api/knowledge-capture/recordings).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The device picks a take's id up front, so a retried upload lands on the same row. */
export function isTakeId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** How far back a recording time is trusted (a phone left in a truck for weeks). */
export const MAX_RECORDED_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Phone clocks drift; a little future is fine, a lot is a wrong clock. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * When the take was actually recorded, as an ISO string, or null to use "now".
 * Rejects anything unparseable, too old, or in the future (bad phone clock).
 */
export function recordedAtFrom(v: unknown, now = Date.now()): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t) || t > now + MAX_CLOCK_SKEW_MS || t < now - MAX_RECORDED_AGE_MS) return null;
  return new Date(Math.min(t, now)).toISOString();
}

/**
 * What the outbox does after a failed request, by HTTP status:
 *   signin — session expired (8-hour sessions); keep the take, ask to sign in
 *   retry  — server or network trouble; keep the take, try again later
 *   stuck  — the server refused it (e.g. owner no longer active); a person decides
 */
export type FailureKind = 'signin' | 'retry' | 'stuck';

export function failureKind(status: number): FailureKind {
  if (status === 401) return 'signin';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'stuck';
}
