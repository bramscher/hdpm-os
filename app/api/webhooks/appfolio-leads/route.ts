import { NextRequest, NextResponse } from 'next/server';
import { verifyAppfolioSignature } from '@/lib/webhook-verify';
import { getSupabaseAdmin } from '@/lib/supabase';
import { SOURCE_BUCKETS } from '@/lib/appfolio-kpi';

// ============================================
// Webhook Payload Type
// ============================================

interface WebhookPayload {
  client_id: string;
  id: string;
  topic: string;
  entity_id: string;
  update_timestamp: string;
  message_sent_at: string;
}

// ============================================
// Lead Event Processing
// ============================================

function normalizeSource(raw: string | null): string {
  if (!raw) return 'Other';
  return SOURCE_BUCKETS[raw] ?? 'Other';
}

/**
 * Fetch the lead details from AppFolio v0 API and write to lead_events.
 * This provides a fast cache layer for today/thisWeek counts on KPI 11.
 */
async function handleLeadUpdate(entityId: string): Promise<void> {
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

  // Fetch recent leads and find the one matching entityId
  const url = new URL('https://api.appfolio.com/api/v0/leads');
  url.searchParams.set('filters[LastUpdatedAtFrom]', oneDayAgo);
  url.searchParams.set('page[number]', '1');
  url.searchParams.set('page[size]', '200');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
      'X-AppFolio-Developer-ID': developerId,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    console.error(`[Leads Webhook] AppFolio API error: ${res.status}`);
    return;
  }

  interface V0LeadWebhook {
    Id: string;
    Source: string | null;
    PropertyId: string | null;
    Status: string;
    CreatedAt: string;
  }

  const json = await res.json();
  const lead = (json.data as V0LeadWebhook[])?.find((l) => l.Id === entityId);
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
    status: lead.Status,
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

// ============================================
// POST /api/webhooks/appfolio-leads
// ============================================

export async function POST(request: NextRequest) {
  try {
    // 1. Get raw body for signature verification
    const rawBody = Buffer.from(await request.arrayBuffer());
    const jwsSignature = request.headers.get('x-jws-signature');

    if (!jwsSignature) {
      console.error('[Leads Webhook] Missing X-JWS-Signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    // 2. Verify JWS signature
    const isValid = await verifyAppfolioSignature(rawBody, jwsSignature);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // 3. Parse the verified payload
    const payload: WebhookPayload = JSON.parse(rawBody.toString());
    console.log(
      `[Leads Webhook] Received: topic=${payload.topic} entity=${payload.entity_id}`
    );

    // 4. Process lead events
    if (payload.topic === 'lead_updates') {
      await handleLeadUpdate(payload.entity_id);
    } else {
      console.log(`[Leads Webhook] Ignoring topic: ${payload.topic}`);
    }

    // 5. Always return 200 to prevent AppFolio retries
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Leads Webhook] Error:', error);
    return NextResponse.json({ received: true, error: 'processing_error' });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/appfolio-leads',
    topics: ['lead_updates'],
    message: 'AppFolio leads webhook receiver is active',
  });
}
