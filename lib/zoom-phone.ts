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

export async function zoomFetch(
  path: string,
  init: RequestInit = {},
  retryOn429 = true,
  tokenOverride?: string
): Promise<Response> {
  const token = tokenOverride ?? (await getAccessToken());
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

// ============================================
// SMS (Brief D.5 — vendor chase by text)
// ============================================

/**
 * Outbound SMS via POST /phone/sms/messages (added by Zoom May 2025).
 * The sender is a fixed identity from env — Cheryl's Zoom line, so vendor
 * replies land in the Zoom app she already works from:
 *   ZOOM_SMS_SENDER_USER_ID — Zoom user id (or email) owning the line
 *   ZOOM_SMS_SENDER_NUMBER  — the SMS-capable number, E.164
 *
 * Known tenant-dependent caveat (2025 devforum): some accounts could not get
 * the SMS write scope on Server-to-Server apps or send on behalf of other
 * users. The /api/agents/sms-test probe settles it per-tenant; errors here
 * surface verbatim in agent_outbox.error.
 */

export function isZoomSmsConfigured(): boolean {
  // Sender number is always required; auth comes from either the sender's
  // stored OAuth token (Brief D.5b, preferred) or the S2S app fallback.
  return (
    !!process.env.ZOOM_SMS_SENDER_NUMBER &&
    (isZoomConfigured() || !!process.env.ZOOM_USER_CLIENT_ID)
  );
}

/**
 * Zoom rejects user-context sends from account-level (S2S) tokens — staff
 * confirmed the user endpoint needs a token OWNED by the sending user
 * (devforum 133055; surfaces as 7639 "number does not belong to the current
 * user", 124, or 135). Detect that class of rejection so we can retry via
 * the account-level endpoint Zoom added for exactly this case.
 */
function isUserContextRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 401 && status !== 403) return false;
  return /"code"\s*:\s*(7639|124|135)|current user|another user/i.test(body);
}

/** The mailbox^W phone line owner whose Zoom account sends the texts. */
export function smsSenderEmail(): string {
  return process.env.ZOOM_SMS_SENDER_EMAIL || 'cheryl@highdesertpm.com';
}

export async function sendSms(input: {
  toPhoneNumber: string; // E.164
  message: string;
}): Promise<{ messageId: string | null }> {
  const senderUserId = process.env.ZOOM_SMS_SENDER_USER_ID;
  const senderNumber = process.env.ZOOM_SMS_SENDER_NUMBER;
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  if (!senderNumber) {
    throw new Error('Zoom SMS sender not configured (ZOOM_SMS_SENDER_NUMBER)');
  }

  // Preferred path (Brief D.5b): the sender's OWN OAuth token — the only
  // token class Zoom accepts for the user-level SMS send. Falls back to the
  // S2S attempt chain when the sender hasn't authorized yet, so the probe
  // still reports something actionable.
  const { getZoomUserAuth } = await import('@/lib/zoom-user-oauth');
  const userAuth = await getZoomUserAuth(smsSenderEmail()).catch((err) => {
    throw new Error(err instanceof Error ? err.message : String(err));
  });

  const bodyFor = (userId: string) =>
    JSON.stringify({
      message: input.message,
      sender: { user_id: userId, phone_number: senderNumber },
      to_members: [{ phone_number: input.toPhoneNumber }],
    });

  let endpoint = '/phone/sms/messages';
  let res: Response;
  let text: string;

  if (userAuth) {
    res = await zoomFetch(
      endpoint,
      { method: 'POST', body: bodyFor(userAuth.zoomUserId ?? senderUserId ?? 'me') },
      true,
      userAuth.accessToken
    );
    text = await res.text();
  } else {
    if (!senderUserId) {
      throw new Error(
        `Zoom SMS: ${smsSenderEmail()} has not authorized the SMS app (visit /api/agents/zoom-oauth/start) and no ZOOM_SMS_SENDER_USER_ID fallback is set`
      );
    }
    const body = bodyFor(senderUserId);
    res = await zoomFetch(endpoint, { method: 'POST', body });
    text = await res.text();
    if (!res.ok && accountId && isUserContextRejection(res.status, text)) {
      endpoint = `/accounts/${encodeURIComponent(accountId)}/phone/sms/messages`;
      res = await zoomFetch(endpoint, { method: 'POST', body });
      text = await res.text();
    }
    if (!res.ok && isUserContextRejection(res.status, text)) {
      throw new Error(
        `Zoom SMS send error (${res.status}) [${endpoint}]: ${text.substring(0, 200)} — S2S tokens can't send SMS; have ${smsSenderEmail()} authorize via /api/agents/zoom-oauth/start`
      );
    }
  }

  if (!res.ok) {
    throw new Error(`Zoom SMS send error (${res.status}) [${endpoint}]: ${text.substring(0, 300)}`);
  }
  try {
    const data = JSON.parse(text) as { message_id?: string; id?: string };
    return { messageId: data.message_id ?? data.id ?? null };
  } catch {
    return { messageId: null };
  }
}
