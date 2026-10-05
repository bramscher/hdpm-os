/**
 * Server-only client for hdpm-web's admin endpoints (/api/os/*).
 *
 * Authenticated with HDPM_OS_ADMIN_TOKEN — a secret separate from
 * HDPM_SERVICE_TOKEN, so only these admin calls can reach applicant data.
 * Callers must check access first (requireSection('hiring')); the acting staff email is sent
 * as x-hdpm-actor and logged by the website.
 */

/** Where staff open the website admin in their browser (www.highdesertpm.com/admin). */
export const WEBSITE_URL = 'https://www.highdesertpm.com';

/** Server-to-server base; HDPM_WEB_BASE_URL may point at a deployment URL. */
function apiBaseUrl(): string {
  return (process.env.HDPM_WEB_BASE_URL || WEBSITE_URL).replace(/\/$/, '');
}

export async function webAdminFetch(path: string, actor: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.HDPM_OS_ADMIN_TOKEN;
  if (!token) {
    return Response.json({ error: 'Website connection is not configured (HDPM_OS_ADMIN_TOKEN).' }, { status: 503 });
  }
  try {
    return await fetch(`${apiBaseUrl()}/api/os${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        'x-hdpm-actor': actor,
      },
    });
  } catch (err) {
    console.error('[hdpm-web-admin] request failed:', path, err instanceof Error ? err.message : err);
    return Response.json({ error: 'Could not reach the website. Try again shortly.' }, { status: 502 });
  }
}
