/**
 * partners.highdesertpm.com — the referrer portal on its own hostname.
 *
 * The portal lives at /partners/* in this app. On the partners host, `/` and
 * the bare referrer paths (/login, /leads, /invite/…, /auth/…) are rewritten
 * to /partners/*, and everything staff-facing is kept off it: staff pages and
 * /partners/admin redirect to the OS host, staff APIs 404. Pure so the routing
 * table is unit-tested; proxy.ts applies it.
 */

export const PARTNERS_HOST = (process.env.PARTNERS_HOST || 'partners.highdesertpm.com').toLowerCase();
export const STAFF_ORIGIN = process.env.STAFF_ORIGIN || 'https://os.highdesertpm.com';

/** Top-level referrer routes under app/partners/(referrer). */
const REFERRER_ROOTS = ['login', 'leads', 'invite', 'auth'];

export type PartnerHostRoute =
  | { kind: 'pass' }
  | { kind: 'rewrite'; path: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'not_found' };

export function isPartnersHost(host: string | null | undefined): boolean {
  return !!host && host.split(':')[0].toLowerCase() === PARTNERS_HOST;
}

/** Routing for a request that arrived on the partners host. `search` keeps the query string. */
export function partnerHostRoute(pathname: string, search = ''): PartnerHostRoute {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/_next') || p === '/favicon.ico' || p === '/robots.txt') return { kind: 'pass' };

  if (p.startsWith('/api/')) {
    if (p.startsWith('/api/partners/admin')) return { kind: 'not_found' };
    return p.startsWith('/api/partners') || p.startsWith('/api/auth') ? { kind: 'pass' } : { kind: 'not_found' };
  }

  if (p === '/partners/admin' || p.startsWith('/partners/admin/')) return { kind: 'redirect', url: `${STAFF_ORIGIN}${p}${search}` };
  if (p === '/partners' || p.startsWith('/partners/')) return { kind: 'pass' };
  if (p === '/') return { kind: 'rewrite', path: `/partners${search}` };

  const root = p.split('/')[1];
  if (REFERRER_ROOTS.includes(root)) return { kind: 'rewrite', path: `/partners${p}${search}` };

  // Anything else is the staff app: send it to the staff host.
  return { kind: 'redirect', url: `${STAFF_ORIGIN}${p}${search}` };
}

/**
 * Base URL for links sent to referrers (invites). PARTNERS_BASE_URL wins once
 * the partners domain is live; until then, the admin's own origin.
 */
export function partnersBaseUrl(requestOrigin: string): string {
  return (process.env.PARTNERS_BASE_URL || requestOrigin).replace(/\/$/, '');
}
