import { getSupabaseAdmin } from '@/lib/supabase';
import { SOURCE_BUCKETS } from '@/lib/appfolio-kpi';

function normalizeSource(raw: string | null): string {
  if (!raw) return 'Other';
  return SOURCE_BUCKETS[raw] ?? 'Other';
}

interface V0LeadWebhook {
  Id: string;
  Source: string | null;
  PropertyId: string | null;
  Status: string;
  InactiveReason: string | null;
  CreatedAt: string;
}

/**
 * Fetch the lead details from AppFolio v0 API and write to lead_events.
 * This provides a fast cache layer for today/thisWeek counts on KPI 11 and
 * the raw material for response-time metrics.
 */
export async function handleLeadUpdate(entityId: string): Promise<void> {
  console.log(`[Leads Webhook] Processing lead ${entityId}`);

  const clientId = process.env.APPFOLIO_CLIENT_ID;
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET;
  const developerId = process.env.APPFOLIO_DEVELOPER_ID;

  if (!clientId || !clientSecret || !developerId) {
    console.warn('[Leads Webhook] Missing AppFolio credentials');
    return;
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Fetch recent leads and find the one matching entityId. Follow
  // next_page_path — the server caps page[size] at 100 (2026-05), so a busy
  // day spans multiple pages.
  const headers = {
    Authorization: `Basic ${auth}`,
    'X-AppFolio-Developer-ID': developerId,
    Accept: 'application/json',
  };
  let lead: V0LeadWebhook | undefined;
  let url =
    'https://api.appfolio.com/api/v0/leads?' +
    new URLSearchParams({
      'filters[LastUpdatedAtFrom]': oneDayAgo,
      'page[number]': '1',
      'page[size]': '100',
    }).toString();

  for (let page = 1; page <= 20 && !lead; page++) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[Leads Webhook] AppFolio API error: ${res.status}`);
      return;
    }
    const json = await res.json();
    lead = (json.data as V0LeadWebhook[])?.find((l) => l.Id === entityId);
    if (!json.next_page_path) break;
    url = `https://api.appfolio.com${json.next_page_path}`;
  }
  if (!lead) {
    console.warn(`[Leads Webhook] Lead ${entityId} not found in recent updates`);
    return;
  }

  // Write to lead_events table
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('lead_events').insert({
    appfolio_lead_id: lead.Id,
    source_raw: lead.Source,
    source_normalized: normalizeSource(lead.Source),
    property_id: lead.PropertyId,
    // Status is just active/inactive since the 2026-05 API change; the
    // conversion signal lives in InactiveReason ('converted_to_tenant').
    status: lead.InactiveReason ? `${lead.Status}:${lead.InactiveReason}` : lead.Status,
    created_at: lead.CreatedAt,
  });

  if (error) {
    console.error('[Leads Webhook] Failed to insert lead event:', error.message);
    return;
  }

  console.log(
    `[Leads Webhook] Lead ${entityId} cached: source=${lead.Source}, status=${lead.Status}`
  );
}
