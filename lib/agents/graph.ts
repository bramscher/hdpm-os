/**
 * App-only Microsoft Graph client — the first headless Graph path in the
 * repo (docs/agent-os/00-DRAFT-master-plan.md Phase 0 Azure item). Distinct
 * from the NextAuth delegated flow (AZURE_AD_* in lib/auth.ts): this uses
 * client credentials against the "HDPM-OS Agent Mail" app registration,
 * which holds application Mail.ReadWrite admin-consented and is scoped via
 * ApplicationAccessPolicy to cheryl@ and info@ only — a draft POST to any
 * other mailbox comes back 403 by design.
 *
 * Env:
 *   AZURE_TENANT_ID           — tenant (NOT AZURE_AD_TENANT_ID)
 *   AGENT_GRAPH_CLIENT_ID     — app registration client id
 *   AGENT_GRAPH_CLIENT_SECRET — client secret
 *   AGENT_GRAPH_DRYRUN=1      — short-circuit before any network call
 *
 * Raw fetch, no msal — matches the repo's existing Graph idiom
 * (lib/maintenance/route-calendar.ts).
 */

import type { SendOutcome } from './channels';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Null when the env vars are missing (callers map that to 'skipped'). */
export async function getAppOnlyGraphToken(): Promise<string | null> {
  const tenant = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AGENT_GRAPH_CLIENT_ID;
  const clientSecret = process.env.AGENT_GRAPH_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) return null;

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`graph token ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

export interface GraphDraftInput {
  /** Mailbox UPN the draft lands in, e.g. cheryl@highdesertpm.com. */
  mailbox: string;
  subject: string;
  htmlBody: string;
  /** Graph accepts recipient-less drafts — the human fills To: before sending. */
  toRecipients: string[];
}

/**
 * Create a draft in the mailbox's Drafts folder (a message POSTed to
 * /users/{upn}/messages is a draft until sent — exactly the L1 contract).
 */
export async function createOutlookDraft(input: GraphDraftInput): Promise<SendOutcome> {
  if (process.env.AGENT_GRAPH_DRYRUN === '1') {
    return { status: 'skipped', error: 'AGENT_GRAPH_DRYRUN=1' };
  }

  try {
    const token = await getAppOnlyGraphToken();
    if (!token) {
      return { status: 'skipped', error: 'Graph app-only env not configured' };
    }

    const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(input.mailbox)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: input.subject,
        body: { contentType: 'HTML', content: input.htmlBody },
        toRecipients: input.toRecipients.map((address) => ({ emailAddress: { address } })),
      }),
    });

    if (!res.ok) {
      // Surface ApplicationAccessPolicy 403s etc. in agent_outbox.error.
      const body = await res.text();
      return { status: 'failed', error: `graph ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json()) as { id?: string };
    return { status: 'sent', message_id: data.id ?? null };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
