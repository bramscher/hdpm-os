/**
 * Zoom Phone API client.
 *
 * Auth: Server-to-Server OAuth (internal app). We exchange the account
 * credentials for a 1-hour access token and cache it in module memory.
 *   POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=...
 *   Authorization: Basic base64(clientId:clientSecret)
 *
 * Contacts live under the Zoom Phone "External Contacts" API:
 *   GET    /phone/external_contacts            (paginated)
 *   POST   /phone/external_contacts            (create → returns external_contact_id)
 *   PATCH  /phone/external_contacts/{id}       (update)
 *   DELETE /phone/external_contacts/{id}       (delete — provided but unused for now)
 *
 * Required env vars:
 *   ZOOM_ACCOUNT_ID
 *   ZOOM_CLIENT_ID
 *   ZOOM_CLIENT_SECRET
 *
 * Like the AppFolio client, getConfig() returns null when creds are missing so
 * callers can skip cleanly instead of throwing.
 */

const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token';
const ZOOM_API_BASE = 'https://api.zoom.us/v2';

function getConfig() {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    console.warn('[Zoom] Missing API credentials — sync will be skipped');
    console.warn('[Zoom] Need: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET');
    return null;
  }
  return { accountId, clientId, clientSecret };
}

export function isZoomConfigured(): boolean {
  return getConfig() !== null;
}

// ============================================
// Access token (cached ~1h)
// ============================================

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Reuse if more than 60s of life remains.
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token;
  }

  const config = getConfig();
  if (!config) throw new Error('Zoom credentials not configured');

  const { accountId, clientId, clientSecret } = config;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const url = new URL(ZOOM_OAUTH_URL);
  url.searchParams.set('grant_type', 'account_credentials');
  url.searchParams.set('account_id', accountId);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zoom OAuth error (${res.status}): ${text.substring(0, 300)}`);
  }

  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// ============================================
// Low-level request helper
// ============================================

async function zoomFetch(
  path: string,
  init: RequestInit = {},
  retryOn429 = true
): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${ZOOM_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  // Zoom rate limits with 429 + Retry-After. Back off once and retry.
  if (res.status === 429 && retryOn429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '2', 10);
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
    return zoomFetch(path, init, false);
  }

  return res;
}

// ============================================
// Types
// ============================================

export interface ZoomExternalContact {
  external_contact_id: string;
  name?: string;
  email?: string;
  description?: string;
  phone_numbers?: string[];
  id?: string; // our custom id, if it was set on create
}

export interface ZoomContactPayload {
  name: string;
  phone_numbers: string[]; // E.164
  email?: string;
  description?: string;
  /** Custom external id we assign for traceability, e.g. "hdpm-tenant-<appfolioId>". */
  id?: string;
}

// ============================================
// List all external contacts (paginated)
// ============================================

export async function listAllExternalContacts(): Promise<ZoomExternalContact[]> {
  const all: ZoomExternalContact[] = [];
  let nextPageToken = '';
  let page = 0;

  do {
    const qs = new URLSearchParams({ page_size: '100' });
    if (nextPageToken) qs.set('next_page_token', nextPageToken);

    const res = await zoomFetch(`/phone/external_contacts?${qs.toString()}`);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Zoom list contacts error (${res.status}): ${text.substring(0, 300)}`);
    }
    const json = JSON.parse(text) as {
      external_contacts?: ZoomExternalContact[];
      next_page_token?: string;
    };
    all.push(...(json.external_contacts || []));
    nextPageToken = json.next_page_token || '';
    page++;
  } while (nextPageToken && page < 200); // safety cap

  return all;
}

// ============================================
// Create / Update / Delete
// ============================================

export async function createExternalContact(
  payload: ZoomContactPayload
): Promise<string> {
  const res = await zoomFetch('/phone/external_contacts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zoom create contact error (${res.status}): ${text.substring(0, 300)}`);
  }
  const json = text ? (JSON.parse(text) as ZoomExternalContact) : ({} as ZoomExternalContact);
  const id = json.external_contact_id || json.id;
  if (!id) {
    throw new Error('Zoom create contact returned no external_contact_id');
  }
  return id;
}

export async function updateExternalContact(
  externalContactId: string,
  payload: Partial<ZoomContactPayload>
): Promise<void> {
  const res = await zoomFetch(
    `/phone/external_contacts/${encodeURIComponent(externalContactId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoom update contact error (${res.status}): ${text.substring(0, 300)}`);
  }
}

export async function deleteExternalContact(externalContactId: string): Promise<void> {
  const res = await zoomFetch(
    `/phone/external_contacts/${encodeURIComponent(externalContactId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Zoom delete contact error (${res.status}): ${text.substring(0, 300)}`);
  }
}
